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

describe("CPU interrupts", () => {
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

  // ─── handleInterrupts() ─────────────────────────────────────────

  describe("handleInterrupts()", () => {
    test("returns 0 when IE=0 (no interrupts enabled)", () => {
      memory.writeByte(0xffff, 0x00); // IE = 0
      memory.writeByte(0xff0f, 0x1f); // IF = all pending
      cpu.ime = true;
      expect(cpu.handleInterrupts()).toBe(0);
    });

    test("returns 0 when IF=0 (no interrupts pending)", () => {
      memory.writeByte(0xffff, 0x1f); // IE = all enabled
      memory.writeByte(0xff0f, 0x00); // IF = none pending
      cpu.ime = true;
      expect(cpu.handleInterrupts()).toBe(0);
    });

    test("returns 0 when enabled and pending bits do not overlap", () => {
      memory.writeByte(0xffff, 0x01); // IE = VBlank only
      memory.writeByte(0xff0f, 0x04); // IF = Timer only
      cpu.ime = true;
      expect(cpu.handleInterrupts()).toBe(0);
    });

    test("returns 0 when IME is false even with pending interrupt", () => {
      memory.writeByte(0xffff, 0x01); // IE = VBlank
      memory.writeByte(0xff0f, 0x01); // IF = VBlank pending
      cpu.ime = false;
      expect(cpu.handleInterrupts()).toBe(0);
    });

    test("still wakes from HALT when IME is false", () => {
      memory.writeByte(0xffff, 0x01);
      memory.writeByte(0xff0f, 0x01);
      cpu.ime = false;
      cpu.halted = true;
      cpu.handleInterrupts();
      expect(cpu.halted).toBe(false);
    });

    test("VBlank interrupt: pushes PC, jumps to 0x0040, clears IF bit 0, returns 20", () => {
      cpu.pc = 0x1234;
      cpu.sp = 0xfffe;
      cpu.ime = true;
      memory.writeByte(0xffff, 0x01); // IE = VBlank
      memory.writeByte(0xff0f, 0x01); // IF = VBlank

      const cycles = cpu.handleInterrupts();

      expect(cycles).toBe(20);
      expect(cpu.pc).toBe(0x0040);
      expect(memory.readByte(0xff0f) & 0x01).toBe(0);
      expect(cpu.ime).toBe(false);
      // PC was pushed onto stack
      expect(cpu.sp).toBe(0xfffc);
      expect(memory.readByte(0xfffc)).toBe(0x34); // low byte
      expect(memory.readByte(0xfffd)).toBe(0x12); // high byte
    });

    test("LCD STAT interrupt (bit 1): vectors to 0x0048", () => {
      cpu.pc = 0x2000;
      cpu.sp = 0xfffe;
      cpu.ime = true;
      memory.writeByte(0xffff, 0x02); // IE = LCD STAT
      memory.writeByte(0xff0f, 0x02); // IF = LCD STAT

      const cycles = cpu.handleInterrupts();

      expect(cycles).toBe(20);
      expect(cpu.pc).toBe(0x0048);
      expect(memory.readByte(0xff0f) & 0x02).toBe(0);
    });

    test("Timer interrupt (bit 2): vectors to 0x0050", () => {
      cpu.pc = 0x3000;
      cpu.sp = 0xfffe;
      cpu.ime = true;
      memory.writeByte(0xffff, 0x04); // IE = Timer
      memory.writeByte(0xff0f, 0x04); // IF = Timer

      const cycles = cpu.handleInterrupts();

      expect(cycles).toBe(20);
      expect(cpu.pc).toBe(0x0050);
      expect(memory.readByte(0xff0f) & 0x04).toBe(0);
    });

    test("Serial interrupt (bit 3): vectors to 0x0058", () => {
      cpu.pc = 0x4000;
      cpu.sp = 0xfffe;
      cpu.ime = true;
      memory.writeByte(0xffff, 0x08); // IE = Serial
      memory.writeByte(0xff0f, 0x08); // IF = Serial

      const cycles = cpu.handleInterrupts();

      expect(cycles).toBe(20);
      expect(cpu.pc).toBe(0x0058);
      expect(memory.readByte(0xff0f) & 0x08).toBe(0);
    });

    test("Joypad interrupt (bit 4): vectors to 0x0060", () => {
      cpu.pc = 0x5000;
      cpu.sp = 0xfffe;
      cpu.ime = true;
      memory.writeByte(0xffff, 0x10); // IE = Joypad
      memory.writeByte(0xff0f, 0x10); // IF = Joypad

      const cycles = cpu.handleInterrupts();

      expect(cycles).toBe(20);
      expect(cpu.pc).toBe(0x0060);
      expect(memory.readByte(0xff0f) & 0x10).toBe(0);
    });

    test("priority: VBlank serviced before Timer when both pending", () => {
      cpu.pc = 0x1000;
      cpu.sp = 0xfffe;
      cpu.ime = true;
      memory.writeByte(0xffff, 0x05); // IE = VBlank + Timer
      memory.writeByte(0xff0f, 0x05); // IF = VBlank + Timer

      cpu.handleInterrupts();

      expect(cpu.pc).toBe(0x0040); // VBlank vector, not Timer
    });

    test("only clears the one interrupt bit that was serviced", () => {
      cpu.pc = 0x1000;
      cpu.sp = 0xfffe;
      cpu.ime = true;
      memory.writeByte(0xffff, 0x05); // IE = VBlank + Timer
      memory.writeByte(0xff0f, 0x05); // IF = VBlank + Timer

      cpu.handleInterrupts();

      const ifAfter = memory.readByte(0xff0f);
      expect(ifAfter & 0x01).toBe(0); // VBlank cleared
      expect(ifAfter & 0x04).toBe(0x04); // Timer still set
    });

    test("IME is cleared after servicing an interrupt", () => {
      cpu.pc = 0x1000;
      cpu.sp = 0xfffe;
      cpu.ime = true;
      memory.writeByte(0xffff, 0x01);
      memory.writeByte(0xff0f, 0x01);

      cpu.handleInterrupts();

      expect(cpu.ime).toBe(false);
    });

    test("PC is pushed correctly onto stack (SP decreases by 2)", () => {
      cpu.pc = 0xabcd;
      cpu.sp = 0xfff0;
      cpu.ime = true;
      memory.writeByte(0xffff, 0x01);
      memory.writeByte(0xff0f, 0x01);

      cpu.handleInterrupts();

      expect(cpu.sp).toBe(0xffee); // 0xFFF0 - 2
      // Little-endian push: low byte at lower address
      expect(memory.readByte(0xffee)).toBe(0xcd);
      expect(memory.readByte(0xffef)).toBe(0xab);
    });

    test("step() services interrupts automatically before fetching next opcode", () => {
      cpu.pc = 0x2000;
      cpu.sp = 0xfffe;
      cpu.ime = true;
      memory.writeByte(0x2000, 0x00); // NOP (should not execute)
      memory.writeByte(0xffff, 0x01); // IE = VBlank
      memory.writeByte(0xff0f, 0x01); // IF = VBlank pending

      const cycles = cpu.step();

      expect(cycles).toBe(20);
      expect(cpu.pc).toBe(0x0040);
      expect(cpu.sp).toBe(0xfffc);
    });
  });

  // ─── HALT behavior ──────────────────────────────────────────────

  describe("HALT behavior", () => {
    test("step() returns 4 cycles when halted", () => {
      cpu.halted = true;
      const cycles = cpu.step();
      expect(cycles).toBe(4);
    });

    test("PC does not advance during HALT", () => {
      cpu.pc = 0x2000;
      cpu.halted = true;
      cpu.step();
      expect(cpu.pc).toBe(0x2000);
    });

    test("handleInterrupts() wakes CPU from HALT when interrupt pending (IME=false)", () => {
      cpu.halted = true;
      cpu.ime = false;
      memory.writeByte(0xffff, 0x01); // IE = VBlank
      memory.writeByte(0xff0f, 0x01); // IF = VBlank

      cpu.handleInterrupts();

      expect(cpu.halted).toBe(false);
    });

    test("HALT wake with IME=false: interrupt is NOT serviced", () => {
      cpu.pc = 0x2000;
      cpu.sp = 0xfffe;
      cpu.halted = true;
      cpu.ime = false;
      memory.writeByte(0xffff, 0x01);
      memory.writeByte(0xff0f, 0x01);

      const cycles = cpu.handleInterrupts();

      expect(cpu.halted).toBe(false);
      expect(cycles).toBe(0); // not serviced
      expect(cpu.pc).toBe(0x2000); // PC unchanged
      expect(cpu.sp).toBe(0xfffe); // SP unchanged
      expect(memory.readByte(0xff0f) & 0x01).toBe(0x01); // IF bit NOT cleared
    });

    test("HALT wake with IME=true: interrupt is serviced (vector jump)", () => {
      cpu.pc = 0x2000;
      cpu.sp = 0xfffe;
      cpu.halted = true;
      cpu.ime = true;
      memory.writeByte(0xffff, 0x01);
      memory.writeByte(0xff0f, 0x01);

      const cycles = cpu.handleInterrupts();

      expect(cpu.halted).toBe(false);
      expect(cycles).toBe(20);
      expect(cpu.pc).toBe(0x0040);
      expect(memory.readByte(0xff0f) & 0x01).toBe(0);
    });

    test("full cycle: EI, HALT, interrupt fires, RETI returns", () => {
      // Set up interrupt handler at 0x0040: RETI (0xD9)
      memory.writeByte(0x0040, 0xd9);

      // Program: EI (0xFB), HALT (0x76)
      loadAt(0x0200, [0xfb, 0x76]);

      // Step 1: EI - schedules IME
      let cycles = cpu.step();
      expect(cycles).toBe(4);
      expect(cpu.ime).toBe(false);
      expect(cpu.pc).toBe(0x0201);

      // Step 2: HALT - but first imeScheduled promotes to ime=true
      cycles = cpu.step();
      expect(cycles).toBe(4);
      expect(cpu.ime).toBe(true);
      expect(cpu.halted).toBe(true);
      expect(cpu.pc).toBe(0x0202);

      // Trigger VBlank interrupt
      memory.writeByte(0xffff, 0x01);
      memory.writeByte(0xff0f, 0x01);

      // handleInterrupts: wakes from HALT and services the interrupt
      cycles = cpu.handleInterrupts();
      expect(cycles).toBe(20);
      expect(cpu.halted).toBe(false);
      expect(cpu.pc).toBe(0x0040);
      expect(cpu.ime).toBe(false);

      // Step 3: Execute RETI at 0x0040 - returns to 0x0202 and re-enables IME
      cycles = cpu.step();
      expect(cycles).toBe(16);
      expect(cpu.pc).toBe(0x0202);
      expect(cpu.ime).toBe(true);
    });
  });

  // ─── HALT bug ───────────────────────────────────────────────────

  describe("HALT bug (IME=0 with pending interrupt at HALT)", () => {
    test("HALT bug: CPU does not enter halted state", () => {
      // Setup: IME=0, IE & IF != 0 when HALT is executed
      cpu.ime = false;
      memory.writeByte(0xffff, 0x01); // IE = VBlank
      memory.writeByte(0xff0f, 0x01); // IF = VBlank pending

      // Place HALT (0x76) followed by NOP (0x00) then HALT (0x76)
      loadAt(0x0200, [0x76, 0x00, 0x76]);

      const cycles = cpu.step(); // Execute HALT with HALT bug condition
      expect(cycles).toBe(4);
      expect(cpu.halted).toBe(false); // CPU does NOT enter halted state
    });

    test("HALT bug: next instruction byte is read twice (PC fails to increment)", () => {
      cpu.ime = false;
      memory.writeByte(0xffff, 0x01); // IE = VBlank
      memory.writeByte(0xff0f, 0x01); // IF = VBlank pending

      // HALT (0x76), LD B,0x42 (0x06 0x42)
      // Due to HALT bug, the CPU will read 0x06 twice:
      //   first read: opcode 0x06 (LD B,d8), PC does NOT increment
      //   second read: 0x06 again as the immediate operand
      // Result: B = 0x06 instead of 0x42
      loadAt(0x0200, [0x76, 0x06, 0x42]);

      cpu.step(); // HALT triggers halt bug (does not halt, sets haltBug flag)

      // Now the next step reads the opcode byte without incrementing PC,
      // so LD B,d8 reads 0x06 as both opcode and operand
      cpu.step(); // LD B, d8 — but d8 is read as 0x06 (the opcode byte repeated)

      expect(cpu.b).toBe(0x06); // Got 0x06, not 0x42
    });

    test("HALT bug: only triggers when IE & IF != 0 at time of HALT", () => {
      cpu.ime = false;
      memory.writeByte(0xffff, 0x00); // IE = none
      memory.writeByte(0xff0f, 0x01); // IF = VBlank pending (but not enabled)

      loadAt(0x0200, [0x76]); // HALT

      cpu.step();
      // No overlap between IE and IF, so HALT enters normally
      expect(cpu.halted).toBe(true);
    });

    test("HALT bug does not occur when IME=1", () => {
      cpu.ime = true;
      memory.writeByte(0xffff, 0x01);
      memory.writeByte(0xff0f, 0x01);

      // With IME=1, the interrupt is serviced instead of HALT bug
      // Place HALT at 0x0200 and the interrupt handler as RETI
      memory.writeByte(0x0040, 0xd9); // RETI at VBlank vector
      loadAt(0x0200, [0x76]);

      // step() services the interrupt first (before fetching HALT)
      const cycles = cpu.step();
      expect(cycles).toBe(20);
      expect(cpu.pc).toBe(0x0040);
      expect(cpu.halted).toBe(false);
    });
  });

  // ─── STOP behavior ─────────────────────────────────────────────

  describe("STOP behavior", () => {
    test("STOP (0x10 0x00) sets stopped=true, PC advances by 2, returns 4", () => {
      loadAt(0x0300, [0x10, 0x00]);
      const cycles = cpu.step();

      expect(cycles).toBe(4);
      expect(cpu.stopped).toBe(true);
      expect(cpu.pc).toBe(0x0302);
    });

    test("step() returns 4 when stopped, PC does not advance", () => {
      cpu.stopped = true;
      cpu.pc = 0x0400;

      const cycles = cpu.step();

      expect(cycles).toBe(4);
      expect(cpu.pc).toBe(0x0400);
    });

    test("button press wakes from STOP (externally clearing stopped)", () => {
      cpu.stopped = true;
      cpu.pc = 0x0400;

      // Simulate button press: set joypad IF bit and externally wake
      memory.writeByte(0xff0f, memory.readByte(0xff0f) | 0x10);
      cpu.stopped = false; // external hardware clears stopped

      // CPU should now be able to execute
      memory.load(0x0400, [0x00]); // NOP
      const cycles = cpu.step();
      expect(cpu.stopped).toBe(false);
      expect(cycles).toBe(4);
      expect(cpu.pc).toBe(0x0401);
    });
  });

  // ─── EI delayed timing ─────────────────────────────────────────

  describe("EI delayed timing", () => {
    test("EI does not set IME immediately", () => {
      cpu.ime = false;
      loadAt(0x0200, [0xfb]); // EI
      cpu.step();
      expect(cpu.ime).toBe(false);
    });

    test("the instruction AFTER EI executes before IME becomes true", () => {
      cpu.ime = false;
      // EI at 0x0200, NOP at 0x0201
      loadAt(0x0200, [0xfb, 0x00]);

      cpu.step(); // EI: imeScheduled=true, ime still false
      expect(cpu.ime).toBe(false);

      // At the START of the next step(), imeScheduled promotes to ime=true,
      // then NOP executes. So IME is true after step returns.
      cpu.step(); // NOP
      expect(cpu.ime).toBe(true);
    });

    test("EI followed by DI leaves IME disabled", () => {
      cpu.ime = false;
      loadAt(0x0200, [0xfb, 0xf3, 0x00]); // EI, DI, NOP

      cpu.step(); // EI: delayed enable is armed
      expect(cpu.ime).toBe(false);

      cpu.step(); // DI executes before delayed enable would take effect
      expect(cpu.ime).toBe(false);

      cpu.step(); // NOP
      expect(cpu.ime).toBe(false);
    });

    test("interrupt is serviced only after the instruction following EI", () => {
      cpu.ime = false;
      loadAt(0x0200, [0xfb, 0x00, 0x00]); // EI, NOP, NOP
      memory.writeByte(0xffff, 0x01); // IE = VBlank
      memory.writeByte(0xff0f, 0x01); // IF = VBlank pending

      cpu.step(); // EI
      expect(cpu.pc).toBe(0x0201);
      expect(cpu.ime).toBe(false);

      cpu.step(); // NOP after EI should run before IRQ is serviced
      expect(cpu.pc).toBe(0x0202);
      expect(cpu.ime).toBe(true);

      const cycles = cpu.step(); // now interrupt is serviced first
      expect(cycles).toBe(20);
      expect(cpu.pc).toBe(0x0040);
    });

    test("EI + HALT: IME is set, then HALT takes effect", () => {
      cpu.ime = false;
      loadAt(0x0200, [0xfb, 0x76]); // EI, HALT

      cpu.step(); // EI
      expect(cpu.ime).toBe(false);

      cpu.step(); // HALT: imeScheduled promotes to ime=true first, then HALT executes
      expect(cpu.ime).toBe(true);
      expect(cpu.halted).toBe(true);
    });
  });

  // ─── Serialize/deserialize with interrupt fields ────────────────

  describe("serialize/deserialize with interrupt fields", () => {
    test("imeScheduled is preserved in serialization", () => {
      // Trigger imeScheduled by executing EI
      loadAt(0x0200, [0xfb]);
      cpu.step(); // EI sets imeScheduled=true

      const data = cpu.serialize();
      const restored = CPU.deserialize(data, memory);

      // imeScheduled should be preserved - verify by stepping NOP
      // If imeScheduled was preserved, ime will become true on next step
      memory.load(restored.pc, [0x00]); // NOP at current PC
      restored.step();
      expect(restored.ime).toBe(true);
    });

    test("stopped is preserved in serialization", () => {
      cpu.stopped = true;
      const data = cpu.serialize();
      const restored = CPU.deserialize(data, memory);
      expect(restored.stopped).toBe(true);
    });

    test("halted is preserved in serialization", () => {
      cpu.halted = true;
      const data = cpu.serialize();
      const restored = CPU.deserialize(data, memory);
      expect(restored.halted).toBe(true);
    });

    test("ime is preserved in serialization", () => {
      cpu.ime = true;
      const data = cpu.serialize();
      const restored = CPU.deserialize(data, memory);
      expect(restored.ime).toBe(true);
    });

    test("deserialize with truncated buffer throws error", () => {
      const shortBuffer = new Uint8Array(10); // less than required 13 bytes
      expect(() => CPU.deserialize(shortBuffer, memory)).toThrow(
        /CPU state buffer too short/
      );
    });

    test("deserialize with empty buffer throws error", () => {
      const emptyBuffer = new Uint8Array(0);
      expect(() => CPU.deserialize(emptyBuffer, memory)).toThrow(
        /CPU state buffer too short/
      );
    });

    test("all interrupt state bits round-trip correctly", () => {
      // First execute EI to set imeScheduled (must be done before halted/stopped)
      loadAt(0x0200, [0xfb]);
      cpu.step(); // EI -> imeScheduled = true

      // Now set the remaining flags after the step
      cpu.ime = true;
      cpu.halted = true;
      cpu.stopped = true;

      const data = cpu.serialize();
      // State byte should have all 4 bits set
      expect(data[12]).toBe(0x0f); // ime=1, halted=2, imeScheduled=4, stopped=8

      const restored = CPU.deserialize(data, memory);
      expect(restored.ime).toBe(true);
      expect(restored.halted).toBe(true);
      expect(restored.stopped).toBe(true);

      // Verify imeScheduled restored: clear ime, unstop/unhalt, step NOP
      restored.ime = false;
      restored.halted = false;
      restored.stopped = false;
      memory.load(restored.pc, [0x00]);
      restored.step();
      expect(restored.ime).toBe(true); // imeScheduled kicked in
    });
  });
});
