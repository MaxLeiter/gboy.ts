import { describe, it, expect, beforeEach } from "bun:test";
import { Timer } from "../timer";

const DIV = 0xff04;
const TIMA = 0xff05;
const TMA = 0xff06;
const TAC = 0xff07;

describe("Timer", () => {
  let timer: Timer;

  beforeEach(() => {
    timer = new Timer();
  });

  describe("DIV register", () => {
    it("starts at 0", () => {
      expect(timer.readRegister(DIV)).toBe(0);
    });

    it("increments every 256 t-cycles", () => {
      timer.tick(256);
      expect(timer.readRegister(DIV)).toBe(1);
    });

    it("does not increment before 256 t-cycles", () => {
      timer.tick(255);
      expect(timer.readRegister(DIV)).toBe(0);
    });

    it("increments multiple times with large tick", () => {
      timer.tick(512);
      expect(timer.readRegister(DIV)).toBe(2);
    });

    it("accumulates partial cycles across ticks", () => {
      timer.tick(128);
      expect(timer.readRegister(DIV)).toBe(0);
      timer.tick(128);
      expect(timer.readRegister(DIV)).toBe(1);
    });

    it("wraps from 0xFF to 0x00", () => {
      timer.tick(256 * 255);
      expect(timer.readRegister(DIV)).toBe(255);
      timer.tick(256);
      expect(timer.readRegister(DIV)).toBe(0);
    });

    it("writing any value resets DIV to 0", () => {
      timer.tick(256 * 10);
      expect(timer.readRegister(DIV)).toBe(10);
      timer.writeRegister(DIV, 0x42);
      expect(timer.readRegister(DIV)).toBe(0);
    });

    it("writing resets the internal divCounter too", () => {
      timer.tick(200);
      timer.writeRegister(DIV, 0);
      timer.tick(100);
      expect(timer.readRegister(DIV)).toBe(0);
      timer.tick(156);
      expect(timer.readRegister(DIV)).toBe(1);
    });
  });

  describe("TIMA with clock select", () => {
    it("TAC=0x04 (enabled, 1024 cycles): TIMA increments every 1024 t-cycles", () => {
      timer.writeRegister(TAC, 0x04);
      timer.tick(1024);
      expect(timer.readRegister(TIMA)).toBe(1);
    });

    it("TAC=0x04: does not increment before 1024 t-cycles", () => {
      timer.writeRegister(TAC, 0x04);
      timer.tick(1023);
      expect(timer.readRegister(TIMA)).toBe(0);
    });

    it("TAC=0x05 (enabled, 16 cycles): TIMA increments every 16 t-cycles", () => {
      timer.writeRegister(TAC, 0x05);
      timer.tick(16);
      expect(timer.readRegister(TIMA)).toBe(1);
    });

    it("TAC=0x05: multiple increments", () => {
      timer.writeRegister(TAC, 0x05);
      timer.tick(48);
      expect(timer.readRegister(TIMA)).toBe(3);
    });

    it("TAC=0x06 (enabled, 64 cycles): TIMA increments every 64 t-cycles", () => {
      timer.writeRegister(TAC, 0x06);
      timer.tick(64);
      expect(timer.readRegister(TIMA)).toBe(1);
    });

    it("TAC=0x06: accumulates across ticks", () => {
      timer.writeRegister(TAC, 0x06);
      timer.tick(32);
      expect(timer.readRegister(TIMA)).toBe(0);
      timer.tick(32);
      expect(timer.readRegister(TIMA)).toBe(1);
    });

    it("TAC=0x07 (enabled, 256 cycles): TIMA increments every 256 t-cycles", () => {
      timer.writeRegister(TAC, 0x07);
      timer.tick(256);
      expect(timer.readRegister(TIMA)).toBe(1);
    });
  });

  describe("TIMA overflow", () => {
    it("returns false normally", () => {
      timer.writeRegister(TAC, 0x05);
      const overflow = timer.tick(16);
      expect(overflow).toBe(false);
    });

    it("returns true when delayed overflow reload occurs", () => {
      timer.writeRegister(TAC, 0x05);
      // TIMA starts at 0, need 256 increments to overflow
      // 256 * 16 = 4096 t-cycles reaches overflow, then reload/IRQ occurs 1 M-cycle (4 t-cycles) later.
      const noIrqYet = timer.tick(256 * 16);
      expect(noIrqYet).toBe(false);
      const overflow = timer.tick(4);
      expect(overflow).toBe(true);
    });

    it("resets TIMA to TMA value on overflow", () => {
      timer.writeRegister(TMA, 0x50);
      timer.writeRegister(TAC, 0x05);
      timer.tick(256 * 16);
      timer.tick(4);
      expect(timer.readRegister(TIMA)).toBe(0x50);
    });

    it("returns true only at reload/interrupt point", () => {
      timer.writeRegister(TAC, 0x05);
      // Tick 255 increments worth (no overflow)
      const noOverflow = timer.tick(255 * 16);
      expect(noOverflow).toBe(false);
      expect(timer.readRegister(TIMA)).toBe(255);
      // One more increment causes overflow state (TIMA=0), but IRQ is delayed.
      const noIrqYet = timer.tick(16);
      expect(noIrqYet).toBe(false);
      expect(timer.readRegister(TIMA)).toBe(0x00);
      const overflow = timer.tick(4);
      expect(overflow).toBe(true);
    });
  });

  describe("Timer disabled", () => {
    it("TIMA does not increment when TAC bit 2 is 0", () => {
      timer.writeRegister(TAC, 0x00);
      timer.tick(4096);
      expect(timer.readRegister(TIMA)).toBe(0);
    });

    it("DIV still increments when timer is disabled", () => {
      timer.writeRegister(TAC, 0x00);
      timer.tick(256);
      expect(timer.readRegister(DIV)).toBe(1);
    });

    it("TIMA does not increment with clock select bits set but enable bit clear", () => {
      timer.writeRegister(TAC, 0x03); // bits 0-1 set, bit 2 clear
      timer.tick(4096);
      expect(timer.readRegister(TIMA)).toBe(0);
    });

    it("enabling timer after being disabled starts counting", () => {
      timer.writeRegister(TAC, 0x01); // disabled, clock select 01
      timer.tick(64);
      expect(timer.readRegister(TIMA)).toBe(0);
      timer.writeRegister(TAC, 0x05); // enabled, clock select 01 (16 cycles)
      timer.tick(16);
      expect(timer.readRegister(TIMA)).toBe(1);
    });
  });

  describe("TMA reload", () => {
    it("custom TMA value is loaded into TIMA on overflow", () => {
      timer.writeRegister(TMA, 0xA0);
      timer.writeRegister(TAC, 0x05);
      timer.tick(256 * 16); // overflow
      timer.tick(4); // delayed reload
      expect(timer.readRegister(TIMA)).toBe(0xA0);
    });

    it("TIMA continues counting from TMA after overflow", () => {
      timer.writeRegister(TMA, 0xFE);
      timer.writeRegister(TAC, 0x05);
      // Overflow: 256 increments
      timer.tick(256 * 16);
      timer.tick(4); // delayed reload
      expect(timer.readRegister(TIMA)).toBe(0xFE);
      // Two more increments to overflow again
      timer.tick(16);
      expect(timer.readRegister(TIMA)).toBe(0xFF);
      timer.tick(16);
      timer.tick(4); // delayed reload
      // Should overflow again back to TMA
      expect(timer.readRegister(TIMA)).toBe(0xFE);
    });

    it("TMA of 0x00 means TIMA resets to 0 on overflow", () => {
      timer.writeRegister(TMA, 0x00);
      timer.writeRegister(TAC, 0x05);
      timer.tick(256 * 16);
      timer.tick(4);
      expect(timer.readRegister(TIMA)).toBe(0x00);
    });
  });

  describe("edge-trigger behavior", () => {
    it("writing DIV can increment TIMA on a timer-signal falling edge", () => {
      timer.writeRegister(TAC, 0x05); // enable, 16 t-cycles (M-cycle bit 1 source)
      timer.tick(8); // two M-cycles: source bit is high now
      expect(timer.readRegister(TIMA)).toBe(0);

      timer.writeRegister(DIV, 0x00); // force source high->low transition
      expect(timer.readRegister(TIMA)).toBe(1);
    });

    it("writing TAC can increment TIMA on falling edge when switching sources", () => {
      timer.writeRegister(TAC, 0x05); // enable, select 01 (bit 1)
      timer.tick(8); // source bit 1 is high
      expect(timer.readRegister(TIMA)).toBe(0);

      timer.writeRegister(TAC, 0x06); // switch to select 10 (bit 3); likely low at this counter
      expect(timer.readRegister(TIMA)).toBe(1);
    });

    it("writing DIV when TIMA=0xFF causes overflow via falling edge", () => {
      timer.writeRegister(TAC, 0x05); // enable, 16 t-cycles (bit 1 source)
      timer.writeRegister(TIMA, 0xFF);
      timer.writeRegister(TMA, 0x80);
      timer.tick(8); // source bit 1 is high (systemCounter=2, bit 1=1)

      // DIV write resets counter → falling edge → TIMA overflow
      timer.writeRegister(DIV, 0x00);
      expect(timer.readRegister(TIMA)).toBe(0x00); // overflow in progress

      // TMA reload + interrupt fires 1 M-cycle (4 T-cycles) after overflow,
      // same as normal overflow timing.
      const irq = timer.tick(4);
      expect(irq).toBe(true);
      expect(timer.readRegister(TIMA)).toBe(0x80);
    });

    it("disabling timer (TAC enable bit 0→0) with selected bit high increments TIMA", () => {
      timer.writeRegister(TAC, 0x05); // enable, bit 1 source
      timer.tick(8); // systemCounter=2, bit 1=1 → signal is high
      expect(timer.readRegister(TIMA)).toBe(0);

      // Disable timer: signal goes high→false (falling edge)
      timer.writeRegister(TAC, 0x01); // disabled, same clock select
      expect(timer.readRegister(TIMA)).toBe(1);
    });

    it("writing TMA during reload cycle propagates new TMA to TIMA", () => {
      timer.writeRegister(TMA, 0x50);
      timer.writeRegister(TAC, 0x05);
      timer.writeRegister(TIMA, 0xFF);

      // One increment causes overflow → TIMA=0x00, reloadDelay armed
      timer.tick(16);
      expect(timer.readRegister(TIMA)).toBe(0x00);

      // Now we're in the delay period (reloadDelay=0).
      // Writing TMA should also update TIMA when reload fires.
      timer.writeRegister(TMA, 0xAA);
      const irq = timer.tick(4);
      expect(irq).toBe(true);
      // TIMA should have the NEW TMA value, not the old one
      expect(timer.readRegister(TIMA)).toBe(0xAA);
    });

    it("writing TIMA during pending overflow cancels delayed TMA reload", () => {
      timer.writeRegister(TMA, 0x99);
      timer.writeRegister(TAC, 0x05);
      timer.writeRegister(TIMA, 0xFF);

      timer.tick(16); // overflow -> TIMA=0x00, reload pending
      expect(timer.readRegister(TIMA)).toBe(0x00);

      timer.writeRegister(TIMA, 0x42); // cancel pending reload
      const irq = timer.tick(4);
      expect(irq).toBe(false);
      expect(timer.readRegister(TIMA)).toBe(0x42);
    });
  });

  describe("readRegister / writeRegister", () => {
    it("reads TMA after writing", () => {
      timer.writeRegister(TMA, 0xBB);
      expect(timer.readRegister(TMA)).toBe(0xBB);
    });

    it("reads TAC after writing (upper bits read as 1)", () => {
      timer.writeRegister(TAC, 0x07);
      expect(timer.readRegister(TAC)).toBe(0xFF);
    });

    it("can write and read TIMA directly", () => {
      timer.writeRegister(TIMA, 0xAB);
      expect(timer.readRegister(TIMA)).toBe(0xAB);
    });

    it("TAC: lower 3 bits writable, upper 5 bits read as 1", () => {
      timer.writeRegister(TAC, 0x05);
      // Upper 5 bits always read as 1 on DMG
      expect(timer.readRegister(TAC)).toBe(0x05 | 0xF8);
    });

    it("TAC: writing 0xFF reads back as 0xFF (lower 3 = 0x07, upper 5 = 1s)", () => {
      timer.writeRegister(TAC, 0xFF);
      expect(timer.readRegister(TAC)).toBe(0xFF);
    });
  });

  describe("reset", () => {
    it("resets all registers to 0", () => {
      timer.writeRegister(TAC, 0x05);
      timer.writeRegister(TMA, 0x80);
      timer.tick(1000);
      timer.reset();
      expect(timer.readRegister(DIV)).toBe(0);
      expect(timer.readRegister(TIMA)).toBe(0);
      expect(timer.readRegister(TMA)).toBe(0);
      expect(timer.readRegister(TAC)).toBe(0xF8); // lower 3 bits = 0, upper 5 = 1
    });

    it("resets internal counters", () => {
      timer.writeRegister(TAC, 0x05);
      timer.tick(200);
      timer.reset();
      timer.writeRegister(TAC, 0x05);
      timer.tick(16);
      expect(timer.readRegister(TIMA)).toBe(1);
      expect(timer.readRegister(DIV)).toBe(0);
    });
  });

  describe("serialize / deserialize", () => {
    it("round-trip preserves all state", () => {
      timer.writeRegister(TMA, 0x42);
      timer.writeRegister(TAC, 0x06);
      timer.tick(300);

      const data = timer.serialize();
      const restored = Timer.deserialize(data);

      expect(restored.readRegister(DIV)).toBe(timer.readRegister(DIV));
      expect(restored.readRegister(TIMA)).toBe(timer.readRegister(TIMA));
      expect(restored.readRegister(TMA)).toBe(timer.readRegister(TMA));
      expect(restored.readRegister(TAC)).toBe(timer.readRegister(TAC));
    });

    it("preserves internal counters across serialize/deserialize", () => {
      timer.writeRegister(TAC, 0x05);
      timer.tick(8); // half a TIMA cycle at 16 t-cycles

      const data = timer.serialize();
      const restored = Timer.deserialize(data);

      // Another 8 cycles should complete the increment
      restored.tick(8);
      expect(restored.readRegister(TIMA)).toBe(1);
    });

    it("preserves divCounter across serialize/deserialize", () => {
      timer.tick(128); // half a DIV cycle

      const data = timer.serialize();
      const restored = Timer.deserialize(data);

      restored.tick(128);
      expect(restored.readRegister(DIV)).toBe(1);
    });
  });
});
