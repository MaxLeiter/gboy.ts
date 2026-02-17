import { Emulator, Button, Cartridge, encodePNG } from "gboy-ts";
import { readFileSync, writeFileSync, existsSync, unlinkSync } from "fs";
import { join } from "path";

const STATE_PATH = join(process.cwd(), ".game-state");
const ROM_PATH = process.env.ROM_PATH || join(process.cwd(), "rom.gb");

const FRAMES_PER_INPUT = 30;

let cachedRom: Uint8Array | null = null;

function loadROM(): Uint8Array {
  if (cachedRom) return cachedRom;
  if (!existsSync(ROM_PATH)) {
    throw new Error(
      `ROM not found at ${ROM_PATH}. Set ROM_PATH env variable or place rom.gb in examples/nextjs/`
    );
  }
  cachedRom = new Uint8Array(readFileSync(ROM_PATH));
  return cachedRom;
}

function loadEmulator(): Emulator {
  const rom = loadROM();
  if (existsSync(STATE_PATH)) {
    const state = new Uint8Array(readFileSync(STATE_PATH));
    return Emulator.deserialize(rom, state);
  }
  const emu = new Emulator(rom);
  emu.runFrames(300);
  return emu;
}

function saveState(emu: Emulator): void {
  writeFileSync(STATE_PATH, emu.serialize());
}

let frameCount = 0;

export function getFrame(): Uint8Array {
  const emu = loadEmulator();
  const fb = emu.getFramebuffer();
  return encodePNG(fb, 160, 144);
}

export function applyInput(button: Button): Uint8Array {
  const emu = loadEmulator();
  emu.pressButton(button);
  emu.runFrames(FRAMES_PER_INPUT);
  emu.releaseButton(button);
  emu.runFrames(5);
  frameCount += FRAMES_PER_INPUT + 5;
  saveState(emu);
  const fb = emu.getFramebuffer();
  return encodePNG(fb, 160, 144);
}

export function runIdleFrames(count: number = 30): Uint8Array {
  const emu = loadEmulator();
  emu.runFrames(count);
  frameCount += count;
  saveState(emu);
  const fb = emu.getFramebuffer();
  return encodePNG(fb, 160, 144);
}

export function resetGame(): Uint8Array {
  if (existsSync(STATE_PATH)) {
    unlinkSync(STATE_PATH);
  }
  frameCount = 0;
  const emu = loadEmulator();
  saveState(emu);
  const fb = emu.getFramebuffer();
  return encodePNG(fb, 160, 144);
}

export function getGameInfo() {
  const rom = loadROM();
  const cart = Cartridge.fromROM(rom);
  return {
    title: cart.getTitle(),
    mbc: cart.getMBCType(),
    romSize: rom.length,
    frameCount,
  };
}
