import { describe, expect, it, beforeEach } from "bun:test";
import { MMU } from "../mmu";
import { Timer } from "../timer";
import { Joypad, Button } from "../input";

describe("MMU I/O delegation", () => {
  let mmu: MMU;

  beforeEach(() => {
    mmu = new MMU();
  });

  describe("without timer/joypad (hardware semantics)", () => {
    it("P1/JOYP (0xFF00): bits 5-4 writable, bits 7-6 read as 1, lower nibble idle", () => {
      mmu.writeByte(0xFF00, 0x30);
      expect(mmu.readByte(0xFF00)).toBe(0xFF);

      mmu.writeByte(0xFF00, 0x00);
      expect(mmu.readByte(0xFF00)).toBe(0xCF);
    });

    it("DIV (0xFF04): any write resets to 0", () => {
      mmu.writeByte(0xFF04, 0xAB);
      expect(mmu.readByte(0xFF04)).toBe(0x00);
    });

    it("reads and writes TIMA (0xFF05) as raw bytes", () => {
      mmu.writeByte(0xFF05, 0x10);
      expect(mmu.readByte(0xFF05)).toBe(0x10);
    });

    it("reads and writes TMA (0xFF06) as raw bytes", () => {
      mmu.writeByte(0xFF06, 0x20);
      expect(mmu.readByte(0xFF06)).toBe(0x20);
    });

    it("reads and writes TAC (0xFF07) as raw bytes", () => {
      mmu.writeByte(0xFF07, 0x05);
      expect(mmu.readByte(0xFF07)).toBe(0x05);
    });

    it("IF (0xFF0F): upper 3 bits always read as 1", () => {
      mmu.writeByte(0xFF0F, 0x1F);
      expect(mmu.readByte(0xFF0F)).toBe(0xFF);

      mmu.writeByte(0xFF40, 0x91);
      expect(mmu.readByte(0xFF40)).toBe(0x91);
    });
  });

  describe("with timer attached", () => {
    let timer: Timer;

    beforeEach(() => {
      timer = new Timer();
      mmu.timer = timer;
    });

    it("writing to DIV (0xFF04) delegates to timer.writeRegister and resets to 0", () => {
      timer.tick(512);
      expect(timer.readRegister(0xFF04)).not.toBe(0);

      mmu.writeByte(0xFF04, 0xFF);
      expect(timer.readRegister(0xFF04)).toBe(0);
    });

    it("reading DIV (0xFF04) returns timer.readRegister value, not stale io byte", () => {
      mmu.writeByte(0xFF04, 0xAB);
      expect(mmu.readByte(0xFF04)).toBe(0);

      timer.tick(256);
      expect(mmu.readByte(0xFF04)).toBe(1);

      timer.tick(256);
      expect(mmu.readByte(0xFF04)).toBe(2);
    });

    it("writing to TIMA (0xFF05) delegates to timer.writeRegister", () => {
      mmu.writeByte(0xFF05, 0x42);
      expect(timer.readRegister(0xFF05)).toBe(0x42);
      expect(mmu.readByte(0xFF05)).toBe(0x42);
    });

    it("writing to TMA (0xFF06) delegates to timer.writeRegister", () => {
      mmu.writeByte(0xFF06, 0x80);
      expect(timer.readRegister(0xFF06)).toBe(0x80);
      expect(mmu.readByte(0xFF06)).toBe(0x80);
    });

    it("writing to TAC (0xFF07) delegates to timer.writeRegister", () => {
      mmu.writeByte(0xFF07, 0x05);
      // TAC: upper 5 bits read as 1 on DMG
      expect(timer.readRegister(0xFF07)).toBe(0xFD);
      expect(mmu.readByte(0xFF07)).toBe(0xFD);
    });

    it("reading TIMA returns live timer state after ticks", () => {
      mmu.writeByte(0xFF07, 0x05); // enable timer, clock select 01 (threshold=16)
      mmu.writeByte(0xFF05, 0xFE); // TIMA = 0xFE

      timer.tick(16);
      expect(mmu.readByte(0xFF05)).toBe(0xFF);
    });

    it("timer overflow reloads TMA value into TIMA", () => {
      mmu.writeByte(0xFF06, 0x50); // TMA = 0x50
      mmu.writeByte(0xFF07, 0x05); // enable timer, clock select 01 (threshold=16)
      mmu.writeByte(0xFF05, 0xFF); // TIMA = 0xFF

      timer.tick(16);
      timer.tick(4); // delayed reload/IRQ point
      expect(mmu.readByte(0xFF05)).toBe(0x50);
    });
  });

  describe("with joypad attached", () => {
    let joypad: Joypad;

    beforeEach(() => {
      joypad = new Joypad();
      mmu.joypad = joypad;
    });

    it("writing to 0xFF00 stores selection bits in io array", () => {
      mmu.writeByte(0xFF00, 0x20);
      const result = mmu.readByte(0xFF00);
      expect(result & 0x30).toBe(0x20);
    });

    it("reading 0xFF00 returns joypad.read() with stored selection bits", () => {
      mmu.writeByte(0xFF00, 0x20);
      expect(mmu.readByte(0xFF00)).toBe(joypad.read(0x20));
    });

    it("selecting direction buttons and pressing Right returns correct state", () => {
      joypad.pressButton(Button.Right);
      mmu.writeByte(0xFF00, 0x10); // select directions (bit 4 = 0 means selected, but 0x10 = bit4 set = NOT selected for directions)

      mmu.writeByte(0xFF00, 0x20); // bit 5 set = actions NOT selected, bit 4 clear = directions selected
      const result = mmu.readByte(0xFF00);
      expect(result & 0x01).toBe(0); // bit 0 clear = Right pressed
    });

    it("selecting action buttons and pressing A returns correct state", () => {
      joypad.pressButton(Button.A);
      mmu.writeByte(0xFF00, 0x10); // bit 4 set = directions NOT selected, bit 5 clear = actions selected
      const result = mmu.readByte(0xFF00);
      expect(result & 0x01).toBe(0); // bit 0 clear = A pressed
    });

    it("no buttons pressed returns 0x0F in lower nibble", () => {
      mmu.writeByte(0xFF00, 0x20); // select directions
      const result = mmu.readByte(0xFF00);
      expect(result & 0x0F).toBe(0x0F);
    });

    it("releasing a button updates the read value", () => {
      joypad.pressButton(Button.Start);
      mmu.writeByte(0xFF00, 0x10); // select actions
      expect(mmu.readByte(0xFF00) & 0x08).toBe(0); // Start is bit 3, pressed = 0

      joypad.releaseButton(Button.Start);
      expect(mmu.readByte(0xFF00) & 0x08).toBe(0x08); // Start released = 1
    });
  });

  describe("non-timer/joypad I/O registers still work normally", () => {
    let timer: Timer;
    let joypad: Joypad;

    beforeEach(() => {
      timer = new Timer();
      joypad = new Joypad();
      mmu.timer = timer;
      mmu.joypad = joypad;
    });

    it("IF register (0xFF0F) keeps upper 3 bits set on read", () => {
      mmu.writeByte(0xFF0F, 0x1F);
      expect(mmu.readByte(0xFF0F)).toBe(0xFF);
    });

    it("LCDC register (0xFF40) reads/writes normally", () => {
      mmu.writeByte(0xFF40, 0x91);
      expect(mmu.readByte(0xFF40)).toBe(0x91);
    });

    it("BGP register (0xFF47) reads/writes normally", () => {
      mmu.writeByte(0xFF47, 0xFC);
      expect(mmu.readByte(0xFF47)).toBe(0xFC);
    });

    it("sound register (0xFF10) reads/writes normally", () => {
      mmu.writeByte(0xFF10, 0x80);
      expect(mmu.readByte(0xFF10)).toBe(0x80);
    });

    it("last I/O register (0xFF7F) reads/writes normally", () => {
      mmu.writeByte(0xFF7F, 0x01);
      expect(mmu.readByte(0xFF7F)).toBe(0x01);
    });
  });
});
