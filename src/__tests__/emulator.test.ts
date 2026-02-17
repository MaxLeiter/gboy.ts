import { describe, it, expect } from "bun:test";
import { Emulator, Button } from "../emulator";

function makeMinimalROM(): Uint8Array {
  const rom = new Uint8Array(0x8000);
  // At 0x0100: HALT loop (CPU starts at PC=0x0100 after reset)
  // 0x76 = HALT, 0x18 0xFD = JR -3 (jump back to HALT)
  rom[0x0100] = 0x76; // HALT
  rom[0x0101] = 0x18; // JR
  rom[0x0102] = 0xFD; // -3 (back to 0x0100)
  // Cartridge header: ROM_ONLY, 2 banks, no RAM
  rom[0x0147] = 0x00;
  rom[0x0148] = 0x00;
  rom[0x0149] = 0x00;
  return rom;
}

function makeLCDCEnabledROM(): Uint8Array {
  const rom = makeMinimalROM();
  // At 0x0100: enable LCDC, then HALT loop
  // LD A, 0x80 (0x3E 0x80)
  // LDH (0x40), A (0xE0 0x40) — writes to FF40 = LCDC
  // HALT (0x76)
  // JR -3 (0x18 0xFD)
  rom[0x0100] = 0x3E; // LD A, d8
  rom[0x0101] = 0x80; // 0x80
  rom[0x0102] = 0xE0; // LDH (a8), A
  rom[0x0103] = 0x40; // 0xFF40 = LCDC
  rom[0x0104] = 0x76; // HALT
  rom[0x0105] = 0x18; // JR
  rom[0x0106] = 0xFD; // -3 (back to HALT)
  return rom;
}

function makeMBC1ROM(banks: number, ramSizeCode: number = 0): Uint8Array {
  const size = banks * 0x4000;
  const rom = new Uint8Array(size);
  for (let b = 0; b < banks; b++) {
    for (let i = 0; i < 0x4000; i++) {
      rom[b * 0x4000 + i] = b;
    }
  }
  let romSizeCode = 0;
  if (banks === 4) romSizeCode = 1;
  else if (banks === 8) romSizeCode = 2;
  else if (banks === 16) romSizeCode = 3;
  else if (banks === 32) romSizeCode = 4;
  else if (banks === 64) romSizeCode = 5;
  rom[0x0147] = 0x01; // MBC1
  rom[0x0148] = romSizeCode;
  rom[0x0149] = ramSizeCode;
  // HALT loop at entry
  rom[0x0100] = 0x76;
  rom[0x0101] = 0x18;
  rom[0x0102] = 0xFD;
  return rom;
}

describe("Emulator", () => {
  describe("construction", () => {
    it("creates all components and wires them", () => {
      const rom = makeMinimalROM();
      const emu = new Emulator(rom);

      expect(emu.cpu).toBeDefined();
      expect(emu.mmu).toBeDefined();
      expect(emu.ppu).toBeDefined();
      expect(emu.timer).toBeDefined();
      expect(emu.joypad).toBeDefined();
      expect(emu.cartridge).toBeDefined();

      expect(emu.mmu.cartridge).toBe(emu.cartridge);
      expect(emu.mmu.timer).toBe(emu.timer);
      expect(emu.mmu.joypad).toBe(emu.joypad);
      expect(emu.mmu.apu).toBe(emu.apu);
    });

    it("applies DMG post-boot I/O defaults when boot ROM is skipped", () => {
      const rom = makeMinimalROM();
      const emu = new Emulator(rom);

      expect(emu.mmu.readByte(0xFF40)).toBe(0x91); // LCDC
      expect(emu.mmu.readByte(0xFF47)).toBe(0xFC); // BGP
      expect(emu.mmu.readByte(0xFF26)).toBe(0xF1); // NR52
      expect(emu.mmu.readByte(0xFFFF)).toBe(0x00); // IE
    });
  });

  describe("audio output", () => {
    it("produces PCM when enabled", () => {
      const rom = makeMinimalROM();
      const emu = new Emulator(rom);
      emu.setAudioOutputEnabled(true);

      emu.runFrames(2);

      const samples = emu.consumeAudioSamples();
      expect(samples.length).toBeGreaterThan(0);
    });
  });

  describe("runFrame", () => {
    it("returns a framebuffer of correct size", () => {
      const rom = makeMinimalROM();
      const emu = new Emulator(rom);
      const fb = emu.runFrame();
      expect(fb.length).toBe(160 * 144 * 4);
    });
  });

  describe("multiple frames", () => {
    it("runs 10 frames without crash", () => {
      const rom = makeMinimalROM();
      const emu = new Emulator(rom);
      expect(() => emu.runFrames(10)).not.toThrow();
    });
  });

  describe("button input", () => {
    it("pressing A sets joypad state", () => {
      const rom = makeMinimalROM();
      const emu = new Emulator(rom);

      emu.pressButton(Button.A);

      // Select action buttons: bit 5 must be LOW (0), bit 4 HIGH (1) = 0x10
      emu.mmu.writeByte(0xFF00, 0x10);
      const val = emu.mmu.readByte(0xFF00);
      // A is bit 0 of action buttons, pressed = low
      expect(val & 0x01).toBe(0);

      emu.releaseButton(Button.A);
      const val2 = emu.mmu.readByte(0xFF00);
      expect(val2 & 0x01).toBe(1);
    });
  });

  describe("timer interrupt", () => {
    it("fires timer interrupt when TAC is enabled", () => {
      const rom = makeLCDCEnabledROM();
      const emu = new Emulator(rom);

      // Enable timer: TAC = 0x05 (enabled, clock/16 = fastest)
      emu.mmu.writeByte(0xFF07, 0x05);
      // Set TIMA close to overflow
      emu.mmu.writeByte(0xFF05, 0xFE);
      // Set TMA (reload value)
      emu.mmu.writeByte(0xFF06, 0x00);

      // Run a frame — timer should overflow
      emu.runFrame();

      const ifReg = emu.mmu.readByte(0xFF0F);
      expect(ifReg & 0x04).toBe(0x04);
    });

    it("timer overflow during interrupt-service cycles still requests IF.Timer", () => {
      const rom = makeMinimalROM();
      const emu = new Emulator(rom);

      // Make the first CPU action an interrupt service.
      emu.mmu.writeByte(0xFFFF, 0x01); // IE: VBlank enabled
      emu.mmu.writeByte(0xFF0F, 0x01); // IF: VBlank pending
      emu.cpu.ime = true;

      // Timer setup:
      // - Enable timer at 4096Hz (TAC=0b100)
      // - TIMA=0xFF so the very next increment overflows
      // - Advance DIV phase so overflow happens within the first 20-cycle ISR
      emu.mmu.writeByte(0xFF06, 0x00); // TMA
      emu.mmu.writeByte(0xFF05, 0xFF); // TIMA
      emu.mmu.writeByte(0xFF07, 0x04); // TAC: enable, select 00
      emu.timer.tick(1020); // 4 t-cycles before next 4096Hz increment edge

      emu.runFrame();

      const ifReg = emu.mmu.readByte(0xFF0F);
      expect(ifReg & 0x04).toBe(0x04);
    });
  });

  describe("VBlank interrupt", () => {
    it("fires VBlank after running a frame with LCD enabled", () => {
      const rom = makeLCDCEnabledROM();
      const emu = new Emulator(rom);

      emu.runFrame();

      const ifReg = emu.mmu.readByte(0xFF0F);
      expect(ifReg & 0x01).toBe(0x01);
    });
  });

  describe("serialize / deserialize", () => {
    it("round-trips state without crash and maintains consistency", () => {
      const rom = makeLCDCEnabledROM();
      const emu = new Emulator(rom);

      emu.runFrames(5);
      const fb1 = new Uint8Array(emu.getFramebuffer());
      const state = emu.serialize();

      const emu2 = Emulator.deserialize(rom, state);
      const fb2 = emu2.getFramebuffer();

      expect(fb2.length).toBe(fb1.length);
      expect(new Uint8Array(fb2)).toEqual(fb1);

      // Run more frames on deserialized emulator
      expect(() => emu2.runFrames(5)).not.toThrow();
    });
  });

  describe("cartridge wired to MMU", () => {
    it("reads ROM banks through MMU using cartridge bank switching", () => {
      const rom = makeMBC1ROM(4);
      const emu = new Emulator(rom);

      // Bank 0 at 0x0000
      expect(emu.mmu.readByte(0x0000)).toBe(0);

      // Default bank 1 at 0x4000
      expect(emu.mmu.readByte(0x4000)).toBe(1);

      // Switch to bank 2 via MBC register write through MMU
      emu.mmu.writeByte(0x2000, 2);
      expect(emu.mmu.readByte(0x4000)).toBe(2);

      // Switch to bank 3
      emu.mmu.writeByte(0x2000, 3);
      expect(emu.mmu.readByte(0x4000)).toBe(3);
    });
  });

  describe("pressButtonForFrames", () => {
    it("holds button for specified frames then releases", () => {
      const rom = makeMinimalROM();
      const emu = new Emulator(rom);
      emu.pressButtonForFrames(Button.Start, 3);

      // After pressButtonForFrames, button should be released
      // Select action buttons: bit 5 LOW (0), bit 4 HIGH (1) = 0x10
      emu.mmu.writeByte(0xFF00, 0x10);
      const val = emu.mmu.readByte(0xFF00);
      // Start is bit 3, released = high (1)
      expect(val & 0x08).toBe(0x08);
    });
  });
});
