import { describe, it, expect, beforeEach } from "bun:test";
import { Joypad, Button } from "../input";

describe("Joypad", () => {
  let joypad: Joypad;

  beforeEach(() => {
    joypad = new Joypad();
  });

  describe("initial state", () => {
    it("all buttons released, direction select returns 0xEF (all high in lower nibble)", () => {
      // Select directions (write 0x20 -> bit 5 set, bit 4 clear)
      const result = joypad.read(0x20);
      // Bits 7-6 = 1, bits 5-4 reflect input (0x20 = 0b0010_0000), bits 3-0 = 1111 (all released)
      expect(result).toBe(0xEF); // 0b1110_1111
    });

    it("all buttons released, action select returns 0xDF (all high in lower nibble)", () => {
      // Select actions (write 0x10 -> bit 4 set, bit 5 clear)
      const result = joypad.read(0x10);
      // Bits 7-6 = 1, bits 5-4 reflect input (0x10 = 0b0001_0000), bits 3-0 = 1111
      expect(result).toBe(0xDF); // 0b1101_1111
    });

    it("both deselected (0x30) returns 0xFF — no button matrix is read", () => {
      const result = joypad.read(0x30);
      expect(result).toBe(0xFF); // 0b1111_1111
    });
  });

  describe("direction selection (write 0x20)", () => {
    const SELECT_DIRECTIONS = 0x20;

    it("pressing Right clears bit 0", () => {
      joypad.pressButton(Button.Right);
      const result = joypad.read(SELECT_DIRECTIONS);
      expect(result & 0x0F).toBe(0x0E); // bit 0 = 0
    });

    it("pressing Left clears bit 1", () => {
      joypad.pressButton(Button.Left);
      const result = joypad.read(SELECT_DIRECTIONS);
      expect(result & 0x0F).toBe(0x0D); // bit 1 = 0
    });

    it("pressing Up clears bit 2", () => {
      joypad.pressButton(Button.Up);
      const result = joypad.read(SELECT_DIRECTIONS);
      expect(result & 0x0F).toBe(0x0B); // bit 2 = 0
    });

    it("pressing Down clears bit 3", () => {
      joypad.pressButton(Button.Down);
      const result = joypad.read(SELECT_DIRECTIONS);
      expect(result & 0x0F).toBe(0x07); // bit 3 = 0
    });

    it("direction buttons do not appear in action selection", () => {
      joypad.pressButton(Button.Right);
      joypad.pressButton(Button.Up);
      const result = joypad.read(0x10); // select actions
      expect(result & 0x0F).toBe(0x0F); // all released
    });
  });

  describe("action selection (write 0x10)", () => {
    const SELECT_ACTIONS = 0x10;

    it("pressing A clears bit 0", () => {
      joypad.pressButton(Button.A);
      const result = joypad.read(SELECT_ACTIONS);
      expect(result & 0x0F).toBe(0x0E); // bit 0 = 0
    });

    it("pressing B clears bit 1", () => {
      joypad.pressButton(Button.B);
      const result = joypad.read(SELECT_ACTIONS);
      expect(result & 0x0F).toBe(0x0D); // bit 1 = 0
    });

    it("pressing Select clears bit 2", () => {
      joypad.pressButton(Button.Select);
      const result = joypad.read(SELECT_ACTIONS);
      expect(result & 0x0F).toBe(0x0B); // bit 2 = 0
    });

    it("pressing Start clears bit 3", () => {
      joypad.pressButton(Button.Start);
      const result = joypad.read(SELECT_ACTIONS);
      expect(result & 0x0F).toBe(0x07); // bit 3 = 0
    });

    it("action buttons do not appear in direction selection", () => {
      joypad.pressButton(Button.A);
      joypad.pressButton(Button.Start);
      const result = joypad.read(0x20); // select directions
      expect(result & 0x0F).toBe(0x0F); // all released
    });
  });

  describe("press and release", () => {
    it("releasing a button restores the bit to 1", () => {
      joypad.pressButton(Button.A);
      expect(joypad.read(0x10) & 0x0F).toBe(0x0E);

      joypad.releaseButton(Button.A);
      expect(joypad.read(0x10) & 0x0F).toBe(0x0F);
    });

    it("releasing a direction button restores the bit to 1", () => {
      joypad.pressButton(Button.Down);
      expect(joypad.read(0x20) & 0x0F).toBe(0x07);

      joypad.releaseButton(Button.Down);
      expect(joypad.read(0x20) & 0x0F).toBe(0x0F);
    });
  });

  describe("multiple buttons", () => {
    it("pressing Right + A shows correct bits in each selection mode", () => {
      joypad.pressButton(Button.Right);
      joypad.pressButton(Button.A);

      // Direction select: Right is bit 0
      const dirResult = joypad.read(0x20);
      expect(dirResult & 0x0F).toBe(0x0E); // only bit 0 low

      // Action select: A is bit 0
      const actResult = joypad.read(0x10);
      expect(actResult & 0x0F).toBe(0x0E); // only bit 0 low
    });

    it("pressing multiple direction buttons", () => {
      joypad.pressButton(Button.Up);
      joypad.pressButton(Button.Left);

      const result = joypad.read(0x20);
      // Up = bit 2 clear, Left = bit 1 clear -> 0b1001 = 0x09
      expect(result & 0x0F).toBe(0x09);
    });

    it("pressing multiple action buttons", () => {
      joypad.pressButton(Button.B);
      joypad.pressButton(Button.Start);

      const result = joypad.read(0x10);
      // B = bit 1 clear, Start = bit 3 clear -> 0b0101 = 0x05
      expect(result & 0x0F).toBe(0x05);
    });
  });

  describe("active low logic", () => {
    it("pressed = 0, released = 1", () => {
      joypad.pressButton(Button.Right);
      const pressed = joypad.read(0x20);
      expect((pressed >> 0) & 1).toBe(0); // bit 0 = 0 (pressed)

      joypad.releaseButton(Button.Right);
      const released = joypad.read(0x20);
      expect((released >> 0) & 1).toBe(1); // bit 0 = 1 (released)
    });
  });

  describe("deselect both (0x30)", () => {
    it("returns all button bits as 1 even when buttons are pressed", () => {
      joypad.pressButton(Button.A);
      joypad.pressButton(Button.Right);
      joypad.pressButton(Button.Start);

      const result = joypad.read(0x30);
      expect(result & 0x0F).toBe(0x0F); // all high
    });

    it("upper bits reflect selection (0x30) with bits 7-6 set", () => {
      const result = joypad.read(0x30);
      expect(result).toBe(0xFF);
    });
  });

  describe("upper bits in read result", () => {
    it("bits 7-6 always set to 1, bits 5-4 reflect selection write", () => {
      // Direction select: written 0x20, bits 5-4 = 10
      const dir = joypad.read(0x20);
      expect(dir & 0xF0).toBe(0xE0); // 0b1110_0000

      // Action select: written 0x10, bits 5-4 = 01
      const act = joypad.read(0x10);
      expect(act & 0xF0).toBe(0xD0); // 0b1101_0000

      // Both deselected: written 0x30, bits 5-4 = 11
      const both = joypad.read(0x30);
      expect(both & 0xF0).toBe(0xF0); // 0b1111_0000
    });
  });

  describe("interrupt on press", () => {
    it("pressing a selected button sets interrupt flag", () => {
      joypad.writeSelect(0x10); // select action buttons
      joypad.pressButton(Button.A);
      expect(joypad.isInterruptRequested()).toBe(true);
    });

    it("interrupt clears after isInterruptRequested() is called", () => {
      joypad.writeSelect(0x10); // select action buttons
      joypad.pressButton(Button.A);
      expect(joypad.isInterruptRequested()).toBe(true);
      expect(joypad.isInterruptRequested()).toBe(false);
    });

    it("no interrupt initially", () => {
      expect(joypad.isInterruptRequested()).toBe(false);
    });

    it("pressing a deselected button does not set interrupt", () => {
      joypad.writeSelect(0x20); // select direction buttons
      joypad.pressButton(Button.Start); // action button not selected
      expect(joypad.isInterruptRequested()).toBe(false);
    });

    it("pressing multiple buttons still sets interrupt when a selected line falls", () => {
      joypad.writeSelect(0x20); // select direction buttons
      joypad.pressButton(Button.Up);
      joypad.pressButton(Button.Start);
      expect(joypad.isInterruptRequested()).toBe(true);
      expect(joypad.isInterruptRequested()).toBe(false);
    });

    it("pressing a button after clearing interrupt sets it again", () => {
      joypad.writeSelect(0x10); // select action buttons
      joypad.pressButton(Button.A);
      joypad.isInterruptRequested(); // clear
      joypad.pressButton(Button.B);
      expect(joypad.isInterruptRequested()).toBe(true);
    });
  });

  describe("release does NOT trigger interrupt", () => {
    it("releasing a button does not set interrupt flag", () => {
      joypad.writeSelect(0x10); // select action buttons
      joypad.pressButton(Button.A);
      joypad.isInterruptRequested(); // clear
      joypad.releaseButton(Button.A);
      expect(joypad.isInterruptRequested()).toBe(false);
    });

    it("pressing then releasing, only press triggers interrupt", () => {
      joypad.writeSelect(0x20); // select direction buttons
      joypad.pressButton(Button.Right);
      expect(joypad.isInterruptRequested()).toBe(true);
      joypad.releaseButton(Button.Right);
      expect(joypad.isInterruptRequested()).toBe(false);
    });
  });

  describe("reset", () => {
    it("clears all button state", () => {
      joypad.pressButton(Button.A);
      joypad.pressButton(Button.Right);
      joypad.reset();

      expect(joypad.read(0x10) & 0x0F).toBe(0x0F);
      expect(joypad.read(0x20) & 0x0F).toBe(0x0F);
    });

    it("clears interrupt flag", () => {
      joypad.pressButton(Button.A);
      joypad.reset();
      expect(joypad.isInterruptRequested()).toBe(false);
    });
  });

  describe("serialize / deserialize", () => {
    it("round-trip preserves button states", () => {
      joypad.pressButton(Button.A);
      joypad.pressButton(Button.Up);
      joypad.pressButton(Button.Start);

      const data = joypad.serialize();
      const restored = Joypad.deserialize(data);

      // Verify same button states
      expect(restored.read(0x10)).toBe(joypad.read(0x10));
      expect(restored.read(0x20)).toBe(joypad.read(0x20));
    });

    it("round-trip preserves interrupt flag", () => {
      joypad.writeSelect(0x10); // select action buttons
      joypad.pressButton(Button.B);
      // interrupt is pending, don't clear it

      const data = joypad.serialize();
      const restored = Joypad.deserialize(data);

      expect(restored.isInterruptRequested()).toBe(true);
    });

    it("round-trip with no buttons pressed", () => {
      const data = joypad.serialize();
      const restored = Joypad.deserialize(data);

      expect(restored.read(0x10)).toBe(joypad.read(0x10));
      expect(restored.read(0x20)).toBe(joypad.read(0x20));
      expect(restored.isInterruptRequested()).toBe(false);
    });

    it("returns Uint8Array from serialize", () => {
      const data = joypad.serialize();
      expect(data).toBeInstanceOf(Uint8Array);
    });
  });
});
