#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
DEST_DIR="${1:-$ROOT_DIR/external/game-boy-test-roms-release}"

TMP_JSON="$(mktemp)"
trap 'rm -f "$TMP_JSON"' EXIT

echo "Fetching latest release metadata for c-sp/game-boy-test-roms..."
curl -fsSL "https://api.github.com/repos/c-sp/game-boy-test-roms/releases/latest" -o "$TMP_JSON"

ASSET_INFO="$(
  bun -e '
    import { readFileSync } from "node:fs";
    const release = JSON.parse(readFileSync(process.argv[1], "utf8"));
    const assets = Array.isArray(release.assets) ? release.assets : [];
    const zip = assets.find(
      (asset) =>
        typeof asset?.name === "string" &&
        asset.name.endsWith(".zip") &&
        typeof asset?.browser_download_url === "string",
    );
    if (!zip) {
      console.error("No .zip release asset found.");
      process.exit(1);
    }
    process.stdout.write(`${zip.name}|${zip.browser_download_url}`);
  ' "$TMP_JSON"
)"

ASSET_NAME="${ASSET_INFO%%|*}"
ASSET_URL="${ASSET_INFO#*|}"

if [[ -z "$ASSET_NAME" || -z "$ASSET_URL" || "$ASSET_NAME" == "$ASSET_INFO" ]]; then
  echo "Failed to parse release asset metadata." >&2
  exit 1
fi

mkdir -p "$DEST_DIR"
ZIP_PATH="$DEST_DIR/$ASSET_NAME"

echo "Downloading $ASSET_NAME..."
curl -fL "$ASSET_URL" -o "$ZIP_PATH"

echo "Extracting archive into $DEST_DIR..."
unzip -oq "$ZIP_PATH" -d "$DEST_DIR"

echo "Done."
echo "ROM root: $DEST_DIR"
echo "Run external ROM smoke tests with:"
echo "  RUN_EXTERNAL_GB_TEST_ROMS=1 bun test src/__tests__/gameboy-test-roms.test.ts"
