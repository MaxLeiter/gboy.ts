#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"

export RUN_EXTERNAL_GB_TEST_ROMS=1
export GB_TEST_ROMS_DIR="${GB_TEST_ROMS_DIR:-$ROOT_DIR/external/game-boy-test-roms-release}"

cd "$ROOT_DIR"
bun test src/__tests__/gameboy-test-roms.test.ts "$@"
