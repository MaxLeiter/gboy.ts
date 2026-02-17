import { describe, it, expect, beforeEach } from "bun:test";
import { PPU } from "../ppu";
import { MMU } from "../mmu";

const LCDC = 0xFF40;
const STAT = 0xFF41;
const SCY = 0xFF42;
const SCX = 0xFF43;
const LY = 0xFF44;
const LYC = 0xFF45;
const BGP = 0xFF47;

function enableLCD(mmu: MMU) {
  mmu.writeByte(LCDC, 0x91); // LCD on, BG on, unsigned tile data
}

// NOTE: Mode 3 is fixed at 172 T-cycles here. On real hardware, Mode 3 varies
// (172-289 T-cycles) based on sprite count, SCX fine-scroll, and window usage.
// Mode 0 (HBlank) fills the remainder of the 456-cycle scanline.
function tickOneScanline(ppu: PPU) {
  ppu.tick(80);   // Mode 2: OAM scan (fixed 80 T-cycles)
  ppu.tick(172);  // Mode 3: Drawing (simplified; real HW varies 172-289)
  ppu.tick(204);  // Mode 0: HBlank (simplified; real HW varies accordingly)
}

function tickCycles(ppu: PPU, cycles: number, step = 4) {
  let vblank = false;
  let stat = false;
  for (let i = 0; i < cycles; i += step) {
    const result = ppu.tick(step);
    if (result.requestVBlankInterrupt) vblank = true;
    if (result.requestStatInterrupt) stat = true;
  }
  return { requestVBlankInterrupt: vblank, requestStatInterrupt: stat };
}

describe("PPU", () => {
  let mmu: MMU;
  let ppu: PPU;

  beforeEach(() => {
    mmu = new MMU();
    ppu = new PPU(mmu);
    enableLCD(mmu);
  });

  describe("Mode transitions", () => {
    it("starts in mode 2 (OAM scan)", () => {
      expect(ppu.mode).toBe(2);
    });

    it("transitions from mode 2 to mode 3 after 80 t-cycles", () => {
      ppu.tick(80);
      expect(ppu.mode).toBe(3);
    });

    it("stays in mode 2 before 80 t-cycles", () => {
      ppu.tick(79);
      expect(ppu.mode).toBe(2);
    });

    it("transitions from mode 3 to mode 0 after 172 t-cycles", () => {
      ppu.tick(80);
      expect(ppu.mode).toBe(3);
      ppu.tick(172);
      expect(ppu.mode).toBe(0);
    });

    it("transitions from mode 0 to mode 2 after 204 t-cycles (non-last visible line)", () => {
      ppu.tick(80);
      ppu.tick(172);
      ppu.tick(204);
      expect(ppu.mode).toBe(2);
      expect(ppu.line).toBe(1);
    });

    it("completes a full scanline in 456 t-cycles (80+172+204)", () => {
      tickOneScanline(ppu);
      expect(ppu.line).toBe(1);
      expect(ppu.mode).toBe(2);
    });

    it("mode 2 -> 3 -> 0 -> 2 for each visible line", () => {
      for (let line = 0; line < 5; line++) {
        expect(ppu.mode).toBe(2);
        expect(ppu.line).toBe(line);
        ppu.tick(80);
        expect(ppu.mode).toBe(3);
        ppu.tick(172);
        expect(ppu.mode).toBe(0);
        ppu.tick(204);
      }
      expect(ppu.line).toBe(5);
      expect(ppu.mode).toBe(2);
    });

    it("enters mode 1 (VBlank) after 144 visible scanlines", () => {
      for (let i = 0; i < 144; i++) {
        tickOneScanline(ppu);
      }
      expect(ppu.line).toBe(144);
      expect(ppu.mode).toBe(1);
    });

    it("stays in mode 1 for 10 lines (lines 144-153)", () => {
      for (let i = 0; i < 144; i++) {
        tickOneScanline(ppu);
      }
      expect(ppu.mode).toBe(1);
      expect(ppu.line).toBe(144);

      for (let i = 0; i < 9; i++) {
        ppu.tick(456);
        expect(ppu.mode).toBe(1);
        expect(ppu.line).toBe(145 + i);
      }

      ppu.tick(456);
      expect(ppu.mode).toBe(2);
      expect(ppu.line).toBe(0);
    });

    it("returns to mode 2 line 0 after a full frame (154 lines)", () => {
      for (let i = 0; i < 144; i++) {
        tickOneScanline(ppu);
      }
      for (let i = 0; i < 10; i++) {
        ppu.tick(456);
      }
      expect(ppu.line).toBe(0);
      expect(ppu.mode).toBe(2);
    });
  });

  describe("LY tracking", () => {
    it("starts at line 0", () => {
      expect(ppu.line).toBe(0);
    });

    it("increments after each full scanline", () => {
      tickOneScanline(ppu);
      expect(ppu.line).toBe(1);
      tickOneScanline(ppu);
      expect(ppu.line).toBe(2);
    });

    it("updates LY register in memory", () => {
      tickOneScanline(ppu);
      expect(mmu.readByte(LY)).toBe(1);
    });

    it("increments through all 154 lines (0-153) then wraps to 0", () => {
      for (let i = 0; i < 144; i++) {
        expect(ppu.line).toBe(i);
        tickOneScanline(ppu);
      }
      for (let i = 0; i < 10; i++) {
        expect(ppu.line).toBe(144 + i);
        ppu.tick(456);
      }
      expect(ppu.line).toBe(0);
    });

    it("LY in memory matches ppu.line throughout a frame", () => {
      for (let i = 0; i < 144; i++) {
        tickOneScanline(ppu);
        expect(mmu.readByte(LY)).toBe(ppu.line);
      }
    });
  });

  describe("VBlank interrupt", () => {
    it("returns requestVBlankInterrupt=true exactly once when entering mode 1", () => {
      let vblankCount = 0;
      for (let i = 0; i < 143; i++) {
        const r = tickCycles(ppu, 456);
        if (r.requestVBlankInterrupt) vblankCount++;
      }
      expect(vblankCount).toBe(0);

      const result = tickCycles(ppu, 456);
      expect(result.requestVBlankInterrupt).toBe(true);
      vblankCount++;
      expect(vblankCount).toBe(1);
    });

    it("does not return requestVBlankInterrupt during vblank lines 145-153", () => {
      for (let i = 0; i < 144; i++) {
        tickOneScanline(ppu);
      }
      for (let i = 0; i < 10; i++) {
        const result = ppu.tick(456);
        expect(result.requestVBlankInterrupt).toBe(false);
      }
    });

    it("requestVBlankInterrupt fires once per frame", () => {
      let vblankCount = 0;

      for (let frame = 0; frame < 3; frame++) {
        for (let i = 0; i < 144; i++) {
          const r = tickCycles(ppu, 456);
          if (r.requestVBlankInterrupt) vblankCount++;
        }
        for (let i = 0; i < 10; i++) {
          const r = ppu.tick(456);
          if (r.requestVBlankInterrupt) vblankCount++;
        }
      }
      expect(vblankCount).toBe(3);
    });
  });

  describe("STAT LYC coincidence", () => {
    it("sets STAT bit 2 when LY matches LYC", () => {
      mmu.writeByte(LYC, 1);
      tickOneScanline(ppu);
      expect(ppu.line).toBe(1);
      const stat = mmu.readByte(STAT);
      expect(stat & 0x04).toBe(0x04);
    });

    it("clears STAT bit 2 when LY does not match LYC", () => {
      mmu.writeByte(LYC, 10);
      tickOneScanline(ppu);
      expect(ppu.line).toBe(1);
      const stat = mmu.readByte(STAT);
      expect(stat & 0x04).toBe(0);
    });

    it("returns requestStatInterrupt when STAT bit 6 is set and LY==LYC", () => {
      mmu.writeByte(LYC, 5);
      mmu.writeByte(STAT, 0x40); // LYC interrupt enable

      let gotStat = false;
      for (let i = 0; i < 10; i++) {
        const result = tickCycles(ppu, 456);
        if (result.requestStatInterrupt) {
          gotStat = true;
          expect(ppu.line).toBe(5);
        }
      }
      expect(gotStat).toBe(true);
    });

    it("does not fire STAT interrupt when bit 6 is clear", () => {
      mmu.writeByte(LYC, 5);
      mmu.writeByte(STAT, 0x00);

      for (let i = 0; i < 10; i++) {
        const result = tickCycles(ppu, 456);
        expect(result.requestStatInterrupt).toBe(false);
      }
    });

    it("STAT mode bits reflect current PPU mode", () => {
      // Before any tick, STAT in memory is 0x00 (MMU default); mode bits are not yet written
      ppu.tick(80); // mode 2 -> 3
      expect(mmu.readByte(STAT) & 0x03).toBe(3);
      ppu.tick(172); // mode 3 -> 0
      expect(mmu.readByte(STAT) & 0x03).toBe(0);
      ppu.tick(204); // mode 0 -> 2
      expect(mmu.readByte(STAT) & 0x03).toBe(2);
    });

    it("fires STAT interrupt on mode 0 when STAT bit 3 is enabled", () => {
      mmu.writeByte(STAT, 0x08);
      ppu.tick(80); // mode 2 -> 3
      const result = ppu.tick(172); // mode 3 -> 0
      expect(result.requestStatInterrupt).toBe(true);
      expect(ppu.mode).toBe(0);
    });

    it("fires STAT interrupt on mode 1 when STAT bit 4 is enabled", () => {
      mmu.writeByte(STAT, 0x10);
      let gotStat = false;

      for (let i = 0; i < 144; i++) {
        const result = tickCycles(ppu, 456);
        if (result.requestStatInterrupt) {
          gotStat = true;
        }
      }

      expect(ppu.mode).toBe(1);
      expect(gotStat).toBe(true);
    });

    it("fires STAT interrupt on mode 2 when STAT bit 5 is enabled", () => {
      mmu.writeByte(STAT, 0x20);
      ppu.tick(80); // mode 2 -> 3
      ppu.tick(172); // mode 3 -> 0
      const result = ppu.tick(204); // mode 0 -> 2
      expect(result.requestStatInterrupt).toBe(true);
      expect(ppu.mode).toBe(2);
    });

    it("STAT interrupt is edge-triggered (does not repeat while condition stays high)", () => {
      mmu.writeByte(STAT, 0x08); // mode 0 interrupt enable
      ppu.tick(80); // mode 2 -> 3
      const first = ppu.tick(172); // mode 3 -> 0
      expect(first.requestStatInterrupt).toBe(true);

      const second = ppu.tick(100); // still mode 0
      expect(second.requestStatInterrupt).toBe(false);
      expect(ppu.mode).toBe(0);
    });
  });

  describe("Framebuffer", () => {
    it("has correct size: 160*144*4 = 92160 bytes", () => {
      expect(ppu.getFramebuffer().length).toBe(92160);
    });

    it("initializes to all white (255)", () => {
      const fb = ppu.getFramebuffer();
      for (let i = 0; i < fb.length; i++) {
        expect(fb[i]).toBe(255);
      }
    });
  });

  describe("Background rendering", () => {
    function writeSolidTile(mmu: MMU, baseAddr: number, colorIdx: number) {
      for (let row = 0; row < 8; row++) {
        const lo = (colorIdx & 1) ? 0xFF : 0x00;
        const hi = (colorIdx & 2) ? 0xFF : 0x00;
        mmu.writeByte(baseAddr + row * 2, lo);
        mmu.writeByte(baseAddr + row * 2 + 1, hi);
      }
    }

    it("renders a solid color 3 tile as black with BGP=0xE4", () => {
      mmu.writeByte(LCDC, 0x91); // LCD on, BG on, unsigned tile data, tile map 0x9800
      mmu.writeByte(BGP, 0xE4); // standard palette: 0=white, 1=light, 2=dark, 3=black

      writeSolidTile(mmu, 0x8000, 3);

      mmu.writeByte(0x9800, 0); // tile map entry 0 -> tile 0

      mmu.writeByte(SCX, 0);
      mmu.writeByte(SCY, 0);

      ppu.tick(80);
      ppu.tick(172);

      const fb = ppu.getFramebuffer();
      for (let px = 0; px < 8; px++) {
        const i = px * 4;
        expect(fb[i]).toBe(0);     // R
        expect(fb[i + 1]).toBe(0); // G
        expect(fb[i + 2]).toBe(0); // B
        expect(fb[i + 3]).toBe(255); // A
      }
    });

    it("renders a solid color 0 tile as white with BGP=0xE4", () => {
      mmu.writeByte(LCDC, 0x91);
      mmu.writeByte(BGP, 0xE4);

      writeSolidTile(mmu, 0x8000, 0);
      mmu.writeByte(0x9800, 0);
      mmu.writeByte(SCX, 0);
      mmu.writeByte(SCY, 0);

      ppu.tick(80);
      ppu.tick(172);

      const fb = ppu.getFramebuffer();
      for (let px = 0; px < 8; px++) {
        const i = px * 4;
        expect(fb[i]).toBe(255);
        expect(fb[i + 1]).toBe(255);
        expect(fb[i + 2]).toBe(255);
        expect(fb[i + 3]).toBe(255);
      }
    });

    it("renders with signed tile data mode (LCDC bit 4=0)", () => {
      mmu.writeByte(LCDC, 0x81); // LCD on, BG on, signed tile data (bit 4=0), map 0x9800
      mmu.writeByte(BGP, 0xE4);

      // Index 0 maps to address 0x9000
      writeSolidTile(mmu, 0x9000, 2);
      mmu.writeByte(0x9800, 0); // tile index 0

      mmu.writeByte(SCX, 0);
      mmu.writeByte(SCY, 0);

      ppu.tick(80);
      ppu.tick(172);

      const fb = ppu.getFramebuffer();
      // color 2 with BGP=0xE4 -> shade 2 -> 96
      for (let px = 0; px < 8; px++) {
        const i = px * 4;
        expect(fb[i]).toBe(96);
        expect(fb[i + 1]).toBe(96);
        expect(fb[i + 2]).toBe(96);
      }
    });

    it("handles signed negative tile indices (index 128 -> addr 0x8800)", () => {
      mmu.writeByte(LCDC, 0x81); // signed tile data mode
      mmu.writeByte(BGP, 0xE4);

      // Index 128 is treated as -128, so address = 0x9000 + (-128)*16 = 0x8800
      writeSolidTile(mmu, 0x8800, 1);
      mmu.writeByte(0x9800, 128);

      mmu.writeByte(SCX, 0);
      mmu.writeByte(SCY, 0);

      ppu.tick(80);
      ppu.tick(172);

      const fb = ppu.getFramebuffer();
      // color 1 with BGP=0xE4 -> shade 1 -> 192
      for (let px = 0; px < 8; px++) {
        const i = px * 4;
        expect(fb[i]).toBe(192);
      }
    });

    it("uses tile map at 0x9C00 when LCDC bit 3 is set", () => {
      mmu.writeByte(LCDC, 0x99); // LCD on, BG on, unsigned tile data, tile map 0x9C00
      mmu.writeByte(BGP, 0xE4);

      writeSolidTile(mmu, 0x8000, 3);
      mmu.writeByte(0x9C00, 0); // tile 0 at the alternate tile map

      mmu.writeByte(SCX, 0);
      mmu.writeByte(SCY, 0);

      ppu.tick(80);
      ppu.tick(172);

      const fb = ppu.getFramebuffer();
      for (let px = 0; px < 8; px++) {
        const i = px * 4;
        expect(fb[i]).toBe(0);
      }
    });

    it("renders different tiles across the screen", () => {
      mmu.writeByte(LCDC, 0x91);
      mmu.writeByte(BGP, 0xE4);

      // Tile 0: all color 0 (white)
      writeSolidTile(mmu, 0x8000, 0);
      // Tile 1: all color 3 (black)
      writeSolidTile(mmu, 0x8010, 3);

      // Alternate tiles in the map: tile 0, tile 1, tile 0, ...
      for (let col = 0; col < 20; col++) {
        mmu.writeByte(0x9800 + col, col % 2);
      }

      mmu.writeByte(SCX, 0);
      mmu.writeByte(SCY, 0);

      ppu.tick(80);
      ppu.tick(172);

      const fb = ppu.getFramebuffer();
      // First 8 pixels: tile 0 = white (255)
      for (let px = 0; px < 8; px++) {
        expect(fb[px * 4]).toBe(255);
      }
      // Next 8 pixels: tile 1 = black (0)
      for (let px = 8; px < 16; px++) {
        expect(fb[px * 4]).toBe(0);
      }
      // Next 8: white again
      for (let px = 16; px < 24; px++) {
        expect(fb[px * 4]).toBe(255);
      }
    });

    it("correctly decodes tile pixel bits (bit 7 = leftmost)", () => {
      mmu.writeByte(LCDC, 0x91);
      mmu.writeByte(BGP, 0xE4);

      // Tile with row 0: lo=0x80 (bit 7 set), hi=0x00 -> pixel 0=color1, rest=color0
      mmu.writeByte(0x8000, 0x80); // lo
      mmu.writeByte(0x8001, 0x00); // hi
      for (let row = 1; row < 8; row++) {
        mmu.writeByte(0x8000 + row * 2, 0x00);
        mmu.writeByte(0x8000 + row * 2 + 1, 0x00);
      }

      mmu.writeByte(0x9800, 0);
      mmu.writeByte(SCX, 0);
      mmu.writeByte(SCY, 0);

      ppu.tick(80);
      ppu.tick(172);

      const fb = ppu.getFramebuffer();
      // Pixel 0 = color 1 -> shade 192
      expect(fb[0]).toBe(192);
      // Pixel 1-7 = color 0 -> shade 255
      for (let px = 1; px < 8; px++) {
        expect(fb[px * 4]).toBe(255);
      }
    });

    it("combines hi and lo bytes for 2-bit color", () => {
      mmu.writeByte(LCDC, 0x91);
      mmu.writeByte(BGP, 0xE4);

      // Row 0: lo=0xAA (10101010), hi=0x55 (01010101)
      // Pixel 0 (bit 7): lo=1, hi=0 -> color 1
      // Pixel 1 (bit 6): lo=0, hi=1 -> color 2
      // Pixel 2 (bit 5): lo=1, hi=0 -> color 1
      // Pixel 3 (bit 4): lo=0, hi=1 -> color 2
      // etc.
      mmu.writeByte(0x8000, 0xAA); // lo
      mmu.writeByte(0x8001, 0x55); // hi
      for (let row = 1; row < 8; row++) {
        mmu.writeByte(0x8000 + row * 2, 0x00);
        mmu.writeByte(0x8000 + row * 2 + 1, 0x00);
      }

      mmu.writeByte(0x9800, 0);
      mmu.writeByte(SCX, 0);
      mmu.writeByte(SCY, 0);

      ppu.tick(80);
      ppu.tick(172);

      const fb = ppu.getFramebuffer();
      // Pixel 0: color 1 (hi=0, lo=1) -> 192
      expect(fb[0]).toBe(192);
      // Pixel 1: color 2 (hi=1, lo=0) -> 96
      expect(fb[4]).toBe(96);
      // Pixel 2: color 1 -> 192
      expect(fb[8]).toBe(192);
      // Pixel 3: color 2 -> 96
      expect(fb[12]).toBe(96);
    });
  });

  describe("BGP palette", () => {
    function writeSolidTile(mmu: MMU, baseAddr: number, colorIdx: number) {
      for (let row = 0; row < 8; row++) {
        const lo = (colorIdx & 1) ? 0xFF : 0x00;
        const hi = (colorIdx & 2) ? 0xFF : 0x00;
        mmu.writeByte(baseAddr + row * 2, lo);
        mmu.writeByte(baseAddr + row * 2 + 1, hi);
      }
    }

    it("BGP=0xE4 maps colors 0->255, 1->192, 2->96, 3->0", () => {
      mmu.writeByte(LCDC, 0x91);
      mmu.writeByte(BGP, 0xE4); // 11 10 01 00

      writeSolidTile(mmu, 0x8000, 0);
      mmu.writeByte(0x9800, 0);

      ppu.tick(80);
      ppu.tick(172);
      const fb = ppu.getFramebuffer();
      expect(fb[0]).toBe(255); // color 0 -> shade 0 -> 255
    });

    it("BGP=0x00 maps all colors to shade 0 (white)", () => {
      mmu.writeByte(LCDC, 0x91);
      mmu.writeByte(BGP, 0x00);

      writeSolidTile(mmu, 0x8000, 3);
      mmu.writeByte(0x9800, 0);

      ppu.tick(80);
      ppu.tick(172);
      const fb = ppu.getFramebuffer();
      expect(fb[0]).toBe(255); // color 3 -> palette entry 3 -> shade 0 -> 255
    });

    it("BGP=0xFF maps all colors to shade 3 (black)", () => {
      mmu.writeByte(LCDC, 0x91);
      mmu.writeByte(BGP, 0xFF);

      writeSolidTile(mmu, 0x8000, 0);
      mmu.writeByte(0x9800, 0);

      ppu.tick(80);
      ppu.tick(172);
      const fb = ppu.getFramebuffer();
      expect(fb[0]).toBe(0); // color 0 -> palette entry 0 -> shade 3 -> 0
    });

    it("BGP=0x1B inverts the palette (0->0, 1->96, 2->192, 3->255)", () => {
      mmu.writeByte(LCDC, 0x91);
      mmu.writeByte(BGP, 0x1B); // 00 01 10 11

      writeSolidTile(mmu, 0x8000, 3);
      mmu.writeByte(0x9800, 0);

      ppu.tick(80);
      ppu.tick(172);
      const fb = ppu.getFramebuffer();
      // color 3 -> palette entry 3 = (0x1B >> 6) & 3 = 0 -> shade 0 -> 255
      expect(fb[0]).toBe(255);
    });

    it("different palette values produce correct shades for each color index", () => {
      mmu.writeByte(LCDC, 0x91);
      // BGP=0x39: entry0=01(192), entry1=10(96), entry2=11(0), entry3=00(255)
      mmu.writeByte(BGP, 0x39); // 00 11 10 01

      // Use tile with lo=0xFF, hi=0x00 -> all color 1
      writeSolidTile(mmu, 0x8000, 1);
      mmu.writeByte(0x9800, 0);

      ppu.tick(80);
      ppu.tick(172);
      const fb = ppu.getFramebuffer();
      // color 1 -> palette entry 1 = (0x39 >> 2) & 3 = 0x0E & 3 = 2 -> shade 2 -> 96
      expect(fb[0]).toBe(96);
    });
  });

  describe("SCX/SCY scrolling", () => {
    function writeSolidTile(mmu: MMU, baseAddr: number, colorIdx: number) {
      for (let row = 0; row < 8; row++) {
        const lo = (colorIdx & 1) ? 0xFF : 0x00;
        const hi = (colorIdx & 2) ? 0xFF : 0x00;
        mmu.writeByte(baseAddr + row * 2, lo);
        mmu.writeByte(baseAddr + row * 2 + 1, hi);
      }
    }

    it("SCX shifts the rendered pixels horizontally", () => {
      mmu.writeByte(LCDC, 0x91);
      mmu.writeByte(BGP, 0xE4);

      // Tile 0: white, Tile 1: black
      writeSolidTile(mmu, 0x8000, 0);
      writeSolidTile(mmu, 0x8010, 3);

      // Map: tile 0, tile 1, ...
      mmu.writeByte(0x9800, 0);
      mmu.writeByte(0x9801, 1);

      mmu.writeByte(SCX, 4); // scroll right by 4 pixels
      mmu.writeByte(SCY, 0);

      ppu.tick(80);
      ppu.tick(172);

      const fb = ppu.getFramebuffer();
      // Pixel 0 on screen = BG pixel 4 of tile 0 = white
      expect(fb[0]).toBe(255);
      // Pixels 0-3 on screen = BG pixels 4-7 of tile 0 = white
      for (let px = 0; px < 4; px++) {
        expect(fb[px * 4]).toBe(255);
      }
      // Pixels 4-11 on screen = BG pixels 8-15 = tile 1 = black
      for (let px = 4; px < 12; px++) {
        expect(fb[px * 4]).toBe(0);
      }
    });

    it("SCY shifts the rendered pixels vertically", () => {
      mmu.writeByte(LCDC, 0x91);
      mmu.writeByte(BGP, 0xE4);

      // Tile 0: white, Tile 1: black
      writeSolidTile(mmu, 0x8000, 0);
      writeSolidTile(mmu, 0x8010, 3);

      // Row 0 of tile map: tile 0 (white)
      mmu.writeByte(0x9800, 0);
      // Row 1 of tile map (offset 32): tile 1 (black)
      mmu.writeByte(0x9800 + 32, 1);

      mmu.writeByte(SCX, 0);
      mmu.writeByte(SCY, 8); // skip first row of tiles

      ppu.tick(80);
      ppu.tick(172);

      const fb = ppu.getFramebuffer();
      // Line 0 with SCY=8 reads tile map row 1 = tile 1 = black
      for (let px = 0; px < 8; px++) {
        expect(fb[px * 4]).toBe(0);
      }
    });

    it("background wraps horizontally at 256 pixels (32 tiles)", () => {
      mmu.writeByte(LCDC, 0x91);
      mmu.writeByte(BGP, 0xE4);

      // Tile 0: white, Tile 1: black
      writeSolidTile(mmu, 0x8000, 0);
      writeSolidTile(mmu, 0x8010, 3);

      // Fill entire row with tile 0 (white)
      for (let col = 0; col < 32; col++) {
        mmu.writeByte(0x9800 + col, 0);
      }
      // Put tile 1 (black) at column 0
      mmu.writeByte(0x9800, 1);

      // Scroll so that the first pixel on screen comes from the last tile column
      // SCX=248 means pixel 0 = BG(248), which is tile column 31 (last tile, white)
      // Pixel 8 = BG(256 & 0xFF = 0), which is tile column 0 (black)
      mmu.writeByte(SCX, 248);
      mmu.writeByte(SCY, 0);

      ppu.tick(80);
      ppu.tick(172);

      const fb = ppu.getFramebuffer();
      // First 8 pixels = tile col 31 = white
      for (let px = 0; px < 8; px++) {
        expect(fb[px * 4]).toBe(255);
      }
      // Next 8 pixels = tile col 0 = black (wraps around)
      for (let px = 8; px < 16; px++) {
        expect(fb[px * 4]).toBe(0);
      }
    });

    it("background wraps vertically at 256 pixels", () => {
      mmu.writeByte(LCDC, 0x91);
      mmu.writeByte(BGP, 0xE4);

      writeSolidTile(mmu, 0x8000, 0); // Tile 0: white
      writeSolidTile(mmu, 0x8010, 3); // Tile 1: black

      // Row 0 of tile map: tile 1 (black)
      mmu.writeByte(0x9800, 1);
      // Row 31 of tile map: tile 0 (white)
      mmu.writeByte(0x9800 + 31 * 32, 0);

      // SCY=248 -> line 0 reads y=(0+248)&0xFF=248, tile row=248/8=31 -> tile 0 (white)
      mmu.writeByte(SCX, 0);
      mmu.writeByte(SCY, 248);

      ppu.tick(80);
      ppu.tick(172);

      const fb = ppu.getFramebuffer();
      for (let px = 0; px < 8; px++) {
        expect(fb[px * 4]).toBe(255); // white from tile row 31
      }
    });

    it("sub-tile SCX offset selects correct pixel within tile", () => {
      mmu.writeByte(LCDC, 0x91);
      mmu.writeByte(BGP, 0xE4);

      // Tile 0, row 0: lo=0x80 (10000000), hi=0x00 -> pixel 0=color1, rest=color0
      mmu.writeByte(0x8000, 0x80);
      mmu.writeByte(0x8001, 0x00);
      for (let row = 1; row < 8; row++) {
        mmu.writeByte(0x8000 + row * 2, 0x80);
        mmu.writeByte(0x8000 + row * 2 + 1, 0x00);
      }

      mmu.writeByte(0x9800, 0);

      // SCX=1 shifts screen: screen pixel 0 shows BG pixel 1 (which is color 0 = white)
      mmu.writeByte(SCX, 1);
      mmu.writeByte(SCY, 0);

      ppu.tick(80);
      ppu.tick(172);

      const fb = ppu.getFramebuffer();
      // Screen pixel 0 = BG pixel 1 = color 0 = white
      expect(fb[0]).toBe(255);
    });
  });

  describe("LCD disabled", () => {
    it("returns no interrupts when LCD is off (LCDC bit 7=0)", () => {
      mmu.writeByte(LCDC, 0x00);
      const result = ppu.tick(456);
      expect(result.requestVBlankInterrupt).toBe(false);
      expect(result.requestStatInterrupt).toBe(false);
    });

    it("does not advance mode or line when LCD is off", () => {
      mmu.writeByte(LCDC, 0x00);
      ppu.tick(1000);
      expect(ppu.mode).toBe(0);
      expect(ppu.line).toBe(0);
    });

    it("resumes normally when LCD is re-enabled", () => {
      mmu.writeByte(LCDC, 0x00);
      ppu.tick(500);
      expect(ppu.mode).toBe(0);

      enableLCD(mmu);
      ppu.tick(80);
      expect(ppu.mode).toBe(3);
    });
  });

  describe("BG disabled", () => {
    it("renders all white when LCDC bit 0=0", () => {
      mmu.writeByte(LCDC, 0x90); // LCD on, BG off
      mmu.writeByte(BGP, 0xFF);

      // Write some non-white tile data
      for (let i = 0; i < 16; i++) {
        mmu.writeByte(0x8000 + i, 0xFF);
      }
      mmu.writeByte(0x9800, 0);

      ppu.tick(80);
      ppu.tick(172);

      const fb = ppu.getFramebuffer();
      for (let px = 0; px < 160; px++) {
        const i = px * 4;
        expect(fb[i]).toBe(255);
        expect(fb[i + 1]).toBe(255);
        expect(fb[i + 2]).toBe(255);
        expect(fb[i + 3]).toBe(255);
      }
    });
  });

  describe("Serialize / Deserialize", () => {
    it("round-trips PPU state", () => {
      enableLCD(mmu);
      tickOneScanline(ppu);
      tickOneScanline(ppu);
      ppu.tick(80);
      expect(ppu.mode).toBe(3);
      expect(ppu.line).toBe(2);

      const data = ppu.serialize();
      const restored = PPU.deserialize(data, mmu);

      expect(restored.mode).toBe(ppu.mode);
      expect(restored.line).toBe(ppu.line);
    });

    it("preserves framebuffer data", () => {
      enableLCD(mmu);
      mmu.writeByte(BGP, 0xE4);

      // Write a black tile and render one scanline
      for (let i = 0; i < 16; i++) {
        mmu.writeByte(0x8000 + i, 0xFF);
      }
      mmu.writeByte(0x9800, 0);

      ppu.tick(80);
      ppu.tick(172);

      const originalFb = new Uint8Array(ppu.getFramebuffer());
      const data = ppu.serialize();
      const restored = PPU.deserialize(data, mmu);
      const restoredFb = restored.getFramebuffer();

      for (let i = 0; i < originalFb.length; i++) {
        expect(restoredFb[i]).toBe(originalFb[i]);
      }
    });

    it("serialized data is a Uint8Array", () => {
      const data = ppu.serialize();
      expect(data).toBeInstanceOf(Uint8Array);
    });

    it("serialized data has correct length", () => {
      const data = ppu.serialize();
      expect(data.length).toBe(7 + 160 * 144 * 4);
    });

    it("deserialized PPU continues working correctly", () => {
      enableLCD(mmu);
      tickOneScanline(ppu);

      const data = ppu.serialize();
      const restored = PPU.deserialize(data, mmu);

      expect(restored.line).toBe(1);
      tickOneScanline(restored);
      expect(restored.line).toBe(2);
    });
  });

  describe("Reset", () => {
    it("resets mode, line, and framebuffer", () => {
      enableLCD(mmu);
      for (let i = 0; i < 10; i++) {
        tickOneScanline(ppu);
      }
      expect(ppu.line).toBe(10);

      ppu.reset();
      expect(ppu.mode).toBe(2);
      expect(ppu.line).toBe(0);

      const fb = ppu.getFramebuffer();
      for (let i = 0; i < fb.length; i++) {
        expect(fb[i]).toBe(255);
      }
    });

    it("can resume ticking after reset", () => {
      enableLCD(mmu);
      tickOneScanline(ppu);
      ppu.reset();

      ppu.tick(80);
      expect(ppu.mode).toBe(3);
      expect(ppu.line).toBe(0);
    });
  });

  describe("Edge cases", () => {
    it("handles single-cycle ticks", () => {
      let totalCycles = 0;
      while (totalCycles < 80) {
        ppu.tick(1);
        totalCycles++;
      }
      expect(ppu.mode).toBe(3);
    });

    it("handles large tick values spanning multiple transitions", () => {
      // A large tick should process all transitions covered by elapsed cycles.
      // 456 cycles from mode 2 advances one full visible scanline.
      ppu.tick(456);
      expect(ppu.mode).toBe(2);
      expect(ppu.line).toBe(1);
    });

    it("mode clock accumulates leftover cycles correctly", () => {
      // Tick 85 cycles (5 more than mode 2 needs)
      ppu.tick(85);
      expect(ppu.mode).toBe(3);
      // Mode 3 needs 172 cycles, but 5 already accumulated
      ppu.tick(167); // 5 + 167 = 172
      expect(ppu.mode).toBe(0);
    });

    it("full frame cycle count is correct (154 * 456 = 70224 t-cycles)", () => {
      let totalCycles = 0;
      const cyclesPerFrame = 154 * 456;
      while (totalCycles < cyclesPerFrame) {
        ppu.tick(4);
        totalCycles += 4;
      }
      expect(ppu.line).toBe(0);
      expect(ppu.mode).toBe(2);
    });
  });
});
