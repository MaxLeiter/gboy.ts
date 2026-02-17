import { describe, it, expect } from "bun:test";
import { MMU } from "../mmu";
import { Cartridge } from "../cartridge";

function makeROM(banks: number, mbcType: number = 0, ramSizeCode: number = 0): Uint8Array {
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
  rom[0x0147] = mbcType;
  rom[0x0148] = romSizeCode;
  rom[0x0149] = ramSizeCode;
  return rom;
}

describe("MMU-Cartridge wiring", () => {
  describe("without cartridge (backward compat)", () => {
    it("ROM reads use internal rom array", () => {
      const mmu = new MMU();
      const romData = new Uint8Array(0x8000);
      romData[0x0000] = 0xAA;
      romData[0x0100] = 0xBB;
      romData[0x4000] = 0xCC;
      mmu.loadROM(romData);

      expect(mmu.readByte(0x0000)).toBe(0xAA);
      expect(mmu.readByte(0x0100)).toBe(0xBB);
      expect(mmu.readByte(0x4000)).toBe(0xCC);
    });

    it("ROM writes are ignored (read-only)", () => {
      const mmu = new MMU();
      const romData = new Uint8Array(0x8000);
      romData[0x0000] = 0x42;
      mmu.loadROM(romData);

      mmu.writeByte(0x0000, 0xFF);
      expect(mmu.readByte(0x0000)).toBe(0x42);
    });

    it("ERAM reads/writes use internal eram", () => {
      const mmu = new MMU();
      mmu.writeByte(0xA000, 0x55);
      expect(mmu.readByte(0xA000)).toBe(0x55);
      mmu.writeByte(0xBFFF, 0x77);
      expect(mmu.readByte(0xBFFF)).toBe(0x77);
    });
  });

  describe("with cartridge", () => {
    it("ROM reads delegate to cartridge", () => {
      const mmu = new MMU();
      const romData = makeROM(4, 0x01); // MBC1, 4 banks
      const cart = Cartridge.fromROM(romData);
      mmu.cartridge = cart;

      // Bank 0 reads
      expect(mmu.readByte(0x0000)).toBe(0);
      expect(mmu.readByte(0x3FFF)).toBe(0);

      // Bank 1 reads (default)
      expect(mmu.readByte(0x4000)).toBe(1);
      expect(mmu.readByte(0x7FFF)).toBe(1);
    });

    it("ROM writes delegate to cartridge (MBC register writes)", () => {
      const mmu = new MMU();
      const romData = makeROM(4, 0x01);
      const cart = Cartridge.fromROM(romData);
      mmu.cartridge = cart;

      // Default: bank 1
      expect(mmu.readByte(0x4000)).toBe(1);

      // Write to MBC register to switch to bank 2
      mmu.writeByte(0x2000, 2);
      expect(mmu.readByte(0x4000)).toBe(2);

      // Switch to bank 3
      mmu.writeByte(0x2000, 3);
      expect(mmu.readByte(0x4000)).toBe(3);
    });

    it("ERAM reads delegate to cartridge", () => {
      const mmu = new MMU();
      const romData = makeROM(4, 0x01, 2); // MBC1, 8KB RAM
      const cart = Cartridge.fromROM(romData);
      mmu.cartridge = cart;

      // RAM disabled by default
      expect(mmu.readByte(0xA000)).toBe(0xFF);

      // Enable RAM
      mmu.writeByte(0x0000, 0x0A);
      mmu.writeByte(0xA000, 0x42);
      expect(mmu.readByte(0xA000)).toBe(0x42);
    });

    it("ERAM writes delegate to cartridge", () => {
      const mmu = new MMU();
      const romData = makeROM(4, 0x01, 2);
      const cart = Cartridge.fromROM(romData);
      mmu.cartridge = cart;

      // Enable RAM and write
      mmu.writeByte(0x0000, 0x0A);
      mmu.writeByte(0xA000, 0xDE);
      mmu.writeByte(0xA100, 0xAD);
      mmu.writeByte(0xBFFF, 0xBE);

      expect(mmu.readByte(0xA000)).toBe(0xDE);
      expect(mmu.readByte(0xA100)).toBe(0xAD);
      expect(mmu.readByte(0xBFFF)).toBe(0xBE);
    });

    it("does not use internal eram when cartridge is set", () => {
      const mmu = new MMU();
      // Write to internal eram first
      mmu.writeByte(0xA000, 0x99);
      expect(mmu.readByte(0xA000)).toBe(0x99);

      // Now attach cartridge
      const romData = makeROM(4, 0x01, 2);
      const cart = Cartridge.fromROM(romData);
      mmu.cartridge = cart;

      // Should read from cartridge (RAM disabled = 0xFF), not internal eram
      expect(mmu.readByte(0xA000)).toBe(0xFF);
    });

    it("bank switching works for MBC3 through MMU", () => {
      const mmu = new MMU();
      const romData = makeROM(8, 0x13); // MBC3, 8 banks
      const cart = Cartridge.fromROM(romData);
      mmu.cartridge = cart;

      expect(mmu.readByte(0x4000)).toBe(1); // default bank

      mmu.writeByte(0x2000, 5);
      expect(mmu.readByte(0x4000)).toBe(5);

      mmu.writeByte(0x2000, 7);
      expect(mmu.readByte(0x4000)).toBe(7);
    });
  });

  describe("ERAM without cartridge", () => {
    it("uses internal eram for reads and writes", () => {
      const mmu = new MMU();

      expect(mmu.readByte(0xA000)).toBe(0);

      mmu.writeByte(0xA000, 0x12);
      mmu.writeByte(0xA500, 0x34);
      mmu.writeByte(0xBFFF, 0x56);

      expect(mmu.readByte(0xA000)).toBe(0x12);
      expect(mmu.readByte(0xA500)).toBe(0x34);
      expect(mmu.readByte(0xBFFF)).toBe(0x56);
    });
  });
});
