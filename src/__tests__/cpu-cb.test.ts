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

describe("CB-prefixed opcodes", () => {
  let memory: MockMemory;
  let cpu: CPU;

  const BASE = 0x0200;

  beforeEach(() => {
    memory = new MockMemory();
    cpu = new CPU(memory);
    cpu.f = 0x00;
  });

  function loadCB(cbOpcode: number) {
    cpu.pc = BASE;
    memory.load(BASE, [0xcb, cbOpcode]);
  }

  // ─── RLC (0x00-0x07) ──────────────────────────────────────────────

  describe("RLC", () => {
    test("RLC B - rotates left, bit 7 to carry and bit 0", () => {
      cpu.b = 0x85; // 1000_0101
      loadCB(0x00);
      const cycles = cpu.step();
      // Rotate left: bit7=1 goes to carry and bit0
      // 0x85 << 1 = 0x0A | old_bit7(1) = 0x0B
      expect(cpu.b).toBe(0x0b);
      expect(cpu.flagC).toBe(true);
      expect(cpu.flagZ).toBe(false);
      expect(cpu.flagN).toBe(false);
      expect(cpu.flagH).toBe(false);
      expect(cycles).toBe(8);
    });

    test("RLC A - rotates left", () => {
      cpu.a = 0x01; // 0000_0001
      loadCB(0x07);
      const cycles = cpu.step();
      // 0x01 << 1 = 0x02, old bit7=0 -> carry=0, bit0=0
      expect(cpu.a).toBe(0x02);
      expect(cpu.flagC).toBe(false);
      expect(cpu.flagZ).toBe(false);
      expect(cycles).toBe(8);
    });

    test("RLC (HL) - memory target", () => {
      cpu.hl = 0xC000;
      memory.writeByte(0xC000, 0x80); // 1000_0000
      loadCB(0x06);
      const cycles = cpu.step();
      // 0x80 << 1 = 0x00 | old_bit7(1) = 0x01
      expect(memory.readByte(0xC000)).toBe(0x01);
      expect(cpu.flagC).toBe(true);
      expect(cpu.flagZ).toBe(false);
      expect(cycles).toBe(16);
    });

    test("RLC B - result 0 sets Z flag", () => {
      cpu.b = 0x00;
      loadCB(0x00);
      cpu.step();
      expect(cpu.b).toBe(0x00);
      expect(cpu.flagZ).toBe(true);
      expect(cpu.flagC).toBe(false);
    });

    test("RLC B - 0xFF rotates to 0xFF with carry", () => {
      cpu.b = 0xff;
      loadCB(0x00);
      cpu.step();
      expect(cpu.b).toBe(0xff);
      expect(cpu.flagC).toBe(true);
      expect(cpu.flagZ).toBe(false);
    });

    test("RLC advances PC by 2", () => {
      cpu.b = 0x01;
      loadCB(0x00);
      cpu.step();
      expect(cpu.pc).toBe(BASE + 2);
    });
  });

  // ─── RRC (0x08-0x0F) ──────────────────────────────────────────────

  describe("RRC", () => {
    test("RRC B - rotates right, bit 0 to carry and bit 7", () => {
      cpu.b = 0x01; // 0000_0001
      loadCB(0x08);
      const cycles = cpu.step();
      // Rotate right: bit0=1 goes to carry and bit7
      // 0x01 >> 1 = 0x00 | (1 << 7) = 0x80
      expect(cpu.b).toBe(0x80);
      expect(cpu.flagC).toBe(true);
      expect(cpu.flagZ).toBe(false);
      expect(cpu.flagN).toBe(false);
      expect(cpu.flagH).toBe(false);
      expect(cycles).toBe(8);
    });

    test("RRC A - rotates right", () => {
      cpu.a = 0x02; // 0000_0010
      loadCB(0x0f);
      const cycles = cpu.step();
      // 0x02 >> 1 = 0x01, old bit0=0 -> carry=0
      expect(cpu.a).toBe(0x01);
      expect(cpu.flagC).toBe(false);
      expect(cpu.flagZ).toBe(false);
      expect(cycles).toBe(8);
    });

    test("RRC (HL) - memory target", () => {
      cpu.hl = 0xC000;
      memory.writeByte(0xC000, 0x81); // 1000_0001
      loadCB(0x0e);
      const cycles = cpu.step();
      // 0x81 >> 1 = 0x40 | (1 << 7) = 0xC0
      expect(memory.readByte(0xC000)).toBe(0xc0);
      expect(cpu.flagC).toBe(true);
      expect(cpu.flagZ).toBe(false);
      expect(cycles).toBe(16);
    });

    test("RRC B - result 0 sets Z flag", () => {
      cpu.b = 0x00;
      loadCB(0x08);
      cpu.step();
      expect(cpu.b).toBe(0x00);
      expect(cpu.flagZ).toBe(true);
      expect(cpu.flagC).toBe(false);
    });

    test("RRC B - 0xFF stays 0xFF with carry", () => {
      cpu.b = 0xff;
      loadCB(0x08);
      cpu.step();
      expect(cpu.b).toBe(0xff);
      expect(cpu.flagC).toBe(true);
      expect(cpu.flagZ).toBe(false);
    });

    test("RRC advances PC by 2", () => {
      cpu.b = 0x01;
      loadCB(0x08);
      cpu.step();
      expect(cpu.pc).toBe(BASE + 2);
    });
  });

  // ─── RL (0x10-0x17) ───────────────────────────────────────────────

  describe("RL", () => {
    test("RL B - rotates left through carry (carry=0)", () => {
      cpu.b = 0x80; // 1000_0000
      cpu.flagC = false;
      loadCB(0x10);
      const cycles = cpu.step();
      // old bit7=1 -> new carry=1
      // result = (0x80 << 1) | old_carry(0) = 0x00
      expect(cpu.b).toBe(0x00);
      expect(cpu.flagC).toBe(true);
      expect(cpu.flagZ).toBe(true);
      expect(cpu.flagN).toBe(false);
      expect(cpu.flagH).toBe(false);
      expect(cycles).toBe(8);
    });

    test("RL B - rotates left through carry (carry=1)", () => {
      cpu.b = 0x80; // 1000_0000
      cpu.flagC = true;
      loadCB(0x10);
      cpu.step();
      // result = (0x80 << 1) | old_carry(1) = 0x01
      expect(cpu.b).toBe(0x01);
      expect(cpu.flagC).toBe(true);
      expect(cpu.flagZ).toBe(false);
    });

    test("RL A - rotates left through carry", () => {
      cpu.a = 0x01;
      cpu.flagC = true;
      loadCB(0x17);
      const cycles = cpu.step();
      // result = (0x01 << 1) | 1 = 0x03, old bit7=0 -> carry=0
      expect(cpu.a).toBe(0x03);
      expect(cpu.flagC).toBe(false);
      expect(cpu.flagZ).toBe(false);
      expect(cycles).toBe(8);
    });

    test("RL (HL) - memory target", () => {
      cpu.hl = 0xC000;
      memory.writeByte(0xC000, 0x40); // 0100_0000
      cpu.flagC = true;
      loadCB(0x16);
      const cycles = cpu.step();
      // result = (0x40 << 1) | 1 = 0x81, old bit7=0 -> carry=0
      expect(memory.readByte(0xC000)).toBe(0x81);
      expect(cpu.flagC).toBe(false);
      expect(cpu.flagZ).toBe(false);
      expect(cycles).toBe(16);
    });

    test("RL B - 0x00 with carry=0 gives Z flag", () => {
      cpu.b = 0x00;
      cpu.flagC = false;
      loadCB(0x10);
      cpu.step();
      expect(cpu.b).toBe(0x00);
      expect(cpu.flagZ).toBe(true);
      expect(cpu.flagC).toBe(false);
    });

    test("RL advances PC by 2", () => {
      cpu.b = 0x01;
      loadCB(0x10);
      cpu.step();
      expect(cpu.pc).toBe(BASE + 2);
    });
  });

  // ─── RR (0x18-0x1F) ───────────────────────────────────────────────

  describe("RR", () => {
    test("RR B - rotates right through carry (carry=0)", () => {
      cpu.b = 0x01; // 0000_0001
      cpu.flagC = false;
      loadCB(0x18);
      const cycles = cpu.step();
      // old bit0=1 -> new carry=1
      // result = (0x01 >> 1) | (old_carry(0) << 7) = 0x00
      expect(cpu.b).toBe(0x00);
      expect(cpu.flagC).toBe(true);
      expect(cpu.flagZ).toBe(true);
      expect(cpu.flagN).toBe(false);
      expect(cpu.flagH).toBe(false);
      expect(cycles).toBe(8);
    });

    test("RR B - rotates right through carry (carry=1)", () => {
      cpu.b = 0x01; // 0000_0001
      cpu.flagC = true;
      loadCB(0x18);
      cpu.step();
      // result = (0x01 >> 1) | (1 << 7) = 0x80
      expect(cpu.b).toBe(0x80);
      expect(cpu.flagC).toBe(true);
      expect(cpu.flagZ).toBe(false);
    });

    test("RR A - rotates right through carry", () => {
      cpu.a = 0x02;
      cpu.flagC = false;
      loadCB(0x1f);
      const cycles = cpu.step();
      // result = (0x02 >> 1) | (0 << 7) = 0x01, old bit0=0 -> carry=0
      expect(cpu.a).toBe(0x01);
      expect(cpu.flagC).toBe(false);
      expect(cpu.flagZ).toBe(false);
      expect(cycles).toBe(8);
    });

    test("RR (HL) - memory target", () => {
      cpu.hl = 0xC000;
      memory.writeByte(0xC000, 0x8A); // 1000_1010
      cpu.flagC = false;
      loadCB(0x1e);
      const cycles = cpu.step();
      // result = (0x8A >> 1) | (0 << 7) = 0x45, old bit0=0 -> carry=0
      expect(memory.readByte(0xC000)).toBe(0x45);
      expect(cpu.flagC).toBe(false);
      expect(cpu.flagZ).toBe(false);
      expect(cycles).toBe(16);
    });

    test("RR B - 0x00 with carry=0 gives Z flag", () => {
      cpu.b = 0x00;
      cpu.flagC = false;
      loadCB(0x18);
      cpu.step();
      expect(cpu.b).toBe(0x00);
      expect(cpu.flagZ).toBe(true);
      expect(cpu.flagC).toBe(false);
    });

    test("RR advances PC by 2", () => {
      cpu.b = 0x01;
      loadCB(0x18);
      cpu.step();
      expect(cpu.pc).toBe(BASE + 2);
    });
  });

  // ─── SLA (0x20-0x27) ──────────────────────────────────────────────

  describe("SLA", () => {
    test("SLA B - shift left arithmetic, bit 0 = 0", () => {
      cpu.b = 0x85; // 1000_0101
      loadCB(0x20);
      const cycles = cpu.step();
      // result = (0x85 << 1) & 0xFF = 0x0A, old bit7=1 -> carry=1
      expect(cpu.b).toBe(0x0a);
      expect(cpu.flagC).toBe(true);
      expect(cpu.flagZ).toBe(false);
      expect(cpu.flagN).toBe(false);
      expect(cpu.flagH).toBe(false);
      expect(cycles).toBe(8);
    });

    test("SLA A - shift left arithmetic", () => {
      cpu.a = 0x01;
      loadCB(0x27);
      const cycles = cpu.step();
      expect(cpu.a).toBe(0x02);
      expect(cpu.flagC).toBe(false);
      expect(cpu.flagZ).toBe(false);
      expect(cycles).toBe(8);
    });

    test("SLA (HL) - memory target", () => {
      cpu.hl = 0xC000;
      memory.writeByte(0xC000, 0xC0); // 1100_0000
      loadCB(0x26);
      const cycles = cpu.step();
      // 0xC0 << 1 = 0x80, carry=1
      expect(memory.readByte(0xC000)).toBe(0x80);
      expect(cpu.flagC).toBe(true);
      expect(cpu.flagZ).toBe(false);
      expect(cycles).toBe(16);
    });

    test("SLA B - 0x80 becomes 0x00 with carry and Z", () => {
      cpu.b = 0x80;
      loadCB(0x20);
      cpu.step();
      expect(cpu.b).toBe(0x00);
      expect(cpu.flagZ).toBe(true);
      expect(cpu.flagC).toBe(true);
    });

    test("SLA B - 0x00 gives Z flag, carry=0", () => {
      cpu.b = 0x00;
      loadCB(0x20);
      cpu.step();
      expect(cpu.b).toBe(0x00);
      expect(cpu.flagZ).toBe(true);
      expect(cpu.flagC).toBe(false);
    });

    test("SLA advances PC by 2", () => {
      cpu.b = 0x01;
      loadCB(0x20);
      cpu.step();
      expect(cpu.pc).toBe(BASE + 2);
    });
  });

  // ─── SRA (0x28-0x2F) ──────────────────────────────────────────────

  describe("SRA", () => {
    test("SRA B - shift right arithmetic, bit 7 unchanged", () => {
      cpu.b = 0x8A; // 1000_1010
      loadCB(0x28);
      const cycles = cpu.step();
      // bit7 preserved: result = 0xC5, old bit0=0 -> carry=0
      expect(cpu.b).toBe(0xc5);
      expect(cpu.flagC).toBe(false);
      expect(cpu.flagZ).toBe(false);
      expect(cpu.flagN).toBe(false);
      expect(cpu.flagH).toBe(false);
      expect(cycles).toBe(8);
    });

    test("SRA A - shift right arithmetic", () => {
      cpu.a = 0x01; // 0000_0001
      loadCB(0x2f);
      const cycles = cpu.step();
      // result = 0x00, old bit0=1 -> carry=1
      expect(cpu.a).toBe(0x00);
      expect(cpu.flagC).toBe(true);
      expect(cpu.flagZ).toBe(true);
      expect(cycles).toBe(8);
    });

    test("SRA (HL) - memory target", () => {
      cpu.hl = 0xC000;
      memory.writeByte(0xC000, 0x81); // 1000_0001
      loadCB(0x2e);
      const cycles = cpu.step();
      // bit7 preserved: result = 0xC0, old bit0=1 -> carry=1
      expect(memory.readByte(0xC000)).toBe(0xc0);
      expect(cpu.flagC).toBe(true);
      expect(cpu.flagZ).toBe(false);
      expect(cycles).toBe(16);
    });

    test("SRA B - 0x00 gives Z flag", () => {
      cpu.b = 0x00;
      loadCB(0x28);
      cpu.step();
      expect(cpu.b).toBe(0x00);
      expect(cpu.flagZ).toBe(true);
      expect(cpu.flagC).toBe(false);
    });

    test("SRA B - negative value stays negative", () => {
      cpu.b = 0x80; // 1000_0000
      loadCB(0x28);
      cpu.step();
      // bit7 preserved: result = 0xC0, old bit0=0 -> carry=0
      expect(cpu.b).toBe(0xc0);
      expect(cpu.flagC).toBe(false);
      expect(cpu.flagZ).toBe(false);
    });

    test("SRA advances PC by 2", () => {
      cpu.b = 0x01;
      loadCB(0x28);
      cpu.step();
      expect(cpu.pc).toBe(BASE + 2);
    });
  });

  // ─── SWAP (0x30-0x37) ─────────────────────────────────────────────

  describe("SWAP", () => {
    test("SWAP B - swaps upper and lower nibbles", () => {
      cpu.b = 0xAB;
      loadCB(0x30);
      const cycles = cpu.step();
      expect(cpu.b).toBe(0xba);
      expect(cpu.flagZ).toBe(false);
      expect(cpu.flagN).toBe(false);
      expect(cpu.flagH).toBe(false);
      expect(cpu.flagC).toBe(false);
      expect(cycles).toBe(8);
    });

    test("SWAP A - swaps nibbles", () => {
      cpu.a = 0xF0;
      loadCB(0x37);
      const cycles = cpu.step();
      expect(cpu.a).toBe(0x0f);
      expect(cpu.flagZ).toBe(false);
      expect(cpu.flagC).toBe(false);
      expect(cycles).toBe(8);
    });

    test("SWAP (HL) - memory target", () => {
      cpu.hl = 0xC000;
      memory.writeByte(0xC000, 0x12);
      loadCB(0x36);
      const cycles = cpu.step();
      expect(memory.readByte(0xC000)).toBe(0x21);
      expect(cpu.flagZ).toBe(false);
      expect(cpu.flagC).toBe(false);
      expect(cycles).toBe(16);
    });

    test("SWAP B - 0x00 sets Z flag", () => {
      cpu.b = 0x00;
      loadCB(0x30);
      cpu.step();
      expect(cpu.b).toBe(0x00);
      expect(cpu.flagZ).toBe(true);
      expect(cpu.flagC).toBe(false);
    });

    test("SWAP B - 0xFF stays 0xFF", () => {
      cpu.b = 0xFF;
      loadCB(0x30);
      cpu.step();
      expect(cpu.b).toBe(0xff);
      expect(cpu.flagZ).toBe(false);
      expect(cpu.flagC).toBe(false);
    });

    test("SWAP advances PC by 2", () => {
      cpu.b = 0x12;
      loadCB(0x30);
      cpu.step();
      expect(cpu.pc).toBe(BASE + 2);
    });
  });

  // ─── SRL (0x38-0x3F) ──────────────────────────────────────────────

  describe("SRL", () => {
    test("SRL B - shift right logical, bit 7 = 0", () => {
      cpu.b = 0xFF; // 1111_1111
      loadCB(0x38);
      const cycles = cpu.step();
      // result = 0x7F, old bit0=1 -> carry=1
      expect(cpu.b).toBe(0x7f);
      expect(cpu.flagC).toBe(true);
      expect(cpu.flagZ).toBe(false);
      expect(cpu.flagN).toBe(false);
      expect(cpu.flagH).toBe(false);
      expect(cycles).toBe(8);
    });

    test("SRL A - shift right logical", () => {
      cpu.a = 0x02; // 0000_0010
      loadCB(0x3f);
      const cycles = cpu.step();
      expect(cpu.a).toBe(0x01);
      expect(cpu.flagC).toBe(false);
      expect(cpu.flagZ).toBe(false);
      expect(cycles).toBe(8);
    });

    test("SRL (HL) - memory target", () => {
      cpu.hl = 0xC000;
      memory.writeByte(0xC000, 0x01);
      loadCB(0x3e);
      const cycles = cpu.step();
      // 0x01 >> 1 = 0x00, carry=1
      expect(memory.readByte(0xC000)).toBe(0x00);
      expect(cpu.flagC).toBe(true);
      expect(cpu.flagZ).toBe(true);
      expect(cycles).toBe(16);
    });

    test("SRL B - 0x01 becomes 0x00 with carry and Z", () => {
      cpu.b = 0x01;
      loadCB(0x38);
      cpu.step();
      expect(cpu.b).toBe(0x00);
      expect(cpu.flagZ).toBe(true);
      expect(cpu.flagC).toBe(true);
    });

    test("SRL B - 0x00 gives Z flag, carry=0", () => {
      cpu.b = 0x00;
      loadCB(0x38);
      cpu.step();
      expect(cpu.b).toBe(0x00);
      expect(cpu.flagZ).toBe(true);
      expect(cpu.flagC).toBe(false);
    });

    test("SRL advances PC by 2", () => {
      cpu.b = 0x02;
      loadCB(0x38);
      cpu.step();
      expect(cpu.pc).toBe(BASE + 2);
    });
  });

  // ─── BIT (0x40-0x7F) ──────────────────────────────────────────────

  describe("BIT", () => {
    test("BIT 0, B - bit 0 is set", () => {
      cpu.b = 0x01;
      loadCB(0x40); // BIT 0, B
      const cycles = cpu.step();
      expect(cpu.flagZ).toBe(false);
      expect(cpu.flagN).toBe(false);
      expect(cpu.flagH).toBe(true);
      expect(cycles).toBe(8);
    });

    test("BIT 0, B - bit 0 is clear", () => {
      cpu.b = 0xFE;
      loadCB(0x40); // BIT 0, B
      cpu.step();
      expect(cpu.flagZ).toBe(true);
      expect(cpu.flagN).toBe(false);
      expect(cpu.flagH).toBe(true);
    });

    test("BIT 3, A - bit 3 is set", () => {
      cpu.a = 0x08;
      loadCB(0x5f); // BIT 3, A
      const cycles = cpu.step();
      expect(cpu.flagZ).toBe(false);
      expect(cpu.flagH).toBe(true);
      expect(cycles).toBe(8);
    });

    test("BIT 3, A - bit 3 is clear", () => {
      cpu.a = 0xF7;
      loadCB(0x5f); // BIT 3, A
      cpu.step();
      expect(cpu.flagZ).toBe(true);
      expect(cpu.flagH).toBe(true);
    });

    test("BIT 7, B - bit 7 is set", () => {
      cpu.b = 0x80;
      loadCB(0x78); // BIT 7, B
      cpu.step();
      expect(cpu.flagZ).toBe(false);
      expect(cpu.flagH).toBe(true);
    });

    test("BIT 7, B - bit 7 is clear", () => {
      cpu.b = 0x7F;
      loadCB(0x78); // BIT 7, B
      cpu.step();
      expect(cpu.flagZ).toBe(true);
    });

    test("BIT preserves C flag when set", () => {
      cpu.b = 0x00;
      cpu.flagC = true;
      loadCB(0x40); // BIT 0, B
      cpu.step();
      expect(cpu.flagC).toBe(true);
    });

    test("BIT preserves C flag when clear", () => {
      cpu.b = 0xFF;
      cpu.flagC = false;
      loadCB(0x40); // BIT 0, B
      cpu.step();
      expect(cpu.flagC).toBe(false);
    });

    test("BIT 0, (HL) - memory target, 12 cycles", () => {
      cpu.hl = 0xC000;
      memory.writeByte(0xC000, 0x01);
      loadCB(0x46); // BIT 0, (HL)
      const cycles = cpu.step();
      expect(cpu.flagZ).toBe(false);
      expect(cpu.flagH).toBe(true);
      expect(cycles).toBe(12);
    });

    test("BIT 7, (HL) - memory target bit clear", () => {
      cpu.hl = 0xC000;
      memory.writeByte(0xC000, 0x7F);
      loadCB(0x7e); // BIT 7, (HL)
      const cycles = cpu.step();
      expect(cpu.flagZ).toBe(true);
      expect(cpu.flagH).toBe(true);
      expect(cycles).toBe(12);
    });

    test("BIT does not modify the register value", () => {
      cpu.b = 0xAB;
      loadCB(0x40); // BIT 0, B
      cpu.step();
      expect(cpu.b).toBe(0xAB);
    });

    test("BIT advances PC by 2", () => {
      cpu.b = 0x01;
      loadCB(0x40);
      cpu.step();
      expect(cpu.pc).toBe(BASE + 2);
    });
  });

  // ─── RES (0x80-0xBF) ──────────────────────────────────────────────

  describe("RES", () => {
    test("RES 0, B - clears bit 0", () => {
      cpu.b = 0xFF;
      loadCB(0x80); // RES 0, B
      const cycles = cpu.step();
      expect(cpu.b).toBe(0xFE);
      expect(cycles).toBe(8);
    });

    test("RES 7, A - clears bit 7", () => {
      cpu.a = 0xFF;
      loadCB(0xbf); // RES 7, A
      const cycles = cpu.step();
      expect(cpu.a).toBe(0x7F);
      expect(cycles).toBe(8);
    });

    test("RES 3, B - clears bit 3", () => {
      cpu.b = 0x0F;
      loadCB(0x98); // RES 3, B
      cpu.step();
      expect(cpu.b).toBe(0x07);
    });

    test("RES on already clear bit has no effect", () => {
      cpu.b = 0x00;
      loadCB(0x80); // RES 0, B
      cpu.step();
      expect(cpu.b).toBe(0x00);
    });

    test("RES does not change flags", () => {
      cpu.f = 0xF0; // all flags set
      cpu.b = 0xFF;
      loadCB(0x80);
      cpu.step();
      expect(cpu.flagZ).toBe(true);
      expect(cpu.flagN).toBe(true);
      expect(cpu.flagH).toBe(true);
      expect(cpu.flagC).toBe(true);
    });

    test("RES 0, (HL) - memory target", () => {
      cpu.hl = 0xC000;
      memory.writeByte(0xC000, 0xFF);
      loadCB(0x86); // RES 0, (HL)
      const cycles = cpu.step();
      expect(memory.readByte(0xC000)).toBe(0xFE);
      expect(cycles).toBe(16);
    });

    test("RES advances PC by 2", () => {
      cpu.b = 0xFF;
      loadCB(0x80);
      cpu.step();
      expect(cpu.pc).toBe(BASE + 2);
    });
  });

  // ─── SET (0xC0-0xFF) ──────────────────────────────────────────────

  describe("SET", () => {
    test("SET 0, B - sets bit 0", () => {
      cpu.b = 0x00;
      loadCB(0xc0); // SET 0, B
      const cycles = cpu.step();
      expect(cpu.b).toBe(0x01);
      expect(cycles).toBe(8);
    });

    test("SET 7, A - sets bit 7", () => {
      cpu.a = 0x00;
      loadCB(0xff); // SET 7, A
      const cycles = cpu.step();
      expect(cpu.a).toBe(0x80);
      expect(cycles).toBe(8);
    });

    test("SET 3, B - sets bit 3", () => {
      cpu.b = 0x00;
      loadCB(0xd8); // SET 3, B
      cpu.step();
      expect(cpu.b).toBe(0x08);
    });

    test("SET on already set bit has no effect", () => {
      cpu.b = 0xFF;
      loadCB(0xc0); // SET 0, B
      cpu.step();
      expect(cpu.b).toBe(0xFF);
    });

    test("SET does not change flags", () => {
      cpu.f = 0xF0; // all flags set
      cpu.b = 0x00;
      loadCB(0xc0);
      cpu.step();
      expect(cpu.flagZ).toBe(true);
      expect(cpu.flagN).toBe(true);
      expect(cpu.flagH).toBe(true);
      expect(cpu.flagC).toBe(true);
    });

    test("SET does not change flags when flags are clear", () => {
      cpu.f = 0x00;
      cpu.b = 0x00;
      loadCB(0xc0);
      cpu.step();
      expect(cpu.flagZ).toBe(false);
      expect(cpu.flagN).toBe(false);
      expect(cpu.flagH).toBe(false);
      expect(cpu.flagC).toBe(false);
    });

    test("SET 0, (HL) - memory target", () => {
      cpu.hl = 0xC000;
      memory.writeByte(0xC000, 0x00);
      loadCB(0xc6); // SET 0, (HL)
      const cycles = cpu.step();
      expect(memory.readByte(0xC000)).toBe(0x01);
      expect(cycles).toBe(16);
    });

    test("SET advances PC by 2", () => {
      cpu.b = 0x00;
      loadCB(0xc0);
      cpu.step();
      expect(cpu.pc).toBe(BASE + 2);
    });
  });

  // ─── Cross-cutting concerns ───────────────────────────────────────

  describe("general CB behavior", () => {
    test("all register targets for RLC produce 8 cycles", () => {
      // B=0, C=1, D=2, E=3, H=4, L=5, A=7
      const regOpcodes = [0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x07];
      for (const op of regOpcodes) {
        loadCB(op);
        const cycles = cpu.step();
        expect(cycles).toBe(8);
      }
    });

    test("(HL) target for all shift/rotate ops produces 16 cycles", () => {
      cpu.hl = 0xC000;
      const hlOpcodes = [0x06, 0x0e, 0x16, 0x1e, 0x26, 0x2e, 0x36, 0x3e];
      for (const op of hlOpcodes) {
        memory.writeByte(0xC000, 0x00);
        loadCB(op);
        const cycles = cpu.step();
        expect(cycles).toBe(16);
      }
    });

    test("all CB opcodes advance PC by exactly 2", () => {
      cpu.hl = 0xC000;
      const sampleOpcodes = [0x00, 0x0f, 0x17, 0x1a, 0x25, 0x2b, 0x33, 0x3c, 0x47, 0x60, 0x7e, 0x87, 0xa0, 0xbf, 0xc5, 0xfe];
      for (const op of sampleOpcodes) {
        loadCB(op);
        cpu.step();
        expect(cpu.pc).toBe(BASE + 2);
      }
    });
  });
});
