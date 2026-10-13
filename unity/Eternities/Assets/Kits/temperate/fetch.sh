#!/usr/bin/env bash
# Downloads the `temperate` kit's slice subset into this folder and verifies every file against the
# SHA-256 in sources.yaml (PRD v4 8.12, 9.5). Re-running skips a file whose checksum already
# matches, so a second run is the offline verification of what is on disk.
#
#   ./fetch.sh            download into this folder
#   ./fetch.sh <dir>      download into <dir> instead
#
# It also fails if CREDITS.md and sources.yaml disagree on any row, or if an asset folder holds a
# file that sources.yaml does not list.
#
# A derived file (PRD v4 7.6.4) is one a committed script made from a source: its entry has
# `derived_by` and `source_sha256`, and its `url` is the source's. It is not downloaded: this
# verifies the kit's own copy, and `./derive.sh` makes it again from its source.
#
# Needs bash, curl, unzip, awk and sha256sum or shasum. Exits non-zero on the first failure.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
manifest="$here/sources.yaml"
credits="$here/CREDITS.md"
dest="${1:-$here}"

# The limits on a source file and on the kit's sources, in bytes: a tripwire, not the budget. The
# budget is the cooked size (PRD v4 7.2: 250 MB for a kit at the photographic standard), which the
# build measures (PRD 8.7.2). The first slice's limits were 200 KB, 8 MB and 60 MB (DEC-952); these
# are the proposal of 2026-10-12 on DEC-1003, the owner's to set: a photographed rock or bush is
# 0.1 to 6.6 MB as its source publishes it.
max_prop=8000000
max_texture=8000000
max_total=200000000

die() {
  echo "fetch.sh: $*" >&2
  exit 1
}

sha() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d' ' -f1
  else
    shasum -a 256 "$1" | cut -d' ' -f1
  fi
}

get() {
  curl --fail --silent --show-error --location --retry 3 --connect-timeout 20 --max-time 600 \
    --user-agent "eternities-kit-fetch/1 (+https://github.com/DioPires/eternities-mtg-app)" \
    --output "$2" "$1" || die "download failed: $1"
}

# One tab-separated line per asset: file, url, member, archive_sha256, derived_by, source_sha256,
# sha256 and the CREDITS.md row the entry stands for. `-` stands for an absent value, because `read` folds consecutive tabs into
# one and would shift the later fields.
records() {
  awk '
    function flush() {
      if (file != "") {
        printf "%s\t%s\t%s\t%s\t%s\t%s\t%s\t| `%s` | <%s> | %s | [%s](%s) | %s | %s |\n", file,
          (url == "" ? "-" : url), (member == "" ? "-" : member), (archive == "" ? "-" : archive),
          (derived == "" ? "-" : derived), (from == "" ? "-" : from),
          (sum == "" ? "-" : sum), file, f["source"], f["author"], f["licence"], f["licence_url"],
          f["fetched"], f["use"]
      }
      file = url = member = archive = derived = from = sum = ""
      split("", f)
    }
    /^  - file: / { flush() }
    /^  (- |  )[a-z_0-9]+: / {
      line = $0
      sub(/^  (- |  )/, "", line)
      key = line
      sub(/: .*$/, "", key)
      val = line
      sub(/^[a-z_0-9]+: /, "", val)
      gsub(/^"|"$/, "", val)
      if (key == "file") file = val
      else if (key == "url") url = val
      else if (key == "member") member = val
      else if (key == "archive_sha256") archive = val
      else if (key == "derived_by") derived = val
      else if (key == "source_sha256") from = val
      else if (key == "sha256") sum = val
      else f[key] = val
    }
    END { flush() }
  ' "$manifest"
}

[ -f "$manifest" ] || die "missing $manifest"
[ -f "$credits" ] || die "missing $credits"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

count=0
total=0
while IFS=$'\t' read -r file url member archive_sha derived source_sha want row; do
  [ "$url" != "-" ] && [ "${#want}" -eq 64 ] || die "$file: entry has no url or no sha256"
  grep -qFx -- "$row" "$credits" || die "$file: CREDITS.md has no row equal to: $row"
  printf '%s\n' "$file" >>"$tmp/listed"

  out="$dest/$file"
  if [ "$derived" != "-" ]; then
    [ "${#source_sha}" -eq 64 ] || die "$file: derived by $derived, and its entry has no source_sha256"
    [ -f "$here/${derived%% *}" ] || die "$file: derived by ${derived%% *}, which is not in the kit"
    out="$here/$file"
    [ -f "$out" ] && [ "$(sha "$out")" = "$want" ] ||
      die "$file: the kit's copy is missing or is not the file its sha256 names: git lfs pull, or ./derive.sh"
    how="derived"
  elif [ -f "$out" ] && [ "$(sha "$out")" = "$want" ]; then
    how="on disk"
  else
    if [ "$member" = "-" ]; then
      get "$url" "$tmp/part"
    else
      [ "${#archive_sha}" -eq 64 ] || die "$file: entry has a member but no archive_sha256"
      zip="$tmp/$archive_sha.zip"
      if [ ! -f "$zip" ]; then
        get "$url" "$zip"
        got="$(sha "$zip")"
        [ "$got" = "$archive_sha" ] || die "archive $url: expected sha256 $archive_sha, got $got"
      fi
      unzip -p "$zip" "$member" >"$tmp/part" || die "$file: no member '$member' in $url"
    fi
    got="$(sha "$tmp/part")"
    [ "$got" = "$want" ] || die "$file: expected sha256 $want, got $got"
    mkdir -p "$(dirname "$out")"
    mv "$tmp/part" "$out"
    how="fetched"
  fi

  bytes="$(wc -c <"$out" | tr -d ' ')"
  case "$file" in
    Props/*) cap="$max_prop" ;;
    Terrain/*) cap="$max_texture" ;;
    *) cap="$max_total" ;;
  esac
  [ "$bytes" -lt "$cap" ] || die "$file: $bytes bytes, the limit for its folder is $cap"
  count=$((count + 1))
  total=$((total + bytes))
  printf 'ok  %-7s  %9d  %s  %s\n' "$how" "$bytes" "$want" "$file"
done < <(records)

# A parse that yields nothing must not read as a clean run.
listed="$(grep -c '^  - file: ' "$manifest" || true)"
[ "$count" -gt 0 ] && [ "$count" -eq "$listed" ] ||
  die "verified $count files, sources.yaml lists $listed"
rows="$(grep -c '^| `' "$credits" || true)"
[ "$rows" -eq "$count" ] || die "CREDITS.md has $rows rows, sources.yaml lists $count files"
[ "$total" -lt "$max_total" ] || die "subset is $total source bytes, the limit is $max_total"

# An asset without a row blocks the merge (PRD 8.12.2), so a file nobody listed must not pass.
# Unity's .meta files sit beside the assets once the folder is under Assets/.
while IFS= read -r found; do
  found="${found#"$dest"/}"
  grep -qFx -- "$found" "$tmp/listed" || die "$found: on disk but not in sources.yaml"
done < <(find "$dest/Terrain" "$dest/Props" "$dest/Audio" -type f ! -name '*.meta' ! -name '.*')

echo "$count files, $total source bytes (limit $max_total)."
echo "Every checksum and every CREDITS.md row matches sources.yaml; nothing unlisted is on disk."
