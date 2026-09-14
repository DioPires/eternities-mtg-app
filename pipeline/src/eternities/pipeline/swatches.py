"""Stage 7 — the swatch fetch (worlds spec §2.2, §2.6 item 3).

One 8-byte statistic per card: its art downsampled to 2x2 and quantised to RGB565. This is the
enabler for the whole of concept B. The contract carries ``hueClass`` today, which is a seven-way
classification of *colour identity* — not a pixel statistic — which is why the W2.3 prototype had
to fake a per-card colour, and why the fake was the thing to be most sceptical of in its captures.

Three properties this module exists to hold:

**It is the only stage besides ``scryfall.py`` that touches the network**, and it is by far the
longest wall-clock stage in the pipeline: one request per card, tens of thousands of them. So it is
**resumable** — every decoded record is appended to a ``(id, imageTs)``-keyed cache the moment it
lands, and a re-run fetches only what is missing. A refresh re-fetches only what Scryfall actually
changed, because ``imageTs`` is Scryfall's own cache-busting stamp and is part of the key.

**It is polite.** Six concurrent requests (§2.2) behind a global minimum gap, retries with backoff
on the transient statuses only, and Scryfall's own ``User-Agent``.

**It is not a repackaging.** An 8-byte colour statistic is not a proxy for, nor a republication of,
Scryfall's images (review §4.4); the images themselves are never stored.
"""

from __future__ import annotations

import json
import threading
import time
import urllib.error
import urllib.request
from collections.abc import Callable, Iterable, Sequence
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path
from typing import TYPE_CHECKING, Any, Final, cast

from ..contract.images import ImageSize, image_uri
from ..contract.models import Swatch
from .scryfall import USER_AGENT

if TYPE_CHECKING:  # pragma: no cover - typing only
    from PIL.Image import Image

DEFAULT_CACHE: Final = (
    Path(__file__).resolve().parents[3] / ".cache" / "swatches" / "swatches.jsonl"
)

SWATCH_SOURCE: Final[ImageSize] = "art_crop"
"""Which Scryfall image the statistic is taken from (§5 Q1, and this spec's recommendation).

Review §4.2 said ``small``. ``small`` is the whole card — frame, border, text box — so a 2x2 of it
is dominated by frame colour, which *is* the colour identity, which is ``hueClass`` again: the new
statistic would be nearly as inert as the one it replaces. ``art_crop`` is the honest source and
costs roughly 9x the bytes, once, into a cache that is never re-fetched unless Scryfall changes the
art. The owner ask carrying this question is pending on DEC-690 (``0eda5f77``) with this as its
recommendation; an answer of ``small`` changes this constant and nothing else in this module."""

CONCURRENCY: Final = 6
"""§2.2's fetch discipline."""

MIN_REQUEST_GAP_S: Final = 0.05
"""Scryfall asks for 50-100 ms between requests. Enforced *globally* rather than per worker: six
workers each sleeping 50 ms is 120 requests a second, which is not what the guidance means."""

MAX_ATTEMPTS: Final = 4
RETRY_STATUSES: Final[frozenset[int]] = frozenset({408, 425, 429, 500, 502, 503, 504})
_TIMEOUT: Final = 60


@dataclass(frozen=True, slots=True)
class SwatchRequest:
    """One card's art source: the printing whose art its cell shows.

    ``printing_id``/``image_ts`` are **printing index 0** — the release-ordered first element of the
    card's ``p`` array, which is what §2.3 says a cell shows and credits. That is deliberately *not*
    the same thing as the card's debut printing: ``p`` is ordered by the printing's set release
    date, and a promo or a list reprint can sort ahead of the set the card debuted in.
    """

    oracle_id: str
    printing_id: str
    image_ts: int


@dataclass(slots=True)
class SwatchStats:
    """PRD 9.2's report line for this stage (§2.6 item 5)."""

    wanted: int = 0
    cache_hits: int = 0
    fetched: int = 0
    failures: list[tuple[str, str]] = field(default_factory=list)
    """``(printing id, reason)`` for every card whose art could not be turned into a swatch."""

    bytes_downloaded: int = 0
    elapsed_s: float = 0.0

    @property
    def failed(self) -> int:
        return len(self.failures)


class SwatchCache:
    """A ``(printing id, imageTs)``-keyed store of decoded 8-byte records.

    An append-only JSONL log rather than a file per card. 28,587 eight-byte files would spend a
    filesystem block each — over a hundred megabytes to hold 223 KB — and would make "how far did
    the last run get" a directory scan. The log is read once at start-up and appended to under a
    lock as records land, so a run killed mid-fetch loses at most the record in flight.

    The *decoded record* is cached, never the image. That is what makes the pipeline deterministic
    across machines once a cache is shared, and it is also why this directory is not a mirror of
    Scryfall's art (review §4.4).
    """

    def __init__(self, path: Path) -> None:
        self.path = path
        self._entries: dict[tuple[str, int], Swatch] = {}
        self._lock = threading.Lock()
        self._handle: Any = None
        if path.exists():
            self._load()

    def _load(self) -> None:
        with self.path.open("r", encoding="utf-8") as handle:
            for line in handle:
                line = line.strip()
                if not line:
                    continue
                try:
                    row = cast("dict[str, Any]", json.loads(line))
                    samples = cast("list[int]", row["s"])
                    self._entries[(str(row["id"]), int(row["ts"]))] = (
                        samples[0],
                        samples[1],
                        samples[2],
                        samples[3],
                    )
                except (ValueError, KeyError, IndexError):
                    # A line truncated by a kill mid-append. Everything before it is still good,
                    # and the missing record is simply re-fetched; refusing the whole cache over a
                    # torn tail would throw away hours of work to save one request.
                    continue

    def get(self, printing_id: str, image_ts: int) -> Swatch | None:
        return self._entries.get((printing_id, image_ts))

    def put(self, printing_id: str, image_ts: int, swatch: Swatch) -> None:
        with self._lock:
            if (printing_id, image_ts) in self._entries:
                return
            self._entries[(printing_id, image_ts)] = swatch
            if self._handle is None:
                self.path.parent.mkdir(parents=True, exist_ok=True)
                self._handle = self.path.open("a", encoding="utf-8")
            self._handle.write(
                json.dumps({"id": printing_id, "ts": image_ts, "s": list(swatch)}) + "\n"
            )
            self._handle.flush()

    def close(self) -> None:
        with self._lock:
            if self._handle is not None:
                self._handle.close()
                self._handle = None

    def __len__(self) -> int:
        return len(self._entries)


class _Throttle:
    """A global minimum gap between requests, shared by every worker."""

    def __init__(self, gap_s: float) -> None:
        self._gap = gap_s
        self._lock = threading.Lock()
        self._next = 0.0

    def wait(self) -> None:
        with self._lock:
            now = time.monotonic()
            delay = max(0.0, self._next - now)
            self._next = max(now, self._next) + self._gap
        if delay > 0:
            time.sleep(delay)


def rgb565(red: int, green: int, blue: int) -> int:
    """Pack one 8-bit-per-channel sample into a uint16 RGB565.

    Truncation, not rounding: rounding 0xFF up overflows the 5-bit field, and the guard that would
    stop it costs more than the half-LSB it buys on a statistic this coarse.
    """
    return ((red & 0xF8) << 8) | ((green & 0xFC) << 3) | (blue >> 3)


_SRGB_TO_LINEAR: Final[tuple[float, ...]] = tuple(
    (v / 255.0 / 12.92) if v <= 10 else (((v / 255.0) + 0.055) / 1.055) ** 2.4 for v in range(256)
)


def _linear_to_srgb_byte(value: float) -> int:
    encoded = value * 12.92 if value <= 0.0031308 else 1.055 * (value ** (1 / 2.4)) - 0.055
    return min(255, max(0, int(encoded * 255.0 + 0.5)))


def swatch_from_image(image: Image) -> Swatch:
    """The card's art as four RGB565 samples: top-left, top-right, bottom-left, bottom-right.

    Averaged in **linear light**, not in sRGB bytes. Averaging gamma-encoded values darkens every
    mixed quadrant, and a mosaic of tens of thousands of cells is exactly where a systematic
    darkening reads as a bug rather than as art.

    The quadrant split is ``width // 2`` and ``height // 2``, so an odd dimension gives the right
    and bottom halves the extra pixel. Arbitrary but fixed: it has to be *some* rule, and a
    deterministic one is what keeps a dataset's content hash reproducible (PRD 4.9.1).
    """
    rgb = image.convert("RGB")
    width, height = rgb.size
    if width < 2 or height < 2:
        raise ValueError(f"art is {width}x{height}; a 2x2 statistic needs at least 2x2")
    pixels = rgb.tobytes()
    mid_x, mid_y = width // 2, height // 2

    out: list[int] = []
    for y0, y1 in ((0, mid_y), (mid_y, height)):
        for x0, x1 in ((0, mid_x), (mid_x, width)):
            totals = [0.0, 0.0, 0.0]
            for y in range(y0, y1):
                base = y * width * 3
                for offset in range(base + x0 * 3, base + x1 * 3, 3):
                    totals[0] += _SRGB_TO_LINEAR[pixels[offset]]
                    totals[1] += _SRGB_TO_LINEAR[pixels[offset + 1]]
                    totals[2] += _SRGB_TO_LINEAR[pixels[offset + 2]]
            count = (y1 - y0) * (x1 - x0)
            out.append(rgb565(*(_linear_to_srgb_byte(channel / count) for channel in totals)))
    return (out[0], out[1], out[2], out[3])


def _decode(payload: bytes) -> Swatch:
    from io import BytesIO

    from PIL import Image as PilImage

    with PilImage.open(BytesIO(payload)) as image:
        return swatch_from_image(image)


def _fetch_one(
    request: SwatchRequest, throttle: _Throttle, stats_lock: threading.Lock, stats: SwatchStats
) -> tuple[SwatchRequest, Swatch | None, str]:
    uri = image_uri(request.printing_id, request.image_ts, SWATCH_SOURCE)
    last = "unknown"
    for attempt in range(MAX_ATTEMPTS):
        throttle.wait()
        try:
            http = urllib.request.Request(uri, headers={"User-Agent": USER_AGENT, "Accept": "*/*"})
            with urllib.request.urlopen(http, timeout=_TIMEOUT) as response:
                payload = cast("bytes", response.read())
            with stats_lock:
                stats.bytes_downloaded += len(payload)
            return request, _decode(payload), ""
        except urllib.error.HTTPError as error:
            last = f"HTTP {error.code}"
            if error.code not in RETRY_STATUSES:
                return request, None, last
        except (urllib.error.URLError, TimeoutError, OSError) as error:
            last = f"{type(error).__name__}: {error}"
        except ValueError as error:
            # A decode failure is not transient: the same bytes will not parse next time either.
            return request, None, f"decode: {error}"
        time.sleep(0.5 * (2**attempt))
    return request, None, last


def fetch_swatches(
    requests: Sequence[SwatchRequest],
    cache: SwatchCache,
    *,
    log: Callable[[str], object] | None = None,
    concurrency: int = CONCURRENCY,
    limit: int | None = None,
) -> SwatchStats:
    """Fill ``cache`` with a swatch for every request, and report what it cost.

    Returns as soon as every request is answered or has exhausted its retries. Nothing is returned
    per card on purpose: the cache *is* the result, so a killed run and a finished one leave the
    same artefact and the next call resumes from it.

    ``limit`` caps how many *new* fetches this call makes, which is what lets a long warm be split
    across several sittings without holding a process open for an hour.
    """
    emit: Callable[[str], object] = log or (lambda _message: None)
    stats = SwatchStats(wanted=len(requests))

    outstanding: list[SwatchRequest] = []
    seen: set[tuple[str, int]] = set()
    for request in requests:
        key = (request.printing_id, request.image_ts)
        if cache.get(*key) is not None:
            stats.cache_hits += 1
        elif key not in seen:
            # Two cards can share a printing id only through bad data, but two *requests* for the
            # same key inside one run are free to collapse, and doing so before the executor sees
            # them keeps the request count honest in the report.
            seen.add(key)
            outstanding.append(request)

    if limit is not None and len(outstanding) > limit:
        emit(f"  capping this run at {limit:,} new fetches of {len(outstanding):,} outstanding")
        outstanding = outstanding[:limit]

    emit(f"  {stats.cache_hits:,} cached, {len(outstanding):,} to fetch from {SWATCH_SOURCE}")
    if not outstanding:
        return stats

    throttle = _Throttle(MIN_REQUEST_GAP_S)
    stats_lock = threading.Lock()
    started = time.monotonic()
    done = 0
    with ThreadPoolExecutor(max_workers=concurrency) as pool:

        def run(r: SwatchRequest) -> tuple[SwatchRequest, Swatch | None, str]:
            return _fetch_one(r, throttle, stats_lock, stats)

        for request, swatch, reason in pool.map(run, outstanding):
            done += 1
            if swatch is None:
                stats.failures.append((request.printing_id, reason))
            else:
                cache.put(request.printing_id, request.image_ts, swatch)
                stats.fetched += 1
            if done % 1000 == 0:
                rate = done / max(time.monotonic() - started, 1e-9)
                remaining = (len(outstanding) - done) / max(rate, 1e-9)
                emit(
                    f"  {done:,}/{len(outstanding):,} at {rate:.1f}/s, "
                    f"~{remaining / 60:.0f} min left, {stats.failed} failed"
                )

    stats.elapsed_s = time.monotonic() - started
    return stats


def swatches_for(requests: Iterable[SwatchRequest], cache: SwatchCache) -> list[Swatch]:
    """The star-ordered swatch column ``swatches.bin`` is encoded from.

    Raises rather than substituting a placeholder for a card the cache has no swatch for. A missing
    swatch is a *black cell* on a map whose entire claim is that colour means something, and a run
    that quietly shipped one would be indistinguishable in the artefacts from a run that fetched
    everything. The caller decides whether to tolerate that, and says so out loud.
    """
    out: list[Swatch] = []
    missing: list[str] = []
    for request in requests:
        swatch = cache.get(request.printing_id, request.image_ts)
        if swatch is None:
            missing.append(request.printing_id)
        else:
            out.append(swatch)
    if missing:
        raise MissingSwatchError(missing)
    return out


class MissingSwatchError(RuntimeError):
    """The swatch cache does not cover every card in the dataset."""

    def __init__(self, missing: Sequence[str]) -> None:
        self.missing = list(missing)
        shown = ", ".join(self.missing[:5])
        more = f" (and {len(self.missing) - 5} more)" if len(self.missing) > 5 else ""
        super().__init__(
            f"{len(self.missing)} cards have no swatch: {shown}{more}. Re-run the swatch stage; "
            "it resumes from the cache and re-fetches only what is missing."
        )
