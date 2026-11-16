#!/usr/bin/env bash
# Install an APK or APKS/XAPK bundle to an Android emulator via adb.
# Usage: install_apk.sh [-s SERIAL] <file.apk | file.apks | file.xapk | bundle_dir/>
#
# For a single APK:        adb install
# For a zip bundle (apks/xapk/split zip): extract and adb install-multiple all *.apk
# For an extracted dir:    adb install-multiple all *.apk inside
set -euo pipefail

SERIAL=""
while getopts "s:" opt; do
  case "$opt" in
    s) SERIAL="-s $OPTARG" ;;
    *) echo "Usage: $0 [-s SERIAL] <file-or-dir>" >&2; exit 1 ;;
  esac
done
shift $((OPTIND-1))

TARGET="${1:?Usage: $0 [-s SERIAL] <file-or-dir>}"

install_apks() {
  local dir="$1"
  shopt -s nullglob
  local apks=("$dir"/*.apk)
  if [ ${#apks[@]} -eq 0 ]; then
    echo "ERROR: no .apk files found in $dir" >&2
    exit 1
  fi
  echo "Installing ${#apks[@]} split APKs from $dir ..."
  adb $SERIAL install-multiple "${apks[@]}"
}

if [ -d "$TARGET" ]; then
  install_apks "$TARGET"
elif [[ "$TARGET" == *.apk ]]; then
  # Try plain install first; MISSING_SPLIT means we need the bundle,
  # but a lone base apk without splits cannot be fixed locally -> report clearly.
  if ! adb $SERIAL install "$TARGET"; then
    echo "ERROR: plain install failed. If the error is INSTALL_FAILED_MISSING_SPLIT," >&2
    echo "this base APK requires split APKs (chrome/config/on_demand). Download the" >&2
    echo "APKS/XAPK bundle instead and pass the zip or extracted dir to this script." >&2
    exit 1
  fi
else
  # zip bundle: apks / xapk / apkm
  TMP="$(mktemp -d)"
  trap 'rm -rf "$TMP"' EXIT
  python - "$TARGET" "$TMP" << 'EOF'
import sys, zipfile
zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])
EOF
  install_apks "$TMP"
fi

echo "Done. Verify with: adb $SERIAL shell pm list packages | grep <package>"
