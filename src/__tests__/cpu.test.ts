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

  // Helper: write bytes starting at an address
  load(address: number, bytes: number[]): void {
    for (let i = 0; i < bytes.length; i++) {
      this.data[(address + i) & 0xffff] = bytes[i]!;
    }
  }
}

describe("CPU", () => {
  let memory: MockMemory;
  let cpu: CPU;

  beforeEach(() => {
    memory = new MockMemory();
    cpu = new CPU(memory);
  });

  // ─── Initial state after reset (DMG boot values) ───────────────────

  describe("initial state after reset", () => {
    test("AF = 0x01B0", () => {
      expect(cpu.af).toBe(0x01b0);
    });

    test("BC = 0x0013", () => {
      expect(cpu.bc).toBe(0x0013);
    });

    test("DE = 0x00D8", () => {
      expect(cpu.de).toBe(0x00d8);
    });

    test("HL = 0x014D", () => {
      expect(cpu.hl).toBe(0x014d);
    });

    test("SP = 0xFFFE", () => {
      expect(cpu.sp).toBe(0xfffe);
    });

    test("PC = 0x0100", () => {
      expect(cpu.pc).toBe(0x0100);
    });

    test("IME = false", () => {
      expect(cpu.ime).toBe(false);
    });

    test("halted = false", () => {
      expect(cpu.halted).toBe(false);
    });

    test("individual registers match AF=0x01B0", () => {
      expect(cpu.a).toBe(0x01);
      expect(cpu.f).toBe(0xb0);
    });

    test("individual registers match BC=0x0013", () => {
      expect(cpu.b).toBe(0x00);
      expect(cpu.c).toBe(0x13);
    });

    test("individual registers match DE=0x00D8", () => {
      expect(cpu.d).toBe(0x00);
      expect(cpu.e).toBe(0xd8);
    });

    test("individual registers match HL=0x014D", () => {
      expect(cpu.h).toBe(0x01);
      expect(cpu.l).toBe(0x4d);
    });

    test("flags match F=0xB0 (Z=1 N=0 H=1 C=1)", () => {
      expect(cpu.flagZ).toBe(true);
      expect(cpu.flagN).toBe(false);
      expect(cpu.flagH).toBe(true);
      expect(cpu.flagC).toBe(true);
    });
  });

  // ─── 8-bit register getters/setters ────────────────────────────────

  describe("8-bit register getters/setters", () => {
    test("A register", () => {
      cpu.a = 0x42;
      expect(cpu.a).toBe(0x42);
    });

    test("A register masks to 8 bits", () => {
      cpu.a = 0x1ff;
      expect(cpu.a).toBe(0xff);
    });

    test("B register", () => {
      cpu.b = 0xab;
      expect(cpu.b).toBe(0xab);
    });

    test("C register", () => {
      cpu.c = 0xcd;
      expect(cpu.c).toBe(0xcd);
    });

    test("D register", () => {
      cpu.d = 0xde;
      expect(cpu.d).toBe(0xde);
    });

    test("E register", () => {
      cpu.e = 0xef;
      expect(cpu.e).toBe(0xef);
    });

    test("H register", () => {
      cpu.h = 0x12;
      expect(cpu.h).toBe(0x12);
    });

    test("L register", () => {
      cpu.l = 0x34;
      expect(cpu.l).toBe(0x34);
    });

    test("F register masks lower 4 bits to 0", () => {
      cpu.f = 0xff;
      expect(cpu.f).toBe(0xf0);
    });

    test("F register preserves upper 4 bits", () => {
      cpu.f = 0xa0;
      expect(cpu.f).toBe(0xa0);
    });
  });

  // ─── 16-bit register pair getters/setters ──────────────────────────

  describe("16-bit register pair getters/setters", () => {
    test("AF getter combines A and F", () => {
      cpu.a = 0x12;
      cpu.f = 0x50;
      expect(cpu.af).toBe(0x1250);
    });

    test("AF setter splits into A and F", () => {
      cpu.af = 0xabcd;
      expect(cpu.a).toBe(0xab);
      expect(cpu.f).toBe(0xc0); // lower 4 bits masked
    });

    test("AF setter masks lower 4 bits of F to 0", () => {
      cpu.af = 0x01ff;
      expect(cpu.a).toBe(0x01);
      expect(cpu.f).toBe(0xf0);
      expect(cpu.af).toBe(0x01f0);
    });

    test("BC getter combines B and C", () => {
      cpu.b = 0x12;
      cpu.c = 0x34;
      expect(cpu.bc).toBe(0x1234);
    });

    test("BC setter splits into B and C", () => {
      cpu.bc = 0xabcd;
      expect(cpu.b).toBe(0xab);
      expect(cpu.c).toBe(0xcd);
    });

    test("DE getter combines D and E", () => {
      cpu.d = 0x56;
      cpu.e = 0x78;
      expect(cpu.de).toBe(0x5678);
    });

    test("DE setter splits into D and E", () => {
      cpu.de = 0x1234;
      expect(cpu.d).toBe(0x12);
      expect(cpu.e).toBe(0x34);
    });

    test("HL getter combines H and L", () => {
      cpu.h = 0x9a;
      cpu.l = 0xbc;
      expect(cpu.hl).toBe(0x9abc);
    });

    test("HL setter splits into H and L", () => {
      cpu.hl = 0xdead;
      expect(cpu.h).toBe(0xde);
      expect(cpu.l).toBe(0xad);
    });

    test("SP getter/setter", () => {
      cpu.sp = 0xbeef;
      expect(cpu.sp).toBe(0xbeef);
    });

    test("SP masks to 16 bits", () => {
      cpu.sp = 0x1fffe;
      expect(cpu.sp).toBe(0xfffe);
    });

    test("PC getter/setter", () => {
      cpu.pc = 0xcafe;
      expect(cpu.pc).toBe(0xcafe);
    });

    test("PC masks to 16 bits", () => {
      cpu.pc = 0x10100;
      expect(cpu.pc).toBe(0x0100);
    });
  });

  // ─── Flag getters/setters ──────────────────────────────────────────

  describe("flag getters/setters", () => {
    test("flagZ set true", () => {
      cpu.f = 0x00;
      cpu.flagZ = true;
      expect(cpu.flagZ).toBe(true);
      expect(cpu.f & 0x80).toBe(0x80);
    });

    test("flagZ set false", () => {
      cpu.f = 0xf0;
      cpu.flagZ = false;
      expect(cpu.flagZ).toBe(false);
      expect(cpu.f & 0x80).toBe(0x00);
    });

    test("flagN set true", () => {
      cpu.f = 0x00;
      cpu.flagN = true;
      expect(cpu.flagN).toBe(true);
      expect(cpu.f & 0x40).toBe(0x40);
    });

    test("flagN set false", () => {
      cpu.f = 0xf0;
      cpu.flagN = false;
      expect(cpu.flagN).toBe(false);
      expect(cpu.f & 0x40).toBe(0x00);
    });

    test("flagH set true", () => {
      cpu.f = 0x00;
      cpu.flagH = true;
      expect(cpu.flagH).toBe(true);
      expect(cpu.f & 0x20).toBe(0x20);
    });

    test("flagH set false", () => {
      cpu.f = 0xf0;
      cpu.flagH = false;
      expect(cpu.flagH).toBe(false);
      expect(cpu.f & 0x20).toBe(0x00);
    });

    test("flagC set true", () => {
      cpu.f = 0x00;
      cpu.flagC = true;
      expect(cpu.flagC).toBe(true);
      expect(cpu.f & 0x10).toBe(0x10);
    });

    test("flagC set false", () => {
      cpu.f = 0xf0;
      cpu.flagC = false;
      expect(cpu.flagC).toBe(false);
      expect(cpu.f & 0x10).toBe(0x00);
    });

    test("setting one flag does not affect others", () => {
      cpu.f = 0x00;
      cpu.flagZ = true;
      expect(cpu.flagN).toBe(false);
      expect(cpu.flagH).toBe(false);
      expect(cpu.flagC).toBe(false);

      cpu.flagC = true;
      expect(cpu.flagZ).toBe(true);
      expect(cpu.flagN).toBe(false);
      expect(cpu.flagH).toBe(false);
      expect(cpu.flagC).toBe(true);
    });

    test("lower 4 bits of F always remain 0 after flag operations", () => {
      cpu.f = 0x00;
      cpu.flagZ = true;
      cpu.flagN = true;
      cpu.flagH = true;
      cpu.flagC = true;
      expect(cpu.f).toBe(0xf0);
      expect(cpu.f & 0x0f).toBe(0x00);
    });
  });

  // ─── reset() ───────────────────────────────────────────────────────

  describe("reset()", () => {
    test("restores DMG boot state", () => {
      cpu.af = 0x0000;
      cpu.bc = 0x0000;
      cpu.de = 0x0000;
      cpu.hl = 0x0000;
      cpu.sp = 0x0000;
      cpu.pc = 0x0000;
      cpu.ime = true;
      cpu.halted = true;

      cpu.reset();

      expect(cpu.af).toBe(0x01b0);
      expect(cpu.bc).toBe(0x0013);
      expect(cpu.de).toBe(0x00d8);
      expect(cpu.hl).toBe(0x014d);
      expect(cpu.sp).toBe(0xfffe);
      expect(cpu.pc).toBe(0x0100);
      expect(cpu.ime).toBe(false);
      expect(cpu.halted).toBe(false);
    });
  });

  // ─── Opcodes ───────────────────────────────────────────────────────

  describe("opcodes", () => {
    // Helper: set PC and load opcode bytes at that address
    function loadAt(address: number, bytes: number[]) {
      cpu.pc = address;
      memory.load(address, bytes);
    }

    // ── NOP (0x00) ──

    describe("0x00 NOP", () => {
      test("advances PC by 1", () => {
        loadAt(0x0100, [0x00]);
        cpu.step();
        expect(cpu.pc).toBe(0x0101);
      });

      test("returns 4 cycles", () => {
        loadAt(0x0100, [0x00]);
        const cycles = cpu.step();
        expect(cycles).toBe(4);
      });

      test("does not change any registers", () => {
        loadAt(0x0100, [0x00]);
        const a = cpu.a,
          b = cpu.b,
          c = cpu.c,
          d = cpu.d,
          e = cpu.e,
          h = cpu.h,
          l = cpu.l,
          f = cpu.f;
        const sp = cpu.sp;
        cpu.step();
        expect(cpu.a).toBe(a);
        expect(cpu.b).toBe(b);
        expect(cpu.c).toBe(c);
        expect(cpu.d).toBe(d);
        expect(cpu.e).toBe(e);
        expect(cpu.h).toBe(h);
        expect(cpu.l).toBe(l);
        expect(cpu.f).toBe(f);
        expect(cpu.sp).toBe(sp);
      });
    });

    // ── LD r8, d8 (8-bit immediate loads) ──

    describe("0x06 LD B, d8", () => {
      test("loads immediate byte into B", () => {
        loadAt(0x0200, [0x06, 0x42]);
        cpu.step();
        expect(cpu.b).toBe(0x42);
      });

      test("advances PC by 2", () => {
        loadAt(0x0200, [0x06, 0x42]);
        cpu.step();
        expect(cpu.pc).toBe(0x0202);
      });

      test("returns 8 cycles", () => {
        loadAt(0x0200, [0x06, 0x42]);
        expect(cpu.step()).toBe(8);
      });
    });

    describe("0x0E LD C, d8", () => {
      test("loads immediate byte into C", () => {
        loadAt(0x0200, [0x0e, 0x99]);
        cpu.step();
        expect(cpu.c).toBe(0x99);
      });

      test("advances PC by 2", () => {
        loadAt(0x0200, [0x0e, 0x99]);
        cpu.step();
        expect(cpu.pc).toBe(0x0202);
      });

      test("returns 8 cycles", () => {
        loadAt(0x0200, [0x0e, 0x99]);
        expect(cpu.step()).toBe(8);
      });
    });

    describe("0x16 LD D, d8", () => {
      test("loads immediate byte into D", () => {
        loadAt(0x0200, [0x16, 0xab]);
        cpu.step();
        expect(cpu.d).toBe(0xab);
      });

      test("advances PC by 2", () => {
        loadAt(0x0200, [0x16, 0xab]);
        cpu.step();
        expect(cpu.pc).toBe(0x0202);
      });

      test("returns 8 cycles", () => {
        loadAt(0x0200, [0x16, 0xab]);
        expect(cpu.step()).toBe(8);
      });
    });

    describe("0x1E LD E, d8", () => {
      test("loads immediate byte into E", () => {
        loadAt(0x0200, [0x1e, 0xcd]);
        cpu.step();
        expect(cpu.e).toBe(0xcd);
      });

      test("advances PC by 2", () => {
        loadAt(0x0200, [0x1e, 0xcd]);
        cpu.step();
        expect(cpu.pc).toBe(0x0202);
      });

      test("returns 8 cycles", () => {
        loadAt(0x0200, [0x1e, 0xcd]);
        expect(cpu.step()).toBe(8);
      });
    });

    describe("0x26 LD H, d8", () => {
      test("loads immediate byte into H", () => {
        loadAt(0x0200, [0x26, 0xef]);
        cpu.step();
        expect(cpu.h).toBe(0xef);
      });

      test("advances PC by 2", () => {
        loadAt(0x0200, [0x26, 0xef]);
        cpu.step();
        expect(cpu.pc).toBe(0x0202);
      });

      test("returns 8 cycles", () => {
        loadAt(0x0200, [0x26, 0xef]);
        expect(cpu.step()).toBe(8);
      });
    });

    describe("0x2E LD L, d8", () => {
      test("loads immediate byte into L", () => {
        loadAt(0x0200, [0x2e, 0x77]);
        cpu.step();
        expect(cpu.l).toBe(0x77);
      });

      test("advances PC by 2", () => {
        loadAt(0x0200, [0x2e, 0x77]);
        cpu.step();
        expect(cpu.pc).toBe(0x0202);
      });

      test("returns 8 cycles", () => {
        loadAt(0x0200, [0x2e, 0x77]);
        expect(cpu.step()).toBe(8);
      });
    });

    describe("0x3E LD A, d8", () => {
      test("loads immediate byte into A", () => {
        loadAt(0x0200, [0x3e, 0x55]);
        cpu.step();
        expect(cpu.a).toBe(0x55);
      });

      test("advances PC by 2", () => {
        loadAt(0x0200, [0x3e, 0x55]);
        cpu.step();
        expect(cpu.pc).toBe(0x0202);
      });

      test("returns 8 cycles", () => {
        loadAt(0x0200, [0x3e, 0x55]);
        expect(cpu.step()).toBe(8);
      });
    });

    // ── LD r16, d16 (16-bit immediate loads) ──

    describe("0x01 LD BC, d16", () => {
      test("loads immediate word into BC", () => {
        loadAt(0x0200, [0x01, 0x34, 0x12]); // little-endian: 0x1234
        cpu.step();
        expect(cpu.bc).toBe(0x1234);
      });

      test("advances PC by 3", () => {
        loadAt(0x0200, [0x01, 0x34, 0x12]);
        cpu.step();
        expect(cpu.pc).toBe(0x0203);
      });

      test("returns 12 cycles", () => {
        loadAt(0x0200, [0x01, 0x34, 0x12]);
        expect(cpu.step()).toBe(12);
      });
    });

    describe("0x11 LD DE, d16", () => {
      test("loads immediate word into DE", () => {
        loadAt(0x0200, [0x11, 0x78, 0x56]);
        cpu.step();
        expect(cpu.de).toBe(0x5678);
      });

      test("advances PC by 3", () => {
        loadAt(0x0200, [0x11, 0x78, 0x56]);
        cpu.step();
        expect(cpu.pc).toBe(0x0203);
      });

      test("returns 12 cycles", () => {
        loadAt(0x0200, [0x11, 0x78, 0x56]);
        expect(cpu.step()).toBe(12);
      });
    });

    describe("0x21 LD HL, d16", () => {
      test("loads immediate word into HL", () => {
        loadAt(0x0200, [0x21, 0xbc, 0x9a]);
        cpu.step();
        expect(cpu.hl).toBe(0x9abc);
      });

      test("advances PC by 3", () => {
        loadAt(0x0200, [0x21, 0xbc, 0x9a]);
        cpu.step();
        expect(cpu.pc).toBe(0x0203);
      });

      test("returns 12 cycles", () => {
        loadAt(0x0200, [0x21, 0xbc, 0x9a]);
        expect(cpu.step()).toBe(12);
      });
    });

    describe("0x31 LD SP, d16", () => {
      test("loads immediate word into SP", () => {
        loadAt(0x0200, [0x31, 0xfe, 0xff]);
        cpu.step();
        expect(cpu.sp).toBe(0xfffe);
      });

      test("advances PC by 3", () => {
        loadAt(0x0200, [0x31, 0xfe, 0xff]);
        cpu.step();
        expect(cpu.pc).toBe(0x0203);
      });

      test("returns 12 cycles", () => {
        loadAt(0x0200, [0x31, 0xfe, 0xff]);
        expect(cpu.step()).toBe(12);
      });
    });

    // ── XOR A (0xAF) ──

    describe("0xAF XOR A", () => {
      test("A becomes 0", () => {
        cpu.a = 0x42;
        loadAt(0x0200, [0xaf]);
        cpu.step();
        expect(cpu.a).toBe(0x00);
      });

      test("Z flag set", () => {
        cpu.a = 0x42;
        loadAt(0x0200, [0xaf]);
        cpu.step();
        expect(cpu.flagZ).toBe(true);
      });

      test("N flag cleared", () => {
        cpu.flagN = true;
        loadAt(0x0200, [0xaf]);
        cpu.step();
        expect(cpu.flagN).toBe(false);
      });

      test("H flag cleared", () => {
        cpu.flagH = true;
        loadAt(0x0200, [0xaf]);
        cpu.step();
        expect(cpu.flagH).toBe(false);
      });

      test("C flag cleared", () => {
        cpu.flagC = true;
        loadAt(0x0200, [0xaf]);
        cpu.step();
        expect(cpu.flagC).toBe(false);
      });

      test("advances PC by 1", () => {
        loadAt(0x0200, [0xaf]);
        cpu.step();
        expect(cpu.pc).toBe(0x0201);
      });

      test("returns 4 cycles", () => {
        loadAt(0x0200, [0xaf]);
        expect(cpu.step()).toBe(4);
      });
    });

    // ── JP a16 (0xC3) ──

    describe("0xC3 JP a16", () => {
      test("sets PC to 16-bit address from operand", () => {
        loadAt(0x0200, [0xc3, 0x50, 0x01]); // JP 0x0150
        cpu.step();
        expect(cpu.pc).toBe(0x0150);
      });

      test("returns 16 cycles", () => {
        loadAt(0x0200, [0xc3, 0x50, 0x01]);
        expect(cpu.step()).toBe(16);
      });

      test("can jump to any address", () => {
        loadAt(0x0200, [0xc3, 0xff, 0xff]); // JP 0xFFFF
        cpu.step();
        expect(cpu.pc).toBe(0xffff);
      });
    });

    // ── HALT (0x76) ──

    describe("0x76 HALT", () => {
      test("sets halted flag", () => {
        loadAt(0x0200, [0x76]);
        cpu.step();
        expect(cpu.halted).toBe(true);
      });

      test("advances PC by 1", () => {
        loadAt(0x0200, [0x76]);
        cpu.step();
        expect(cpu.pc).toBe(0x0201);
      });

      test("returns 4 cycles", () => {
        loadAt(0x0200, [0x76]);
        expect(cpu.step()).toBe(4);
      });
    });

    // ── DI (0xF3) ──

    describe("0xF3 DI", () => {
      test("clears IME", () => {
        cpu.ime = true;
        loadAt(0x0200, [0xf3]);
        cpu.step();
        expect(cpu.ime).toBe(false);
      });

      test("advances PC by 1", () => {
        loadAt(0x0200, [0xf3]);
        cpu.step();
        expect(cpu.pc).toBe(0x0201);
      });

      test("returns 4 cycles", () => {
        loadAt(0x0200, [0xf3]);
        expect(cpu.step()).toBe(4);
      });
    });

    // ── EI (0xFB) ──

    describe("0xFB EI", () => {
      test("does not set IME immediately (delayed by one instruction)", () => {
        cpu.ime = false;
        loadAt(0x0200, [0xfb]);
        cpu.step();
        expect(cpu.ime).toBe(false);
      });

      test("sets IME after the NEXT instruction executes", () => {
        cpu.ime = false;
        loadAt(0x0200, [0xfb, 0x00]); // EI, NOP
        cpu.step(); // EI
        expect(cpu.ime).toBe(false);
        cpu.step(); // NOP - IME becomes true at start of this step
        expect(cpu.ime).toBe(true);
      });

      test("advances PC by 1", () => {
        loadAt(0x0200, [0xfb]);
        cpu.step();
        expect(cpu.pc).toBe(0x0201);
      });

      test("returns 4 cycles", () => {
        loadAt(0x0200, [0xfb]);
        expect(cpu.step()).toBe(4);
      });
    });

    // ── Illegal opcodes ──

    describe("illegal opcode lock-up", () => {
      const illegalOpcodes = [0xd3, 0xdb, 0xdd, 0xe3, 0xe4, 0xeb, 0xec, 0xed, 0xf4, 0xfc, 0xfd];

      for (const opcode of illegalOpcodes) {
        test(`0x${opcode.toString(16).toUpperCase()} enters hard lock and stalls`, () => {
          loadAt(0x0200, [opcode, 0x00]);

          expect(cpu.step()).toBe(4);
          expect(cpu.pc).toBe(0x0201);

          expect(cpu.step()).toBe(4);
          expect(cpu.pc).toBe(0x0201);
        });
      }

      test("interrupts do not clear hard lock", () => {
        loadAt(0x0200, [0xed]);

        expect(cpu.step()).toBe(4);
        expect(cpu.pc).toBe(0x0201);

        cpu.ime = true;
        memory.writeByte(0xffff, 0x01); // IE: VBlank
        memory.writeByte(0xff0f, 0x01); // IF: VBlank pending

        expect(cpu.step()).toBe(4);
        expect(cpu.pc).toBe(0x0201);
        expect(memory.readByte(0xff0f) & 0x01).toBe(0x01);
      });
    });
  });

  // ─── Serialize / Deserialize ───────────────────────────────────────

  describe("serialize and deserialize", () => {
    test("round-trip preserves all register values", () => {
      cpu.af = 0x1230; // lower nibble masked
      cpu.bc = 0x4567;
      cpu.de = 0x89ab;
      cpu.hl = 0xcdef;
      cpu.sp = 0x1234;
      cpu.pc = 0x5678;
      cpu.ime = true;
      cpu.halted = true;

      const data = cpu.serialize();
      const restored = CPU.deserialize(data, memory);

      expect(restored.af).toBe(0x1230);
      expect(restored.bc).toBe(0x4567);
      expect(restored.de).toBe(0x89ab);
      expect(restored.hl).toBe(0xcdef);
      expect(restored.sp).toBe(0x1234);
      expect(restored.pc).toBe(0x5678);
      expect(restored.ime).toBe(true);
      expect(restored.halted).toBe(true);
    });

    test("round-trip preserves default state", () => {
      const data = cpu.serialize();
      const restored = CPU.deserialize(data, memory);

      expect(restored.af).toBe(0x01b0);
      expect(restored.bc).toBe(0x0013);
      expect(restored.de).toBe(0x00d8);
      expect(restored.hl).toBe(0x014d);
      expect(restored.sp).toBe(0xfffe);
      expect(restored.pc).toBe(0x0100);
      expect(restored.ime).toBe(false);
      expect(restored.halted).toBe(false);
    });

    test("serialize returns a Uint8Array", () => {
      const data = cpu.serialize();
      expect(data).toBeInstanceOf(Uint8Array);
    });

    test("deserialized CPU can execute instructions", () => {
      cpu.pc = 0x0300;
      memory.load(0x0300, [0x3e, 0x42]); // LD A, 0x42

      const data = cpu.serialize();
      const restored = CPU.deserialize(data, memory);
      const cycles = restored.step();

      expect(restored.a).toBe(0x42);
      expect(cycles).toBe(8);
    });

    test("round-trip preserves hard lock state", () => {
      cpu.pc = 0x0300;
      memory.load(0x0300, [0xed, 0x00]); // Illegal opcode followed by NOP

      expect(cpu.step()).toBe(4);
      expect(cpu.pc).toBe(0x0301);

      const data = cpu.serialize();
      const restored = CPU.deserialize(data, memory);

      expect(restored.step()).toBe(4);
      expect(restored.pc).toBe(0x0301);
    });
  });
});
