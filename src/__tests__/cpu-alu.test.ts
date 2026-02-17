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

describe("CPU ALU opcodes", () => {
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

  // Helper to clear all flags before a test
  function clearFlags() {
    cpu.f = 0x00;
  }

  // ═══════════════════════════════════════════════════════════════════
  // ADD A, r8
  // ═══════════════════════════════════════════════════════════════════
  describe("ADD A, r8", () => {
    const regOps: [number, string, () => void][] = [
      [0x80, "B", () => { cpu.b = 0x12; }],
      [0x81, "C", () => { cpu.c = 0x12; }],
      [0x82, "D", () => { cpu.d = 0x12; }],
      [0x83, "E", () => { cpu.e = 0x12; }],
      [0x84, "H", () => { cpu.h = 0x12; }],
      [0x85, "L", () => { cpu.l = 0x12; }],
    ];

    for (const [opcode, name, setReg] of regOps) {
      describe(`0x${opcode.toString(16).toUpperCase()} ADD A,${name}`, () => {
        test("correct result", () => {
          cpu.a = 0x10;
          setReg();
          clearFlags();
          loadAt(0x200, [opcode]);
          cpu.step();
          expect(cpu.a).toBe(0x22);
        });

        test("returns 4 cycles", () => {
          cpu.a = 0x10;
          setReg();
          clearFlags();
          loadAt(0x200, [opcode]);
          expect(cpu.step()).toBe(4);
        });

        test("advances PC by 1", () => {
          cpu.a = 0x10;
          setReg();
          loadAt(0x200, [opcode]);
          cpu.step();
          expect(cpu.pc).toBe(0x201);
        });
      });
    }

    describe("0x87 ADD A,A", () => {
      test("correct result (A + A)", () => {
        cpu.a = 0x10;
        clearFlags();
        loadAt(0x200, [0x87]);
        cpu.step();
        expect(cpu.a).toBe(0x20);
      });

      test("returns 4 cycles", () => {
        cpu.a = 0x10;
        clearFlags();
        loadAt(0x200, [0x87]);
        expect(cpu.step()).toBe(4);
      });
    });

    describe("flags", () => {
      test("Z flag set when result is 0", () => {
        cpu.a = 0x00;
        cpu.b = 0x00;
        clearFlags();
        loadAt(0x200, [0x80]);
        cpu.step();
        expect(cpu.flagZ).toBe(true);
      });

      test("Z flag clear when result is non-zero", () => {
        cpu.a = 0x01;
        cpu.b = 0x02;
        clearFlags();
        loadAt(0x200, [0x80]);
        cpu.step();
        expect(cpu.flagZ).toBe(false);
      });

      test("N flag always 0", () => {
        cpu.a = 0x01;
        cpu.b = 0x02;
        cpu.flagN = true;
        loadAt(0x200, [0x80]);
        cpu.step();
        expect(cpu.flagN).toBe(false);
      });

      test("H flag set when carry from bit 3 (0x0F + 0x01)", () => {
        cpu.a = 0x0f;
        cpu.b = 0x01;
        clearFlags();
        loadAt(0x200, [0x80]);
        cpu.step();
        expect(cpu.flagH).toBe(true);
      });

      test("H flag clear when no carry from bit 3", () => {
        cpu.a = 0x01;
        cpu.b = 0x02;
        clearFlags();
        loadAt(0x200, [0x80]);
        cpu.step();
        expect(cpu.flagH).toBe(false);
      });

      test("C flag set on overflow (0xFF + 0x01)", () => {
        cpu.a = 0xff;
        cpu.b = 0x01;
        clearFlags();
        loadAt(0x200, [0x80]);
        cpu.step();
        expect(cpu.a).toBe(0x00);
        expect(cpu.flagC).toBe(true);
        expect(cpu.flagZ).toBe(true);
      });

      test("C flag clear when no overflow", () => {
        cpu.a = 0x10;
        cpu.b = 0x20;
        clearFlags();
        loadAt(0x200, [0x80]);
        cpu.step();
        expect(cpu.flagC).toBe(false);
      });

      test("H and C both set (0xFF + 0xFF)", () => {
        cpu.a = 0xff;
        cpu.b = 0xff;
        clearFlags();
        loadAt(0x200, [0x80]);
        cpu.step();
        expect(cpu.a).toBe(0xfe);
        expect(cpu.flagH).toBe(true);
        expect(cpu.flagC).toBe(true);
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // ADC A, r8
  // ═══════════════════════════════════════════════════════════════════
  describe("ADC A, r8", () => {
    const regOps: [number, string, () => void][] = [
      [0x88, "B", () => { cpu.b = 0x12; }],
      [0x89, "C", () => { cpu.c = 0x12; }],
      [0x8A, "D", () => { cpu.d = 0x12; }],
      [0x8B, "E", () => { cpu.e = 0x12; }],
      [0x8C, "H", () => { cpu.h = 0x12; }],
      [0x8D, "L", () => { cpu.l = 0x12; }],
    ];

    for (const [opcode, name, setReg] of regOps) {
      describe(`0x${opcode.toString(16).toUpperCase()} ADC A,${name}`, () => {
        test("correct result without carry", () => {
          cpu.a = 0x10;
          setReg();
          clearFlags();
          loadAt(0x200, [opcode]);
          cpu.step();
          expect(cpu.a).toBe(0x22);
        });

        test("correct result with carry", () => {
          cpu.a = 0x10;
          setReg();
          clearFlags();
          cpu.flagC = true;
          loadAt(0x200, [opcode]);
          cpu.step();
          expect(cpu.a).toBe(0x23);
        });

        test("returns 4 cycles", () => {
          cpu.a = 0x10;
          setReg();
          clearFlags();
          loadAt(0x200, [opcode]);
          expect(cpu.step()).toBe(4);
        });
      });
    }

    describe("0x8F ADC A,A", () => {
      test("correct result with carry", () => {
        cpu.a = 0x10;
        clearFlags();
        cpu.flagC = true;
        loadAt(0x200, [0x8F]);
        cpu.step();
        expect(cpu.a).toBe(0x21);
      });

      test("returns 4 cycles", () => {
        cpu.a = 0x10;
        clearFlags();
        loadAt(0x200, [0x8F]);
        expect(cpu.step()).toBe(4);
      });
    });

    describe("flags", () => {
      test("Z flag set when result is 0 (0xFF + 0x00 + carry)", () => {
        cpu.a = 0xff;
        cpu.b = 0x00;
        clearFlags();
        cpu.flagC = true;
        loadAt(0x200, [0x88]);
        cpu.step();
        expect(cpu.a).toBe(0x00);
        expect(cpu.flagZ).toBe(true);
      });

      test("N flag always 0", () => {
        cpu.a = 0x01;
        cpu.b = 0x02;
        cpu.flagN = true;
        cpu.flagC = false;
        loadAt(0x200, [0x88]);
        cpu.step();
        expect(cpu.flagN).toBe(false);
      });

      test("H flag set with carry from bit 3 via carry flag (0x0F + 0x00 + 1)", () => {
        cpu.a = 0x0f;
        cpu.b = 0x00;
        clearFlags();
        cpu.flagC = true;
        loadAt(0x200, [0x88]);
        cpu.step();
        expect(cpu.flagH).toBe(true);
      });

      test("C flag set on overflow with carry (0xFE + 0x01 + 1)", () => {
        cpu.a = 0xfe;
        cpu.b = 0x01;
        clearFlags();
        cpu.flagC = true;
        loadAt(0x200, [0x88]);
        cpu.step();
        expect(cpu.a).toBe(0x00);
        expect(cpu.flagC).toBe(true);
        expect(cpu.flagZ).toBe(true);
      });

      test("C flag clear when no overflow", () => {
        cpu.a = 0x10;
        cpu.b = 0x20;
        clearFlags();
        loadAt(0x200, [0x88]);
        cpu.step();
        expect(cpu.flagC).toBe(false);
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // SUB r8
  // ═══════════════════════════════════════════════════════════════════
  describe("SUB r8", () => {
    const regOps: [number, string, () => void][] = [
      [0x90, "B", () => { cpu.b = 0x05; }],
      [0x91, "C", () => { cpu.c = 0x05; }],
      [0x92, "D", () => { cpu.d = 0x05; }],
      [0x93, "E", () => { cpu.e = 0x05; }],
      [0x94, "H", () => { cpu.h = 0x05; }],
      [0x95, "L", () => { cpu.l = 0x05; }],
    ];

    for (const [opcode, name, setReg] of regOps) {
      describe(`0x${opcode.toString(16).toUpperCase()} SUB ${name}`, () => {
        test("correct result", () => {
          cpu.a = 0x10;
          setReg();
          clearFlags();
          loadAt(0x200, [opcode]);
          cpu.step();
          expect(cpu.a).toBe(0x0b);
        });

        test("returns 4 cycles", () => {
          cpu.a = 0x10;
          setReg();
          clearFlags();
          loadAt(0x200, [opcode]);
          expect(cpu.step()).toBe(4);
        });

        test("advances PC by 1", () => {
          cpu.a = 0x10;
          setReg();
          loadAt(0x200, [opcode]);
          cpu.step();
          expect(cpu.pc).toBe(0x201);
        });
      });
    }

    describe("0x97 SUB A", () => {
      test("A - A = 0", () => {
        cpu.a = 0x42;
        clearFlags();
        loadAt(0x200, [0x97]);
        cpu.step();
        expect(cpu.a).toBe(0x00);
        expect(cpu.flagZ).toBe(true);
      });

      test("returns 4 cycles", () => {
        cpu.a = 0x42;
        clearFlags();
        loadAt(0x200, [0x97]);
        expect(cpu.step()).toBe(4);
      });
    });

    describe("flags", () => {
      test("Z flag set when result is 0", () => {
        cpu.a = 0x05;
        cpu.b = 0x05;
        clearFlags();
        loadAt(0x200, [0x90]);
        cpu.step();
        expect(cpu.flagZ).toBe(true);
      });

      test("Z flag clear when result non-zero", () => {
        cpu.a = 0x10;
        cpu.b = 0x05;
        clearFlags();
        loadAt(0x200, [0x90]);
        cpu.step();
        expect(cpu.flagZ).toBe(false);
      });

      test("N flag always 1", () => {
        cpu.a = 0x10;
        cpu.b = 0x05;
        clearFlags();
        loadAt(0x200, [0x90]);
        cpu.step();
        expect(cpu.flagN).toBe(true);
      });

      test("H flag set on borrow from bit 4 (0x10 - 0x01)", () => {
        cpu.a = 0x10;
        cpu.b = 0x01;
        clearFlags();
        loadAt(0x200, [0x90]);
        cpu.step();
        expect(cpu.flagH).toBe(true);
      });

      test("H flag clear when no borrow from bit 4", () => {
        cpu.a = 0x0f;
        cpu.b = 0x01;
        clearFlags();
        loadAt(0x200, [0x90]);
        cpu.step();
        expect(cpu.flagH).toBe(false);
      });

      test("C flag set on underflow (0x00 - 0x01)", () => {
        cpu.a = 0x00;
        cpu.b = 0x01;
        clearFlags();
        loadAt(0x200, [0x90]);
        cpu.step();
        expect(cpu.a).toBe(0xff);
        expect(cpu.flagC).toBe(true);
      });

      test("C flag clear when no underflow", () => {
        cpu.a = 0x10;
        cpu.b = 0x05;
        clearFlags();
        loadAt(0x200, [0x90]);
        cpu.step();
        expect(cpu.flagC).toBe(false);
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // SBC A, r8
  // ═══════════════════════════════════════════════════════════════════
  describe("SBC A, r8", () => {
    const regOps: [number, string, () => void][] = [
      [0x98, "B", () => { cpu.b = 0x05; }],
      [0x99, "C", () => { cpu.c = 0x05; }],
      [0x9A, "D", () => { cpu.d = 0x05; }],
      [0x9B, "E", () => { cpu.e = 0x05; }],
      [0x9C, "H", () => { cpu.h = 0x05; }],
      [0x9D, "L", () => { cpu.l = 0x05; }],
    ];

    for (const [opcode, name, setReg] of regOps) {
      describe(`0x${opcode.toString(16).toUpperCase()} SBC A,${name}`, () => {
        test("correct result without carry", () => {
          cpu.a = 0x10;
          setReg();
          clearFlags();
          loadAt(0x200, [opcode]);
          cpu.step();
          expect(cpu.a).toBe(0x0b);
        });

        test("correct result with carry", () => {
          cpu.a = 0x10;
          setReg();
          clearFlags();
          cpu.flagC = true;
          loadAt(0x200, [opcode]);
          cpu.step();
          expect(cpu.a).toBe(0x0a);
        });

        test("returns 4 cycles", () => {
          cpu.a = 0x10;
          setReg();
          clearFlags();
          loadAt(0x200, [opcode]);
          expect(cpu.step()).toBe(4);
        });
      });
    }

    describe("0x9F SBC A,A", () => {
      test("SBC A,A with carry clear = 0", () => {
        cpu.a = 0x42;
        clearFlags();
        loadAt(0x200, [0x9F]);
        cpu.step();
        expect(cpu.a).toBe(0x00);
        expect(cpu.flagZ).toBe(true);
      });

      test("SBC A,A with carry set = 0xFF", () => {
        cpu.a = 0x42;
        clearFlags();
        cpu.flagC = true;
        loadAt(0x200, [0x9F]);
        cpu.step();
        expect(cpu.a).toBe(0xff);
        expect(cpu.flagC).toBe(true);
      });
    });

    describe("flags", () => {
      test("Z flag set when result is 0", () => {
        cpu.a = 0x05;
        cpu.b = 0x05;
        clearFlags();
        loadAt(0x200, [0x98]);
        cpu.step();
        expect(cpu.flagZ).toBe(true);
      });

      test("N flag always 1", () => {
        cpu.a = 0x10;
        cpu.b = 0x05;
        clearFlags();
        loadAt(0x200, [0x98]);
        cpu.step();
        expect(cpu.flagN).toBe(true);
      });

      test("H flag set on borrow from bit 4 with carry (0x10 - 0x00 - 1)", () => {
        cpu.a = 0x10;
        cpu.b = 0x00;
        clearFlags();
        cpu.flagC = true;
        loadAt(0x200, [0x98]);
        cpu.step();
        expect(cpu.flagH).toBe(true);
      });

      test("C flag set on underflow with carry (0x00 - 0x00 - 1)", () => {
        cpu.a = 0x00;
        cpu.b = 0x00;
        clearFlags();
        cpu.flagC = true;
        loadAt(0x200, [0x98]);
        cpu.step();
        expect(cpu.a).toBe(0xff);
        expect(cpu.flagC).toBe(true);
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // AND r8
  // ═══════════════════════════════════════════════════════════════════
  describe("AND r8", () => {
    const regOps: [number, string, () => void][] = [
      [0xA0, "B", () => { cpu.b = 0x0F; }],
      [0xA1, "C", () => { cpu.c = 0x0F; }],
      [0xA2, "D", () => { cpu.d = 0x0F; }],
      [0xA3, "E", () => { cpu.e = 0x0F; }],
      [0xA4, "H", () => { cpu.h = 0x0F; }],
      [0xA5, "L", () => { cpu.l = 0x0F; }],
    ];

    for (const [opcode, name, setReg] of regOps) {
      describe(`0x${opcode.toString(16).toUpperCase()} AND ${name}`, () => {
        test("correct result", () => {
          cpu.a = 0xF3;
          setReg();
          clearFlags();
          loadAt(0x200, [opcode]);
          cpu.step();
          expect(cpu.a).toBe(0x03);
        });

        test("returns 4 cycles", () => {
          cpu.a = 0xF3;
          setReg();
          clearFlags();
          loadAt(0x200, [opcode]);
          expect(cpu.step()).toBe(4);
        });

        test("advances PC by 1", () => {
          cpu.a = 0xF3;
          setReg();
          loadAt(0x200, [opcode]);
          cpu.step();
          expect(cpu.pc).toBe(0x201);
        });
      });
    }

    describe("0xA7 AND A", () => {
      test("A AND A = A", () => {
        cpu.a = 0x42;
        clearFlags();
        loadAt(0x200, [0xA7]);
        cpu.step();
        expect(cpu.a).toBe(0x42);
      });

      test("returns 4 cycles", () => {
        cpu.a = 0x42;
        clearFlags();
        loadAt(0x200, [0xA7]);
        expect(cpu.step()).toBe(4);
      });
    });

    describe("flags", () => {
      test("Z flag set when result is 0", () => {
        cpu.a = 0xF0;
        cpu.b = 0x0F;
        clearFlags();
        loadAt(0x200, [0xA0]);
        cpu.step();
        expect(cpu.flagZ).toBe(true);
      });

      test("Z flag clear when result non-zero", () => {
        cpu.a = 0xFF;
        cpu.b = 0x0F;
        clearFlags();
        loadAt(0x200, [0xA0]);
        cpu.step();
        expect(cpu.flagZ).toBe(false);
      });

      test("N flag always 0", () => {
        cpu.a = 0xFF;
        cpu.b = 0x0F;
        cpu.flagN = true;
        loadAt(0x200, [0xA0]);
        cpu.step();
        expect(cpu.flagN).toBe(false);
      });

      test("H flag always 1", () => {
        cpu.a = 0xFF;
        cpu.b = 0x0F;
        clearFlags();
        loadAt(0x200, [0xA0]);
        cpu.step();
        expect(cpu.flagH).toBe(true);
      });

      test("C flag always 0", () => {
        cpu.a = 0xFF;
        cpu.b = 0x0F;
        cpu.flagC = true;
        loadAt(0x200, [0xA0]);
        cpu.step();
        expect(cpu.flagC).toBe(false);
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // XOR r8
  // ═══════════════════════════════════════════════════════════════════
  describe("XOR r8", () => {
    const regOps: [number, string, () => void][] = [
      [0xA8, "B", () => { cpu.b = 0xFF; }],
      [0xA9, "C", () => { cpu.c = 0xFF; }],
      [0xAA, "D", () => { cpu.d = 0xFF; }],
      [0xAB, "E", () => { cpu.e = 0xFF; }],
      [0xAC, "H", () => { cpu.h = 0xFF; }],
      [0xAD, "L", () => { cpu.l = 0xFF; }],
    ];

    for (const [opcode, name, setReg] of regOps) {
      describe(`0x${opcode.toString(16).toUpperCase()} XOR ${name}`, () => {
        test("correct result", () => {
          cpu.a = 0xF0;
          setReg();
          clearFlags();
          loadAt(0x200, [opcode]);
          cpu.step();
          expect(cpu.a).toBe(0x0F);
        });

        test("returns 4 cycles", () => {
          cpu.a = 0xF0;
          setReg();
          clearFlags();
          loadAt(0x200, [opcode]);
          expect(cpu.step()).toBe(4);
        });

        test("advances PC by 1", () => {
          cpu.a = 0xF0;
          setReg();
          loadAt(0x200, [opcode]);
          cpu.step();
          expect(cpu.pc).toBe(0x201);
        });
      });
    }

    describe("flags", () => {
      test("Z flag set when result is 0", () => {
        cpu.a = 0xFF;
        cpu.b = 0xFF;
        clearFlags();
        loadAt(0x200, [0xA8]);
        cpu.step();
        expect(cpu.flagZ).toBe(true);
      });

      test("Z flag clear when result non-zero", () => {
        cpu.a = 0xF0;
        cpu.b = 0xFF;
        clearFlags();
        loadAt(0x200, [0xA8]);
        cpu.step();
        expect(cpu.flagZ).toBe(false);
      });

      test("N flag always 0", () => {
        cpu.a = 0xFF;
        cpu.b = 0xFF;
        cpu.flagN = true;
        loadAt(0x200, [0xA8]);
        cpu.step();
        expect(cpu.flagN).toBe(false);
      });

      test("H flag always 0", () => {
        cpu.a = 0xFF;
        cpu.b = 0xFF;
        cpu.flagH = true;
        loadAt(0x200, [0xA8]);
        cpu.step();
        expect(cpu.flagH).toBe(false);
      });

      test("C flag always 0", () => {
        cpu.a = 0xFF;
        cpu.b = 0xFF;
        cpu.flagC = true;
        loadAt(0x200, [0xA8]);
        cpu.step();
        expect(cpu.flagC).toBe(false);
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // OR r8
  // ═══════════════════════════════════════════════════════════════════
  describe("OR r8", () => {
    const regOps: [number, string, () => void][] = [
      [0xB0, "B", () => { cpu.b = 0x0F; }],
      [0xB1, "C", () => { cpu.c = 0x0F; }],
      [0xB2, "D", () => { cpu.d = 0x0F; }],
      [0xB3, "E", () => { cpu.e = 0x0F; }],
      [0xB4, "H", () => { cpu.h = 0x0F; }],
      [0xB5, "L", () => { cpu.l = 0x0F; }],
    ];

    for (const [opcode, name, setReg] of regOps) {
      describe(`0x${opcode.toString(16).toUpperCase()} OR ${name}`, () => {
        test("correct result", () => {
          cpu.a = 0xF0;
          setReg();
          clearFlags();
          loadAt(0x200, [opcode]);
          cpu.step();
          expect(cpu.a).toBe(0xFF);
        });

        test("returns 4 cycles", () => {
          cpu.a = 0xF0;
          setReg();
          clearFlags();
          loadAt(0x200, [opcode]);
          expect(cpu.step()).toBe(4);
        });

        test("advances PC by 1", () => {
          cpu.a = 0xF0;
          setReg();
          loadAt(0x200, [opcode]);
          cpu.step();
          expect(cpu.pc).toBe(0x201);
        });
      });
    }

    describe("0xB7 OR A", () => {
      test("A OR A = A", () => {
        cpu.a = 0x42;
        clearFlags();
        loadAt(0x200, [0xB7]);
        cpu.step();
        expect(cpu.a).toBe(0x42);
      });

      test("returns 4 cycles", () => {
        cpu.a = 0x42;
        clearFlags();
        loadAt(0x200, [0xB7]);
        expect(cpu.step()).toBe(4);
      });
    });

    describe("flags", () => {
      test("Z flag set when result is 0", () => {
        cpu.a = 0x00;
        cpu.b = 0x00;
        clearFlags();
        loadAt(0x200, [0xB0]);
        cpu.step();
        expect(cpu.flagZ).toBe(true);
      });

      test("Z flag clear when result non-zero", () => {
        cpu.a = 0xF0;
        cpu.b = 0x0F;
        clearFlags();
        loadAt(0x200, [0xB0]);
        cpu.step();
        expect(cpu.flagZ).toBe(false);
      });

      test("N flag always 0", () => {
        cpu.a = 0x00;
        cpu.b = 0x0F;
        cpu.flagN = true;
        loadAt(0x200, [0xB0]);
        cpu.step();
        expect(cpu.flagN).toBe(false);
      });

      test("H flag always 0", () => {
        cpu.a = 0x00;
        cpu.b = 0x0F;
        cpu.flagH = true;
        loadAt(0x200, [0xB0]);
        cpu.step();
        expect(cpu.flagH).toBe(false);
      });

      test("C flag always 0", () => {
        cpu.a = 0x00;
        cpu.b = 0x0F;
        cpu.flagC = true;
        loadAt(0x200, [0xB0]);
        cpu.step();
        expect(cpu.flagC).toBe(false);
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // CP r8
  // ═══════════════════════════════════════════════════════════════════
  describe("CP r8", () => {
    const regOps: [number, string, () => void][] = [
      [0xB8, "B", () => { cpu.b = 0x05; }],
      [0xB9, "C", () => { cpu.c = 0x05; }],
      [0xBA, "D", () => { cpu.d = 0x05; }],
      [0xBB, "E", () => { cpu.e = 0x05; }],
      [0xBC, "H", () => { cpu.h = 0x05; }],
      [0xBD, "L", () => { cpu.l = 0x05; }],
    ];

    for (const [opcode, name, setReg] of regOps) {
      describe(`0x${opcode.toString(16).toUpperCase()} CP ${name}`, () => {
        test("does not modify A", () => {
          cpu.a = 0x10;
          setReg();
          clearFlags();
          loadAt(0x200, [opcode]);
          cpu.step();
          expect(cpu.a).toBe(0x10);
        });

        test("returns 4 cycles", () => {
          cpu.a = 0x10;
          setReg();
          clearFlags();
          loadAt(0x200, [opcode]);
          expect(cpu.step()).toBe(4);
        });

        test("advances PC by 1", () => {
          cpu.a = 0x10;
          setReg();
          loadAt(0x200, [opcode]);
          cpu.step();
          expect(cpu.pc).toBe(0x201);
        });
      });
    }

    describe("0xBF CP A", () => {
      test("A compared with itself, Z set", () => {
        cpu.a = 0x42;
        clearFlags();
        loadAt(0x200, [0xBF]);
        cpu.step();
        expect(cpu.a).toBe(0x42);
        expect(cpu.flagZ).toBe(true);
        expect(cpu.flagN).toBe(true);
        expect(cpu.flagH).toBe(false);
        expect(cpu.flagC).toBe(false);
      });
    });

    describe("flags", () => {
      test("Z flag set when A == r8", () => {
        cpu.a = 0x05;
        cpu.b = 0x05;
        clearFlags();
        loadAt(0x200, [0xB8]);
        cpu.step();
        expect(cpu.flagZ).toBe(true);
      });

      test("Z flag clear when A != r8", () => {
        cpu.a = 0x10;
        cpu.b = 0x05;
        clearFlags();
        loadAt(0x200, [0xB8]);
        cpu.step();
        expect(cpu.flagZ).toBe(false);
      });

      test("N flag always 1", () => {
        cpu.a = 0x10;
        cpu.b = 0x05;
        clearFlags();
        loadAt(0x200, [0xB8]);
        cpu.step();
        expect(cpu.flagN).toBe(true);
      });

      test("H flag set on borrow from bit 4", () => {
        cpu.a = 0x10;
        cpu.b = 0x01;
        clearFlags();
        loadAt(0x200, [0xB8]);
        cpu.step();
        expect(cpu.flagH).toBe(true);
      });

      test("C flag set when A < r8", () => {
        cpu.a = 0x00;
        cpu.b = 0x01;
        clearFlags();
        loadAt(0x200, [0xB8]);
        cpu.step();
        expect(cpu.flagC).toBe(true);
      });

      test("C flag clear when A >= r8", () => {
        cpu.a = 0x10;
        cpu.b = 0x05;
        clearFlags();
        loadAt(0x200, [0xB8]);
        cpu.step();
        expect(cpu.flagC).toBe(false);
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // ALU with (HL) operand - 8 cycles
  // ═══════════════════════════════════════════════════════════════════
  describe("ALU with (HL)", () => {
    describe("0x86 ADD A,(HL)", () => {
      test("correct result", () => {
        cpu.a = 0x10;
        cpu.hl = 0xC000;
        memory.writeByte(0xC000, 0x05);
        clearFlags();
        loadAt(0x200, [0x86]);
        cpu.step();
        expect(cpu.a).toBe(0x15);
      });

      test("returns 8 cycles", () => {
        cpu.a = 0x10;
        cpu.hl = 0xC000;
        memory.writeByte(0xC000, 0x05);
        clearFlags();
        loadAt(0x200, [0x86]);
        expect(cpu.step()).toBe(8);
      });

      test("sets flags correctly (H flag)", () => {
        cpu.a = 0x0F;
        cpu.hl = 0xC000;
        memory.writeByte(0xC000, 0x01);
        clearFlags();
        loadAt(0x200, [0x86]);
        cpu.step();
        expect(cpu.a).toBe(0x10);
        expect(cpu.flagH).toBe(true);
        expect(cpu.flagN).toBe(false);
      });

      test("advances PC by 1", () => {
        cpu.a = 0x10;
        cpu.hl = 0xC000;
        memory.writeByte(0xC000, 0x05);
        loadAt(0x200, [0x86]);
        cpu.step();
        expect(cpu.pc).toBe(0x201);
      });
    });

    describe("0x8E ADC A,(HL)", () => {
      test("correct result with carry", () => {
        cpu.a = 0x10;
        cpu.hl = 0xC000;
        memory.writeByte(0xC000, 0x05);
        clearFlags();
        cpu.flagC = true;
        loadAt(0x200, [0x8E]);
        cpu.step();
        expect(cpu.a).toBe(0x16);
      });

      test("returns 8 cycles", () => {
        cpu.a = 0x10;
        cpu.hl = 0xC000;
        memory.writeByte(0xC000, 0x05);
        clearFlags();
        loadAt(0x200, [0x8E]);
        expect(cpu.step()).toBe(8);
      });
    });

    describe("0x96 SUB (HL)", () => {
      test("correct result", () => {
        cpu.a = 0x10;
        cpu.hl = 0xC000;
        memory.writeByte(0xC000, 0x05);
        clearFlags();
        loadAt(0x200, [0x96]);
        cpu.step();
        expect(cpu.a).toBe(0x0B);
        expect(cpu.flagN).toBe(true);
      });

      test("returns 8 cycles", () => {
        cpu.a = 0x10;
        cpu.hl = 0xC000;
        memory.writeByte(0xC000, 0x05);
        clearFlags();
        loadAt(0x200, [0x96]);
        expect(cpu.step()).toBe(8);
      });
    });

    describe("0x9E SBC A,(HL)", () => {
      test("correct result with carry", () => {
        cpu.a = 0x10;
        cpu.hl = 0xC000;
        memory.writeByte(0xC000, 0x05);
        clearFlags();
        cpu.flagC = true;
        loadAt(0x200, [0x9E]);
        cpu.step();
        expect(cpu.a).toBe(0x0A);
        expect(cpu.flagN).toBe(true);
      });

      test("returns 8 cycles", () => {
        cpu.a = 0x10;
        cpu.hl = 0xC000;
        memory.writeByte(0xC000, 0x05);
        clearFlags();
        loadAt(0x200, [0x9E]);
        expect(cpu.step()).toBe(8);
      });
    });

    describe("0xA6 AND (HL)", () => {
      test("correct result", () => {
        cpu.a = 0xF3;
        cpu.hl = 0xC000;
        memory.writeByte(0xC000, 0x0F);
        clearFlags();
        loadAt(0x200, [0xA6]);
        cpu.step();
        expect(cpu.a).toBe(0x03);
        expect(cpu.flagH).toBe(true);
      });

      test("returns 8 cycles", () => {
        cpu.a = 0xF3;
        cpu.hl = 0xC000;
        memory.writeByte(0xC000, 0x0F);
        clearFlags();
        loadAt(0x200, [0xA6]);
        expect(cpu.step()).toBe(8);
      });
    });

    describe("0xAE XOR (HL)", () => {
      test("correct result", () => {
        cpu.a = 0xF0;
        cpu.hl = 0xC000;
        memory.writeByte(0xC000, 0xFF);
        clearFlags();
        loadAt(0x200, [0xAE]);
        cpu.step();
        expect(cpu.a).toBe(0x0F);
      });

      test("returns 8 cycles", () => {
        cpu.a = 0xF0;
        cpu.hl = 0xC000;
        memory.writeByte(0xC000, 0xFF);
        clearFlags();
        loadAt(0x200, [0xAE]);
        expect(cpu.step()).toBe(8);
      });
    });

    describe("0xB6 OR (HL)", () => {
      test("correct result", () => {
        cpu.a = 0xF0;
        cpu.hl = 0xC000;
        memory.writeByte(0xC000, 0x0F);
        clearFlags();
        loadAt(0x200, [0xB6]);
        cpu.step();
        expect(cpu.a).toBe(0xFF);
      });

      test("returns 8 cycles", () => {
        cpu.a = 0xF0;
        cpu.hl = 0xC000;
        memory.writeByte(0xC000, 0x0F);
        clearFlags();
        loadAt(0x200, [0xB6]);
        expect(cpu.step()).toBe(8);
      });
    });

    describe("0xBE CP (HL)", () => {
      test("does not modify A, sets flags", () => {
        cpu.a = 0x10;
        cpu.hl = 0xC000;
        memory.writeByte(0xC000, 0x10);
        clearFlags();
        loadAt(0x200, [0xBE]);
        cpu.step();
        expect(cpu.a).toBe(0x10);
        expect(cpu.flagZ).toBe(true);
        expect(cpu.flagN).toBe(true);
      });

      test("returns 8 cycles", () => {
        cpu.a = 0x10;
        cpu.hl = 0xC000;
        memory.writeByte(0xC000, 0x10);
        clearFlags();
        loadAt(0x200, [0xBE]);
        expect(cpu.step()).toBe(8);
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // ALU with immediate d8 - 8 cycles
  // ═══════════════════════════════════════════════════════════════════
  describe("ALU with immediate d8", () => {
    describe("0xC6 ADD A,d8", () => {
      test("correct result", () => {
        cpu.a = 0x10;
        clearFlags();
        loadAt(0x200, [0xC6, 0x05]);
        cpu.step();
        expect(cpu.a).toBe(0x15);
      });

      test("returns 8 cycles", () => {
        cpu.a = 0x10;
        clearFlags();
        loadAt(0x200, [0xC6, 0x05]);
        expect(cpu.step()).toBe(8);
      });

      test("advances PC by 2", () => {
        cpu.a = 0x10;
        clearFlags();
        loadAt(0x200, [0xC6, 0x05]);
        cpu.step();
        expect(cpu.pc).toBe(0x202);
      });

      test("sets H flag on carry from bit 3", () => {
        cpu.a = 0x0F;
        clearFlags();
        loadAt(0x200, [0xC6, 0x01]);
        cpu.step();
        expect(cpu.flagH).toBe(true);
      });

      test("sets C flag on overflow", () => {
        cpu.a = 0xFF;
        clearFlags();
        loadAt(0x200, [0xC6, 0x01]);
        cpu.step();
        expect(cpu.a).toBe(0x00);
        expect(cpu.flagC).toBe(true);
        expect(cpu.flagZ).toBe(true);
      });
    });

    describe("0xCE ADC A,d8", () => {
      test("correct result without carry", () => {
        cpu.a = 0x10;
        clearFlags();
        loadAt(0x200, [0xCE, 0x05]);
        cpu.step();
        expect(cpu.a).toBe(0x15);
      });

      test("correct result with carry", () => {
        cpu.a = 0x10;
        clearFlags();
        cpu.flagC = true;
        loadAt(0x200, [0xCE, 0x05]);
        cpu.step();
        expect(cpu.a).toBe(0x16);
      });

      test("returns 8 cycles", () => {
        cpu.a = 0x10;
        clearFlags();
        loadAt(0x200, [0xCE, 0x05]);
        expect(cpu.step()).toBe(8);
      });

      test("advances PC by 2", () => {
        cpu.a = 0x10;
        clearFlags();
        loadAt(0x200, [0xCE, 0x05]);
        cpu.step();
        expect(cpu.pc).toBe(0x202);
      });
    });

    describe("0xD6 SUB d8", () => {
      test("correct result", () => {
        cpu.a = 0x10;
        clearFlags();
        loadAt(0x200, [0xD6, 0x05]);
        cpu.step();
        expect(cpu.a).toBe(0x0B);
        expect(cpu.flagN).toBe(true);
      });

      test("returns 8 cycles", () => {
        cpu.a = 0x10;
        clearFlags();
        loadAt(0x200, [0xD6, 0x05]);
        expect(cpu.step()).toBe(8);
      });

      test("advances PC by 2", () => {
        cpu.a = 0x10;
        clearFlags();
        loadAt(0x200, [0xD6, 0x05]);
        cpu.step();
        expect(cpu.pc).toBe(0x202);
      });

      test("sets H flag on borrow from bit 4", () => {
        cpu.a = 0x10;
        clearFlags();
        loadAt(0x200, [0xD6, 0x01]);
        cpu.step();
        expect(cpu.flagH).toBe(true);
      });
    });

    describe("0xDE SBC A,d8", () => {
      test("correct result with carry", () => {
        cpu.a = 0x10;
        clearFlags();
        cpu.flagC = true;
        loadAt(0x200, [0xDE, 0x05]);
        cpu.step();
        expect(cpu.a).toBe(0x0A);
        expect(cpu.flagN).toBe(true);
      });

      test("returns 8 cycles", () => {
        cpu.a = 0x10;
        clearFlags();
        loadAt(0x200, [0xDE, 0x05]);
        expect(cpu.step()).toBe(8);
      });

      test("advances PC by 2", () => {
        cpu.a = 0x10;
        clearFlags();
        loadAt(0x200, [0xDE, 0x05]);
        cpu.step();
        expect(cpu.pc).toBe(0x202);
      });
    });

    describe("0xE6 AND d8", () => {
      test("correct result", () => {
        cpu.a = 0xF3;
        clearFlags();
        loadAt(0x200, [0xE6, 0x0F]);
        cpu.step();
        expect(cpu.a).toBe(0x03);
        expect(cpu.flagH).toBe(true);
      });

      test("returns 8 cycles", () => {
        cpu.a = 0xF3;
        clearFlags();
        loadAt(0x200, [0xE6, 0x0F]);
        expect(cpu.step()).toBe(8);
      });

      test("advances PC by 2", () => {
        cpu.a = 0xF3;
        clearFlags();
        loadAt(0x200, [0xE6, 0x0F]);
        cpu.step();
        expect(cpu.pc).toBe(0x202);
      });
    });

    describe("0xEE XOR d8", () => {
      test("correct result", () => {
        cpu.a = 0xF0;
        clearFlags();
        loadAt(0x200, [0xEE, 0xFF]);
        cpu.step();
        expect(cpu.a).toBe(0x0F);
      });

      test("returns 8 cycles", () => {
        cpu.a = 0xF0;
        clearFlags();
        loadAt(0x200, [0xEE, 0xFF]);
        expect(cpu.step()).toBe(8);
      });

      test("advances PC by 2", () => {
        cpu.a = 0xF0;
        clearFlags();
        loadAt(0x200, [0xEE, 0xFF]);
        cpu.step();
        expect(cpu.pc).toBe(0x202);
      });
    });

    describe("0xF6 OR d8", () => {
      test("correct result", () => {
        cpu.a = 0xF0;
        clearFlags();
        loadAt(0x200, [0xF6, 0x0F]);
        cpu.step();
        expect(cpu.a).toBe(0xFF);
      });

      test("returns 8 cycles", () => {
        cpu.a = 0xF0;
        clearFlags();
        loadAt(0x200, [0xF6, 0x0F]);
        expect(cpu.step()).toBe(8);
      });

      test("advances PC by 2", () => {
        cpu.a = 0xF0;
        clearFlags();
        loadAt(0x200, [0xF6, 0x0F]);
        cpu.step();
        expect(cpu.pc).toBe(0x202);
      });
    });

    describe("0xFE CP d8", () => {
      test("does not modify A, sets flags", () => {
        cpu.a = 0x10;
        clearFlags();
        loadAt(0x200, [0xFE, 0x10]);
        cpu.step();
        expect(cpu.a).toBe(0x10);
        expect(cpu.flagZ).toBe(true);
        expect(cpu.flagN).toBe(true);
      });

      test("returns 8 cycles", () => {
        cpu.a = 0x10;
        clearFlags();
        loadAt(0x200, [0xFE, 0x10]);
        expect(cpu.step()).toBe(8);
      });

      test("advances PC by 2", () => {
        cpu.a = 0x10;
        clearFlags();
        loadAt(0x200, [0xFE, 0x10]);
        cpu.step();
        expect(cpu.pc).toBe(0x202);
      });

      test("C flag set when A < d8", () => {
        cpu.a = 0x05;
        clearFlags();
        loadAt(0x200, [0xFE, 0x10]);
        cpu.step();
        expect(cpu.flagC).toBe(true);
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // INC r8 - 4 cycles
  // ═══════════════════════════════════════════════════════════════════
  describe("INC r8", () => {
    const regOps: [number, string, (v: number) => void, () => number][] = [
      [0x04, "B", (v) => { cpu.b = v; }, () => cpu.b],
      [0x0C, "C", (v) => { cpu.c = v; }, () => cpu.c],
      [0x14, "D", (v) => { cpu.d = v; }, () => cpu.d],
      [0x1C, "E", (v) => { cpu.e = v; }, () => cpu.e],
      [0x24, "H", (v) => { cpu.h = v; }, () => cpu.h],
      [0x2C, "L", (v) => { cpu.l = v; }, () => cpu.l],
      [0x3C, "A", (v) => { cpu.a = v; }, () => cpu.a],
    ];

    for (const [opcode, name, setReg, getReg] of regOps) {
      describe(`0x${opcode.toString(16).toUpperCase().padStart(2, "0")} INC ${name}`, () => {
        test("increments register", () => {
          setReg(0x10);
          clearFlags();
          loadAt(0x200, [opcode]);
          cpu.step();
          expect(getReg()).toBe(0x11);
        });

        test("returns 4 cycles", () => {
          setReg(0x10);
          clearFlags();
          loadAt(0x200, [opcode]);
          expect(cpu.step()).toBe(4);
        });

        test("advances PC by 1", () => {
          setReg(0x10);
          loadAt(0x200, [opcode]);
          cpu.step();
          expect(cpu.pc).toBe(0x201);
        });

        test("wraps from 0xFF to 0x00", () => {
          setReg(0xFF);
          clearFlags();
          loadAt(0x200, [opcode]);
          cpu.step();
          expect(getReg()).toBe(0x00);
          expect(cpu.flagZ).toBe(true);
        });

        test("Z flag set when result is 0", () => {
          setReg(0xFF);
          clearFlags();
          loadAt(0x200, [opcode]);
          cpu.step();
          expect(cpu.flagZ).toBe(true);
        });

        test("Z flag clear when result non-zero", () => {
          setReg(0x10);
          clearFlags();
          loadAt(0x200, [opcode]);
          cpu.step();
          expect(cpu.flagZ).toBe(false);
        });

        test("N flag always 0", () => {
          setReg(0x10);
          cpu.flagN = true;
          loadAt(0x200, [opcode]);
          cpu.step();
          expect(cpu.flagN).toBe(false);
        });

        test("H flag set when carry from bit 3 (0x0F + 1)", () => {
          setReg(0x0F);
          clearFlags();
          loadAt(0x200, [opcode]);
          cpu.step();
          expect(cpu.flagH).toBe(true);
        });

        test("H flag clear when no carry from bit 3", () => {
          setReg(0x10);
          clearFlags();
          loadAt(0x200, [opcode]);
          cpu.step();
          expect(cpu.flagH).toBe(false);
        });

        test("C flag unchanged", () => {
          setReg(0xFF);
          clearFlags();
          cpu.flagC = true;
          loadAt(0x200, [opcode]);
          cpu.step();
          expect(cpu.flagC).toBe(true);
        });

        test("C flag remains clear", () => {
          setReg(0xFF);
          clearFlags();
          loadAt(0x200, [opcode]);
          cpu.step();
          expect(cpu.flagC).toBe(false);
        });
      });
    }
  });

  // ═══════════════════════════════════════════════════════════════════
  // DEC r8 - 4 cycles
  // ═══════════════════════════════════════════════════════════════════
  describe("DEC r8", () => {
    const regOps: [number, string, (v: number) => void, () => number][] = [
      [0x05, "B", (v) => { cpu.b = v; }, () => cpu.b],
      [0x0D, "C", (v) => { cpu.c = v; }, () => cpu.c],
      [0x15, "D", (v) => { cpu.d = v; }, () => cpu.d],
      [0x1D, "E", (v) => { cpu.e = v; }, () => cpu.e],
      [0x25, "H", (v) => { cpu.h = v; }, () => cpu.h],
      [0x2D, "L", (v) => { cpu.l = v; }, () => cpu.l],
      [0x3D, "A", (v) => { cpu.a = v; }, () => cpu.a],
    ];

    for (const [opcode, name, setReg, getReg] of regOps) {
      describe(`0x${opcode.toString(16).toUpperCase().padStart(2, "0")} DEC ${name}`, () => {
        test("decrements register", () => {
          setReg(0x10);
          clearFlags();
          loadAt(0x200, [opcode]);
          cpu.step();
          expect(getReg()).toBe(0x0F);
        });

        test("returns 4 cycles", () => {
          setReg(0x10);
          clearFlags();
          loadAt(0x200, [opcode]);
          expect(cpu.step()).toBe(4);
        });

        test("advances PC by 1", () => {
          setReg(0x10);
          loadAt(0x200, [opcode]);
          cpu.step();
          expect(cpu.pc).toBe(0x201);
        });

        test("wraps from 0x00 to 0xFF", () => {
          setReg(0x00);
          clearFlags();
          loadAt(0x200, [opcode]);
          cpu.step();
          expect(getReg()).toBe(0xFF);
        });

        test("Z flag set when result is 0", () => {
          setReg(0x01);
          clearFlags();
          loadAt(0x200, [opcode]);
          cpu.step();
          expect(cpu.flagZ).toBe(true);
        });

        test("Z flag clear when result non-zero", () => {
          setReg(0x10);
          clearFlags();
          loadAt(0x200, [opcode]);
          cpu.step();
          expect(cpu.flagZ).toBe(false);
        });

        test("N flag always 1", () => {
          setReg(0x10);
          clearFlags();
          loadAt(0x200, [opcode]);
          cpu.step();
          expect(cpu.flagN).toBe(true);
        });

        test("H flag set on borrow from bit 4 (0x10 - 1)", () => {
          setReg(0x10);
          clearFlags();
          loadAt(0x200, [opcode]);
          cpu.step();
          expect(cpu.flagH).toBe(true);
        });

        test("H flag clear when no borrow from bit 4", () => {
          setReg(0x0F);
          clearFlags();
          loadAt(0x200, [opcode]);
          cpu.step();
          expect(cpu.flagH).toBe(false);
        });

        test("C flag unchanged", () => {
          setReg(0x00);
          clearFlags();
          cpu.flagC = true;
          loadAt(0x200, [opcode]);
          cpu.step();
          expect(cpu.flagC).toBe(true);
        });

        test("C flag remains clear", () => {
          setReg(0x00);
          clearFlags();
          loadAt(0x200, [opcode]);
          cpu.step();
          expect(cpu.flagC).toBe(false);
        });
      });
    }
  });

  // ═══════════════════════════════════════════════════════════════════
  // INC/DEC (HL) - 12 cycles
  // ═══════════════════════════════════════════════════════════════════
  describe("INC/DEC (HL)", () => {
    describe("0x34 INC (HL)", () => {
      test("increments memory at HL", () => {
        cpu.hl = 0xC000;
        memory.writeByte(0xC000, 0x10);
        clearFlags();
        loadAt(0x200, [0x34]);
        cpu.step();
        expect(memory.readByte(0xC000)).toBe(0x11);
      });

      test("returns 12 cycles", () => {
        cpu.hl = 0xC000;
        memory.writeByte(0xC000, 0x10);
        clearFlags();
        loadAt(0x200, [0x34]);
        expect(cpu.step()).toBe(12);
      });

      test("advances PC by 1", () => {
        cpu.hl = 0xC000;
        memory.writeByte(0xC000, 0x10);
        loadAt(0x200, [0x34]);
        cpu.step();
        expect(cpu.pc).toBe(0x201);
      });

      test("wraps from 0xFF to 0x00", () => {
        cpu.hl = 0xC000;
        memory.writeByte(0xC000, 0xFF);
        clearFlags();
        loadAt(0x200, [0x34]);
        cpu.step();
        expect(memory.readByte(0xC000)).toBe(0x00);
        expect(cpu.flagZ).toBe(true);
      });

      test("H flag set on carry from bit 3", () => {
        cpu.hl = 0xC000;
        memory.writeByte(0xC000, 0x0F);
        clearFlags();
        loadAt(0x200, [0x34]);
        cpu.step();
        expect(cpu.flagH).toBe(true);
      });

      test("N flag always 0", () => {
        cpu.hl = 0xC000;
        memory.writeByte(0xC000, 0x10);
        cpu.flagN = true;
        loadAt(0x200, [0x34]);
        cpu.step();
        expect(cpu.flagN).toBe(false);
      });

      test("C flag unchanged", () => {
        cpu.hl = 0xC000;
        memory.writeByte(0xC000, 0xFF);
        clearFlags();
        cpu.flagC = true;
        loadAt(0x200, [0x34]);
        cpu.step();
        expect(cpu.flagC).toBe(true);
      });
    });

    describe("0x35 DEC (HL)", () => {
      test("decrements memory at HL", () => {
        cpu.hl = 0xC000;
        memory.writeByte(0xC000, 0x10);
        clearFlags();
        loadAt(0x200, [0x35]);
        cpu.step();
        expect(memory.readByte(0xC000)).toBe(0x0F);
      });

      test("returns 12 cycles", () => {
        cpu.hl = 0xC000;
        memory.writeByte(0xC000, 0x10);
        clearFlags();
        loadAt(0x200, [0x35]);
        expect(cpu.step()).toBe(12);
      });

      test("advances PC by 1", () => {
        cpu.hl = 0xC000;
        memory.writeByte(0xC000, 0x10);
        loadAt(0x200, [0x35]);
        cpu.step();
        expect(cpu.pc).toBe(0x201);
      });

      test("wraps from 0x00 to 0xFF", () => {
        cpu.hl = 0xC000;
        memory.writeByte(0xC000, 0x00);
        clearFlags();
        loadAt(0x200, [0x35]);
        cpu.step();
        expect(memory.readByte(0xC000)).toBe(0xFF);
      });

      test("Z flag set when result is 0", () => {
        cpu.hl = 0xC000;
        memory.writeByte(0xC000, 0x01);
        clearFlags();
        loadAt(0x200, [0x35]);
        cpu.step();
        expect(cpu.flagZ).toBe(true);
      });

      test("N flag always 1", () => {
        cpu.hl = 0xC000;
        memory.writeByte(0xC000, 0x10);
        clearFlags();
        loadAt(0x200, [0x35]);
        cpu.step();
        expect(cpu.flagN).toBe(true);
      });

      test("H flag set on borrow from bit 4", () => {
        cpu.hl = 0xC000;
        memory.writeByte(0xC000, 0x10);
        clearFlags();
        loadAt(0x200, [0x35]);
        cpu.step();
        expect(cpu.flagH).toBe(true);
      });

      test("C flag unchanged", () => {
        cpu.hl = 0xC000;
        memory.writeByte(0xC000, 0x00);
        clearFlags();
        cpu.flagC = true;
        loadAt(0x200, [0x35]);
        cpu.step();
        expect(cpu.flagC).toBe(true);
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // INC/DEC r16 - 8 cycles, no flag changes
  // ═══════════════════════════════════════════════════════════════════
  describe("INC r16", () => {
    const ops: [number, string, (v: number) => void, () => number][] = [
      [0x03, "BC", (v) => { cpu.bc = v; }, () => cpu.bc],
      [0x13, "DE", (v) => { cpu.de = v; }, () => cpu.de],
      [0x23, "HL", (v) => { cpu.hl = v; }, () => cpu.hl],
      [0x33, "SP", (v) => { cpu.sp = v; }, () => cpu.sp],
    ];

    for (const [opcode, name, setReg, getReg] of ops) {
      describe(`0x${opcode.toString(16).toUpperCase().padStart(2, "0")} INC ${name}`, () => {
        test("increments register pair", () => {
          setReg(0x1234);
          clearFlags();
          loadAt(0x200, [opcode]);
          cpu.step();
          expect(getReg()).toBe(0x1235);
        });

        test("wraps from 0xFFFF to 0x0000", () => {
          setReg(0xFFFF);
          clearFlags();
          loadAt(0x200, [opcode]);
          cpu.step();
          expect(getReg()).toBe(0x0000);
        });

        test("returns 8 cycles", () => {
          setReg(0x1234);
          clearFlags();
          loadAt(0x200, [opcode]);
          expect(cpu.step()).toBe(8);
        });

        test("advances PC by 1", () => {
          setReg(0x1234);
          loadAt(0x200, [opcode]);
          cpu.step();
          expect(cpu.pc).toBe(0x201);
        });

        test("does not change flags", () => {
          setReg(0xFFFF);
          cpu.f = 0xF0;
          loadAt(0x200, [opcode]);
          cpu.step();
          expect(cpu.f).toBe(0xF0);
        });
      });
    }
  });

  describe("DEC r16", () => {
    const ops: [number, string, (v: number) => void, () => number][] = [
      [0x0B, "BC", (v) => { cpu.bc = v; }, () => cpu.bc],
      [0x1B, "DE", (v) => { cpu.de = v; }, () => cpu.de],
      [0x2B, "HL", (v) => { cpu.hl = v; }, () => cpu.hl],
      [0x3B, "SP", (v) => { cpu.sp = v; }, () => cpu.sp],
    ];

    for (const [opcode, name, setReg, getReg] of ops) {
      describe(`0x${opcode.toString(16).toUpperCase().padStart(2, "0")} DEC ${name}`, () => {
        test("decrements register pair", () => {
          setReg(0x1234);
          clearFlags();
          loadAt(0x200, [opcode]);
          cpu.step();
          expect(getReg()).toBe(0x1233);
        });

        test("wraps from 0x0000 to 0xFFFF", () => {
          setReg(0x0000);
          clearFlags();
          loadAt(0x200, [opcode]);
          cpu.step();
          expect(getReg()).toBe(0xFFFF);
        });

        test("returns 8 cycles", () => {
          setReg(0x1234);
          clearFlags();
          loadAt(0x200, [opcode]);
          expect(cpu.step()).toBe(8);
        });

        test("advances PC by 1", () => {
          setReg(0x1234);
          loadAt(0x200, [opcode]);
          cpu.step();
          expect(cpu.pc).toBe(0x201);
        });

        test("does not change flags", () => {
          setReg(0x0000);
          cpu.f = 0xF0;
          loadAt(0x200, [opcode]);
          cpu.step();
          expect(cpu.f).toBe(0xF0);
        });
      });
    }
  });

  // ═══════════════════════════════════════════════════════════════════
  // ADD HL, r16 - 8 cycles
  // ═══════════════════════════════════════════════════════════════════
  describe("ADD HL, r16", () => {
    describe("0x09 ADD HL,BC", () => {
      test("correct result", () => {
        cpu.hl = 0x1000;
        cpu.bc = 0x0234;
        clearFlags();
        loadAt(0x200, [0x09]);
        cpu.step();
        expect(cpu.hl).toBe(0x1234);
      });

      test("returns 8 cycles", () => {
        cpu.hl = 0x1000;
        cpu.bc = 0x0234;
        clearFlags();
        loadAt(0x200, [0x09]);
        expect(cpu.step()).toBe(8);
      });

      test("advances PC by 1", () => {
        cpu.hl = 0x1000;
        cpu.bc = 0x0234;
        loadAt(0x200, [0x09]);
        cpu.step();
        expect(cpu.pc).toBe(0x201);
      });
    });

    describe("0x19 ADD HL,DE", () => {
      test("correct result", () => {
        cpu.hl = 0x1000;
        cpu.de = 0x0500;
        clearFlags();
        loadAt(0x200, [0x19]);
        cpu.step();
        expect(cpu.hl).toBe(0x1500);
      });

      test("returns 8 cycles", () => {
        cpu.hl = 0x1000;
        cpu.de = 0x0500;
        clearFlags();
        loadAt(0x200, [0x19]);
        expect(cpu.step()).toBe(8);
      });
    });

    describe("0x29 ADD HL,HL", () => {
      test("correct result (doubles HL)", () => {
        cpu.hl = 0x1000;
        clearFlags();
        loadAt(0x200, [0x29]);
        cpu.step();
        expect(cpu.hl).toBe(0x2000);
      });

      test("returns 8 cycles", () => {
        cpu.hl = 0x1000;
        clearFlags();
        loadAt(0x200, [0x29]);
        expect(cpu.step()).toBe(8);
      });
    });

    describe("0x39 ADD HL,SP", () => {
      test("correct result", () => {
        cpu.hl = 0x1000;
        cpu.sp = 0x0100;
        clearFlags();
        loadAt(0x200, [0x39]);
        cpu.step();
        expect(cpu.hl).toBe(0x1100);
      });

      test("returns 8 cycles", () => {
        cpu.hl = 0x1000;
        cpu.sp = 0x0100;
        clearFlags();
        loadAt(0x200, [0x39]);
        expect(cpu.step()).toBe(8);
      });
    });

    describe("flags", () => {
      test("Z flag unchanged", () => {
        cpu.hl = 0x1000;
        cpu.bc = 0x0234;
        cpu.flagZ = true;
        cpu.flagN = false;
        cpu.flagH = false;
        cpu.flagC = false;
        loadAt(0x200, [0x09]);
        cpu.step();
        expect(cpu.flagZ).toBe(true);
      });

      test("Z flag unchanged (stays false)", () => {
        cpu.hl = 0x1000;
        cpu.bc = 0x0234;
        clearFlags();
        loadAt(0x200, [0x09]);
        cpu.step();
        expect(cpu.flagZ).toBe(false);
      });

      test("N flag always 0", () => {
        cpu.hl = 0x1000;
        cpu.bc = 0x0234;
        cpu.flagN = true;
        loadAt(0x200, [0x09]);
        cpu.step();
        expect(cpu.flagN).toBe(false);
      });

      test("H flag set on carry from bit 11", () => {
        cpu.hl = 0x0FFF;
        cpu.bc = 0x0001;
        clearFlags();
        loadAt(0x200, [0x09]);
        cpu.step();
        expect(cpu.flagH).toBe(true);
      });

      test("H flag clear when no carry from bit 11", () => {
        cpu.hl = 0x1000;
        cpu.bc = 0x0001;
        clearFlags();
        loadAt(0x200, [0x09]);
        cpu.step();
        expect(cpu.flagH).toBe(false);
      });

      test("C flag set on overflow from bit 15", () => {
        cpu.hl = 0xFFFF;
        cpu.bc = 0x0001;
        clearFlags();
        loadAt(0x200, [0x09]);
        cpu.step();
        expect(cpu.flagC).toBe(true);
      });

      test("C flag clear when no overflow", () => {
        cpu.hl = 0x1000;
        cpu.bc = 0x0234;
        clearFlags();
        loadAt(0x200, [0x09]);
        cpu.step();
        expect(cpu.flagC).toBe(false);
      });

      test("H and C both set (0x8FFF + 0x8001)", () => {
        cpu.hl = 0x8FFF;
        cpu.bc = 0x8001;
        clearFlags();
        loadAt(0x200, [0x09]);
        cpu.step();
        expect(cpu.hl).toBe(0x1000);
        expect(cpu.flagH).toBe(true);
        expect(cpu.flagC).toBe(true);
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // DAA - 4 cycles
  // ═══════════════════════════════════════════════════════════════════
  describe("0x27 DAA", () => {
    test("returns 4 cycles", () => {
      cpu.a = 0x00;
      clearFlags();
      loadAt(0x200, [0x27]);
      expect(cpu.step()).toBe(4);
    });

    test("advances PC by 1", () => {
      cpu.a = 0x00;
      clearFlags();
      loadAt(0x200, [0x27]);
      cpu.step();
      expect(cpu.pc).toBe(0x201);
    });

    test("after addition: BCD adjust 0x0A -> 0x10", () => {
      // Simulate: 5 + 5 = 0x0A in binary, DAA should correct to 0x10
      cpu.a = 0x0A;
      clearFlags(); // N=0 means after addition
      loadAt(0x200, [0x27]);
      cpu.step();
      expect(cpu.a).toBe(0x10);
      expect(cpu.flagZ).toBe(false);
    });

    test("after addition: 0x9A -> 0x00 with carry", () => {
      cpu.a = 0x9A;
      clearFlags();
      loadAt(0x200, [0x27]);
      cpu.step();
      expect(cpu.a).toBe(0x00);
      expect(cpu.flagC).toBe(true);
      expect(cpu.flagZ).toBe(true);
    });

    test("after addition: H flag triggers +0x06", () => {
      cpu.a = 0x12; // low nibble is fine but H flag says there was half-carry
      clearFlags();
      cpu.flagH = true;
      loadAt(0x200, [0x27]);
      cpu.step();
      expect(cpu.a).toBe(0x18);
    });

    test("after addition: C flag triggers +0x60", () => {
      cpu.a = 0x30;
      clearFlags();
      cpu.flagC = true;
      loadAt(0x200, [0x27]);
      cpu.step();
      expect(cpu.a).toBe(0x90);
      expect(cpu.flagC).toBe(true);
    });

    test("after addition: A > 0x99 triggers +0x60 and sets C", () => {
      cpu.a = 0xA0;
      clearFlags();
      loadAt(0x200, [0x27]);
      cpu.step();
      expect(cpu.a).toBe(0x00);
      expect(cpu.flagC).toBe(true);
      expect(cpu.flagZ).toBe(true);
    });

    test("after subtraction: H flag triggers -0x06", () => {
      cpu.a = 0x0A;
      clearFlags();
      cpu.flagN = true;
      cpu.flagH = true;
      loadAt(0x200, [0x27]);
      cpu.step();
      expect(cpu.a).toBe(0x04);
    });

    test("after subtraction: C flag triggers -0x60", () => {
      cpu.a = 0xA0;
      clearFlags();
      cpu.flagN = true;
      cpu.flagC = true;
      loadAt(0x200, [0x27]);
      cpu.step();
      expect(cpu.a).toBe(0x40);
      expect(cpu.flagC).toBe(true);
    });

    test("H flag always cleared", () => {
      cpu.a = 0x00;
      clearFlags();
      cpu.flagH = true;
      loadAt(0x200, [0x27]);
      cpu.step();
      expect(cpu.flagH).toBe(false);
    });

    test("N flag unchanged", () => {
      cpu.a = 0x00;
      clearFlags();
      cpu.flagN = true;
      loadAt(0x200, [0x27]);
      cpu.step();
      expect(cpu.flagN).toBe(true);
    });

    test("full BCD addition: 15 + 27 = 42", () => {
      // 0x15 + 0x27 = 0x3C, DAA should give 0x42
      cpu.a = 0x3C;
      clearFlags();
      loadAt(0x200, [0x27]);
      cpu.step();
      expect(cpu.a).toBe(0x42);
    });

    test("full BCD addition: 99 + 01 = 100 (carry)", () => {
      // 0x99 + 0x01 = 0x9A, DAA should give 0x00 + carry
      cpu.a = 0x9A;
      clearFlags();
      loadAt(0x200, [0x27]);
      cpu.step();
      expect(cpu.a).toBe(0x00);
      expect(cpu.flagC).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // CPL - 4 cycles
  // ═══════════════════════════════════════════════════════════════════
  describe("0x2F CPL", () => {
    test("complements A", () => {
      cpu.a = 0xF0;
      clearFlags();
      loadAt(0x200, [0x2F]);
      cpu.step();
      expect(cpu.a).toBe(0x0F);
    });

    test("returns 4 cycles", () => {
      cpu.a = 0xF0;
      clearFlags();
      loadAt(0x200, [0x2F]);
      expect(cpu.step()).toBe(4);
    });

    test("advances PC by 1", () => {
      cpu.a = 0xF0;
      loadAt(0x200, [0x2F]);
      cpu.step();
      expect(cpu.pc).toBe(0x201);
    });

    test("N flag set to 1", () => {
      cpu.a = 0xF0;
      clearFlags();
      loadAt(0x200, [0x2F]);
      cpu.step();
      expect(cpu.flagN).toBe(true);
    });

    test("H flag set to 1", () => {
      cpu.a = 0xF0;
      clearFlags();
      loadAt(0x200, [0x2F]);
      cpu.step();
      expect(cpu.flagH).toBe(true);
    });

    test("Z flag unchanged", () => {
      cpu.a = 0xFF;
      cpu.flagZ = true;
      cpu.flagN = false;
      cpu.flagH = false;
      cpu.flagC = false;
      loadAt(0x200, [0x2F]);
      cpu.step();
      expect(cpu.flagZ).toBe(true);
    });

    test("C flag unchanged", () => {
      cpu.a = 0xFF;
      clearFlags();
      cpu.flagC = true;
      loadAt(0x200, [0x2F]);
      cpu.step();
      expect(cpu.flagC).toBe(true);
    });

    test("complement of 0x00 is 0xFF", () => {
      cpu.a = 0x00;
      clearFlags();
      loadAt(0x200, [0x2F]);
      cpu.step();
      expect(cpu.a).toBe(0xFF);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // SCF - 4 cycles
  // ═══════════════════════════════════════════════════════════════════
  describe("0x37 SCF", () => {
    test("sets carry flag", () => {
      clearFlags();
      loadAt(0x200, [0x37]);
      cpu.step();
      expect(cpu.flagC).toBe(true);
    });

    test("returns 4 cycles", () => {
      clearFlags();
      loadAt(0x200, [0x37]);
      expect(cpu.step()).toBe(4);
    });

    test("advances PC by 1", () => {
      loadAt(0x200, [0x37]);
      cpu.step();
      expect(cpu.pc).toBe(0x201);
    });

    test("N flag cleared", () => {
      cpu.flagN = true;
      loadAt(0x200, [0x37]);
      cpu.step();
      expect(cpu.flagN).toBe(false);
    });

    test("H flag cleared", () => {
      cpu.flagH = true;
      loadAt(0x200, [0x37]);
      cpu.step();
      expect(cpu.flagH).toBe(false);
    });

    test("Z flag unchanged", () => {
      cpu.flagZ = true;
      cpu.flagN = true;
      cpu.flagH = true;
      cpu.flagC = false;
      loadAt(0x200, [0x37]);
      cpu.step();
      expect(cpu.flagZ).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // CCF - 4 cycles
  // ═══════════════════════════════════════════════════════════════════
  describe("0x3F CCF", () => {
    test("flips carry flag (0 -> 1)", () => {
      clearFlags();
      loadAt(0x200, [0x3F]);
      cpu.step();
      expect(cpu.flagC).toBe(true);
    });

    test("flips carry flag (1 -> 0)", () => {
      clearFlags();
      cpu.flagC = true;
      loadAt(0x200, [0x3F]);
      cpu.step();
      expect(cpu.flagC).toBe(false);
    });

    test("returns 4 cycles", () => {
      clearFlags();
      loadAt(0x200, [0x3F]);
      expect(cpu.step()).toBe(4);
    });

    test("advances PC by 1", () => {
      loadAt(0x200, [0x3F]);
      cpu.step();
      expect(cpu.pc).toBe(0x201);
    });

    test("N flag cleared", () => {
      cpu.flagN = true;
      loadAt(0x200, [0x3F]);
      cpu.step();
      expect(cpu.flagN).toBe(false);
    });

    test("H flag cleared", () => {
      cpu.flagH = true;
      loadAt(0x200, [0x3F]);
      cpu.step();
      expect(cpu.flagH).toBe(false);
    });

    test("Z flag unchanged", () => {
      cpu.flagZ = true;
      cpu.flagN = true;
      cpu.flagH = true;
      cpu.flagC = true;
      loadAt(0x200, [0x3F]);
      cpu.step();
      expect(cpu.flagZ).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // RLCA (0x07) / RLA (0x17) / RRCA (0x0F) / RRA (0x1F) - 4 cycles
  // These ALWAYS clear Z, unlike CB-prefix rotates which set Z on zero.
  // ═══════════════════════════════════════════════════════════════════

  describe("0x07 RLCA", () => {
    test("rotates A left, old bit 7 to carry and bit 0", () => {
      cpu.a = 0x85; // 1000_0101
      clearFlags();
      loadAt(0x200, [0x07]);
      cpu.step();
      expect(cpu.a).toBe(0x0B); // 0000_1011
      expect(cpu.flagC).toBe(true);
    });

    test("Z flag is ALWAYS cleared (even when result is 0)", () => {
      cpu.a = 0x00;
      cpu.flagZ = true;
      loadAt(0x200, [0x07]);
      cpu.step();
      expect(cpu.a).toBe(0x00);
      expect(cpu.flagZ).toBe(false);
      expect(cpu.flagC).toBe(false);
    });

    test("N and H flags cleared", () => {
      cpu.a = 0x80;
      cpu.flagN = true;
      cpu.flagH = true;
      loadAt(0x200, [0x07]);
      cpu.step();
      expect(cpu.flagN).toBe(false);
      expect(cpu.flagH).toBe(false);
    });

    test("returns 4 cycles and advances PC by 1", () => {
      cpu.a = 0x01;
      loadAt(0x200, [0x07]);
      expect(cpu.step()).toBe(4);
      expect(cpu.pc).toBe(0x201);
    });
  });

  describe("0x17 RLA", () => {
    test("rotates A left through carry", () => {
      cpu.a = 0x80;
      clearFlags();
      cpu.flagC = true;
      loadAt(0x200, [0x17]);
      cpu.step();
      expect(cpu.a).toBe(0x01); // old carry goes to bit 0
      expect(cpu.flagC).toBe(true); // old bit 7 goes to carry
    });

    test("Z flag is ALWAYS cleared (even when result is 0)", () => {
      cpu.a = 0x00;
      cpu.flagZ = true;
      cpu.flagC = false;
      loadAt(0x200, [0x17]);
      cpu.step();
      expect(cpu.a).toBe(0x00);
      expect(cpu.flagZ).toBe(false);
      expect(cpu.flagC).toBe(false);
    });

    test("N and H flags cleared", () => {
      cpu.a = 0x01;
      cpu.flagN = true;
      cpu.flagH = true;
      cpu.flagC = false;
      loadAt(0x200, [0x17]);
      cpu.step();
      expect(cpu.flagN).toBe(false);
      expect(cpu.flagH).toBe(false);
    });

    test("returns 4 cycles", () => {
      cpu.a = 0x01;
      loadAt(0x200, [0x17]);
      expect(cpu.step()).toBe(4);
    });
  });

  describe("0x0F RRCA", () => {
    test("rotates A right, old bit 0 to carry and bit 7", () => {
      cpu.a = 0x01;
      clearFlags();
      loadAt(0x200, [0x0F]);
      cpu.step();
      expect(cpu.a).toBe(0x80);
      expect(cpu.flagC).toBe(true);
    });

    test("Z flag is ALWAYS cleared (even when result is 0)", () => {
      cpu.a = 0x00;
      cpu.flagZ = true;
      loadAt(0x200, [0x0F]);
      cpu.step();
      expect(cpu.a).toBe(0x00);
      expect(cpu.flagZ).toBe(false);
      expect(cpu.flagC).toBe(false);
    });

    test("N and H flags cleared", () => {
      cpu.a = 0x01;
      cpu.flagN = true;
      cpu.flagH = true;
      loadAt(0x200, [0x0F]);
      cpu.step();
      expect(cpu.flagN).toBe(false);
      expect(cpu.flagH).toBe(false);
    });

    test("returns 4 cycles", () => {
      cpu.a = 0x01;
      loadAt(0x200, [0x0F]);
      expect(cpu.step()).toBe(4);
    });
  });

  describe("0x1F RRA", () => {
    test("rotates A right through carry", () => {
      cpu.a = 0x01;
      clearFlags();
      cpu.flagC = true;
      loadAt(0x200, [0x1F]);
      cpu.step();
      expect(cpu.a).toBe(0x80); // old carry goes to bit 7
      expect(cpu.flagC).toBe(true); // old bit 0 goes to carry
    });

    test("Z flag is ALWAYS cleared (even when result is 0)", () => {
      cpu.a = 0x00;
      cpu.flagZ = true;
      cpu.flagC = false;
      loadAt(0x200, [0x1F]);
      cpu.step();
      expect(cpu.a).toBe(0x00);
      expect(cpu.flagZ).toBe(false);
      expect(cpu.flagC).toBe(false);
    });

    test("N and H flags cleared", () => {
      cpu.a = 0x01;
      cpu.flagN = true;
      cpu.flagH = true;
      cpu.flagC = false;
      loadAt(0x200, [0x1F]);
      cpu.step();
      expect(cpu.flagN).toBe(false);
      expect(cpu.flagH).toBe(false);
    });

    test("returns 4 cycles", () => {
      cpu.a = 0x01;
      loadAt(0x200, [0x1F]);
      expect(cpu.step()).toBe(4);
    });
  });
});
