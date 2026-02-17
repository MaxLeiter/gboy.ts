import { describe, test, expect } from "bun:test";
import { CPU } from "../cpu";
import { MMU } from "../mmu";

function buildROM(base: number, bytes: number[]): Uint8Array {
  const rom = new Uint8Array(0x8000);
  for (let i = 0; i < bytes.length; i++) {
    rom[base + i] = bytes[i]!;
  }
  return rom;
}

function runUntilHalt(cpu: CPU, maxSteps = 1000): number {
  let totalCycles = 0;
  let steps = 0;
  while (!cpu.halted && steps < maxSteps) {
    totalCycles += cpu.step();
    steps++;
  }
  return totalCycles;
}

describe("CPU + MMU integration", () => {
  // 1. Execute a simple program from ROM
  describe("execute a simple program from ROM", () => {
    test("LD A,0x42; LD B,0x13; ADD A,B; HALT", () => {
      const mmu = new MMU();
      // Program at 0x0100: LD A,0x42 (3E 42); LD B,0x13 (06 13); ADD A,B (80); HALT (76)
      mmu.loadROM(buildROM(0x0100, [0x3e, 0x42, 0x06, 0x13, 0x80, 0x76]));
      const cpu = new CPU(mmu);

      // Step 1: LD A, 0x42
      cpu.step();
      expect(cpu.a).toBe(0x42);
      expect(cpu.pc).toBe(0x0102);

      // Step 2: LD B, 0x13
      cpu.step();
      expect(cpu.b).toBe(0x13);
      expect(cpu.pc).toBe(0x0104);

      // Step 3: ADD A, B => 0x42 + 0x13 = 0x55
      cpu.step();
      expect(cpu.a).toBe(0x55);
      expect(cpu.flagZ).toBe(false);
      expect(cpu.flagN).toBe(false);
      expect(cpu.pc).toBe(0x0105);

      // Step 4: HALT
      cpu.step();
      expect(cpu.halted).toBe(true);
    });
  });

  // 2. Stack operations through real memory
  describe("stack operations through real memory", () => {
    test("PUSH and POP round-trip through HRAM/WRAM", () => {
      const mmu = new MMU();
      // Set SP to 0xFFFE (HRAM), push BC (0xBEEF), push DE (0x1234), pop HL, pop DE, HALT
      // LD SP,0xFFFE (31 FE FF)
      // LD BC,0xBEEF (01 EF BE)
      // PUSH BC (C5)
      // LD DE,0x1234 (11 34 12)
      // PUSH DE (D5)
      // POP HL (E1)  -- HL = 0x1234
      // POP DE (D1)  -- DE = 0xBEEF
      // HALT (76)
      mmu.loadROM(
        buildROM(0x0100, [
          0x31, 0xfe, 0xff, // LD SP, 0xFFFE
          0x01, 0xef, 0xbe, // LD BC, 0xBEEF
          0xc5,             // PUSH BC
          0x11, 0x34, 0x12, // LD DE, 0x1234
          0xd5,             // PUSH DE
          0xe1,             // POP HL
          0xd1,             // POP DE
          0x76,             // HALT
        ])
      );
      const cpu = new CPU(mmu);

      runUntilHalt(cpu);
      expect(cpu.hl).toBe(0x1234);
      expect(cpu.de).toBe(0xbeef);
      expect(cpu.sp).toBe(0xfffe);
    });

    test("SP changes correctly during push/pop", () => {
      const mmu = new MMU();
      // LD SP, 0xFFFE; LD BC, 0x1122; PUSH BC; HALT
      mmu.loadROM(
        buildROM(0x0100, [
          0x31, 0xfe, 0xff, // LD SP, 0xFFFE
          0x01, 0x22, 0x11, // LD BC, 0x1122
          0xc5,             // PUSH BC
          0x76,             // HALT
        ])
      );
      const cpu = new CPU(mmu);

      cpu.step(); // LD SP
      expect(cpu.sp).toBe(0xfffe);
      cpu.step(); // LD BC
      cpu.step(); // PUSH BC => SP goes from 0xFFFE to 0xFFFC
      expect(cpu.sp).toBe(0xfffc);
      // Verify the bytes are in HRAM: 0xFFFD=0x11(hi), 0xFFFC=0x22(lo)
      expect(mmu.readByte(0xfffc)).toBe(0x22);
      expect(mmu.readByte(0xfffd)).toBe(0x11);
    });
  });

  // 3. Memory-indirect operations
  describe("memory-indirect operations", () => {
    test("LD (HL),A then LD B,(HL) round-trips through WRAM", () => {
      const mmu = new MMU();
      // LD HL, 0xC000 (21 00 C0)
      // LD A, 0xAB (3E AB)
      // LD (HL), A (77)
      // LD B, (HL) (46)
      // HALT (76)
      mmu.loadROM(
        buildROM(0x0100, [
          0x21, 0x00, 0xc0,
          0x3e, 0xab,
          0x77,
          0x46,
          0x76,
        ])
      );
      const cpu = new CPU(mmu);
      runUntilHalt(cpu);

      expect(cpu.b).toBe(0xab);
      expect(mmu.readByte(0xc000)).toBe(0xab);
    });

    test("ADD A,(HL) uses value from WRAM", () => {
      const mmu = new MMU();
      // LD HL, 0xC010; LD A, 0x10; LD (HL), A; LD A, 0x05; ADD A,(HL); HALT
      mmu.loadROM(
        buildROM(0x0100, [
          0x21, 0x10, 0xc0, // LD HL, 0xC010
          0x3e, 0x10,       // LD A, 0x10
          0x77,             // LD (HL), A
          0x3e, 0x05,       // LD A, 0x05
          0x86,             // ADD A, (HL)
          0x76,             // HALT
        ])
      );
      const cpu = new CPU(mmu);
      runUntilHalt(cpu);

      expect(cpu.a).toBe(0x15);
    });
  });

  // 4. Subroutine call and return
  describe("subroutine call and return", () => {
    test("CALL to subroutine, work, RET back", () => {
      const mmu = new MMU();
      // Main at 0x0100:
      //   LD A, 0x00       (3E 00)
      //   CALL 0x0200      (CD 00 02)
      //   HALT             (76)
      //
      // Subroutine at 0x0200:
      //   LD A, 0xFF       (3E FF)
      //   LD B, 0x01       (06 01)
      //   ADD A, B         (80)   => A = 0x00 (wraps), flags: Z=1, C=1
      //   RET              (C9)
      const rom = new Uint8Array(0x8000);
      // Main
      const main = [0x3e, 0x00, 0xcd, 0x00, 0x02, 0x76];
      for (let i = 0; i < main.length; i++) rom[0x0100 + i] = main[i]!;
      // Subroutine
      const sub = [0x3e, 0xff, 0x06, 0x01, 0x80, 0xc9];
      for (let i = 0; i < sub.length; i++) rom[0x0200 + i] = sub[i]!;

      mmu.loadROM(rom);
      const cpu = new CPU(mmu);

      runUntilHalt(cpu);
      expect(cpu.a).toBe(0x00);
      expect(cpu.b).toBe(0x01);
      expect(cpu.flagZ).toBe(true);
      expect(cpu.flagC).toBe(true);
      expect(cpu.halted).toBe(true);
      // PC should be one past HALT (0x0106)
      expect(cpu.pc).toBe(0x0106);
    });
  });

  // 5. Loop with counter
  describe("loop with counter", () => {
    test("DEC B; JR NZ loop counts down to 0", () => {
      const mmu = new MMU();
      // LD B, 5   (06 05)         ; 0x0100
      // loop:
      //   DEC B   (05)            ; 0x0102
      //   JR NZ, -2 (20 FD)      ; 0x0103 -- offset -3 jumps to 0x0102 (from 0x0105, so FD = -3)
      // HALT (76)                 ; 0x0105
      // JR NZ offset: target = PC_after + offset. PC after reading offset = 0x0105.
      // We want target = 0x0102, so offset = 0x0102 - 0x0105 = -3 = 0xFD
      mmu.loadROM(buildROM(0x0100, [0x06, 0x05, 0x05, 0x20, 0xfd, 0x76]));
      const cpu = new CPU(mmu);

      const totalCycles = runUntilHalt(cpu);
      expect(cpu.b).toBe(0);
      expect(cpu.halted).toBe(true);

      // Cycle count:
      // LD B,5: 8
      // Loop iterations 1-4 (B=4,3,2,1, NZ=true): DEC B (4) + JR NZ taken (12) = 16 each = 64
      // Iteration 5 (B=0, Z=true): DEC B (4) + JR NZ not taken (8) = 12
      // HALT: 4
      // Total: 8 + 64 + 12 + 4 = 88
      expect(totalCycles).toBe(88);
    });
  });

  // 6. High-page I/O
  describe("high-page I/O", () => {
    test("LDH write and read to I/O register", () => {
      const mmu = new MMU();
      // Use SCY (0xFF42) instead of NR10 (0xFF10) which has unimplemented bit 7
      // LD A, 0x42     (3E 42)
      // LDH (0x42), A  (E0 42)  => write A to 0xFF42 (SCY)
      // LD A, 0x00     (3E 00)  => clear A
      // LDH A, (0x42)  (F0 42)  => read 0xFF42 into A
      // HALT           (76)
      mmu.loadROM(
        buildROM(0x0100, [0x3e, 0x42, 0xe0, 0x42, 0x3e, 0x00, 0xf0, 0x42, 0x76])
      );
      const cpu = new CPU(mmu);
      runUntilHalt(cpu);

      expect(cpu.a).toBe(0x42);
      expect(mmu.readByte(0xff42)).toBe(0x42);
    });

    test("LD (C),A and LD A,(C) for I/O access", () => {
      const mmu = new MMU();
      // Use 0x45 (LYC) instead of 0x44 (LY) since LY resets on write
      // LD C, 0x45     (0E 45)
      // LD A, 0x77     (3E 77)
      // LD (C), A      (E2)     => write A to 0xFF45
      // LD A, 0x00     (3E 00)
      // LD A, (C)      (F2)     => read 0xFF45 into A
      // HALT           (76)
      mmu.loadROM(
        buildROM(0x0100, [0x0e, 0x45, 0x3e, 0x77, 0xe2, 0x3e, 0x00, 0xf2, 0x76])
      );
      const cpu = new CPU(mmu);
      runUntilHalt(cpu);

      expect(cpu.a).toBe(0x77);
      expect(mmu.readByte(0xff45)).toBe(0x77);
    });
  });

  // 7. Serialize and deserialize full state
  describe("serialize and deserialize full state", () => {
    test("save mid-execution, restore, continue to same result", () => {
      const mmu = new MMU();
      // Program: LD A,0x10; LD B,0x20; ADD A,B; ADD A,B; HALT
      // 0x0100: 3E 10  06 20  80  80  76
      mmu.loadROM(buildROM(0x0100, [0x3e, 0x10, 0x06, 0x20, 0x80, 0x80, 0x76]));

      // Run all the way through without interruption
      const cpuFull = new CPU(mmu);
      runUntilHalt(cpuFull);
      const expectedA = cpuFull.a; // 0x10 + 0x20 + 0x20 = 0x50

      // Now run partway, serialize, restore, continue
      const mmu2 = new MMU();
      mmu2.loadROM(buildROM(0x0100, [0x3e, 0x10, 0x06, 0x20, 0x80, 0x80, 0x76]));
      const cpuPartial = new CPU(mmu2);
      cpuPartial.step(); // LD A, 0x10
      cpuPartial.step(); // LD B, 0x20
      cpuPartial.step(); // ADD A, B (first)

      // Serialize both
      const cpuState = cpuPartial.serialize();
      const mmuState = mmu2.serialize();

      // Deserialize into new instances (ROM must be loaded separately)
      const rom = buildROM(0x0100, [0x3e, 0x10, 0x06, 0x20, 0x80, 0x80, 0x76]);
      const mmu3 = MMU.deserialize(mmuState, rom);
      const cpuRestored = CPU.deserialize(cpuState, mmu3);

      // Verify mid-state
      expect(cpuRestored.a).toBe(0x30);
      expect(cpuRestored.b).toBe(0x20);
      expect(cpuRestored.halted).toBe(false);

      // Continue execution
      runUntilHalt(cpuRestored);
      expect(cpuRestored.a).toBe(expectedA);
      expect(cpuRestored.a).toBe(0x50);
      expect(cpuRestored.halted).toBe(true);
    });
  });

  // 8. WRAM read/write from CPU instructions
  describe("WRAM read/write from CPU instructions", () => {
    test("LD (a16),A writes to WRAM, LD A,(a16) reads it back", () => {
      const mmu = new MMU();
      // LD A, 0xDE     (3E DE)
      // LD (0xC100), A (EA 00 C1)
      // LD A, 0x00     (3E 00)
      // LD A, (0xC100) (FA 00 C1)
      // HALT           (76)
      mmu.loadROM(
        buildROM(0x0100, [
          0x3e, 0xde,
          0xea, 0x00, 0xc1,
          0x3e, 0x00,
          0xfa, 0x00, 0xc1,
          0x76,
        ])
      );
      const cpu = new CPU(mmu);
      runUntilHalt(cpu);

      expect(cpu.a).toBe(0xde);
      expect(mmu.readByte(0xc100)).toBe(0xde);
    });
  });

  // 9. Echo RAM accessible from CPU
  describe("echo RAM accessible from CPU", () => {
    test("write to WRAM via CPU, read from echo RAM address", () => {
      const mmu = new MMU();
      // Write 0xAB to WRAM address 0xC050 via LD (a16), A
      // Then read from echo RAM address 0xE050 via LD A, (a16)
      // LD A, 0xAB     (3E AB)
      // LD (0xC050), A (EA 50 C0)
      // LD A, 0x00     (3E 00)
      // LD A, (0xE050) (FA 50 E0)
      // HALT           (76)
      mmu.loadROM(
        buildROM(0x0100, [
          0x3e, 0xab,
          0xea, 0x50, 0xc0,
          0x3e, 0x00,
          0xfa, 0x50, 0xe0,
          0x76,
        ])
      );
      const cpu = new CPU(mmu);
      runUntilHalt(cpu);

      expect(cpu.a).toBe(0xab);
    });

    test("write to echo RAM, read from WRAM", () => {
      const mmu = new MMU();
      // Write 0xCD to echo RAM 0xE080 via LD (a16), A
      // Then read from WRAM 0xC080 via LD A, (a16)
      mmu.loadROM(
        buildROM(0x0100, [
          0x3e, 0xcd,
          0xea, 0x80, 0xe0,
          0x3e, 0x00,
          0xfa, 0x80, 0xc0,
          0x76,
        ])
      );
      const cpu = new CPU(mmu);
      runUntilHalt(cpu);

      expect(cpu.a).toBe(0xcd);
    });
  });

  // 10. CB-prefix operations on memory
  describe("CB-prefix operations on memory", () => {
    test("BIT, SET, RES on (HL) in WRAM", () => {
      const mmu = new MMU();
      // LD HL, 0xC000  (21 00 C0)
      // LD A, 0b10100101 = 0xA5 (3E A5)
      // LD (HL), A     (77)
      //
      // CB BIT 0,(HL)  (CB 46) -- test bit 0 of 0xA5: bit0=1, so Z=0
      //   Actually BIT 0,(HL) = CB 46. BIT b,(HL) = CB [0x46 + b*8]
      //   BIT 0 = CB 46
      //
      // CB RES 0,(HL)  (CB 86) -- clear bit 0: 0xA5 & ~1 = 0xA4
      // CB SET 1,(HL)  (CB CE) -- set bit 1: 0xA4 | 2 = 0xA6
      // LD A, (HL)     (7E)    -- read back
      // HALT           (76)
      mmu.loadROM(
        buildROM(0x0100, [
          0x21, 0x00, 0xc0, // LD HL, 0xC000
          0x3e, 0xa5,       // LD A, 0xA5
          0x77,             // LD (HL), A
          0xcb, 0x46,       // BIT 0, (HL)
          0xcb, 0x86,       // RES 0, (HL)
          0xcb, 0xce,       // SET 1, (HL)
          0x7e,             // LD A, (HL)
          0x76,             // HALT
        ])
      );
      const cpu = new CPU(mmu);

      // Step through to check BIT result
      cpu.step(); // LD HL
      cpu.step(); // LD A
      cpu.step(); // LD (HL), A
      cpu.step(); // BIT 0, (HL) - bit 0 of 0xA5 is 1, so Z=false
      expect(cpu.flagZ).toBe(false);
      expect(cpu.flagH).toBe(true);
      expect(cpu.flagN).toBe(false);

      cpu.step(); // RES 0, (HL) -> 0xA4
      expect(mmu.readByte(0xc000)).toBe(0xa4);

      cpu.step(); // SET 1, (HL) -> 0xA6
      expect(mmu.readByte(0xc000)).toBe(0xa6);

      cpu.step(); // LD A, (HL)
      expect(cpu.a).toBe(0xa6);

      cpu.step(); // HALT
      expect(cpu.halted).toBe(true);
    });

    test("SWAP (HL) swaps nibbles in WRAM", () => {
      const mmu = new MMU();
      // LD HL, 0xC000  (21 00 C0)
      // LD A, 0xF1     (3E F1)
      // LD (HL), A     (77)
      // CB SWAP (HL)   (CB 36) -- 0xF1 -> 0x1F
      // LD A, (HL)     (7E)
      // HALT           (76)
      mmu.loadROM(
        buildROM(0x0100, [
          0x21, 0x00, 0xc0,
          0x3e, 0xf1,
          0x77,
          0xcb, 0x36,
          0x7e,
          0x76,
        ])
      );
      const cpu = new CPU(mmu);
      runUntilHalt(cpu);

      expect(cpu.a).toBe(0x1f);
      expect(mmu.readByte(0xc000)).toBe(0x1f);
    });

    test("SLA (HL) shifts left through WRAM", () => {
      const mmu = new MMU();
      // LD HL, 0xC002; LD A, 0x81; LD (HL), A; CB SLA (HL) (CB 26); LD A, (HL); HALT
      // SLA 0x81: bit7=1->carry, result = 0x02
      mmu.loadROM(
        buildROM(0x0100, [
          0x21, 0x02, 0xc0,
          0x3e, 0x81,
          0x77,
          0xcb, 0x26,
          0x7e,
          0x76,
        ])
      );
      const cpu = new CPU(mmu);
      runUntilHalt(cpu);

      expect(cpu.a).toBe(0x02);
      expect(cpu.flagC).toBe(true);
      expect(mmu.readByte(0xc002)).toBe(0x02);
    });
  });
});
