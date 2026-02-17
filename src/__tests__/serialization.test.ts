import { describe, expect, it } from "bun:test";
import { MMU, EXPECTED_SERIALIZE_SIZE } from "../mmu";
import { Timer } from "../timer";
import { Joypad } from "../input";
import { PPU } from "../ppu";
import { Cartridge } from "../cartridge";
import { APU } from "../apu";

describe("Serialization", () => {
  describe("MMU serialize no longer includes ROM", () => {
    it("serialized buffer size equals VRAM+ERAM+WRAM+OAM+IO+HRAM+1", () => {
      const mmu = new MMU();
      const data = mmu.serialize();
      expect(data.length).toBe(EXPECTED_SERIALIZE_SIZE);
    });

    it("old size (with ROM) should NOT match new size", () => {
      const oldSize = 0x8000 + 0x2000 + 0x2000 + 0x2000 + 0xA0 + 0x80 + 0x7F + 1;
      expect(EXPECTED_SERIALIZE_SIZE).not.toBe(oldSize);
    });

    it("deserialize round-trip preserves VRAM, WRAM, OAM, IO, HRAM, IE", () => {
      const mmu = new MMU();
      mmu.writeByte(0x8000, 0x42); // VRAM
      mmu.writeByte(0x9FFF, 0x99); // VRAM end
      mmu.writeByte(0xC000, 0x11); // WRAM
      mmu.writeByte(0xDFFF, 0x22); // WRAM end
      mmu.writeByte(0xFE00, 0x33); // OAM
      mmu.writeByte(0xFE9F, 0x44); // OAM end
      mmu.writeByte(0xFF00, 0x30); // IO
      mmu.writeByte(0xFF40, 0x91); // IO
      mmu.writeByte(0xFF80, 0xDE); // HRAM
      mmu.writeByte(0xFFFE, 0xAD); // HRAM end
      mmu.writeByte(0xFFFF, 0x1F); // IE

      const data = mmu.serialize();
      const restored = MMU.deserialize(data);

      expect(restored.readByte(0x8000)).toBe(0x42);
      expect(restored.readByte(0x9FFF)).toBe(0x99);
      expect(restored.readByte(0xC000)).toBe(0x11);
      expect(restored.readByte(0xDFFF)).toBe(0x22);
      expect(restored.readByte(0xFE00)).toBe(0x33);
      expect(restored.readByte(0xFE9F)).toBe(0x44);
      expect(restored.readByte(0xFF00) & 0x30).toBe(0x30);
      expect(restored.readByte(0xFF40)).toBe(0x91);
      expect(restored.readByte(0xFF80)).toBe(0xDE);
      expect(restored.readByte(0xFFFE)).toBe(0xAD);
      expect(restored.readByte(0xFFFF)).toBe(0x1F);
    });

    it("ROM is NOT in serialized data (load ROM separately after deserialize)", () => {
      const mmu = new MMU();
      const rom = new Uint8Array(0x8000);
      rom[0x0000] = 0x31;
      rom[0x0100] = 0xC3;
      mmu.loadROM(rom);

      const data = mmu.serialize();
      const restored = MMU.deserialize(data);

      // ROM should be zeroed since it was not serialized and no rom was passed
      expect(restored.readByte(0x0000)).toBe(0x00);
      expect(restored.readByte(0x0100)).toBe(0x00);

      // Load ROM separately
      restored.loadROM(rom);
      expect(restored.readByte(0x0000)).toBe(0x31);
      expect(restored.readByte(0x0100)).toBe(0xC3);
    });
  });

  describe("Buffer validation", () => {
    it("Timer.deserialize with empty buffer throws", () => {
      expect(() => Timer.deserialize(new Uint8Array(0))).toThrow(
        /Timer state buffer too short/
      );
    });

    it("Timer.deserialize with 5 bytes throws", () => {
      expect(() => Timer.deserialize(new Uint8Array(5))).toThrow(
        /Timer state buffer too short/
      );
    });

    it("Joypad.deserialize with empty buffer throws", () => {
      expect(() => Joypad.deserialize(new Uint8Array(0))).toThrow(
        /Joypad state buffer too short/
      );
    });

    it("PPU.deserialize with too-short buffer throws", () => {
      const mmu = new MMU();
      expect(() => PPU.deserialize(new Uint8Array(7), mmu)).toThrow(
        /PPU state buffer too short/
      );
    });

    it("Cartridge.deserialize with too-short buffer throws", () => {
      const rom = new Uint8Array(0x8000);
      expect(() => Cartridge.deserialize(new Uint8Array(4), rom)).toThrow(
        /Cartridge state buffer too short/
      );
    });

    it("MMU.deserialize with too-short buffer throws", () => {
      expect(() => MMU.deserialize(new Uint8Array(100))).toThrow(
        /MMU state buffer too short/
      );
    });

    it("APU.deserialize with too-short buffer throws", () => {
      expect(() => APU.deserialize(new Uint8Array(8))).toThrow(
        /APU state buffer too short/
      );
    });
  });

  describe("Valid serialize→deserialize round-trips", () => {
    it("Timer round-trips correctly", () => {
      const timer = new Timer();
      timer.writeRegister(0xFF05, 0x42); // TIMA
      timer.writeRegister(0xFF06, 0x10); // TMA
      timer.writeRegister(0xFF07, 0x05); // TAC
      timer.tick(100);

      const data = timer.serialize();
      const restored = Timer.deserialize(data);

      expect(restored.readRegister(0xFF05)).toBe(timer.readRegister(0xFF05));
      expect(restored.readRegister(0xFF06)).toBe(timer.readRegister(0xFF06));
      expect(restored.readRegister(0xFF07)).toBe(timer.readRegister(0xFF07));
    });

    it("Joypad round-trips correctly", () => {
      const joypad = new Joypad();
      joypad.pressButton(0); // Right
      joypad.pressButton(4); // A

      const data = joypad.serialize();
      const restored = Joypad.deserialize(data);

      // Both should produce the same read result
      expect(restored.read(0x10)).toBe(joypad.read(0x10));
      expect(restored.read(0x20)).toBe(joypad.read(0x20));
    });

    it("PPU round-trips correctly", () => {
      const mmu = new MMU();
      const ppu = new PPU(mmu);

      const data = ppu.serialize();
      const restored = PPU.deserialize(data, mmu);

      expect(restored.mode).toBe(ppu.mode);
      expect(restored.line).toBe(ppu.line);
      expect(restored.getFramebuffer()).toEqual(ppu.getFramebuffer());
    });

    it("Cartridge round-trips correctly", () => {
      const rom = new Uint8Array(0x8000);
      rom[0x0147] = 0x01; // MBC1
      rom[0x0149] = 0x02; // 8KB RAM
      const cart = Cartridge.fromROM(rom);

      const data = cart.serialize();
      const restored = Cartridge.deserialize(data, rom);

      expect(restored.getMBCType()).toBe("MBC1");
    });

    it("MMU round-trips correctly", () => {
      const mmu = new MMU();
      mmu.writeByte(0x8000, 0x42);
      mmu.writeByte(0xC000, 0x11);
      mmu.writeByte(0xFFFF, 0x1F);

      const data = mmu.serialize();
      const restored = MMU.deserialize(data);

      expect(restored.readByte(0x8000)).toBe(0x42);
      expect(restored.readByte(0xC000)).toBe(0x11);
      expect(restored.readByte(0xFFFF)).toBe(0x1F);
    });

    it("APU round-trips correctly", () => {
      const apu = new APU();
      apu.writeRegister(0xFF24, 0x77);
      apu.writeRegister(0xFF25, 0x11);
      apu.writeRegister(0xFF12, 0xF3);
      apu.writeRegister(0xFF14, 0x80);
      apu.tick(2048);

      const data = apu.serialize();
      const restored = APU.deserialize(data);

      expect(restored.readRegister(0xFF24)).toBe(apu.readRegister(0xFF24));
      expect(restored.readRegister(0xFF25)).toBe(apu.readRegister(0xFF25));
      expect(restored.readRegister(0xFF26) & 0x8F).toBe(apu.readRegister(0xFF26) & 0x8F);
    });
  });
});
