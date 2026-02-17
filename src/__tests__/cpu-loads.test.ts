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

  peek(address: number): number {
    return this.data[address & 0xffff]!;
  }
}

describe("CPU load/store opcodes", () => {
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

  function saveFlagsState() {
    return cpu.f;
  }

  // ─── Register-to-register LD r8, r8 ─────────────────────────────

  describe("LD r8, r8 (register-to-register)", () => {
    test("0x40 LD B,B copies B to B (identity)", () => {
      cpu.b = 0x42;
      loadAt(0x0200, [0x40]);
      const f = saveFlagsState();
      const cycles = cpu.step();
      expect(cpu.b).toBe(0x42);
      expect(cycles).toBe(4);
      expect(cpu.pc).toBe(0x0201);
      expect(cpu.f).toBe(f);
    });

    test("0x41 LD B,C", () => {
      cpu.c = 0xAB;
      loadAt(0x0200, [0x41]);
      const cycles = cpu.step();
      expect(cpu.b).toBe(0xAB);
      expect(cycles).toBe(4);
    });

    test("0x42 LD B,D", () => {
      cpu.d = 0xCD;
      loadAt(0x0200, [0x42]);
      cpu.step();
      expect(cpu.b).toBe(0xCD);
    });

    test("0x43 LD B,E", () => {
      cpu.e = 0xEF;
      loadAt(0x0200, [0x43]);
      cpu.step();
      expect(cpu.b).toBe(0xEF);
    });

    test("0x44 LD B,H", () => {
      cpu.h = 0x11;
      loadAt(0x0200, [0x44]);
      cpu.step();
      expect(cpu.b).toBe(0x11);
    });

    test("0x45 LD B,L", () => {
      cpu.l = 0x22;
      loadAt(0x0200, [0x45]);
      cpu.step();
      expect(cpu.b).toBe(0x22);
    });

    test("0x47 LD B,A", () => {
      cpu.a = 0x99;
      loadAt(0x0200, [0x47]);
      cpu.step();
      expect(cpu.b).toBe(0x99);
    });

    test("0x48 LD C,B", () => {
      cpu.b = 0x33;
      loadAt(0x0200, [0x48]);
      cpu.step();
      expect(cpu.c).toBe(0x33);
    });

    test("0x49 LD C,C (identity)", () => {
      cpu.c = 0x55;
      loadAt(0x0200, [0x49]);
      cpu.step();
      expect(cpu.c).toBe(0x55);
    });

    test("0x4A LD C,D", () => {
      cpu.d = 0x77;
      loadAt(0x0200, [0x4a]);
      cpu.step();
      expect(cpu.c).toBe(0x77);
    });

    test("0x4B LD C,E", () => {
      cpu.e = 0x88;
      loadAt(0x0200, [0x4b]);
      cpu.step();
      expect(cpu.c).toBe(0x88);
    });

    test("0x4C LD C,H", () => {
      cpu.h = 0x44;
      loadAt(0x0200, [0x4c]);
      cpu.step();
      expect(cpu.c).toBe(0x44);
    });

    test("0x4D LD C,L", () => {
      cpu.l = 0x66;
      loadAt(0x0200, [0x4d]);
      cpu.step();
      expect(cpu.c).toBe(0x66);
    });

    test("0x4F LD C,A", () => {
      cpu.a = 0xBB;
      loadAt(0x0200, [0x4f]);
      cpu.step();
      expect(cpu.c).toBe(0xBB);
    });

    test("0x50 LD D,B", () => {
      cpu.b = 0x12;
      loadAt(0x0200, [0x50]);
      cpu.step();
      expect(cpu.d).toBe(0x12);
    });

    test("0x51 LD D,C", () => {
      cpu.c = 0x34;
      loadAt(0x0200, [0x51]);
      cpu.step();
      expect(cpu.d).toBe(0x34);
    });

    test("0x52 LD D,D (identity)", () => {
      cpu.d = 0x56;
      loadAt(0x0200, [0x52]);
      cpu.step();
      expect(cpu.d).toBe(0x56);
    });

    test("0x53 LD D,E", () => {
      cpu.e = 0x78;
      loadAt(0x0200, [0x53]);
      cpu.step();
      expect(cpu.d).toBe(0x78);
    });

    test("0x54 LD D,H", () => {
      cpu.h = 0x9A;
      loadAt(0x0200, [0x54]);
      cpu.step();
      expect(cpu.d).toBe(0x9A);
    });

    test("0x55 LD D,L", () => {
      cpu.l = 0xBC;
      loadAt(0x0200, [0x55]);
      cpu.step();
      expect(cpu.d).toBe(0xBC);
    });

    test("0x57 LD D,A", () => {
      cpu.a = 0xDE;
      loadAt(0x0200, [0x57]);
      cpu.step();
      expect(cpu.d).toBe(0xDE);
    });

    test("0x58 LD E,B", () => {
      cpu.b = 0xF0;
      loadAt(0x0200, [0x58]);
      cpu.step();
      expect(cpu.e).toBe(0xF0);
    });

    test("0x59 LD E,C", () => {
      cpu.c = 0x0F;
      loadAt(0x0200, [0x59]);
      cpu.step();
      expect(cpu.e).toBe(0x0F);
    });

    test("0x5A LD E,D", () => {
      cpu.d = 0xAA;
      loadAt(0x0200, [0x5a]);
      cpu.step();
      expect(cpu.e).toBe(0xAA);
    });

    test("0x5B LD E,E (identity)", () => {
      cpu.e = 0xBB;
      loadAt(0x0200, [0x5b]);
      cpu.step();
      expect(cpu.e).toBe(0xBB);
    });

    test("0x5C LD E,H", () => {
      cpu.h = 0xCC;
      loadAt(0x0200, [0x5c]);
      cpu.step();
      expect(cpu.e).toBe(0xCC);
    });

    test("0x5D LD E,L", () => {
      cpu.l = 0xDD;
      loadAt(0x0200, [0x5d]);
      cpu.step();
      expect(cpu.e).toBe(0xDD);
    });

    test("0x5F LD E,A", () => {
      cpu.a = 0xEE;
      loadAt(0x0200, [0x5f]);
      cpu.step();
      expect(cpu.e).toBe(0xEE);
    });

    test("0x60 LD H,B", () => {
      cpu.b = 0x11;
      loadAt(0x0200, [0x60]);
      cpu.step();
      expect(cpu.h).toBe(0x11);
    });

    test("0x61 LD H,C", () => {
      cpu.c = 0x22;
      loadAt(0x0200, [0x61]);
      cpu.step();
      expect(cpu.h).toBe(0x22);
    });

    test("0x62 LD H,D", () => {
      cpu.d = 0x33;
      loadAt(0x0200, [0x62]);
      cpu.step();
      expect(cpu.h).toBe(0x33);
    });

    test("0x63 LD H,E", () => {
      cpu.e = 0x44;
      loadAt(0x0200, [0x63]);
      cpu.step();
      expect(cpu.h).toBe(0x44);
    });

    test("0x64 LD H,H (identity)", () => {
      cpu.h = 0x55;
      loadAt(0x0200, [0x64]);
      cpu.step();
      expect(cpu.h).toBe(0x55);
    });

    test("0x65 LD H,L", () => {
      cpu.l = 0x66;
      loadAt(0x0200, [0x65]);
      cpu.step();
      expect(cpu.h).toBe(0x66);
    });

    test("0x67 LD H,A", () => {
      cpu.a = 0x77;
      loadAt(0x0200, [0x67]);
      cpu.step();
      expect(cpu.h).toBe(0x77);
    });

    test("0x68 LD L,B", () => {
      cpu.b = 0x88;
      loadAt(0x0200, [0x68]);
      cpu.step();
      expect(cpu.l).toBe(0x88);
    });

    test("0x69 LD L,C", () => {
      cpu.c = 0x99;
      loadAt(0x0200, [0x69]);
      cpu.step();
      expect(cpu.l).toBe(0x99);
    });

    test("0x6A LD L,D", () => {
      cpu.d = 0xAA;
      loadAt(0x0200, [0x6a]);
      cpu.step();
      expect(cpu.l).toBe(0xAA);
    });

    test("0x6B LD L,E", () => {
      cpu.e = 0xBB;
      loadAt(0x0200, [0x6b]);
      cpu.step();
      expect(cpu.l).toBe(0xBB);
    });

    test("0x6C LD L,H", () => {
      cpu.h = 0xCC;
      loadAt(0x0200, [0x6c]);
      cpu.step();
      expect(cpu.l).toBe(0xCC);
    });

    test("0x6D LD L,L (identity)", () => {
      cpu.l = 0xDD;
      loadAt(0x0200, [0x6d]);
      cpu.step();
      expect(cpu.l).toBe(0xDD);
    });

    test("0x6F LD L,A", () => {
      cpu.a = 0xEE;
      loadAt(0x0200, [0x6f]);
      cpu.step();
      expect(cpu.l).toBe(0xEE);
    });

    test("0x78 LD A,B", () => {
      cpu.b = 0x42;
      loadAt(0x0200, [0x78]);
      const f = saveFlagsState();
      const cycles = cpu.step();
      expect(cpu.a).toBe(0x42);
      expect(cycles).toBe(4);
      expect(cpu.pc).toBe(0x0201);
      expect(cpu.f).toBe(f);
    });

    test("0x79 LD A,C", () => {
      cpu.c = 0x55;
      loadAt(0x0200, [0x79]);
      cpu.step();
      expect(cpu.a).toBe(0x55);
    });

    test("0x7A LD A,D", () => {
      cpu.d = 0x66;
      loadAt(0x0200, [0x7a]);
      cpu.step();
      expect(cpu.a).toBe(0x66);
    });

    test("0x7B LD A,E", () => {
      cpu.e = 0x77;
      loadAt(0x0200, [0x7b]);
      cpu.step();
      expect(cpu.a).toBe(0x77);
    });

    test("0x7C LD A,H", () => {
      cpu.h = 0x88;
      loadAt(0x0200, [0x7c]);
      cpu.step();
      expect(cpu.a).toBe(0x88);
    });

    test("0x7D LD A,L", () => {
      cpu.l = 0x99;
      loadAt(0x0200, [0x7d]);
      cpu.step();
      expect(cpu.a).toBe(0x99);
    });

    test("0x7F LD A,A (identity)", () => {
      cpu.a = 0xAA;
      loadAt(0x0200, [0x7f]);
      cpu.step();
      expect(cpu.a).toBe(0xAA);
    });

    test("does not modify flags", () => {
      cpu.f = 0xF0;
      cpu.c = 0x42;
      loadAt(0x0200, [0x78]); // LD A,B
      cpu.step();
      expect(cpu.f).toBe(0xF0);
    });
  });

  // ─── LD r8, (HL) ────────────────────────────────────────────────

  describe("LD r8, (HL) - read from memory[HL]", () => {
    test("0x46 LD B,(HL)", () => {
      cpu.hl = 0xC000;
      memory.writeByte(0xC000, 0x42);
      loadAt(0x0200, [0x46]);
      const f = saveFlagsState();
      const cycles = cpu.step();
      expect(cpu.b).toBe(0x42);
      expect(cycles).toBe(8);
      expect(cpu.pc).toBe(0x0201);
      expect(cpu.f).toBe(f);
    });

    test("0x4E LD C,(HL)", () => {
      cpu.hl = 0xC001;
      memory.writeByte(0xC001, 0x55);
      loadAt(0x0200, [0x4e]);
      const cycles = cpu.step();
      expect(cpu.c).toBe(0x55);
      expect(cycles).toBe(8);
    });

    test("0x56 LD D,(HL)", () => {
      cpu.hl = 0xC002;
      memory.writeByte(0xC002, 0x66);
      loadAt(0x0200, [0x56]);
      cpu.step();
      expect(cpu.d).toBe(0x66);
    });

    test("0x5E LD E,(HL)", () => {
      cpu.hl = 0xC003;
      memory.writeByte(0xC003, 0x77);
      loadAt(0x0200, [0x5e]);
      cpu.step();
      expect(cpu.e).toBe(0x77);
    });

    test("0x66 LD H,(HL)", () => {
      cpu.hl = 0xC004;
      memory.writeByte(0xC004, 0x88);
      loadAt(0x0200, [0x66]);
      cpu.step();
      expect(cpu.h).toBe(0x88);
    });

    test("0x6E LD L,(HL)", () => {
      cpu.hl = 0xC005;
      memory.writeByte(0xC005, 0x99);
      loadAt(0x0200, [0x6e]);
      cpu.step();
      expect(cpu.l).toBe(0x99);
    });

    test("0x7E LD A,(HL)", () => {
      cpu.hl = 0xC006;
      memory.writeByte(0xC006, 0xAA);
      loadAt(0x0200, [0x7e]);
      const cycles = cpu.step();
      expect(cpu.a).toBe(0xAA);
      expect(cycles).toBe(8);
    });
  });

  // ─── LD (HL), r8 ────────────────────────────────────────────────

  describe("LD (HL), r8 - write register to memory[HL]", () => {
    test("0x70 LD (HL),B", () => {
      cpu.b = 0x42;
      cpu.hl = 0xC000;
      loadAt(0x0200, [0x70]);
      const f = saveFlagsState();
      const cycles = cpu.step();
      expect(memory.peek(0xC000)).toBe(0x42);
      expect(cycles).toBe(8);
      expect(cpu.pc).toBe(0x0201);
      expect(cpu.f).toBe(f);
    });

    test("0x71 LD (HL),C", () => {
      cpu.c = 0x55;
      cpu.hl = 0xC001;
      loadAt(0x0200, [0x71]);
      cpu.step();
      expect(memory.peek(0xC001)).toBe(0x55);
    });

    test("0x72 LD (HL),D", () => {
      cpu.d = 0x66;
      cpu.hl = 0xC002;
      loadAt(0x0200, [0x72]);
      cpu.step();
      expect(memory.peek(0xC002)).toBe(0x66);
    });

    test("0x73 LD (HL),E", () => {
      cpu.e = 0x77;
      cpu.hl = 0xC003;
      loadAt(0x0200, [0x73]);
      cpu.step();
      expect(memory.peek(0xC003)).toBe(0x77);
    });

    test("0x74 LD (HL),H", () => {
      cpu.hl = 0xC004;
      loadAt(0x0200, [0x74]);
      cpu.step();
      expect(memory.peek(0xC004)).toBe(0xC0); // H = 0xC0
    });

    test("0x75 LD (HL),L", () => {
      cpu.hl = 0xC005;
      loadAt(0x0200, [0x75]);
      cpu.step();
      expect(memory.peek(0xC005)).toBe(0x05); // L = 0x05
    });

    test("0x77 LD (HL),A", () => {
      cpu.a = 0xBB;
      cpu.hl = 0xC006;
      loadAt(0x0200, [0x77]);
      const cycles = cpu.step();
      expect(memory.peek(0xC006)).toBe(0xBB);
      expect(cycles).toBe(8);
    });
  });

  // ─── LD (HL), d8 ────────────────────────────────────────────────

  describe("0x36 LD (HL), d8", () => {
    test("writes immediate byte to memory[HL]", () => {
      cpu.hl = 0xC000;
      loadAt(0x0200, [0x36, 0x42]);
      const cycles = cpu.step();
      expect(memory.peek(0xC000)).toBe(0x42);
      expect(cycles).toBe(12);
      expect(cpu.pc).toBe(0x0202);
    });

    test("does not modify flags", () => {
      cpu.hl = 0xC000;
      cpu.f = 0xF0;
      loadAt(0x0200, [0x36, 0xFF]);
      cpu.step();
      expect(cpu.f).toBe(0xF0);
    });
  });

  // ─── Memory loads with register indirect ────────────────────────

  describe("register indirect loads", () => {
    test("0x02 LD (BC),A", () => {
      cpu.a = 0x42;
      cpu.bc = 0xC000;
      loadAt(0x0200, [0x02]);
      const f = saveFlagsState();
      const cycles = cpu.step();
      expect(memory.peek(0xC000)).toBe(0x42);
      expect(cycles).toBe(8);
      expect(cpu.pc).toBe(0x0201);
      expect(cpu.f).toBe(f);
    });

    test("0x12 LD (DE),A", () => {
      cpu.a = 0x55;
      cpu.de = 0xC010;
      loadAt(0x0200, [0x12]);
      const cycles = cpu.step();
      expect(memory.peek(0xC010)).toBe(0x55);
      expect(cycles).toBe(8);
      expect(cpu.pc).toBe(0x0201);
    });

    test("0x0A LD A,(BC)", () => {
      cpu.bc = 0xC020;
      memory.writeByte(0xC020, 0x99);
      loadAt(0x0200, [0x0a]);
      const f = saveFlagsState();
      const cycles = cpu.step();
      expect(cpu.a).toBe(0x99);
      expect(cycles).toBe(8);
      expect(cpu.pc).toBe(0x0201);
      expect(cpu.f).toBe(f);
    });

    test("0x1A LD A,(DE)", () => {
      cpu.de = 0xC030;
      memory.writeByte(0xC030, 0xBB);
      loadAt(0x0200, [0x1a]);
      const cycles = cpu.step();
      expect(cpu.a).toBe(0xBB);
      expect(cycles).toBe(8);
      expect(cpu.pc).toBe(0x0201);
    });
  });

  // ─── LD with HL increment/decrement ─────────────────────────────

  describe("HL increment/decrement loads", () => {
    test("0x22 LD (HL+),A writes A to memory[HL] then HL++", () => {
      cpu.a = 0x42;
      cpu.hl = 0xC000;
      loadAt(0x0200, [0x22]);
      const f = saveFlagsState();
      const cycles = cpu.step();
      expect(memory.peek(0xC000)).toBe(0x42);
      expect(cpu.hl).toBe(0xC001);
      expect(cycles).toBe(8);
      expect(cpu.pc).toBe(0x0201);
      expect(cpu.f).toBe(f);
    });

    test("0x22 LD (HL+),A wraps HL from 0xFFFF to 0x0000", () => {
      cpu.a = 0x55;
      cpu.hl = 0xFFFF;
      loadAt(0x0200, [0x22]);
      cpu.step();
      expect(cpu.hl).toBe(0x0000);
    });

    test("0x32 LD (HL-),A writes A to memory[HL] then HL--", () => {
      cpu.a = 0x66;
      cpu.hl = 0xC005;
      loadAt(0x0200, [0x32]);
      const cycles = cpu.step();
      expect(memory.peek(0xC005)).toBe(0x66);
      expect(cpu.hl).toBe(0xC004);
      expect(cycles).toBe(8);
      expect(cpu.pc).toBe(0x0201);
    });

    test("0x32 LD (HL-),A wraps HL from 0x0000 to 0xFFFF", () => {
      cpu.a = 0x77;
      cpu.hl = 0x0000;
      loadAt(0x0200, [0x32]);
      cpu.step();
      expect(cpu.hl).toBe(0xFFFF);
    });

    test("0x2A LD A,(HL+) reads memory[HL] into A then HL++", () => {
      cpu.hl = 0xC010;
      memory.writeByte(0xC010, 0x88);
      loadAt(0x0200, [0x2a]);
      const f = saveFlagsState();
      const cycles = cpu.step();
      expect(cpu.a).toBe(0x88);
      expect(cpu.hl).toBe(0xC011);
      expect(cycles).toBe(8);
      expect(cpu.pc).toBe(0x0201);
      expect(cpu.f).toBe(f);
    });

    test("0x2A LD A,(HL+) wraps HL from 0xFFFF to 0x0000", () => {
      cpu.hl = 0xFFFF;
      memory.writeByte(0xFFFF, 0x99);
      loadAt(0x0200, [0x2a]);
      cpu.step();
      expect(cpu.a).toBe(0x99);
      expect(cpu.hl).toBe(0x0000);
    });

    test("0x3A LD A,(HL-) reads memory[HL] into A then HL--", () => {
      cpu.hl = 0xC020;
      memory.writeByte(0xC020, 0xAA);
      loadAt(0x0200, [0x3a]);
      const cycles = cpu.step();
      expect(cpu.a).toBe(0xAA);
      expect(cpu.hl).toBe(0xC01F);
      expect(cycles).toBe(8);
      expect(cpu.pc).toBe(0x0201);
    });

    test("0x3A LD A,(HL-) wraps HL from 0x0000 to 0xFFFF", () => {
      cpu.hl = 0x0000;
      memory.writeByte(0x0000, 0xBB);
      loadAt(0x0200, [0x3a]);
      cpu.step();
      expect(cpu.a).toBe(0xBB);
      expect(cpu.hl).toBe(0xFFFF);
    });
  });

  // ─── Direct memory loads (16-bit address) ───────────────────────

  describe("direct memory loads", () => {
    test("0xEA LD (a16),A writes A to address", () => {
      cpu.a = 0x42;
      loadAt(0x0200, [0xea, 0x00, 0xC0]); // address 0xC000
      const f = saveFlagsState();
      const cycles = cpu.step();
      expect(memory.peek(0xC000)).toBe(0x42);
      expect(cycles).toBe(16);
      expect(cpu.pc).toBe(0x0203);
      expect(cpu.f).toBe(f);
    });

    test("0xFA LD A,(a16) reads from address into A", () => {
      memory.writeByte(0xC050, 0x99);
      loadAt(0x0200, [0xfa, 0x50, 0xC0]); // address 0xC050
      const f = saveFlagsState();
      const cycles = cpu.step();
      expect(cpu.a).toBe(0x99);
      expect(cycles).toBe(16);
      expect(cpu.pc).toBe(0x0203);
      expect(cpu.f).toBe(f);
    });

    test("0x08 LD (a16),SP writes SP as 16-bit LE", () => {
      cpu.sp = 0xFFFE;
      loadAt(0x0200, [0x08, 0x00, 0xC0]); // address 0xC000
      const f = saveFlagsState();
      const cycles = cpu.step();
      expect(memory.peek(0xC000)).toBe(0xFE); // low byte
      expect(memory.peek(0xC001)).toBe(0xFF); // high byte
      expect(cycles).toBe(20);
      expect(cpu.pc).toBe(0x0203);
      expect(cpu.f).toBe(f);
    });
  });

  // ─── High-page loads ────────────────────────────────────────────

  describe("high-page loads", () => {
    test("0xE0 LDH (a8),A writes A to 0xFF00+offset", () => {
      cpu.a = 0x42;
      loadAt(0x0200, [0xe0, 0x80]); // address 0xFF80
      const f = saveFlagsState();
      const cycles = cpu.step();
      expect(memory.peek(0xFF80)).toBe(0x42);
      expect(cycles).toBe(12);
      expect(cpu.pc).toBe(0x0202);
      expect(cpu.f).toBe(f);
    });

    test("0xF0 LDH A,(a8) reads from 0xFF00+offset into A", () => {
      memory.writeByte(0xFF44, 0x90);
      loadAt(0x0200, [0xf0, 0x44]); // address 0xFF44
      const f = saveFlagsState();
      const cycles = cpu.step();
      expect(cpu.a).toBe(0x90);
      expect(cycles).toBe(12);
      expect(cpu.pc).toBe(0x0202);
      expect(cpu.f).toBe(f);
    });

    test("0xE0 LDH maps to 0xFF00-0xFFFF range", () => {
      cpu.a = 0xBB;
      loadAt(0x0200, [0xe0, 0xFF]); // address 0xFFFF
      cpu.step();
      expect(memory.peek(0xFFFF)).toBe(0xBB);
    });

    test("0xE2 LD (C),A writes A to 0xFF00+C", () => {
      cpu.a = 0x55;
      cpu.c = 0x10;
      loadAt(0x0200, [0xe2]);
      const f = saveFlagsState();
      const cycles = cpu.step();
      expect(memory.peek(0xFF10)).toBe(0x55);
      expect(cycles).toBe(8);
      expect(cpu.pc).toBe(0x0201);
      expect(cpu.f).toBe(f);
    });

    test("0xF2 LD A,(C) reads from 0xFF00+C into A", () => {
      cpu.c = 0x20;
      memory.writeByte(0xFF20, 0x77);
      loadAt(0x0200, [0xf2]);
      const f = saveFlagsState();
      const cycles = cpu.step();
      expect(cpu.a).toBe(0x77);
      expect(cycles).toBe(8);
      expect(cpu.pc).toBe(0x0201);
      expect(cpu.f).toBe(f);
    });
  });

  // ─── Stack operations ───────────────────────────────────────────

  describe("PUSH/POP", () => {
    test("0xC5 PUSH BC", () => {
      cpu.bc = 0x1234;
      cpu.sp = 0xFFFE;
      loadAt(0x0200, [0xc5]);
      const f = saveFlagsState();
      const cycles = cpu.step();
      expect(cpu.sp).toBe(0xFFFC);
      expect(memory.peek(0xFFFD)).toBe(0x12); // high byte
      expect(memory.peek(0xFFFC)).toBe(0x34); // low byte
      expect(cycles).toBe(16);
      expect(cpu.pc).toBe(0x0201);
      expect(cpu.f).toBe(f);
    });

    test("0xD5 PUSH DE", () => {
      cpu.de = 0x5678;
      cpu.sp = 0xFFFE;
      loadAt(0x0200, [0xd5]);
      const cycles = cpu.step();
      expect(cpu.sp).toBe(0xFFFC);
      expect(memory.peek(0xFFFD)).toBe(0x56);
      expect(memory.peek(0xFFFC)).toBe(0x78);
      expect(cycles).toBe(16);
    });

    test("0xE5 PUSH HL", () => {
      cpu.hl = 0x9ABC;
      cpu.sp = 0xFFFE;
      loadAt(0x0200, [0xe5]);
      const cycles = cpu.step();
      expect(cpu.sp).toBe(0xFFFC);
      expect(memory.peek(0xFFFD)).toBe(0x9A);
      expect(memory.peek(0xFFFC)).toBe(0xBC);
      expect(cycles).toBe(16);
    });

    test("0xF5 PUSH AF", () => {
      cpu.af = 0x12F0;
      cpu.sp = 0xFFFE;
      loadAt(0x0200, [0xf5]);
      const cycles = cpu.step();
      expect(cpu.sp).toBe(0xFFFC);
      expect(memory.peek(0xFFFD)).toBe(0x12);
      expect(memory.peek(0xFFFC)).toBe(0xF0);
      expect(cycles).toBe(16);
    });

    test("0xC1 POP BC", () => {
      cpu.sp = 0xFFFC;
      memory.writeByte(0xFFFC, 0x34); // low byte
      memory.writeByte(0xFFFD, 0x12); // high byte
      loadAt(0x0200, [0xc1]);
      const f = saveFlagsState();
      const cycles = cpu.step();
      expect(cpu.bc).toBe(0x1234);
      expect(cpu.sp).toBe(0xFFFE);
      expect(cycles).toBe(12);
      expect(cpu.pc).toBe(0x0201);
      expect(cpu.f).toBe(f);
    });

    test("0xD1 POP DE", () => {
      cpu.sp = 0xFFFC;
      memory.writeByte(0xFFFC, 0x78);
      memory.writeByte(0xFFFD, 0x56);
      loadAt(0x0200, [0xd1]);
      const cycles = cpu.step();
      expect(cpu.de).toBe(0x5678);
      expect(cpu.sp).toBe(0xFFFE);
      expect(cycles).toBe(12);
    });

    test("0xE1 POP HL", () => {
      cpu.sp = 0xFFFC;
      memory.writeByte(0xFFFC, 0xBC);
      memory.writeByte(0xFFFD, 0x9A);
      loadAt(0x0200, [0xe1]);
      const cycles = cpu.step();
      expect(cpu.hl).toBe(0x9ABC);
      expect(cpu.sp).toBe(0xFFFE);
      expect(cycles).toBe(12);
    });

    test("0xF1 POP AF masks lower nibble of F", () => {
      cpu.sp = 0xFFFC;
      memory.writeByte(0xFFFC, 0xFF); // F value with lower bits set
      memory.writeByte(0xFFFD, 0xAB); // A value
      loadAt(0x0200, [0xf1]);
      const cycles = cpu.step();
      expect(cpu.a).toBe(0xAB);
      expect(cpu.f).toBe(0xF0); // lower 4 bits masked to 0
      expect(cpu.sp).toBe(0xFFFE);
      expect(cycles).toBe(12);
    });

    test("PUSH/POP BC round-trip preserves value", () => {
      cpu.bc = 0xBEEF;
      cpu.sp = 0xFFFE;
      loadAt(0x0200, [0xc5, 0xc1]); // PUSH BC then POP BC
      cpu.step();
      cpu.bc = 0x0000; // clear BC
      cpu.step();
      expect(cpu.bc).toBe(0xBEEF);
    });

    test("PUSH/POP DE round-trip preserves value", () => {
      cpu.de = 0xCAFE;
      cpu.sp = 0xFFFE;
      loadAt(0x0200, [0xd5, 0xd1]);
      cpu.step();
      cpu.de = 0x0000;
      cpu.step();
      expect(cpu.de).toBe(0xCAFE);
    });

    test("PUSH/POP HL round-trip preserves value", () => {
      cpu.hl = 0xDEAD;
      cpu.sp = 0xFFFE;
      loadAt(0x0200, [0xe5, 0xe1]);
      cpu.step();
      cpu.hl = 0x0000;
      cpu.step();
      expect(cpu.hl).toBe(0xDEAD);
    });

    test("PUSH/POP AF round-trip masks lower nibble", () => {
      cpu.af = 0x12F0;
      cpu.sp = 0xFFFE;
      loadAt(0x0200, [0xf5, 0xf1]);
      cpu.step();
      cpu.af = 0x0000;
      cpu.step();
      expect(cpu.af).toBe(0x12F0);
      expect(cpu.f & 0x0F).toBe(0);
    });
  });

  // ─── LD HL, SP+r8 ──────────────────────────────────────────────

  describe("0xF8 LD HL, SP+r8", () => {
    test("positive offset", () => {
      cpu.sp = 0xFFF0;
      loadAt(0x0200, [0xf8, 0x05]); // SP + 5
      const cycles = cpu.step();
      expect(cpu.hl).toBe(0xFFF5);
      expect(cycles).toBe(12);
      expect(cpu.pc).toBe(0x0202);
    });

    test("negative offset (signed)", () => {
      cpu.sp = 0xFFF0;
      loadAt(0x0200, [0xf8, 0xFE]); // SP + (-2)
      cpu.step();
      expect(cpu.hl).toBe(0xFFEE);
    });

    test("Z flag cleared, N flag cleared", () => {
      cpu.sp = 0x0000;
      cpu.flagZ = true;
      cpu.flagN = true;
      loadAt(0x0200, [0xf8, 0x00]);
      cpu.step();
      expect(cpu.flagZ).toBe(false);
      expect(cpu.flagN).toBe(false);
    });

    test("H flag set on carry from bit 3", () => {
      cpu.sp = 0x000F; // low byte 0x0F
      loadAt(0x0200, [0xf8, 0x01]); // 0x0F + 0x01 -> carry from bit 3
      cpu.step();
      expect(cpu.hl).toBe(0x0010);
      expect(cpu.flagH).toBe(true);
      expect(cpu.flagC).toBe(false);
    });

    test("C flag set on carry from bit 7", () => {
      cpu.sp = 0x00FF; // low byte 0xFF
      loadAt(0x0200, [0xf8, 0x01]); // 0xFF + 0x01 -> carry from bit 7
      cpu.step();
      expect(cpu.hl).toBe(0x0100);
      expect(cpu.flagC).toBe(true);
      expect(cpu.flagH).toBe(true);
    });

    test("H and C computed on unsigned lower byte (negative offset)", () => {
      // SP=0x0100, r8=-1 (0xFF). (0x00 & 0xFF) + (0xFF & 0xFF) = 0xFF + 0x100 carry
      // Actually: low byte of SP is 0x00. r8 & 0xFF = 0xFF.
      // 0x00 + 0xFF = 0xFF, no carry from bit 7, no carry from bit 3
      cpu.sp = 0x0100;
      loadAt(0x0200, [0xf8, 0xFF]); // -1
      cpu.step();
      expect(cpu.hl).toBe(0x00FF);
      expect(cpu.flagH).toBe(false);
      expect(cpu.flagC).toBe(false);
    });

    test("H and C flags with negative offset causing carries", () => {
      // SP = 0x0111, r8 = -1 (0xFF). SP low byte = 0x11
      // 0x11 + 0xFF = 0x110 -> C=1, (0x1 + 0xF) = 0x10 > 0xF -> H=1
      cpu.sp = 0x0111;
      loadAt(0x0200, [0xf8, 0xFF]); // -1
      cpu.step();
      expect(cpu.hl).toBe(0x0110);
      expect(cpu.flagH).toBe(true);
      expect(cpu.flagC).toBe(true);
    });

    test("no flags set when no carries", () => {
      cpu.sp = 0x1000;
      loadAt(0x0200, [0xf8, 0x02]);
      cpu.step();
      expect(cpu.hl).toBe(0x1002);
      expect(cpu.flagZ).toBe(false);
      expect(cpu.flagN).toBe(false);
      expect(cpu.flagH).toBe(false);
      expect(cpu.flagC).toBe(false);
    });
  });

  // ─── LD SP, HL ──────────────────────────────────────────────────

  describe("0xF9 LD SP, HL", () => {
    test("copies HL to SP", () => {
      cpu.hl = 0xDEAD;
      loadAt(0x0200, [0xf9]);
      const f = saveFlagsState();
      const cycles = cpu.step();
      expect(cpu.sp).toBe(0xDEAD);
      expect(cycles).toBe(8);
      expect(cpu.pc).toBe(0x0201);
      expect(cpu.f).toBe(f);
    });

    test("does not modify flags", () => {
      cpu.f = 0xF0;
      cpu.hl = 0x1234;
      loadAt(0x0200, [0xf9]);
      cpu.step();
      expect(cpu.f).toBe(0xF0);
    });
  });
});
