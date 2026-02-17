import { describe, it, expect } from "bun:test";
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
  else if (banks === 128) romSizeCode = 6;
  rom[0x0147] = mbcType;
  rom[0x0148] = romSizeCode;
  rom[0x0149] = ramSizeCode;
  return rom;
}

function makeROMWithTitle(title: string, mbcType: number = 0): Uint8Array {
  const rom = makeROM(2, mbcType);
  for (let i = 0; i < title.length && i < 16; i++) {
    rom[0x0134 + i] = title.charCodeAt(i);
  }
  return rom;
}

function makeMBC5ROM512Banks(): Uint8Array {
  const banks = 512;
  const rom = new Uint8Array(banks * 0x4000);
  for (let b = 0; b < banks; b++) {
    const fill = ((b & 0xFF) ^ (((b >> 8) & 0x01) << 7)) & 0xFF;
    rom.fill(fill, b * 0x4000, (b + 1) * 0x4000);
  }
  rom[0x0147] = 0x1B; // MBC5 + RAM + BATTERY
  rom[0x0148] = 0x08; // 8MB / 512 banks
  rom[0x0149] = 0x03; // 32KB RAM
  return rom;
}

describe("Cartridge", () => {
  describe("ROM Only", () => {
    it("reads bank 0 (0x0000-0x3FFF)", () => {
      const rom = makeROM(2, 0x00);
      const cart = Cartridge.fromROM(rom);
      expect(cart.readByte(0x0000)).toBe(0);
      expect(cart.readByte(0x1000)).toBe(0);
      expect(cart.readByte(0x3FFF)).toBe(0);
    });

    it("reads bank 1 (0x4000-0x7FFF)", () => {
      const rom = makeROM(2, 0x00);
      const cart = Cartridge.fromROM(rom);
      expect(cart.readByte(0x4000)).toBe(1);
      expect(cart.readByte(0x5000)).toBe(1);
      expect(cart.readByte(0x7FFF)).toBe(1);
    });

    it("ignores writes to ROM region", () => {
      const rom = makeROM(2, 0x00);
      const cart = Cartridge.fromROM(rom);
      cart.writeByte(0x0000, 0x42);
      expect(cart.readByte(0x0000)).toBe(0);
      cart.writeByte(0x4000, 0x42);
      expect(cart.readByte(0x4000)).toBe(1);
    });

    it("has no external RAM (reads 0xFF)", () => {
      const rom = makeROM(2, 0x00);
      const cart = Cartridge.fromROM(rom);
      expect(cart.readByte(0xA000)).toBe(0xFF);
      expect(cart.readByte(0xB000)).toBe(0xFF);
      expect(cart.readByte(0xBFFF)).toBe(0xFF);
    });

    it("ignores writes to external RAM region", () => {
      const rom = makeROM(2, 0x00);
      const cart = Cartridge.fromROM(rom);
      cart.writeByte(0xA000, 0x42);
      expect(cart.readByte(0xA000)).toBe(0xFF);
    });

    it("returns 0xFF for unmapped addresses", () => {
      const rom = makeROM(2, 0x00);
      const cart = Cartridge.fromROM(rom);
      expect(cart.readByte(0x8000)).toBe(0xFF);
      expect(cart.readByte(0xC000)).toBe(0xFF);
      expect(cart.readByte(0xFFFF)).toBe(0xFF);
    });
  });

  describe("Header parsing", () => {
    it("reads title from header", () => {
      const rom = makeROMWithTitle("TESTGAME");
      const cart = Cartridge.fromROM(rom);
      expect(cart.getTitle()).toBe("TESTGAME");
    });

    it("handles title with null terminator in the middle", () => {
      const rom = makeROM(2);
      rom[0x0134] = 0x41; // A
      rom[0x0135] = 0x42; // B
      rom[0x0136] = 0x00; // null
      rom[0x0137] = 0x43; // C (should not be included)
      const cart = Cartridge.fromROM(rom);
      expect(cart.getTitle()).toBe("AB");
    });

    it("handles empty title (all zeros)", () => {
      const rom = makeROM(2);
      const cart = Cartridge.fromROM(rom);
      expect(cart.getTitle()).toBe("");
    });

    it("detects ROM_ONLY (type 0x00)", () => {
      const rom = makeROM(2, 0x00);
      const cart = Cartridge.fromROM(rom);
      expect(cart.getMBCType()).toBe("ROM_ONLY");
    });

    it("detects MBC1 (type 0x01)", () => {
      const rom = makeROM(4, 0x01);
      const cart = Cartridge.fromROM(rom);
      expect(cart.getMBCType()).toBe("MBC1");
    });

    it("detects MBC1+RAM+BATTERY (type 0x03)", () => {
      const rom = makeROM(4, 0x03);
      const cart = Cartridge.fromROM(rom);
      expect(cart.getMBCType()).toBe("MBC1");
    });

    it("detects MBC3+TIMER+BATTERY (type 0x0F)", () => {
      const rom = makeROM(4, 0x0F);
      const cart = Cartridge.fromROM(rom);
      expect(cart.getMBCType()).toBe("MBC3");
    });

    it("detects MBC3+RAM+BATTERY (type 0x13)", () => {
      const rom = makeROM(4, 0x13);
      const cart = Cartridge.fromROM(rom);
      expect(cart.getMBCType()).toBe("MBC3");
    });

    it("falls back to ROM_ONLY for unknown type", () => {
      const rom = makeROM(2, 0xFF);
      const cart = Cartridge.fromROM(rom);
      expect(cart.getMBCType()).toBe("ROM_ONLY");
    });

    it("parses ROM size correctly (2 banks)", () => {
      const rom = makeROM(2, 0x00);
      const cart = Cartridge.fromROM(rom);
      expect(cart.readByte(0x4000)).toBe(1);
    });

    it("parses RAM size code 0 (no RAM)", () => {
      const rom = makeROM(4, 0x01, 0);
      const cart = Cartridge.fromROM(rom);
      cart.writeByte(0x0000, 0x0A); // enable RAM
      expect(cart.readByte(0xA000)).toBe(0xFF);
    });

    it("parses RAM size code 2 (8KB)", () => {
      const rom = makeROM(4, 0x01, 2);
      const cart = Cartridge.fromROM(rom);
      cart.writeByte(0x0000, 0x0A); // enable RAM
      cart.writeByte(0xA000, 0x42);
      expect(cart.readByte(0xA000)).toBe(0x42);
    });

    it("parses RAM size code 3 (32KB)", () => {
      const rom = makeROM(4, 0x01, 3);
      const cart = Cartridge.fromROM(rom);
      cart.writeByte(0x0000, 0x0A);
      cart.writeByte(0xA000, 0x99);
      expect(cart.readByte(0xA000)).toBe(0x99);
    });
  });

  describe("MBC1 ROM banking", () => {
    it("defaults to bank 1 for 0x4000-0x7FFF region", () => {
      const rom = makeROM(4, 0x01);
      const cart = Cartridge.fromROM(rom);
      expect(cart.readByte(0x4000)).toBe(1);
    });

    it("switches to bank 2", () => {
      const rom = makeROM(4, 0x01);
      const cart = Cartridge.fromROM(rom);
      cart.writeByte(0x2000, 2); // select bank 2
      expect(cart.readByte(0x4000)).toBe(2);
    });

    it("switches to bank 3", () => {
      const rom = makeROM(4, 0x01);
      const cart = Cartridge.fromROM(rom);
      cart.writeByte(0x2000, 3);
      expect(cart.readByte(0x4000)).toBe(3);
    });

    it("bank 0 maps to bank 1 (bank 0→1 quirk)", () => {
      const rom = makeROM(4, 0x01);
      const cart = Cartridge.fromROM(rom);
      cart.writeByte(0x2000, 0); // writing 0 should select bank 1
      expect(cart.readByte(0x4000)).toBe(1);
    });

    it("bank 0 always readable from 0x0000-0x3FFF", () => {
      const rom = makeROM(4, 0x01);
      const cart = Cartridge.fromROM(rom);
      cart.writeByte(0x2000, 3); // switch to bank 3
      expect(cart.readByte(0x0000)).toBe(0); // bank 0 still accessible
      expect(cart.readByte(0x4000)).toBe(3);
    });

    it("wraps bank number when exceeding available banks", () => {
      const rom = makeROM(4, 0x01); // 4 banks: 0-3
      const cart = Cartridge.fromROM(rom);
      cart.writeByte(0x2000, 5); // bank 5 % 4 = 1
      expect(cart.readByte(0x4000)).toBe(1);
    });

    it("uses lower 5 bits of value for bank select", () => {
      const rom = makeROM(4, 0x01);
      const cart = Cartridge.fromROM(rom);
      cart.writeByte(0x2000, 0xE2); // lower 5 bits = 0x02
      expect(cart.readByte(0x4000)).toBe(2);
    });

    it("reads correct data throughout the bank", () => {
      const rom = makeROM(4, 0x01);
      const cart = Cartridge.fromROM(rom);
      cart.writeByte(0x2000, 2);
      expect(cart.readByte(0x4000)).toBe(2);
      expect(cart.readByte(0x5000)).toBe(2);
      expect(cart.readByte(0x7FFF)).toBe(2);
    });

    it("can switch banks multiple times", () => {
      const rom = makeROM(4, 0x01);
      const cart = Cartridge.fromROM(rom);

      cart.writeByte(0x2000, 1);
      expect(cart.readByte(0x4000)).toBe(1);

      cart.writeByte(0x2000, 2);
      expect(cart.readByte(0x4000)).toBe(2);

      cart.writeByte(0x2000, 3);
      expect(cart.readByte(0x4000)).toBe(3);

      cart.writeByte(0x2000, 1);
      expect(cart.readByte(0x4000)).toBe(1);
    });

    it("supports upper 2 bits via 0x4000-0x5FFF register (ROM mode)", () => {
      const rom = makeROM(64, 0x01); // 64 banks for testing upper bits
      const cart = Cartridge.fromROM(rom);
      cart.writeByte(0x2000, 1);     // lower 5 bits = 1
      cart.writeByte(0x4000, 1);     // upper 2 bits = 1 -> bank = (1 << 5) | 1 = 33
      expect(cart.readByte(0x4000)).toBe(33);
    });
  });

  describe("MBC1 RAM", () => {
    it("RAM is disabled by default (reads 0xFF)", () => {
      const rom = makeROM(4, 0x01, 2); // 8KB RAM
      const cart = Cartridge.fromROM(rom);
      expect(cart.readByte(0xA000)).toBe(0xFF);
    });

    it("enables RAM by writing 0x0A to 0x0000-0x1FFF", () => {
      const rom = makeROM(4, 0x01, 2);
      const cart = Cartridge.fromROM(rom);
      cart.writeByte(0x0000, 0x0A);
      cart.writeByte(0xA000, 0x42);
      expect(cart.readByte(0xA000)).toBe(0x42);
    });

    it("enables RAM with any value where lower nibble is 0xA", () => {
      const rom = makeROM(4, 0x01, 2);
      const cart = Cartridge.fromROM(rom);
      cart.writeByte(0x0000, 0x3A);
      cart.writeByte(0xA000, 0x55);
      expect(cart.readByte(0xA000)).toBe(0x55);
    });

    it("disables RAM by writing value without 0xA in lower nibble", () => {
      const rom = makeROM(4, 0x01, 2);
      const cart = Cartridge.fromROM(rom);
      cart.writeByte(0x0000, 0x0A); // enable
      cart.writeByte(0xA000, 0x42);
      expect(cart.readByte(0xA000)).toBe(0x42);

      cart.writeByte(0x0000, 0x00); // disable
      expect(cart.readByte(0xA000)).toBe(0xFF);
    });

    it("preserves RAM data after disable/re-enable", () => {
      const rom = makeROM(4, 0x01, 2);
      const cart = Cartridge.fromROM(rom);
      cart.writeByte(0x0000, 0x0A);
      cart.writeByte(0xA000, 0x42);
      cart.writeByte(0x0000, 0x00); // disable
      cart.writeByte(0x0000, 0x0A); // re-enable
      expect(cart.readByte(0xA000)).toBe(0x42);
    });

    it("ignores writes when RAM is disabled", () => {
      const rom = makeROM(4, 0x01, 2);
      const cart = Cartridge.fromROM(rom);
      cart.writeByte(0xA000, 0x42); // RAM not enabled
      cart.writeByte(0x0000, 0x0A); // enable RAM
      expect(cart.readByte(0xA000)).toBe(0x00); // should be 0, write was ignored
    });

    it("reads/writes multiple addresses in RAM", () => {
      const rom = makeROM(4, 0x01, 2);
      const cart = Cartridge.fromROM(rom);
      cart.writeByte(0x0000, 0x0A);
      cart.writeByte(0xA000, 0x11);
      cart.writeByte(0xA100, 0x22);
      cart.writeByte(0xBFFF, 0x33);
      expect(cart.readByte(0xA000)).toBe(0x11);
      expect(cart.readByte(0xA100)).toBe(0x22);
      expect(cart.readByte(0xBFFF)).toBe(0x33);
    });

    it("returns 0xFF when cartridge has no RAM", () => {
      const rom = makeROM(4, 0x01, 0); // no RAM
      const cart = Cartridge.fromROM(rom);
      cart.writeByte(0x0000, 0x0A);
      expect(cart.readByte(0xA000)).toBe(0xFF);
    });

    it("enable works from any address in 0x0000-0x1FFF", () => {
      const rom = makeROM(4, 0x01, 2);
      const cart = Cartridge.fromROM(rom);
      cart.writeByte(0x1FFF, 0x0A);
      cart.writeByte(0xA000, 0x77);
      expect(cart.readByte(0xA000)).toBe(0x77);
    });
  });

  describe("MBC1 banking modes", () => {
    it("defaults to ROM banking mode (mode 0)", () => {
      const rom = makeROM(64, 0x01, 3); // 64 banks, 32KB RAM
      const cart = Cartridge.fromROM(rom);
      cart.writeByte(0x0000, 0x0A);

      // In ROM mode, upper 2 bits apply to ROM bank
      cart.writeByte(0x2000, 1);
      cart.writeByte(0x4000, 1); // upper bits = 1
      // Bank = (1 << 5) | 1 = 33
      expect(cart.readByte(0x4000)).toBe(33);
    });

    it("ROM mode: RAM bank is always 0", () => {
      const rom = makeROM(64, 0x01, 3); // 32KB RAM
      const cart = Cartridge.fromROM(rom);
      cart.writeByte(0x0000, 0x0A);
      cart.writeByte(0x4000, 1); // set upper bits

      // In ROM mode (default), RAM bank should be 0
      cart.writeByte(0xA000, 0xAB);
      expect(cart.readByte(0xA000)).toBe(0xAB);

      // Switch to RAM mode to access bank 1
      cart.writeByte(0x6000, 1);
      // Now RAM bank should be romBankHigh = 1
      // Bank 1 should have clean data
      expect(cart.readByte(0xA000)).toBe(0x00);
    });

    it("RAM mode: upper bits apply to RAM bank select", () => {
      const rom = makeROM(64, 0x01, 3); // 32KB RAM (4 banks)
      const cart = Cartridge.fromROM(rom);
      cart.writeByte(0x0000, 0x0A); // enable RAM
      cart.writeByte(0x6000, 1);     // switch to RAM mode

      // Write to RAM bank 0
      cart.writeByte(0x4000, 0); // upper bits = 0, so RAM bank 0
      cart.writeByte(0xA000, 0x11);

      // Write to RAM bank 1
      cart.writeByte(0x4000, 1); // upper bits = 1, so RAM bank 1
      cart.writeByte(0xA000, 0x22);

      // Write to RAM bank 2
      cart.writeByte(0x4000, 2);
      cart.writeByte(0xA000, 0x33);

      // Write to RAM bank 3
      cart.writeByte(0x4000, 3);
      cart.writeByte(0xA000, 0x44);

      // Verify each bank
      cart.writeByte(0x4000, 0);
      expect(cart.readByte(0xA000)).toBe(0x11);

      cart.writeByte(0x4000, 1);
      expect(cart.readByte(0xA000)).toBe(0x22);

      cart.writeByte(0x4000, 2);
      expect(cart.readByte(0xA000)).toBe(0x33);

      cart.writeByte(0x4000, 3);
      expect(cart.readByte(0xA000)).toBe(0x44);
    });

    it("RAM mode: upper bits do NOT apply to ROM bank", () => {
      const rom = makeROM(64, 0x01);
      const cart = Cartridge.fromROM(rom);
      cart.writeByte(0x6000, 1); // RAM mode
      cart.writeByte(0x2000, 3); // lower 5 bits = 3
      cart.writeByte(0x4000, 1); // upper 2 bits = 1

      // In RAM mode, ROM bank uses only lower 5 bits
      expect(cart.readByte(0x4000)).toBe(3);
    });

    it("RAM mode: 0x0000-0x3FFF uses upper bits as bank high selector", () => {
      const rom = makeROM(64, 0x01);
      const cart = Cartridge.fromROM(rom);
      cart.writeByte(0x6000, 1); // RAM mode
      cart.writeByte(0x4000, 1); // upper 2 bits = 1 => low region bank 0x20
      expect(cart.readByte(0x0000)).toBe(32);
      expect(cart.readByte(0x3FFF)).toBe(32);
    });

    it("switching modes preserves register values", () => {
      const rom = makeROM(64, 0x01, 3);
      const cart = Cartridge.fromROM(rom);

      // Set bank registers in ROM mode
      cart.writeByte(0x2000, 5);  // lower 5 bits = 5
      cart.writeByte(0x4000, 1);  // upper 2 bits = 1
      // ROM bank = (1 << 5) | 5 = 37
      expect(cart.readByte(0x4000)).toBe(37);

      // Switch to RAM mode
      cart.writeByte(0x6000, 1);
      // Now ROM bank uses only lower 5 bits = 5
      expect(cart.readByte(0x4000)).toBe(5);

      // Switch back to ROM mode
      cart.writeByte(0x6000, 0);
      // ROM bank = (1 << 5) | 5 = 37 again
      expect(cart.readByte(0x4000)).toBe(37);
    });

    it("mode select only uses bit 0", () => {
      const rom = makeROM(4, 0x01);
      const cart = Cartridge.fromROM(rom);
      cart.writeByte(0x6000, 0xFE); // bit 0 = 0 -> ROM mode
      cart.writeByte(0x2000, 2);
      expect(cart.readByte(0x4000)).toBe(2);

      cart.writeByte(0x6000, 0xFF); // bit 0 = 1 -> RAM mode
      // Should still read bank 2 (low bits only, but same result for small ROM)
      expect(cart.readByte(0x4000)).toBe(2);
    });
  });

  describe("MBC3 ROM banking", () => {
    it("defaults to bank 1", () => {
      const rom = makeROM(8, 0x13);
      const cart = Cartridge.fromROM(rom);
      expect(cart.readByte(0x4000)).toBe(1);
    });

    it("switches ROM banks", () => {
      const rom = makeROM(8, 0x13);
      const cart = Cartridge.fromROM(rom);
      cart.writeByte(0x2000, 3);
      expect(cart.readByte(0x4000)).toBe(3);
    });

    it("bank 0 maps to bank 1 (bank 0→1 quirk)", () => {
      const rom = makeROM(8, 0x13);
      const cart = Cartridge.fromROM(rom);
      cart.writeByte(0x2000, 0);
      expect(cart.readByte(0x4000)).toBe(1);
    });

    it("uses 7-bit bank number (0x00-0x7F)", () => {
      const rom = makeROM(128, 0x13); // 128 banks
      const cart = Cartridge.fromROM(rom);
      cart.writeByte(0x2000, 0x7F); // max bank = 127
      expect(cart.readByte(0x4000)).toBe(127);
    });

    it("masks to 7 bits", () => {
      const rom = makeROM(128, 0x13);
      const cart = Cartridge.fromROM(rom);
      cart.writeByte(0x2000, 0xFF); // 0xFF & 0x7F = 0x7F = 127
      expect(cart.readByte(0x4000)).toBe(127);
    });

    it("wraps around when bank exceeds ROM size", () => {
      const rom = makeROM(8, 0x13); // 8 banks: 0-7
      const cart = Cartridge.fromROM(rom);
      cart.writeByte(0x2000, 9); // 9 % 8 = 1
      expect(cart.readByte(0x4000)).toBe(1);
    });

    it("can switch through multiple banks", () => {
      const rom = makeROM(8, 0x13);
      const cart = Cartridge.fromROM(rom);
      for (let b = 1; b < 8; b++) {
        cart.writeByte(0x2000, b);
        expect(cart.readByte(0x4000)).toBe(b);
      }
    });

    it("bank 0 always readable from 0x0000-0x3FFF", () => {
      const rom = makeROM(8, 0x13);
      const cart = Cartridge.fromROM(rom);
      cart.writeByte(0x2000, 5);
      expect(cart.readByte(0x0000)).toBe(0);
      expect(cart.readByte(0x3FFF)).toBe(0);
      expect(cart.readByte(0x4000)).toBe(5);
    });

    it("accepts bank select writes at various addresses in 0x2000-0x3FFF", () => {
      const rom = makeROM(8, 0x13);
      const cart = Cartridge.fromROM(rom);
      cart.writeByte(0x3FFF, 4);
      expect(cart.readByte(0x4000)).toBe(4);
    });
  });

  describe("MBC3 RAM banking", () => {
    it("supports 4 RAM banks", () => {
      const rom = makeROM(8, 0x13, 3); // 32KB RAM = 4 banks
      const cart = Cartridge.fromROM(rom);
      cart.writeByte(0x0000, 0x0A); // enable RAM

      for (let bank = 0; bank < 4; bank++) {
        cart.writeByte(0x4000, bank);
        cart.writeByte(0xA000, 0x10 + bank);
      }

      for (let bank = 0; bank < 4; bank++) {
        cart.writeByte(0x4000, bank);
        expect(cart.readByte(0xA000)).toBe(0x10 + bank);
      }
    });

    it("RAM bank select uses lower 4 bits (0x00-0x03 for RAM, 0x08-0x0C for RTC)", () => {
      const rom = makeROM(8, 0x13, 3);
      const cart = Cartridge.fromROM(rom);
      cart.writeByte(0x0000, 0x0A);

      // Writing 0x03 selects RAM bank 3
      cart.writeByte(0x4000, 0x03);
      cart.writeByte(0xA000, 0xBB);
      cart.writeByte(0x4000, 3);
      expect(cart.readByte(0xA000)).toBe(0xBB);
    });

    it("selecting RTC register (0x08-0x0C) returns 0xFF (RTC not emulated)", () => {
      const rom = makeROM(8, 0x13, 3);
      const cart = Cartridge.fromROM(rom);
      cart.writeByte(0x0000, 0x0A);

      // Write to RAM bank 0
      cart.writeByte(0x4000, 0);
      cart.writeByte(0xA000, 0x42);

      // Select RTC register (0x08 = seconds)
      cart.writeByte(0x4000, 0x08);
      expect(cart.readByte(0xA000)).toBe(0xFF);

      // Switching back to RAM bank 0 should still have data
      cart.writeByte(0x4000, 0);
      expect(cart.readByte(0xA000)).toBe(0x42);
    });

    it("RAM is disabled by default", () => {
      const rom = makeROM(8, 0x13, 3);
      const cart = Cartridge.fromROM(rom);
      expect(cart.readByte(0xA000)).toBe(0xFF);
    });

    it("RAM enable/disable works", () => {
      const rom = makeROM(8, 0x13, 3);
      const cart = Cartridge.fromROM(rom);

      cart.writeByte(0x0000, 0x0A); // enable
      cart.writeByte(0xA000, 0x42);
      expect(cart.readByte(0xA000)).toBe(0x42);

      cart.writeByte(0x0000, 0x00); // disable
      expect(cart.readByte(0xA000)).toBe(0xFF);

      cart.writeByte(0x0000, 0x0A); // re-enable
      expect(cart.readByte(0xA000)).toBe(0x42);
    });

    it("different RAM banks are independent", () => {
      const rom = makeROM(8, 0x13, 3);
      const cart = Cartridge.fromROM(rom);
      cart.writeByte(0x0000, 0x0A);

      cart.writeByte(0x4000, 0);
      cart.writeByte(0xA000, 0xAA);

      cart.writeByte(0x4000, 1);
      expect(cart.readByte(0xA000)).toBe(0x00);
      cart.writeByte(0xA000, 0xBB);

      cart.writeByte(0x4000, 0);
      expect(cart.readByte(0xA000)).toBe(0xAA);

      cart.writeByte(0x4000, 1);
      expect(cart.readByte(0xA000)).toBe(0xBB);
    });

    it("writes across full 8KB bank range", () => {
      const rom = makeROM(8, 0x13, 3);
      const cart = Cartridge.fromROM(rom);
      cart.writeByte(0x0000, 0x0A);
      cart.writeByte(0x4000, 0);

      cart.writeByte(0xA000, 0x11);
      cart.writeByte(0xAFFF, 0x22);
      cart.writeByte(0xBFFF, 0x33);

      expect(cart.readByte(0xA000)).toBe(0x11);
      expect(cart.readByte(0xAFFF)).toBe(0x22);
      expect(cart.readByte(0xBFFF)).toBe(0x33);
    });
  });

  describe("Serialize / Deserialize", () => {
    it("round-trips MBC1 state", () => {
      const rom = makeROM(64, 0x01, 3);
      const cart = Cartridge.fromROM(rom);
      cart.writeByte(0x0000, 0x0A); // enable RAM
      cart.writeByte(0x2000, 5);     // ROM bank low = 5
      cart.writeByte(0x4000, 2);     // ROM bank high = 2
      cart.writeByte(0x6000, 1);     // RAM mode
      cart.writeByte(0xA000, 0xDE);

      const serialized = cart.serialize();
      const restored = Cartridge.deserialize(serialized, rom);

      expect(restored.getMBCType()).toBe("MBC1");
      expect(restored.readByte(0xA000)).toBe(0xDE);

      // Verify ROM bank: in RAM mode, only lower bits used -> bank 5
      expect(restored.readByte(0x4000)).toBe(5);
    });

    it("round-trips MBC3 state", () => {
      const rom = makeROM(8, 0x13, 3);
      const cart = Cartridge.fromROM(rom);
      cart.writeByte(0x0000, 0x0A);
      cart.writeByte(0x2000, 5);    // ROM bank 5
      cart.writeByte(0x4000, 2);    // RAM bank 2
      cart.writeByte(0xA000, 0xCC);

      const serialized = cart.serialize();
      const restored = Cartridge.deserialize(serialized, rom);

      expect(restored.getMBCType()).toBe("MBC3");
      expect(restored.readByte(0x4000)).toBe(5);
      cart.writeByte(0x4000, 2);
      expect(restored.readByte(0xA000)).toBe(0xCC);
    });

    it("round-trips MBC5 state with 9-bit ROM bank selection", () => {
      const rom = makeMBC5ROM512Banks();
      const cart = Cartridge.fromROM(rom);
      cart.writeByte(0x2000, 0xAB); // low 8 bits
      cart.writeByte(0x3000, 0x01); // high 1 bit

      const before = cart.readByte(0x4000);
      const serialized = cart.serialize();
      const restored = Cartridge.deserialize(serialized, rom);
      const after = restored.readByte(0x4000);

      expect(after).toBe(before);
    });

    it("preserves RAM content across all banks", () => {
      const rom = makeROM(8, 0x13, 3); // 32KB RAM
      const cart = Cartridge.fromROM(rom);
      cart.writeByte(0x0000, 0x0A);

      // Fill each RAM bank with distinct data
      for (let bank = 0; bank < 4; bank++) {
        cart.writeByte(0x4000, bank);
        for (let addr = 0xA000; addr < 0xA010; addr++) {
          cart.writeByte(addr, bank * 16 + (addr - 0xA000));
        }
      }

      const serialized = cart.serialize();
      const restored = Cartridge.deserialize(serialized, rom);

      for (let bank = 0; bank < 4; bank++) {
        restored.writeByte(0x4000, bank);
        for (let addr = 0xA000; addr < 0xA010; addr++) {
          expect(restored.readByte(addr)).toBe(bank * 16 + (addr - 0xA000));
        }
      }
    });

    it("preserves RAM disabled state", () => {
      const rom = makeROM(4, 0x01, 2);
      const cart = Cartridge.fromROM(rom);
      // Don't enable RAM
      const serialized = cart.serialize();
      const restored = Cartridge.deserialize(serialized, rom);
      expect(restored.readByte(0xA000)).toBe(0xFF);
    });

    it("preserves RAM enabled state", () => {
      const rom = makeROM(4, 0x01, 2);
      const cart = Cartridge.fromROM(rom);
      cart.writeByte(0x0000, 0x0A);
      cart.writeByte(0xA000, 0x77);

      const serialized = cart.serialize();
      const restored = Cartridge.deserialize(serialized, rom);
      expect(restored.readByte(0xA000)).toBe(0x77);
    });

    it("serialized size is 8 + ramSize", () => {
      const rom = makeROM(4, 0x01, 2); // 8KB RAM
      const cart = Cartridge.fromROM(rom);
      const serialized = cart.serialize();
      expect(serialized.length).toBe(8 + 8192);
    });

    it("serialized size for ROM_ONLY is 8 (no RAM)", () => {
      const rom = makeROM(2, 0x00);
      const cart = Cartridge.fromROM(rom);
      const serialized = cart.serialize();
      expect(serialized.length).toBe(8);
    });

    it("round-trips ROM_ONLY cartridge", () => {
      const rom = makeROM(2, 0x00);
      const cart = Cartridge.fromROM(rom);
      const serialized = cart.serialize();
      const restored = Cartridge.deserialize(serialized, rom);
      expect(restored.getMBCType()).toBe("ROM_ONLY");
      expect(restored.readByte(0x0000)).toBe(0);
      expect(restored.readByte(0x4000)).toBe(1);
    });
  });
});
