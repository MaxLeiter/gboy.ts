import { describe, expect, it, beforeEach } from "bun:test";
import { MMU } from "../mmu";
import type { IMemory } from "../mmu";

describe("MMU", () => {
  let mmu: MMU;

  beforeEach(() => {
    mmu = new MMU();
  });

  describe("IMemory interface", () => {
    it("MMU implements IMemory", () => {
      const memory: IMemory = mmu;
      expect(typeof memory.readByte).toBe("function");
      expect(typeof memory.writeByte).toBe("function");
      expect(typeof memory.readWord).toBe("function");
      expect(typeof memory.writeWord).toBe("function");
    });
  });

  describe("ROM (0x0000-0x7FFF)", () => {
    it("reads 0x00 from ROM before any ROM is loaded", () => {
      expect(mmu.readByte(0x0000)).toBe(0x00);
      expect(mmu.readByte(0x3FFF)).toBe(0x00);
      expect(mmu.readByte(0x4000)).toBe(0x00);
      expect(mmu.readByte(0x7FFF)).toBe(0x00);
    });

    it("reads back loaded ROM data from bank 0 (0x0000-0x3FFF)", () => {
      const rom = new Uint8Array(0x8000);
      rom[0x0000] = 0x31;
      rom[0x0100] = 0x00; // entry point
      rom[0x3FFF] = 0xAB;
      mmu.loadROM(rom);

      expect(mmu.readByte(0x0000)).toBe(0x31);
      expect(mmu.readByte(0x0100)).toBe(0x00);
      expect(mmu.readByte(0x3FFF)).toBe(0xAB);
    });

    it("reads back loaded ROM data from bank 1 (0x4000-0x7FFF)", () => {
      const rom = new Uint8Array(0x8000);
      rom[0x4000] = 0xCD;
      rom[0x7FFF] = 0xEF;
      mmu.loadROM(rom);

      expect(mmu.readByte(0x4000)).toBe(0xCD);
      expect(mmu.readByte(0x7FFF)).toBe(0xEF);
    });

    it("ROM is read-only — writes do not modify ROM data", () => {
      const rom = new Uint8Array(0x8000);
      rom[0x0000] = 0x31;
      rom[0x4000] = 0xCD;
      mmu.loadROM(rom);

      mmu.writeByte(0x0000, 0xFF);
      mmu.writeByte(0x4000, 0xFF);

      expect(mmu.readByte(0x0000)).toBe(0x31);
      expect(mmu.readByte(0x4000)).toBe(0xCD);
    });

    it("loads a small ROM (less than 32KB) and pads the rest with zeros", () => {
      const rom = new Uint8Array(256);
      rom[0] = 0x00; // NOP
      rom[1] = 0xC3; // JP
      mmu.loadROM(rom);

      expect(mmu.readByte(0x0000)).toBe(0x00);
      expect(mmu.readByte(0x0001)).toBe(0xC3);
      expect(mmu.readByte(0x0100)).toBe(0x00);
    });
  });

  describe("VRAM (0x8000-0x9FFF)", () => {
    it("reads and writes bytes", () => {
      mmu.writeByte(0x8000, 0x42);
      expect(mmu.readByte(0x8000)).toBe(0x42);

      mmu.writeByte(0x9FFF, 0x99);
      expect(mmu.readByte(0x9FFF)).toBe(0x99);
    });

    it("defaults to 0x00", () => {
      expect(mmu.readByte(0x8000)).toBe(0x00);
      expect(mmu.readByte(0x9FFF)).toBe(0x00);
    });
  });

  describe("External RAM (0xA000-0xBFFF)", () => {
    it("reads and writes bytes", () => {
      mmu.writeByte(0xA000, 0x55);
      expect(mmu.readByte(0xA000)).toBe(0x55);

      mmu.writeByte(0xBFFF, 0xAA);
      expect(mmu.readByte(0xBFFF)).toBe(0xAA);
    });

    it("defaults to 0x00", () => {
      expect(mmu.readByte(0xA000)).toBe(0x00);
      expect(mmu.readByte(0xBFFF)).toBe(0x00);
    });
  });

  describe("Work RAM (0xC000-0xDFFF)", () => {
    it("reads and writes to WRAM bank 0 (0xC000-0xCFFF)", () => {
      mmu.writeByte(0xC000, 0x11);
      expect(mmu.readByte(0xC000)).toBe(0x11);

      mmu.writeByte(0xCFFF, 0x22);
      expect(mmu.readByte(0xCFFF)).toBe(0x22);
    });

    it("reads and writes to WRAM bank 1 (0xD000-0xDFFF)", () => {
      mmu.writeByte(0xD000, 0x33);
      expect(mmu.readByte(0xD000)).toBe(0x33);

      mmu.writeByte(0xDFFF, 0x44);
      expect(mmu.readByte(0xDFFF)).toBe(0x44);
    });

    it("defaults to 0x00", () => {
      expect(mmu.readByte(0xC000)).toBe(0x00);
      expect(mmu.readByte(0xDFFF)).toBe(0x00);
    });
  });

  describe("Echo RAM (0xE000-0xFDFF)", () => {
    it("mirrors WRAM: write to WRAM, read from Echo", () => {
      mmu.writeByte(0xC000, 0xAA);
      expect(mmu.readByte(0xE000)).toBe(0xAA);

      mmu.writeByte(0xC123, 0xBB);
      expect(mmu.readByte(0xE123)).toBe(0xBB);

      mmu.writeByte(0xDDFF, 0xCC);
      expect(mmu.readByte(0xFDFF)).toBe(0xCC);
    });

    it("mirrors WRAM: write to Echo, read from WRAM", () => {
      mmu.writeByte(0xE000, 0x11);
      expect(mmu.readByte(0xC000)).toBe(0x11);

      mmu.writeByte(0xE456, 0x22);
      expect(mmu.readByte(0xC456)).toBe(0x22);

      mmu.writeByte(0xFDFF, 0x33);
      expect(mmu.readByte(0xDDFF)).toBe(0x33);
    });

    it("echo and WRAM stay in sync after multiple writes", () => {
      mmu.writeByte(0xC000, 0x10);
      expect(mmu.readByte(0xE000)).toBe(0x10);

      mmu.writeByte(0xE000, 0x20);
      expect(mmu.readByte(0xC000)).toBe(0x20);
      expect(mmu.readByte(0xE000)).toBe(0x20);
    });

    it("mirrors the full range C000-DDFF (not just C000-CFFF)", () => {
      mmu.writeByte(0xD000, 0x77);
      expect(mmu.readByte(0xF000)).toBe(0x77);

      mmu.writeByte(0xF000, 0x88);
      expect(mmu.readByte(0xD000)).toBe(0x88);
    });
  });

  describe("OAM (0xFE00-0xFE9F)", () => {
    it("reads and writes bytes within OAM", () => {
      mmu.writeByte(0xFE00, 0x10);
      expect(mmu.readByte(0xFE00)).toBe(0x10);

      mmu.writeByte(0xFE9F, 0x20);
      expect(mmu.readByte(0xFE9F)).toBe(0x20);
    });

    it("defaults to 0x00", () => {
      expect(mmu.readByte(0xFE00)).toBe(0x00);
      expect(mmu.readByte(0xFE9F)).toBe(0x00);
    });

    it("handles middle-of-range access", () => {
      mmu.writeByte(0xFE50, 0xAB);
      expect(mmu.readByte(0xFE50)).toBe(0xAB);
    });
  });

  describe("Unusable region (0xFEA0-0xFEFF)", () => {
    it("returns 0xFF on read", () => {
      expect(mmu.readByte(0xFEA0)).toBe(0xFF);
      expect(mmu.readByte(0xFECF)).toBe(0xFF);
      expect(mmu.readByte(0xFEFF)).toBe(0xFF);
    });

    it("writes are ignored (still reads 0xFF)", () => {
      mmu.writeByte(0xFEA0, 0x42);
      expect(mmu.readByte(0xFEA0)).toBe(0xFF);

      mmu.writeByte(0xFEFF, 0x00);
      expect(mmu.readByte(0xFEFF)).toBe(0xFF);
    });
  });

  describe("I/O Registers (0xFF00-0xFF7F)", () => {
    it("P1/JOYP: only bits 5-4 writable, bits 7-6 read as 1, bits 3-0 reflect buttons", () => {
      mmu.writeByte(0xFF00, 0x30);
      // Bits 7-6 = 1 (unused), bits 5-4 = selection (0x30), bits 3-0 = 0xF (no buttons pressed)
      expect(mmu.readByte(0xFF00)).toBe(0xFF);
    });

    it("DIV: any write resets to 0x00", () => {
      mmu.writeByte(0xFF04, 0xAB);
      expect(mmu.readByte(0xFF04)).toBe(0x00);
    });

    it("reads and writes TIMA (0xFF05)", () => {
      mmu.writeByte(0xFF05, 0x10);
      expect(mmu.readByte(0xFF05)).toBe(0x10);
    });

    it("reads and writes TMA (0xFF06)", () => {
      mmu.writeByte(0xFF06, 0x20);
      expect(mmu.readByte(0xFF06)).toBe(0x20);
    });

    it("reads and writes TAC (0xFF07)", () => {
      mmu.writeByte(0xFF07, 0x05);
      expect(mmu.readByte(0xFF07)).toBe(0x05);
    });

    it("IF: upper 3 bits always read as 1", () => {
      mmu.writeByte(0xFF0F, 0x1F);
      // Bits 7-5 unused, always read as 1 on DMG
      expect(mmu.readByte(0xFF0F)).toBe(0xFF);
    });

    it("reads and writes LCDC (0xFF40)", () => {
      mmu.writeByte(0xFF40, 0x91);
      expect(mmu.readByte(0xFF40)).toBe(0x91);
    });

    it("STAT: bit 7 always reads as 1", () => {
      mmu.writeByte(0xFF41, 0x05);
      // Bit 7 is unused and always reads as 1
      expect(mmu.readByte(0xFF41)).toBe(0x85);
    });

    it("reads and writes SCY (0xFF42)", () => {
      mmu.writeByte(0xFF42, 0x00);
      expect(mmu.readByte(0xFF42)).toBe(0x00);
    });

    it("reads and writes SCX (0xFF43)", () => {
      mmu.writeByte(0xFF43, 0x00);
      expect(mmu.readByte(0xFF43)).toBe(0x00);
    });

    it("LY (0xFF44) resets to 0 on write (read-only from CPU)", () => {
      mmu.writeByte(0xFF44, 0x90);
      expect(mmu.readByte(0xFF44)).toBe(0);
    });

    it("reads and writes LYC (0xFF45)", () => {
      mmu.writeByte(0xFF45, 0x45);
      expect(mmu.readByte(0xFF45)).toBe(0x45);
    });

    it("reads and writes DMA (0xFF46)", () => {
      mmu.writeByte(0xFF46, 0xC0);
      expect(mmu.readByte(0xFF46)).toBe(0xC0);
    });

    it("DMA write copies 160 bytes into OAM (instant; real HW takes ~640 T-cycles)", () => {
      for (let i = 0; i < 0xA0; i++) {
        mmu.writeByte(0xC000 + i, (i * 3) & 0xFF);
      }

      mmu.writeByte(0xFF46, 0xC0);

      for (let i = 0; i < 0xA0; i++) {
        expect(mmu.readByte(0xFE00 + i)).toBe((i * 3) & 0xFF);
      }
    });

    it("reads and writes BGP (0xFF47)", () => {
      mmu.writeByte(0xFF47, 0xFC);
      expect(mmu.readByte(0xFF47)).toBe(0xFC);
    });

    it("reads and writes OBP0 (0xFF48)", () => {
      mmu.writeByte(0xFF48, 0xFF);
      expect(mmu.readByte(0xFF48)).toBe(0xFF);
    });

    it("reads and writes OBP1 (0xFF49)", () => {
      mmu.writeByte(0xFF49, 0xFF);
      expect(mmu.readByte(0xFF49)).toBe(0xFF);
    });

    it("reads and writes WY (0xFF4A)", () => {
      mmu.writeByte(0xFF4A, 0x00);
      expect(mmu.readByte(0xFF4A)).toBe(0x00);
    });

    it("reads and writes WX (0xFF4B)", () => {
      mmu.writeByte(0xFF4B, 0x07);
      expect(mmu.readByte(0xFF4B)).toBe(0x07);
    });

    it("reads and writes to generic I/O addresses", () => {
      mmu.writeByte(0xFF10, 0x80);
      expect(mmu.readByte(0xFF10)).toBe(0x80);

      mmu.writeByte(0xFF7F, 0x01);
      expect(mmu.readByte(0xFF7F)).toBe(0x01);
    });

    it("I/O defaults: P1 reads 0xFF (bits 7-6=1, nothing selected, no buttons)", () => {
      // P1: bits 7-6=1, bits 5-4=0 (nothing selected), bits 3-0=0xF (no buttons)
      expect(mmu.readByte(0xFF00)).toBe(0xCF);
      expect(mmu.readByte(0xFF40)).toBe(0x00);
    });
  });

  describe("HRAM (0xFF80-0xFFFE)", () => {
    it("reads and writes bytes", () => {
      mmu.writeByte(0xFF80, 0xDE);
      expect(mmu.readByte(0xFF80)).toBe(0xDE);

      mmu.writeByte(0xFFFE, 0xAD);
      expect(mmu.readByte(0xFFFE)).toBe(0xAD);
    });

    it("defaults to 0x00", () => {
      expect(mmu.readByte(0xFF80)).toBe(0x00);
      expect(mmu.readByte(0xFFFE)).toBe(0x00);
    });
  });

  describe("Interrupt Enable Register (0xFFFF)", () => {
    it("reads and writes the IE register", () => {
      mmu.writeByte(0xFFFF, 0x1F);
      expect(mmu.readByte(0xFFFF)).toBe(0x1F);
    });

    it("defaults to 0x00", () => {
      expect(mmu.readByte(0xFFFF)).toBe(0x00);
    });
  });

  describe("readWord / writeWord (16-bit little-endian)", () => {
    it("writes and reads a 16-bit word in little-endian order", () => {
      mmu.writeWord(0xC000, 0xBEEF);
      expect(mmu.readWord(0xC000)).toBe(0xBEEF);
      // Low byte first (little-endian)
      expect(mmu.readByte(0xC000)).toBe(0xEF); // low byte
      expect(mmu.readByte(0xC001)).toBe(0xBE); // high byte
    });

    it("readWord assembles from two consecutive bytes", () => {
      mmu.writeByte(0xC100, 0x34); // low byte
      mmu.writeByte(0xC101, 0x12); // high byte
      expect(mmu.readWord(0xC100)).toBe(0x1234);
    });

    it("handles word 0x0000", () => {
      mmu.writeWord(0xC000, 0x0000);
      expect(mmu.readWord(0xC000)).toBe(0x0000);
    });

    it("handles word 0xFFFF", () => {
      mmu.writeWord(0xC000, 0xFFFF);
      expect(mmu.readWord(0xC000)).toBe(0xFFFF);
    });

    it("works in HRAM", () => {
      mmu.writeWord(0xFF80, 0x1234);
      expect(mmu.readWord(0xFF80)).toBe(0x1234);
    });

    it("works across WRAM/Echo boundary semantics", () => {
      mmu.writeWord(0xC000, 0xCAFE);
      // Echo should mirror it
      expect(mmu.readWord(0xE000)).toBe(0xCAFE);
    });

    it("reads a word from loaded ROM", () => {
      const rom = new Uint8Array(0x8000);
      rom[0x0100] = 0x50; // low byte
      rom[0x0101] = 0xC3; // high byte
      mmu.loadROM(rom);
      expect(mmu.readWord(0x0100)).toBe(0xC350);
    });
  });

  describe("loadROM", () => {
    it("loads ROM data and reads it back correctly", () => {
      const rom = new Uint8Array(0x8000);
      for (let i = 0; i < rom.length; i++) {
        rom[i] = i & 0xFF;
      }
      mmu.loadROM(rom);

      expect(mmu.readByte(0x0000)).toBe(0x00);
      expect(mmu.readByte(0x0001)).toBe(0x01);
      expect(mmu.readByte(0x00FF)).toBe(0xFF);
      expect(mmu.readByte(0x0100)).toBe(0x00); // wraps
      expect(mmu.readByte(0x7FFF)).toBe(0xFF);
    });

    it("loading a new ROM replaces the old one", () => {
      const rom1 = new Uint8Array(0x8000);
      rom1[0] = 0xAA;
      mmu.loadROM(rom1);
      expect(mmu.readByte(0x0000)).toBe(0xAA);

      const rom2 = new Uint8Array(0x8000);
      rom2[0] = 0xBB;
      mmu.loadROM(rom2);
      expect(mmu.readByte(0x0000)).toBe(0xBB);
    });

    it("does not affect other memory regions", () => {
      mmu.writeByte(0xC000, 0x42);
      const rom = new Uint8Array(0x8000);
      rom[0] = 0xFF;
      mmu.loadROM(rom);

      expect(mmu.readByte(0xC000)).toBe(0x42);
    });
  });

  describe("serialize / deserialize", () => {
    it("round-trips an empty MMU", () => {
      const data = mmu.serialize();
      const restored = MMU.deserialize(data);

      expect(restored.readByte(0xC000)).toBe(0x00);
      expect(restored.readByte(0xFF80)).toBe(0x00);
      expect(restored.readByte(0xFFFF)).toBe(0x00);
    });

    it("round-trips ROM data when rom is provided to deserialize", () => {
      const rom = new Uint8Array(0x8000);
      rom[0x0000] = 0x31;
      rom[0x0100] = 0xC3;
      rom[0x7FFF] = 0xAB;
      mmu.loadROM(rom);

      const data = mmu.serialize();
      const restored = MMU.deserialize(data, rom);

      expect(restored.readByte(0x0000)).toBe(0x31);
      expect(restored.readByte(0x0100)).toBe(0xC3);
      expect(restored.readByte(0x7FFF)).toBe(0xAB);
    });

    it("round-trips VRAM data", () => {
      mmu.writeByte(0x8000, 0x42);
      mmu.writeByte(0x9FFF, 0x99);

      const restored = MMU.deserialize(mmu.serialize());

      expect(restored.readByte(0x8000)).toBe(0x42);
      expect(restored.readByte(0x9FFF)).toBe(0x99);
    });

    it("round-trips External RAM data", () => {
      mmu.writeByte(0xA000, 0x55);
      mmu.writeByte(0xBFFF, 0xAA);

      const restored = MMU.deserialize(mmu.serialize());

      expect(restored.readByte(0xA000)).toBe(0x55);
      expect(restored.readByte(0xBFFF)).toBe(0xAA);
    });

    it("round-trips WRAM data (and echo mirrors correctly)", () => {
      mmu.writeByte(0xC000, 0x11);
      mmu.writeByte(0xDDFF, 0x22);

      const restored = MMU.deserialize(mmu.serialize());

      expect(restored.readByte(0xC000)).toBe(0x11);
      expect(restored.readByte(0xDDFF)).toBe(0x22);
      // Echo mirror
      expect(restored.readByte(0xE000)).toBe(0x11);
      expect(restored.readByte(0xFDFF)).toBe(0x22);
    });

    it("round-trips OAM data", () => {
      mmu.writeByte(0xFE00, 0x10);
      mmu.writeByte(0xFE9F, 0x20);

      const restored = MMU.deserialize(mmu.serialize());

      expect(restored.readByte(0xFE00)).toBe(0x10);
      expect(restored.readByte(0xFE9F)).toBe(0x20);
    });

    it("round-trips I/O register data", () => {
      mmu.writeByte(0xFF00, 0x20); // P1: select directions (bit 5=0, bit 4=1)
      mmu.writeByte(0xFF40, 0x91);
      mmu.writeByte(0xFF47, 0xFC);

      const restored = MMU.deserialize(mmu.serialize());

      // P1: bits 7-6=1, selection=0x20, buttons=0xF (no joypad wired)
      expect(restored.readByte(0xFF00)).toBe(0xEF);
      expect(restored.readByte(0xFF40)).toBe(0x91);
      expect(restored.readByte(0xFF47)).toBe(0xFC);
    });

    it("round-trips HRAM data", () => {
      mmu.writeByte(0xFF80, 0xDE);
      mmu.writeByte(0xFFFE, 0xAD);

      const restored = MMU.deserialize(mmu.serialize());

      expect(restored.readByte(0xFF80)).toBe(0xDE);
      expect(restored.readByte(0xFFFE)).toBe(0xAD);
    });

    it("round-trips IE register", () => {
      mmu.writeByte(0xFFFF, 0x1F);

      const restored = MMU.deserialize(mmu.serialize());

      expect(restored.readByte(0xFFFF)).toBe(0x1F);
    });

    it("serialized data is a Uint8Array", () => {
      const data = mmu.serialize();
      expect(data).toBeInstanceOf(Uint8Array);
    });

    it("deserialized MMU is a fully functional MMU", () => {
      mmu.writeByte(0xC000, 0x42);
      const restored = MMU.deserialize(mmu.serialize());

      // Can still write to it
      restored.writeByte(0xC001, 0x43);
      expect(restored.readByte(0xC001)).toBe(0x43);

      // Original is not affected
      expect(mmu.readByte(0xC001)).toBe(0x00);
    });
  });

  describe("Edge cases", () => {
    it("8-bit value wrapping: only lower 8 bits stored", () => {
      mmu.writeByte(0xC000, 0x1FF);
      expect(mmu.readByte(0xC000)).toBe(0xFF);

      mmu.writeByte(0xC001, 256);
      expect(mmu.readByte(0xC001)).toBe(0x00);

      mmu.writeByte(0xC002, 0x100);
      expect(mmu.readByte(0xC002)).toBe(0x00);
    });

    it("16-bit value wrapping: only lower 16 bits stored", () => {
      mmu.writeWord(0xC000, 0x1FFFF);
      expect(mmu.readWord(0xC000)).toBe(0xFFFF);

      mmu.writeWord(0xC002, 0x10000);
      expect(mmu.readWord(0xC002)).toBe(0x0000);
    });

    it("address boundary: last byte of ROM bank 0 / first byte of bank 1", () => {
      const rom = new Uint8Array(0x8000);
      rom[0x3FFF] = 0xAA;
      rom[0x4000] = 0xBB;
      mmu.loadROM(rom);

      expect(mmu.readByte(0x3FFF)).toBe(0xAA);
      expect(mmu.readByte(0x4000)).toBe(0xBB);
    });

    it("address boundary: VRAM start/end", () => {
      mmu.writeByte(0x8000, 0x01);
      mmu.writeByte(0x9FFF, 0x02);
      expect(mmu.readByte(0x8000)).toBe(0x01);
      expect(mmu.readByte(0x9FFF)).toBe(0x02);
    });

    it("address boundary: External RAM start/end", () => {
      mmu.writeByte(0xA000, 0x01);
      mmu.writeByte(0xBFFF, 0x02);
      expect(mmu.readByte(0xA000)).toBe(0x01);
      expect(mmu.readByte(0xBFFF)).toBe(0x02);
    });

    it("address boundary: OAM end / unusable start", () => {
      mmu.writeByte(0xFE9F, 0xAA);
      expect(mmu.readByte(0xFE9F)).toBe(0xAA);
      expect(mmu.readByte(0xFEA0)).toBe(0xFF);
    });

    it("address boundary: unusable end / I/O start", () => {
      expect(mmu.readByte(0xFEFF)).toBe(0xFF);
      mmu.writeByte(0xFF00, 0x30);
      // P1: bits 7-6=1, selection=0x30, buttons=0xF
      expect(mmu.readByte(0xFF00)).toBe(0xFF);
    });

    it("address boundary: I/O end / HRAM start", () => {
      mmu.writeByte(0xFF7F, 0xAA);
      expect(mmu.readByte(0xFF7F)).toBe(0xAA);

      mmu.writeByte(0xFF80, 0xBB);
      expect(mmu.readByte(0xFF80)).toBe(0xBB);
    });

    it("address boundary: HRAM end / IE register", () => {
      mmu.writeByte(0xFFFE, 0xAA);
      expect(mmu.readByte(0xFFFE)).toBe(0xAA);

      mmu.writeByte(0xFFFF, 0xBB);
      expect(mmu.readByte(0xFFFF)).toBe(0xBB);
    });

    it("address boundary: Echo RAM ends at 0xFDFF, OAM starts at 0xFE00", () => {
      mmu.writeByte(0xDDFF, 0x77);
      expect(mmu.readByte(0xFDFF)).toBe(0x77); // echo

      mmu.writeByte(0xFE00, 0x88);
      expect(mmu.readByte(0xFE00)).toBe(0x88); // OAM, not echo
    });

    it("word read across WRAM bank boundary", () => {
      mmu.writeByte(0xCFFF, 0x34);
      mmu.writeByte(0xD000, 0x12);
      expect(mmu.readWord(0xCFFF)).toBe(0x1234);
    });

    it("multiple writes to same address — last write wins", () => {
      mmu.writeByte(0xC000, 0x11);
      mmu.writeByte(0xC000, 0x22);
      mmu.writeByte(0xC000, 0x33);
      expect(mmu.readByte(0xC000)).toBe(0x33);
    });

    it("writing and reading every region in sequence does not corrupt other regions", () => {
      const rom = new Uint8Array(0x8000);
      rom[0x0000] = 0x01;
      mmu.loadROM(rom);

      mmu.writeByte(0x8000, 0x02); // VRAM
      mmu.writeByte(0xA000, 0x03); // External RAM
      mmu.writeByte(0xC000, 0x04); // WRAM
      mmu.writeByte(0xFE00, 0x05); // OAM
      mmu.writeByte(0xFF10, 0x06); // I/O (use generic register, not P1)
      mmu.writeByte(0xFF80, 0x07); // HRAM
      mmu.writeByte(0xFFFF, 0x08); // IE

      expect(mmu.readByte(0x0000)).toBe(0x01);
      expect(mmu.readByte(0x8000)).toBe(0x02);
      expect(mmu.readByte(0xA000)).toBe(0x03);
      expect(mmu.readByte(0xC000)).toBe(0x04);
      expect(mmu.readByte(0xFE00)).toBe(0x05);
      expect(mmu.readByte(0xFF10)).toBe(0x06);
      expect(mmu.readByte(0xFF80)).toBe(0x07);
      expect(mmu.readByte(0xFFFF)).toBe(0x08);
    });
  });
});
