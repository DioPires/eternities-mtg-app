#!/usr/bin/env bash
# Makes each of the `temperate` kit's derived files again from its pinned source and holds the
# result to the file the kit commits (PRD v4 7.6.4, 8.12). A derived file is a binary that a
# committed script makes from a CC0 source: its entry in sources.yaml names the script and its
# arguments (`derived_by`), the source's address (`url`) and the source's SHA-256
# (`source_sha256`); `sha256` is the derived file's own, which `./fetch.sh` verifies. A source of
# two files, a glTF and its data, has the second as `url_2` and `source_sha256_2`: it is kept
# beside the first under its own name, and the script is given the first.
#
#   ./derive.sh                  every derived file: download its source, verify it, make the
#                                file again and compare it with the kit's, byte for byte
#   ./derive.sh <file>...        only the files named, as sources.yaml names them
#   ./derive.sh --write [...]    put each result in the kit, and its report beside the script;
#                                prints the sha256 that sources.yaml must then carry
#
# A source is 48 to 480 MB and is kept between runs in $ETERNITIES_DERIVE_CACHE, or in a folder
# of this script's own under $TMPDIR. Needs bash, curl, awk, sha256sum or shasum, and Blender. The
# bytes are those of the Blender that a file's report names; another Blender may cut the same
# tree into other bytes, and then this compares the two reports and says so.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
manifest="$here/sources.yaml"
cache="${ETERNITIES_DERIVE_CACHE:-${TMPDIR:-/tmp}/eternities-derive}"

die() {
  echo "derive.sh: $*" >&2
  exit 1
}

sha() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d' ' -f1
  else
    shasum -a 256 "$1" | cut -d' ' -f1
  fi
}

write=0
if [ "${1:-}" = "--write" ]; then
  write=1
  shift
fi
command -v blender >/dev/null 2>&1 || die "Blender is not on the PATH"
ours="$(blender --version | head -1 | sed 's/^Blender //')"

# One tab-separated line per derived file: file, url, source_sha256, url_2, source_sha256_2,
# derived_by, sha256. `-` stands for an absent value.
records() {
  awk '
    function flush() {
      if (file != "" && derived != "") printf "%s\t%s\t%s\t%s\t%s\t%s\t%s\n", file, url, from, (url2 == "" ? "-" : url2), (from2 == "" ? "-" : from2), derived, sum
      file = url = from = url2 = from2 = derived = sum = ""
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
      else if (key == "source_sha256") from = val
      else if (key == "url_2") url2 = val
      else if (key == "source_sha256_2") from2 = val
      else if (key == "derived_by") derived = val
      else if (key == "sha256") sum = val
    }
    END { flush() }
  ' "$manifest"
}

# A source file at its address, into the cache if it is not there with its checksum.
source_file() {
  if [ ! -f "$2" ] || [ "$(sha "$2")" != "$3" ]; then
    mkdir -p "$(dirname "$2")"
    curl --fail --silent --show-error --location --retry 3 --connect-timeout 20 --max-time 3000 \
      --user-agent "eternities-kit-fetch/1 (+https://github.com/DioPires/eternities-mtg-app)" \
      --output "$2.part" "$1" || die "download failed: $1"
    got="$(sha "$2.part")"
    [ "$got" = "$3" ] || die "$1: expected sha256 $3, got $got"
    mv "$2.part" "$2"
  fi
}

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$cache"

made=0
differ=0
while IFS=$'\t' read -r file url source_sha url_2 source_sha_2 derived want; do
  if [ "$#" -gt 0 ]; then
    wanted=0
    for name in "$@"; do
      [ "$name" = "$file" ] && wanted=1
    done
    [ "$wanted" -eq 1 ] || continue
  fi
  [ "${#source_sha}" -eq 64 ] && [ "${#want}" -eq 64 ] || die "$file: entry has no source_sha256 or no sha256"
  script="${derived%% *}"
  words="${derived#"$script"}"
  [ -f "$here/$script" ] || die "$file: derived by $script, which is not in the kit"

  # The source, in a folder of its own that holds nothing else.
  source="$cache/$source_sha/$(basename "$url")"
  source_file "$url" "$source" "$source_sha"
  if [ "$url_2" != "-" ]; then
    [ "${#source_sha_2}" -eq 64 ] || die "$file: entry has a url_2 and no source_sha256_2"
    source_file "$url_2" "$cache/$source_sha/$(basename "$url_2")" "$source_sha_2"
  fi

  out="$tmp/$(basename "$file")"
  # shellcheck disable=SC2086  # the words after the script are its arguments, one a word
  blender -b --factory-startup --disable-autoexec --python-exit-code 1 --python "$here/$script" -- \
    $words "$source" "$out" >"$tmp/log" 2>&1 || { tail -20 "$tmp/log" >&2; die "$file: $script failed"; }
  [ -f "$out" ] || die "$file: $script wrote no file"
  got="$(sha "$out")"
  report="$here/$(dirname "$script")/$(basename "${file%.*}").json"
  made=$((made + 1))

  if [ "$write" -eq 1 ]; then
    cp "$out" "$here/$file"
    cp "${out%.*}.json" "$report"
    printf 'wrote  %s  %s\n' "$got" "$file"
  elif [ "$got" = "$want" ]; then
    printf 'ok     %s  %s\n' "$got" "$file"
  else
    differ=$((differ + 1))
    theirs="$(sed -n 's/^ "blender": "\(.*\)",$/\1/p' "$report" 2>/dev/null || true)"
    printf 'differ %s  %s (sources.yaml has %s)\n' "$got" "$file" "$want"
    if [ "$ours" != "$theirs" ]; then
      echo "       this is Blender $ours and the kit's file was cut by Blender ${theirs:-?}; the two reports:"
    fi
    diff <(grep -v '^ "blender": \|^ "bytes": ' "$report") <(grep -v '^ "blender": \|^ "bytes": ' "${out%.*}.json") &&
      echo "       the reports agree: the same triangles, levels and size" || true
  fi
done < <(records)

[ "$made" -gt 0 ] || die "no derived file${1:+ named so} in sources.yaml"
[ "$differ" -eq 0 ] || die "$differ of $made derived files are not the files the kit commits"
echo "$made derived files, each made again from its pinned source by Blender $ours."
