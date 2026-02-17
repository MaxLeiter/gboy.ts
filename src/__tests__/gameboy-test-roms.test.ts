import { describe, it, expect } from "bun:test";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { Emulator } from "../emulator";

const ROMS_DIR = resolve(
  process.env.GB_TEST_ROMS_DIR ??
    join(process.cwd(), "external", "game-boy-test-roms-release"),
);
const RUN_EXTERNAL =
  process.env.SKIP_EXTERNAL_GB_TEST_ROMS !== "1" &&
  (process.env.RUN_EXTERNAL_GB_TEST_ROMS === "1" || existsSync(ROMS_DIR));
const FRAME_BUDGET = Math.max(1, Number(process.env.GB_TEST_ROM_FRAMES ?? "600"));
const TEST_TIMEOUT_MS = Math.max(
  1000,
  Number(process.env.GB_TEST_ROM_TIMEOUT_MS ?? "120000"),
);

const DEFAULT_ROMS = [
  "gbmicrotest/minimal.gb",
  "blargg/halt_bug.gb",
  "blargg/instr_timing/instr_timing.gb",
  "blargg/interrupt_time/interrupt_time.gb",
  "dmg-acid2/dmg-acid2.gb",
];

function parseROMList(): string[] {
  const envValue = process.env.GB_TEST_ROMS;
  if (!envValue) return DEFAULT_ROMS;
  return envValue
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

const ROM_LIST = parseROMList();
const suite = RUN_EXTERNAL ? describe : describe.skip;

suite("External game-boy-test-roms smoke", () => {
  it("ROM directory exists", () => {
    expect(existsSync(ROMS_DIR)).toBe(true);
  });

  for (const relativePath of ROM_LIST) {
    it(
      `runs ${relativePath} for ${FRAME_BUDGET} frames without crashing`,
      async () => {
        const absolutePath = join(ROMS_DIR, relativePath);
        if (!existsSync(absolutePath)) {
          throw new Error(
            `ROM not found: ${absolutePath}. Set GB_TEST_ROMS_DIR or GB_TEST_ROMS.`,
          );
        }

        const romData = new Uint8Array(await Bun.file(absolutePath).arrayBuffer());
        const emulator = new Emulator(romData);

        try {
          emulator.runFrames(FRAME_BUDGET);
        } catch (error: unknown) {
          const message =
            error instanceof Error ? error.message : String(error);
          throw new Error(
            `Crash in ${relativePath}: ${message} ` +
              `(PC=0x${emulator.cpu.pc.toString(16).padStart(4, "0")}, ` +
              `SP=0x${emulator.cpu.sp.toString(16).padStart(4, "0")})`,
          );
        }
      },
      { timeout: TEST_TIMEOUT_MS },
    );
  }
});
