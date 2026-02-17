import { describe, test, expect, beforeEach } from "bun:test";
import { CPU, type IMemory } from "../cpu";

class MockMemory implements IMemory {
  private data = new Uint8Array(0x10000);

  readByte(address: number): number {
    return this.data[address & 0xffff]!;
  }

  writeByte(address: number, value: number): void {
    this.data[address & 0xffff] = value & 0xff;
  }

  readWord(address: number): number {
    const lo = this.readByte(address);
    const hi = this.readByte(address + 1);
    return (hi << 8) | lo;
  }

  writeWord(address: number, value: number): void {
    this.writeByte(address, value & 0xff);
    this.writeByte(address + 1, (value >> 8) & 0xff);
  }

  load(address: number, bytes: number[]): void {
    for (let i = 0; i < bytes.length; i++) {
      this.data[(address + i) & 0xffff] = bytes[i]!;
    }
  }
}

describe("CPU jumps, calls, returns, rotations", () => {
  let memory: MockMemory;
  let cpu: CPU;

  beforeEach(() => {
    memory = new MockMemory();
    cpu = new CPU(memory);
  });

  function loadAt(address: number, bytes: number[]) {
    cpu.pc = address;
    memory.load(address, bytes);
  }

  // ─── JP cc, a16 ─────────────────────────────────────────────────

  describe("0xC2 JP NZ, a16", () => {
    test("jumps when Z=0 (condition met)", () => {
      cpu.flagZ = false;
      loadAt(0x0200, [0xc2, 0x50, 0x04]);
      const cycles = cpu.step();
      expect(cpu.pc).toBe(0x0450);
      expect(cycles).toBe(16);
    });

    test("does not jump when Z=1 (condition not met)", () => {
      cpu.flagZ = true;
      loadAt(0x0200, [0xc2, 0x50, 0x04]);
      const cycles = cpu.step();
      expect(cpu.pc).toBe(0x0203);
      expect(cycles).toBe(12);
    });
  });

  describe("0xCA JP Z, a16", () => {
    test("jumps when Z=1", () => {
      cpu.flagZ = true;
      loadAt(0x0200, [0xca, 0x00, 0x10]);
      const cycles = cpu.step();
      expect(cpu.pc).toBe(0x1000);
      expect(cycles).toBe(16);
    });

    test("does not jump when Z=0", () => {
      cpu.flagZ = false;
      loadAt(0x0200, [0xca, 0x00, 0x10]);
      const cycles = cpu.step();
      expect(cpu.pc).toBe(0x0203);
      expect(cycles).toBe(12);
    });
  });

  describe("0xD2 JP NC, a16", () => {
    test("jumps when C=0", () => {
      cpu.flagC = false;
      loadAt(0x0200, [0xd2, 0xab, 0xcd]);
      const cycles = cpu.step();
      expect(cpu.pc).toBe(0xcdab);
      expect(cycles).toBe(16);
    });

    test("does not jump when C=1", () => {
      cpu.flagC = true;
      loadAt(0x0200, [0xd2, 0xab, 0xcd]);
      const cycles = cpu.step();
      expect(cpu.pc).toBe(0x0203);
      expect(cycles).toBe(12);
    });
  });

  describe("0xDA JP C, a16", () => {
    test("jumps when C=1", () => {
      cpu.flagC = true;
      loadAt(0x0200, [0xda, 0xff, 0x00]);
      const cycles = cpu.step();
      expect(cpu.pc).toBe(0x00ff);
      expect(cycles).toBe(16);
    });

    test("does not jump when C=0", () => {
      cpu.flagC = false;
      loadAt(0x0200, [0xda, 0xff, 0x00]);
      const cycles = cpu.step();
      expect(cpu.pc).toBe(0x0203);
      expect(cycles).toBe(12);
    });
  });

  // ─── JP (HL) ────────────────────────────────────────────────────

  describe("0xE9 JP (HL)", () => {
    test("sets PC to HL value", () => {
      cpu.hl = 0x1234;
      loadAt(0x0200, [0xe9]);
      const cycles = cpu.step();
      expect(cpu.pc).toBe(0x1234);
      expect(cycles).toBe(4);
    });

    test("does not read from memory at HL", () => {
      cpu.hl = 0x4000;
      memory.writeByte(0x4000, 0xff);
      loadAt(0x0200, [0xe9]);
      cpu.step();
      expect(cpu.pc).toBe(0x4000);
    });
  });

  // ─── JR r8 ──────────────────────────────────────────────────────

  describe("0x18 JR r8", () => {
    test("jumps forward by positive offset", () => {
      loadAt(0x0200, [0x18, 0x10]); // JR +16 -> 0x0200 + 2 + 16 = 0x0212
      const cycles = cpu.step();
      expect(cpu.pc).toBe(0x0212);
      expect(cycles).toBe(12);
    });

    test("jumps backward by negative offset", () => {
      loadAt(0x0200, [0x18, 0xfe]); // -2 signed -> 0x0200 + 2 + (-2) = 0x0200
      const cycles = cpu.step();
      expect(cpu.pc).toBe(0x0200);
      expect(cycles).toBe(12);
    });

    test("wraps around address space forward", () => {
      loadAt(0xffff, [0x18, 0x05]); // 0xFFFF + 2 + 5 = 0x10006 -> wraps to 0x0006
      // fetchByte at 0xFFFF reads 0x18, PC becomes 0x0000
      // fetchByte at 0x0000 reads offset
      memory.writeByte(0xffff, 0x18);
      memory.writeByte(0x0000, 0x05);
      cpu.pc = 0xffff;
      cpu.step();
      expect(cpu.pc).toBe(0x0006);
    });

    test("wraps around address space backward", () => {
      loadAt(0x0001, [0x18, 0xfb]); // 0x0001 + 2 + (-5) = 0xFFFE
      cpu.step();
      expect(cpu.pc).toBe(0xfffe);
    });
  });

  // ─── JR cc, r8 ─────────────────────────────────────────────────

  describe("0x20 JR NZ, r8", () => {
    test("jumps when Z=0 (taken)", () => {
      cpu.flagZ = false;
      loadAt(0x0300, [0x20, 0x0a]); // JR NZ, +10 -> 0x0300+2+10 = 0x030C
      const cycles = cpu.step();
      expect(cpu.pc).toBe(0x030c);
      expect(cycles).toBe(12);
    });

    test("does not jump when Z=1 (not taken)", () => {
      cpu.flagZ = true;
      loadAt(0x0300, [0x20, 0x0a]);
      const cycles = cpu.step();
      expect(cpu.pc).toBe(0x0302);
      expect(cycles).toBe(8);
    });

    test("backward jump when taken", () => {
      cpu.flagZ = false;
      loadAt(0x0300, [0x20, 0xf6]); // -10 signed -> 0x0300+2+(-10)=0x02F8
      cpu.step();
      expect(cpu.pc).toBe(0x02f8);
    });
  });

  describe("0x28 JR Z, r8", () => {
    test("jumps when Z=1 (taken)", () => {
      cpu.flagZ = true;
      loadAt(0x0300, [0x28, 0x05]);
      const cycles = cpu.step();
      expect(cpu.pc).toBe(0x0307);
      expect(cycles).toBe(12);
    });

    test("does not jump when Z=0 (not taken)", () => {
      cpu.flagZ = false;
      loadAt(0x0300, [0x28, 0x05]);
      const cycles = cpu.step();
      expect(cpu.pc).toBe(0x0302);
      expect(cycles).toBe(8);
    });
  });

  describe("0x30 JR NC, r8", () => {
    test("jumps when C=0 (taken)", () => {
      cpu.flagC = false;
      loadAt(0x0300, [0x30, 0x20]);
      const cycles = cpu.step();
      expect(cpu.pc).toBe(0x0322);
      expect(cycles).toBe(12);
    });

    test("does not jump when C=1 (not taken)", () => {
      cpu.flagC = true;
      loadAt(0x0300, [0x30, 0x20]);
      const cycles = cpu.step();
      expect(cpu.pc).toBe(0x0302);
      expect(cycles).toBe(8);
    });
  });

  describe("0x38 JR C, r8", () => {
    test("jumps when C=1 (taken)", () => {
      cpu.flagC = true;
      loadAt(0x0300, [0x38, 0x03]);
      const cycles = cpu.step();
      expect(cpu.pc).toBe(0x0305);
      expect(cycles).toBe(12);
    });

    test("does not jump when C=0 (not taken)", () => {
      cpu.flagC = false;
      loadAt(0x0300, [0x38, 0x03]);
      const cycles = cpu.step();
      expect(cpu.pc).toBe(0x0302);
      expect(cycles).toBe(8);
    });
  });

  // ─── CALL a16 ───────────────────────────────────────────────────

  describe("0xCD CALL a16", () => {
    test("pushes return address and jumps", () => {
      cpu.sp = 0xfffe;
      loadAt(0x0200, [0xcd, 0x00, 0x05]); // CALL 0x0500
      const cycles = cpu.step();
      expect(cpu.pc).toBe(0x0500);
      expect(cpu.sp).toBe(0xfffc);
      expect(memory.readWord(0xfffc)).toBe(0x0203); // return address = PC after 3-byte instruction
      expect(cycles).toBe(24);
    });

    test("CALL followed by RET returns to correct address", () => {
      cpu.sp = 0xfffe;
      loadAt(0x0200, [0xcd, 0x00, 0x05]); // CALL 0x0500
      cpu.step();
      // Now at 0x0500, put a RET there
      memory.writeByte(0x0500, 0xc9);
      cpu.step();
      expect(cpu.pc).toBe(0x0203);
      expect(cpu.sp).toBe(0xfffe);
    });
  });

  // ─── CALL cc, a16 ──────────────────────────────────────────────

  describe("0xC4 CALL NZ, a16", () => {
    test("calls when Z=0 (taken)", () => {
      cpu.flagZ = false;
      cpu.sp = 0xfffe;
      loadAt(0x0200, [0xc4, 0x00, 0x08]);
      const cycles = cpu.step();
      expect(cpu.pc).toBe(0x0800);
      expect(cpu.sp).toBe(0xfffc);
      expect(memory.readWord(0xfffc)).toBe(0x0203);
      expect(cycles).toBe(24);
    });

    test("does not call when Z=1 (not taken)", () => {
      cpu.flagZ = true;
      cpu.sp = 0xfffe;
      loadAt(0x0200, [0xc4, 0x00, 0x08]);
      const cycles = cpu.step();
      expect(cpu.pc).toBe(0x0203);
      expect(cpu.sp).toBe(0xfffe);
      expect(cycles).toBe(12);
    });
  });

  describe("0xCC CALL Z, a16", () => {
    test("calls when Z=1 (taken)", () => {
      cpu.flagZ = true;
      cpu.sp = 0xfffe;
      loadAt(0x0200, [0xcc, 0x34, 0x12]);
      const cycles = cpu.step();
      expect(cpu.pc).toBe(0x1234);
      expect(cpu.sp).toBe(0xfffc);
      expect(memory.readWord(0xfffc)).toBe(0x0203);
      expect(cycles).toBe(24);
    });

    test("does not call when Z=0 (not taken)", () => {
      cpu.flagZ = false;
      cpu.sp = 0xfffe;
      loadAt(0x0200, [0xcc, 0x34, 0x12]);
      const cycles = cpu.step();
      expect(cpu.pc).toBe(0x0203);
      expect(cpu.sp).toBe(0xfffe);
      expect(cycles).toBe(12);
    });
  });

  describe("0xD4 CALL NC, a16", () => {
    test("calls when C=0 (taken)", () => {
      cpu.flagC = false;
      cpu.sp = 0xfffe;
      loadAt(0x0200, [0xd4, 0x00, 0x30]);
      const cycles = cpu.step();
      expect(cpu.pc).toBe(0x3000);
      expect(cpu.sp).toBe(0xfffc);
      expect(memory.readWord(0xfffc)).toBe(0x0203);
      expect(cycles).toBe(24);
    });

    test("does not call when C=1 (not taken)", () => {
      cpu.flagC = true;
      cpu.sp = 0xfffe;
      loadAt(0x0200, [0xd4, 0x00, 0x30]);
      const cycles = cpu.step();
      expect(cpu.pc).toBe(0x0203);
      expect(cpu.sp).toBe(0xfffe);
      expect(cycles).toBe(12);
    });
  });

  describe("0xDC CALL C, a16", () => {
    test("calls when C=1 (taken)", () => {
      cpu.flagC = true;
      cpu.sp = 0xfffe;
      loadAt(0x0200, [0xdc, 0xab, 0xcd]);
      const cycles = cpu.step();
      expect(cpu.pc).toBe(0xcdab);
      expect(cpu.sp).toBe(0xfffc);
      expect(memory.readWord(0xfffc)).toBe(0x0203);
      expect(cycles).toBe(24);
    });

    test("does not call when C=0 (not taken)", () => {
      cpu.flagC = false;
      cpu.sp = 0xfffe;
      loadAt(0x0200, [0xdc, 0xab, 0xcd]);
      const cycles = cpu.step();
      expect(cpu.pc).toBe(0x0203);
      expect(cpu.sp).toBe(0xfffe);
      expect(cycles).toBe(12);
    });
  });

  // ─── RET ────────────────────────────────────────────────────────

  describe("0xC9 RET", () => {
    test("pops address from stack and jumps", () => {
      cpu.sp = 0xfffc;
      memory.writeWord(0xfffc, 0x0203);
      loadAt(0x0500, [0xc9]);
      const cycles = cpu.step();
      expect(cpu.pc).toBe(0x0203);
      expect(cpu.sp).toBe(0xfffe);
      expect(cycles).toBe(16);
    });
  });

  // ─── RET cc ─────────────────────────────────────────────────────

  describe("0xC0 RET NZ", () => {
    test("returns when Z=0 (taken)", () => {
      cpu.flagZ = false;
      cpu.sp = 0xfffc;
      memory.writeWord(0xfffc, 0x1234);
      loadAt(0x0500, [0xc0]);
      const cycles = cpu.step();
      expect(cpu.pc).toBe(0x1234);
      expect(cpu.sp).toBe(0xfffe);
      expect(cycles).toBe(20);
    });

    test("does not return when Z=1 (not taken)", () => {
      cpu.flagZ = true;
      cpu.sp = 0xfffc;
      memory.writeWord(0xfffc, 0x1234);
      loadAt(0x0500, [0xc0]);
      const cycles = cpu.step();
      expect(cpu.pc).toBe(0x0501);
      expect(cpu.sp).toBe(0xfffc);
      expect(cycles).toBe(8);
    });
  });

  describe("0xC8 RET Z", () => {
    test("returns when Z=1 (taken)", () => {
      cpu.flagZ = true;
      cpu.sp = 0xfffc;
      memory.writeWord(0xfffc, 0xabcd);
      loadAt(0x0500, [0xc8]);
      const cycles = cpu.step();
      expect(cpu.pc).toBe(0xabcd);
      expect(cpu.sp).toBe(0xfffe);
      expect(cycles).toBe(20);
    });

    test("does not return when Z=0 (not taken)", () => {
      cpu.flagZ = false;
      cpu.sp = 0xfffc;
      memory.writeWord(0xfffc, 0xabcd);
      loadAt(0x0500, [0xc8]);
      const cycles = cpu.step();
      expect(cpu.pc).toBe(0x0501);
      expect(cpu.sp).toBe(0xfffc);
      expect(cycles).toBe(8);
    });
  });

  describe("0xD0 RET NC", () => {
    test("returns when C=0 (taken)", () => {
      cpu.flagC = false;
      cpu.sp = 0xfffc;
      memory.writeWord(0xfffc, 0x9999);
      loadAt(0x0500, [0xd0]);
      const cycles = cpu.step();
      expect(cpu.pc).toBe(0x9999);
      expect(cpu.sp).toBe(0xfffe);
      expect(cycles).toBe(20);
    });

    test("does not return when C=1 (not taken)", () => {
      cpu.flagC = true;
      cpu.sp = 0xfffc;
      memory.writeWord(0xfffc, 0x9999);
      loadAt(0x0500, [0xd0]);
      const cycles = cpu.step();
      expect(cpu.pc).toBe(0x0501);
      expect(cpu.sp).toBe(0xfffc);
      expect(cycles).toBe(8);
    });
  });

  describe("0xD8 RET C", () => {
    test("returns when C=1 (taken)", () => {
      cpu.flagC = true;
      cpu.sp = 0xfffc;
      memory.writeWord(0xfffc, 0x5555);
      loadAt(0x0500, [0xd8]);
      const cycles = cpu.step();
      expect(cpu.pc).toBe(0x5555);
      expect(cpu.sp).toBe(0xfffe);
      expect(cycles).toBe(20);
    });

    test("does not return when C=0 (not taken)", () => {
      cpu.flagC = false;
      cpu.sp = 0xfffc;
      memory.writeWord(0xfffc, 0x5555);
      loadAt(0x0500, [0xd8]);
      const cycles = cpu.step();
      expect(cpu.pc).toBe(0x0501);
      expect(cpu.sp).toBe(0xfffc);
      expect(cycles).toBe(8);
    });
  });

  // ─── RETI ───────────────────────────────────────────────────────

  describe("0xD9 RETI", () => {
    test("pops address and enables interrupts", () => {
      cpu.ime = false;
      cpu.sp = 0xfffc;
      memory.writeWord(0xfffc, 0x0203);
      loadAt(0x0500, [0xd9]);
      const cycles = cpu.step();
      expect(cpu.pc).toBe(0x0203);
      expect(cpu.sp).toBe(0xfffe);
      expect(cpu.ime).toBe(true);
      expect(cycles).toBe(16);
    });
  });

  // ─── RST n ──────────────────────────────────────────────────────

  describe("RST instructions", () => {
    const rstTests: [number, number][] = [
      [0xc7, 0x00],
      [0xcf, 0x08],
      [0xd7, 0x10],
      [0xdf, 0x18],
      [0xe7, 0x20],
      [0xef, 0x28],
      [0xf7, 0x30],
      [0xff, 0x38],
    ];

    for (const [opcode, target] of rstTests) {
      describe(`0x${opcode.toString(16).toUpperCase()} RST 0x${target.toString(16).toUpperCase().padStart(2, "0")}`, () => {
        test("pushes PC and jumps to fixed address", () => {
          cpu.sp = 0xfffe;
          loadAt(0x0200, [opcode]);
          const cycles = cpu.step();
          expect(cpu.pc).toBe(target);
          expect(cpu.sp).toBe(0xfffc);
          // Return address is the address AFTER the RST instruction (1-byte opcode)
          expect(memory.readWord(0xfffc)).toBe(0x0201);
          expect(cycles).toBe(16);
        });
      });
    }

    test("RST pushes correct return address from different location", () => {
      cpu.sp = 0xfffe;
      loadAt(0x1000, [0xc7]); // RST 00
      cpu.step();
      expect(memory.readWord(0xfffc)).toBe(0x1001);
    });
  });

  // ─── RLCA ───────────────────────────────────────────────────────

  describe("0x07 RLCA", () => {
    test("rotates A left, bit 7 to carry and bit 0", () => {
      cpu.a = 0x85; // 10000101
      loadAt(0x0200, [0x07]);
      const cycles = cpu.step();
      // bit 7 was 1 -> carry=1, result: 00001011 = 0x0B
      expect(cpu.a).toBe(0x0b);
      expect(cpu.flagC).toBe(true);
      expect(cpu.flagZ).toBe(false);
      expect(cpu.flagN).toBe(false);
      expect(cpu.flagH).toBe(false);
      expect(cycles).toBe(4);
    });

    test("bit 7 is 0, no carry", () => {
      cpu.a = 0x01; // 00000001
      loadAt(0x0200, [0x07]);
      cpu.step();
      expect(cpu.a).toBe(0x02);
      expect(cpu.flagC).toBe(false);
    });

    test("0xFF rotates to 0xFF with carry", () => {
      cpu.a = 0xff;
      loadAt(0x0200, [0x07]);
      cpu.step();
      expect(cpu.a).toBe(0xff);
      expect(cpu.flagC).toBe(true);
    });

    test("0x00 stays 0x00, no carry", () => {
      cpu.a = 0x00;
      loadAt(0x0200, [0x07]);
      cpu.step();
      expect(cpu.a).toBe(0x00);
      expect(cpu.flagC).toBe(false);
      expect(cpu.flagZ).toBe(false); // Z always 0 for RLCA
    });

    test("clears Z flag even if result is zero", () => {
      cpu.a = 0x00;
      cpu.flagZ = true;
      loadAt(0x0200, [0x07]);
      cpu.step();
      expect(cpu.flagZ).toBe(false);
    });
  });

  // ─── RLA ────────────────────────────────────────────────────────

  describe("0x17 RLA", () => {
    test("rotates A left through carry (carry was 0)", () => {
      cpu.a = 0x80; // 10000000
      cpu.flagC = false;
      loadAt(0x0200, [0x17]);
      const cycles = cpu.step();
      // bit 7 was 1 -> carry=1; old carry 0 -> bit 0 = 0
      expect(cpu.a).toBe(0x00);
      expect(cpu.flagC).toBe(true);
      expect(cpu.flagZ).toBe(false);
      expect(cpu.flagN).toBe(false);
      expect(cpu.flagH).toBe(false);
      expect(cycles).toBe(4);
    });

    test("rotates A left through carry (carry was 1)", () => {
      cpu.a = 0x80; // 10000000
      cpu.flagC = true;
      loadAt(0x0200, [0x17]);
      cpu.step();
      // bit 7 was 1 -> carry=1; old carry 1 -> bit 0 = 1
      expect(cpu.a).toBe(0x01);
      expect(cpu.flagC).toBe(true);
    });

    test("0x00 with carry=1 produces 0x01", () => {
      cpu.a = 0x00;
      cpu.flagC = true;
      loadAt(0x0200, [0x17]);
      cpu.step();
      expect(cpu.a).toBe(0x01);
      expect(cpu.flagC).toBe(false);
    });

    test("0x01 with carry=0", () => {
      cpu.a = 0x01; // 00000001
      cpu.flagC = false;
      loadAt(0x0200, [0x17]);
      cpu.step();
      expect(cpu.a).toBe(0x02);
      expect(cpu.flagC).toBe(false);
    });
  });

  // ─── RRCA ───────────────────────────────────────────────────────

  describe("0x0F RRCA", () => {
    test("rotates A right, bit 0 to carry and bit 7", () => {
      cpu.a = 0x01; // 00000001
      loadAt(0x0200, [0x0f]);
      const cycles = cpu.step();
      // bit 0 was 1 -> carry=1, bit 7=1: 10000000 = 0x80
      expect(cpu.a).toBe(0x80);
      expect(cpu.flagC).toBe(true);
      expect(cpu.flagZ).toBe(false);
      expect(cpu.flagN).toBe(false);
      expect(cpu.flagH).toBe(false);
      expect(cycles).toBe(4);
    });

    test("bit 0 is 0, no carry", () => {
      cpu.a = 0x02; // 00000010
      loadAt(0x0200, [0x0f]);
      cpu.step();
      expect(cpu.a).toBe(0x01);
      expect(cpu.flagC).toBe(false);
    });

    test("0xFF rotates to 0xFF with carry", () => {
      cpu.a = 0xff;
      loadAt(0x0200, [0x0f]);
      cpu.step();
      expect(cpu.a).toBe(0xff);
      expect(cpu.flagC).toBe(true);
    });

    test("0x00 stays 0x00, no carry", () => {
      cpu.a = 0x00;
      loadAt(0x0200, [0x0f]);
      cpu.step();
      expect(cpu.a).toBe(0x00);
      expect(cpu.flagC).toBe(false);
      expect(cpu.flagZ).toBe(false);
    });
  });

  // ─── RRA ────────────────────────────────────────────────────────

  describe("0x1F RRA", () => {
    test("rotates A right through carry (carry was 0)", () => {
      cpu.a = 0x01; // 00000001
      cpu.flagC = false;
      loadAt(0x0200, [0x1f]);
      const cycles = cpu.step();
      // bit 0 was 1 -> carry=1; old carry 0 -> bit 7 = 0
      expect(cpu.a).toBe(0x00);
      expect(cpu.flagC).toBe(true);
      expect(cpu.flagZ).toBe(false);
      expect(cpu.flagN).toBe(false);
      expect(cpu.flagH).toBe(false);
      expect(cycles).toBe(4);
    });

    test("rotates A right through carry (carry was 1)", () => {
      cpu.a = 0x01; // 00000001
      cpu.flagC = true;
      loadAt(0x0200, [0x1f]);
      cpu.step();
      // bit 0 was 1 -> carry=1; old carry 1 -> bit 7 = 1
      expect(cpu.a).toBe(0x80);
      expect(cpu.flagC).toBe(true);
    });

    test("0x00 with carry=1 produces 0x80", () => {
      cpu.a = 0x00;
      cpu.flagC = true;
      loadAt(0x0200, [0x1f]);
      cpu.step();
      expect(cpu.a).toBe(0x80);
      expect(cpu.flagC).toBe(false);
    });

    test("0x80 with carry=0", () => {
      cpu.a = 0x80; // 10000000
      cpu.flagC = false;
      loadAt(0x0200, [0x1f]);
      cpu.step();
      expect(cpu.a).toBe(0x40);
      expect(cpu.flagC).toBe(false);
    });
  });

  // ─── ADD SP, r8 ─────────────────────────────────────────────────

  describe("0xE8 ADD SP, r8", () => {
    test("adds positive offset to SP", () => {
      cpu.sp = 0xfff0;
      loadAt(0x0200, [0xe8, 0x05]); // ADD SP, +5
      const cycles = cpu.step();
      expect(cpu.sp).toBe(0xfff5);
      expect(cpu.flagZ).toBe(false);
      expect(cpu.flagN).toBe(false);
      expect(cycles).toBe(16);
    });

    test("adds negative offset to SP", () => {
      cpu.sp = 0xfff0;
      loadAt(0x0200, [0xe8, 0xfb]); // ADD SP, -5 (0xFB = -5 signed)
      const cycles = cpu.step();
      expect(cpu.sp).toBe(0xffeb);
      expect(cpu.flagZ).toBe(false);
      expect(cpu.flagN).toBe(false);
      expect(cycles).toBe(16);
    });

    test("H flag set on half-carry from bit 3", () => {
      cpu.sp = 0x0008; // lower byte 0x08
      loadAt(0x0200, [0xe8, 0x08]); // 0x08 + 0x08 = carry from bit 3
      cpu.step();
      expect(cpu.sp).toBe(0x0010);
      expect(cpu.flagH).toBe(true);
      expect(cpu.flagC).toBe(false);
    });

    test("C flag set on carry from bit 7", () => {
      cpu.sp = 0x00ff;
      loadAt(0x0200, [0xe8, 0x01]); // 0xFF + 0x01 = carry from bit 7
      cpu.step();
      expect(cpu.sp).toBe(0x0100);
      expect(cpu.flagC).toBe(true);
    });

    test("both H and C set", () => {
      cpu.sp = 0x00ff;
      loadAt(0x0200, [0xe8, 0x01]);
      cpu.step();
      expect(cpu.flagH).toBe(true);
      expect(cpu.flagC).toBe(true);
    });

    test("flags based on lower byte addition with negative value", () => {
      // SP = 0x10FF (lower byte = 0xFF)
      // r8 = -1 = 0xFF unsigned
      // (0xFF + 0xFF) & 0x100 -> C set
      // (0x0F + 0x0F) & 0x10 -> H set
      cpu.sp = 0x10ff;
      loadAt(0x0200, [0xe8, 0xff]); // -1
      cpu.step();
      expect(cpu.sp).toBe(0x10fe);
      expect(cpu.flagH).toBe(true);
      expect(cpu.flagC).toBe(true);
    });

    test("no flags set when no carry", () => {
      cpu.sp = 0x1000;
      loadAt(0x0200, [0xe8, 0x01]);
      cpu.step();
      expect(cpu.sp).toBe(0x1001);
      expect(cpu.flagH).toBe(false);
      expect(cpu.flagC).toBe(false);
    });

    test("advances PC by 2", () => {
      cpu.sp = 0x1000;
      loadAt(0x0200, [0xe8, 0x01]);
      cpu.step();
      expect(cpu.pc).toBe(0x0202);
    });
  });

  // ─── Integration: CALL + RET cc ─────────────────────────────────

  describe("Integration: CALL and conditional RET", () => {
    test("CALL then RET NZ when Z=0 returns correctly", () => {
      cpu.sp = 0xfffe;
      cpu.flagZ = false;
      // CALL 0x0500
      loadAt(0x0200, [0xcd, 0x00, 0x05]);
      cpu.step();
      expect(cpu.pc).toBe(0x0500);

      // RET NZ
      memory.writeByte(0x0500, 0xc0);
      cpu.step();
      expect(cpu.pc).toBe(0x0203);
      expect(cpu.sp).toBe(0xfffe);
    });

    test("CALL then conditional RET not taken stays in subroutine", () => {
      cpu.sp = 0xfffe;
      cpu.flagZ = true;
      loadAt(0x0200, [0xcd, 0x00, 0x05]);
      cpu.step();

      // RET NZ with Z=1 -> not taken
      memory.writeByte(0x0500, 0xc0);
      const cycles = cpu.step();
      expect(cpu.pc).toBe(0x0501); // stays in subroutine
      expect(cpu.sp).toBe(0xfffc);
      expect(cycles).toBe(8);
    });
  });
});
