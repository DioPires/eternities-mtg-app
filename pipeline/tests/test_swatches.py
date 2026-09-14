"""The swatch stage of worlds spec §2.2: the 2x2 statistic, the cache, and the fetch discipline.

The stage is the second impure one in the pipeline and the only one that decodes an image, so the
things worth pinning here are the ones that are invisible in the artefact: that the downsample
averages in **linear light** and not in sRGB bytes, that the cache is genuinely resumable across a
kill, and that a card with no swatch stops the build instead of shipping a black cell.

Nothing here touches the network — ``urlopen`` is stubbed — and nothing decodes a real JPEG except
through Pillow, which is pinned in ``pyproject.toml`` because these pixels feed a content-hashed
dataset name (PRD 4.9.1).
"""

from __future__ import annotations

import io
import json
import struct
import threading
import urllib.error
from pathlib import Path
from collections.abc import Callable
from typing import Any

import pytest
from PIL import Image

from eternities.pipeline import swatches as sw


type Pixel = tuple[int, int, int]


def _image(width: int, height: int, pixels: list[Pixel]) -> Image.Image:
    image = Image.new("RGB", (width, height))
    image.putdata(pixels)  # pyright: ignore[reportUnknownMemberType]
    return image


def _png(pixels: list[list[Pixel]]) -> bytes:
    image = _image(len(pixels[0]), len(pixels), [p for row in pixels for p in row])
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def _ok(_uri: str) -> _Response:
    return _Response(PIXELS)


def _no_sleep(_seconds: float) -> None:
    """Backoff is a real behaviour and a real delay; the tests assert the first, not the second."""


def _request(index: int = 0, ts: int = 1700000000) -> sw.SwatchRequest:
    return sw.SwatchRequest(
        oracle_id=f"oracle-{index}", printing_id=f"printing-{index}", image_ts=ts
    )


# --- the statistic -----------------------------------------------------------------------------


def test_rgb565_packs_the_five_six_five_fields():
    assert sw.rgb565(255, 255, 255) == 0xFFFF
    assert sw.rgb565(255, 0, 0) == 0xF800
    # Green is the six-bit field, which is the one an RGB555 packing gets wrong.
    assert sw.rgb565(0, 255, 0) == 0x07E0
    assert sw.rgb565(0, 0, 255) == 0x001F
    assert sw.rgb565(0, 0, 0) == 0x0000


def test_each_quadrant_becomes_its_own_sample_in_reading_order():
    red, green, blue, white = (255, 0, 0), (0, 255, 0), (0, 0, 255), (255, 255, 255)
    top = [*[red] * 2, *[green] * 2]
    bottom = [*[blue] * 2, *[white] * 2]
    image = _image(4, 4, [*top, *top, *bottom, *bottom])
    assert sw.swatch_from_image(image) == (0xF800, 0x07E0, 0x001F, 0xFFFF)


def test_the_average_is_taken_in_linear_light_not_in_srgb_bytes():
    """§1.4's mosaic is where a systematic darkening reads as a bug rather than as art.

    Half black and half white averages to 0.5 in *linear* light, which is sRGB 188 — not 128. The
    byte-space average is the mutant this exists to kill, and the two differ by 24% of the range.
    """
    # 4x4 so each *quadrant* is a black row over a white row; a 2x2 would give each quadrant a
    # single pixel and average nothing at all.
    black: Pixel = (0, 0, 0)
    white: Pixel = (255, 255, 255)
    image = _image(4, 4, [*[black] * 4, *[white] * 4, *[black] * 4, *[white] * 4])
    top_left = sw.swatch_from_image(image)[0]
    red5 = top_left >> 11
    assert red5 == 188 >> 3, f"expected the linear mean (sRGB 188), got {red5 << 3}"
    assert red5 != 128 >> 3, "this is the sRGB-byte mean, which is the bug"


def test_an_odd_dimension_gives_the_extra_pixel_to_the_far_half():
    """Arbitrary but fixed: a content hash needs *a* rule, and this is the one in the docstring."""
    row: list[Pixel] = [(255, 0, 0), (0, 0, 255), (0, 0, 255)]
    with pytest.raises(ValueError, match="at least 2x2"):
        sw.swatch_from_image(_image(3, 1, row))

    left, right, _, _ = sw.swatch_from_image(_image(3, 2, [*row, *row]))
    assert left == 0xF800, "the single left column is pure red"
    assert right == 0x001F, "the two right columns are pure blue"


def test_a_sub_2x2_image_is_refused_rather_than_guessed():
    with pytest.raises(ValueError, match="a 2x2 statistic needs at least 2x2"):
        sw.swatch_from_image(Image.new("RGB", (1, 1)))


def test_a_greyscale_or_palette_image_is_converted_before_sampling():
    """Scryfall serves JPEG, but the decode path must not assume three channels are there."""
    image = Image.new("L", (2, 2))
    image.putdata([0, 255, 0, 255])  # pyright: ignore[reportUnknownMemberType]
    assert sw.swatch_from_image(image) == (0x0000, 0xFFFF, 0x0000, 0xFFFF)


# --- the cache ---------------------------------------------------------------------------------


def test_the_cache_round_trips_through_the_file(tmp_path: Path):
    path = tmp_path / "swatches.jsonl"
    cache = sw.SwatchCache(path)
    assert len(cache) == 0
    cache.put("printing-0", 17, (1, 2, 3, 4))
    cache.close()

    reopened = sw.SwatchCache(path)
    assert len(reopened) == 1
    assert reopened.get("printing-0", 17) == (1, 2, 3, 4)


def test_the_cache_key_carries_imageTs_so_a_refresh_refetches_only_what_changed(tmp_path: Path):
    """§2.2's fetch discipline: once per card, keyed by ``(id, imageTs)``.

    Scryfall's own cache-busting stamp is half the key, so new art is a miss and unchanged art is a
    hit — which is what makes a refresh cost a handful of requests rather than 28,603.
    """
    cache = sw.SwatchCache(tmp_path / "swatches.jsonl")
    cache.put("printing-0", 17, (1, 2, 3, 4))
    assert cache.get("printing-0", 17) == (1, 2, 3, 4)
    assert cache.get("printing-0", 18) is None


def test_a_line_torn_by_a_kill_mid_append_loses_only_that_record(tmp_path: Path):
    """The whole argument for an append-only log: a run killed after 20 000 fetches keeps them."""
    path = tmp_path / "swatches.jsonl"
    good = json.dumps({"id": "printing-0", "ts": 17, "s": [1, 2, 3, 4]})
    path.write_text(f"{good}\n" + '{"id": "printing-1", "ts": 17, "s": [5, 6', encoding="utf-8")

    cache = sw.SwatchCache(path)

    assert len(cache) == 1
    assert cache.get("printing-0", 17) == (1, 2, 3, 4)
    assert cache.get("printing-1", 17) is None


def test_putting_the_same_key_twice_appends_once(tmp_path: Path):
    path = tmp_path / "swatches.jsonl"
    cache = sw.SwatchCache(path)
    cache.put("printing-0", 17, (1, 2, 3, 4))
    cache.put("printing-0", 17, (9, 9, 9, 9))
    cache.close()

    assert path.read_text(encoding="utf-8").count("\n") == 1
    assert sw.SwatchCache(path).get("printing-0", 17) == (1, 2, 3, 4)


# --- the star-ordered column -------------------------------------------------------------------


def test_swatches_for_returns_the_column_in_request_order(tmp_path: Path):
    cache = sw.SwatchCache(tmp_path / "c.jsonl")
    for i in range(3):
        cache.put(f"printing-{i}", 1700000000, (i, i, i, i))

    column = sw.swatches_for([_request(2), _request(0), _request(1)], cache)

    assert column == [(2, 2, 2, 2), (0, 0, 0, 0), (1, 1, 1, 1)]


def test_a_missing_swatch_stops_the_build_rather_than_shipping_a_black_cell(tmp_path: Path):
    """§2.2 read through §1.3: a black cell on a map whose claim is that colour means something.

    A run that quietly substituted a placeholder would be indistinguishable, in the artefacts, from
    a run that fetched everything — which is exactly the failure the report line cannot catch.
    """
    cache = sw.SwatchCache(tmp_path / "c.jsonl")
    cache.put("printing-0", 1700000000, (1, 1, 1, 1))

    with pytest.raises(sw.MissingSwatchError) as error:
        sw.swatches_for([_request(0), _request(1)], cache)

    assert "printing-1" in str(error.value)
    assert error.value.missing == ["printing-1"]


def test_the_missing_swatch_message_names_a_resumable_next_step(tmp_path: Path):
    cache = sw.SwatchCache(tmp_path / "c.jsonl")
    with pytest.raises(sw.MissingSwatchError, match="re-fetches only what is missing"):
        sw.swatches_for([_request(i) for i in range(8)], cache)


# --- the fetch ---------------------------------------------------------------------------------


class _Response:
    def __init__(self, payload: bytes) -> None:
        self._payload = payload

    def read(self) -> bytes:
        return self._payload

    def __enter__(self) -> _Response:
        return self

    def __exit__(self, *_: object) -> None:
        return None


def _stub(monkeypatch: pytest.MonkeyPatch, handler: Callable[[str], Any]) -> list[str]:
    """Replace the one network call, and record every URI it was asked for."""
    seen: list[str] = []

    def urlopen(request: Any, timeout: int = 0) -> Any:
        seen.append(request.full_url)
        return handler(request.full_url)

    monkeypatch.setattr(sw.urllib.request, "urlopen", urlopen)
    monkeypatch.setattr(sw.time, "sleep", _no_sleep)
    return seen


PIXELS = _png([[(255, 0, 0), (255, 0, 0)], [(255, 0, 0), (255, 0, 0)]])


def test_a_fetch_decodes_caches_and_reports(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    seen = _stub(monkeypatch, _ok)
    cache = sw.SwatchCache(tmp_path / "c.jsonl")

    stats = sw.fetch_swatches([_request(0), _request(1)], cache, concurrency=2)

    assert (stats.wanted, stats.cache_hits, stats.fetched, stats.failed) == (2, 0, 2, 0)
    assert stats.bytes_downloaded == 2 * len(PIXELS)
    assert cache.get("printing-0", 1700000000) == (0xF800,) * 4
    assert len(seen) == 2
    assert all(f"/{sw.SWATCH_SOURCE}/front/" in uri for uri in seen), seen
    assert all(uri.endswith("?1700000000") for uri in seen), "imageTs busts Scryfall's cache"


def test_a_cached_card_is_never_requested(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    seen = _stub(monkeypatch, _ok)
    cache = sw.SwatchCache(tmp_path / "c.jsonl")
    cache.put("printing-0", 1700000000, (1, 2, 3, 4))

    stats = sw.fetch_swatches([_request(0), _request(1)], cache, concurrency=2)

    assert (stats.cache_hits, stats.fetched) == (1, 1)
    assert seen == [sw.image_uri("printing-1", 1700000000, sw.SWATCH_SOURCE)]


def test_two_requests_for_one_printing_collapse_to_one(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    seen = _stub(monkeypatch, _ok)
    cache = sw.SwatchCache(tmp_path / "c.jsonl")

    stats = sw.fetch_swatches([_request(0), _request(0)], cache, concurrency=2)

    assert len(seen) == 1
    assert stats.fetched == 1


def test_limit_caps_new_fetches_so_a_cold_warm_can_be_split(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    seen = _stub(monkeypatch, _ok)
    cache = sw.SwatchCache(tmp_path / "c.jsonl")

    first = sw.fetch_swatches([_request(i) for i in range(5)], cache, limit=2, concurrency=2)
    assert (first.fetched, len(seen)) == (2, 2)

    # The second sitting resumes: what the first fetched is now a cache hit.
    second = sw.fetch_swatches([_request(i) for i in range(5)], cache, concurrency=2)
    assert (second.cache_hits, second.fetched) == (2, 3)


def test_a_retryable_status_is_retried_and_a_permanent_one_is_not(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    """Only the transient statuses. A 404 retried four times is four requests for nothing."""
    attempts: dict[str, int] = {}

    def handler(uri: str) -> Any:
        attempts[uri] = attempts.get(uri, 0) + 1
        code = 503 if "printing-0" in uri else 404
        if "printing-0" in uri and attempts[uri] >= 3:
            return _Response(PIXELS)
        raise urllib.error.HTTPError(uri, code, "boom", None, None)  # pyright: ignore[reportArgumentType]

    _stub(monkeypatch, handler)
    cache = sw.SwatchCache(tmp_path / "c.jsonl")

    stats = sw.fetch_swatches([_request(0), _request(1)], cache, concurrency=1)

    assert stats.fetched == 1, "the 503 was retried until it succeeded"
    assert stats.failed == 1
    assert stats.failures[0][0] == "printing-1"
    assert stats.failures[0][1] == "HTTP 404"
    assert sum(1 for uri in attempts if "printing-1" in uri) == 1
    assert attempts[sw.image_uri("printing-1", 1700000000, sw.SWATCH_SOURCE)] == 1


def test_a_body_that_is_not_an_image_fails_without_retrying(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    def broken(_uri: str) -> _Response:
        return _Response(b"not an image")

    seen = _stub(monkeypatch, broken)
    cache = sw.SwatchCache(tmp_path / "c.jsonl")

    stats = sw.fetch_swatches([_request(0)], cache, concurrency=1)

    assert stats.failed == 1
    assert stats.failures[0][1].startswith("decode: ")
    assert len(seen) == 1, "the same bytes will not parse on a second attempt"


def test_a_transport_error_exhausts_its_attempts_and_is_reported(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    def timeout(_uri: str) -> _Response:
        raise TimeoutError("slow")

    seen = _stub(monkeypatch, timeout)
    cache = sw.SwatchCache(tmp_path / "c.jsonl")

    stats = sw.fetch_swatches([_request(0)], cache, concurrency=1)

    assert stats.failed == 1
    assert "TimeoutError" in stats.failures[0][1]
    assert len(seen) == sw.MAX_ATTEMPTS


def test_an_empty_request_list_costs_nothing(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    seen = _stub(monkeypatch, _ok)
    stats = sw.fetch_swatches([], sw.SwatchCache(tmp_path / "c.jsonl"))
    assert (stats.wanted, stats.fetched, seen) == (0, 0, [])


def test_the_throttle_is_global_and_not_per_worker():
    """Six workers each sleeping 50 ms is 120 requests a second, which is not the guidance.

    The gap is enforced on a shared clock, so N calls from any number of threads are spaced by at
    least ``(N - 1) * gap`` between the first and the last.
    """
    slept: list[float] = []
    throttle = sw._Throttle(0.05)
    lock = threading.Lock()

    original = sw.time.sleep
    try:

        def record(seconds: float) -> None:
            with lock:
                slept.append(seconds)

        sw.time.sleep = record  # pyright: ignore[reportAttributeAccessIssue]
        threads = [threading.Thread(target=throttle.wait) for _ in range(6)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
    finally:
        sw.time.sleep = original  # pyright: ignore[reportAttributeAccessIssue]

    # The first caller does not wait; every other one waits behind the shared cursor.
    assert len(slept) >= 5, slept
    assert sum(slept) >= 0.05 * 5 - 1e-9, slept


def test_the_swatch_source_is_the_honest_one(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """§2.2 and §5 Q1's recommendation, pinned so a change to it is a change to a test.

    ``small`` is the whole card — frame, border, text box — so a 2x2 of it is dominated by frame
    colour, which *is* the colour identity, which is ``hueClass`` again. The new statistic would be
    nearly as inert as the one it replaces, which is the whole reason concept B needs it.
    """
    assert sw.SWATCH_SOURCE == "art_crop"
    seen = _stub(monkeypatch, _ok)
    sw.fetch_swatches([_request(0)], sw.SwatchCache(tmp_path / "c.jsonl"), concurrency=1)
    assert "/art_crop/" in seen[0]
    assert "/small/" not in seen[0]


def test_the_record_is_eight_bytes_of_four_uint16(tmp_path: Path):
    """The contract side, from this end: what the cache stores is what ``swatches.bin`` writes."""
    from eternities.contract.binary import decode_swatches, encode_swatches
    from eternities.contract.enums import SWATCH_RECORD_BYTES

    cache = sw.SwatchCache(tmp_path / "c.jsonl")
    cache.put("printing-0", 1700000000, (0xFFFF, 0x0000, 0x07E0, 0xF800))
    column = sw.swatches_for([_request(0)], cache)

    encoded = encode_swatches(column)
    assert len(encoded) == 16 + SWATCH_RECORD_BYTES
    assert struct.unpack_from("<HHHH", encoded, 16) == (0xFFFF, 0x0000, 0x07E0, 0xF800)
    assert decode_swatches(encoded) == column
