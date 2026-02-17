import { describe, it, expect } from "bun:test";
import { PPU } from "../ppu";
import { MMU } from "../mmu";

const LCDC = 0xFF40;
const BGP = 0xFF47;
const OBP0 = 0xFF48;
const OBP1 = 0xFF49;
const SCX = 0xFF43;
const SCY = 0xFF42;
const WY = 0xFF4A;
const WX = 0xFF4B;

function setupPPU() {
  const mmu = new MMU();
  const ppu = new PPU(mmu);
  mmu.writeByte(LCDC, 0x93); // LCD on, BG on, sprites on, unsigned tile data
  mmu.writeByte(BGP, 0xE4);  // 0=white(255), 1=light(192), 2=dark(96), 3=black(0)
  mmu.writeByte(OBP0, 0xE4);
  mmu.writeByte(OBP1, 0xD2); // 0=dark(96), 1=black(0), 2=light(192), 3=black(0) — different
  return { mmu, ppu };
}

function tickFrame(ppu: PPU) {
  for (let i = 0; i < 70224; i += 4) {
    ppu.tick(4);
  }
}

function tickScanlines(ppu: PPU, lines: number) {
  for (let i = 0; i < lines * 456; i += 4) {
    ppu.tick(4);
  }
}

function writeTile(mmu: MMU, tileIndex: number, data: number[]) {
  const addr = 0x8000 + tileIndex * 16;
  for (let i = 0; i < data.length && i < 16; i++) {
    mmu.writeByte(addr + i, data[i]!);
  }
}

function getPixel(fb: Uint8Array, x: number, y: number): number {
  const i = (y * 160 + x) * 4;
  return fb[i]!;
}

function writeSprite(mmu: MMU, oamIndex: number, y: number, x: number, tile: number, flags: number) {
  const addr = 0xFE00 + oamIndex * 4;
  mmu.writeByte(addr, y);
  mmu.writeByte(addr + 1, x);
  mmu.writeByte(addr + 2, tile);
  mmu.writeByte(addr + 3, flags);
}

function solidTileData(colorIdx: number): number[] {
  const data: number[] = [];
  for (let row = 0; row < 8; row++) {
    const lo = (colorIdx & 1) ? 0xFF : 0x00;
    const hi = (colorIdx & 2) ? 0xFF : 0x00;
    data.push(lo, hi);
  }
  return data;
}

describe("PPU Sprite and Window Rendering", () => {
  describe("Sprite rendering basics", () => {
    it("single sprite renders on screen", () => {
      const { mmu, ppu } = setupPPU();
      writeTile(mmu, 0, solidTileData(3)); // solid black tile
      writeSprite(mmu, 0, 16, 8, 0, 0x00); // Y=16 -> screen Y=0, X=8 -> screen X=0

      tickFrame(ppu);
      const fb = ppu.getFramebuffer();

      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
          expect(getPixel(fb, x, y)).not.toBe(255);
        }
      }
    });

    it("sprite color index 0 is transparent", () => {
      const { mmu, ppu } = setupPPU();

      // BG: solid color 1 (light gray = 192) using tile 1
      writeTile(mmu, 1, solidTileData(1));
      for (let col = 0; col < 32; col++) {
        mmu.writeByte(0x9800 + col, 1);
      }
      // Fill first 4 rows of tile map too
      for (let row = 0; row < 4; row++) {
        for (let col = 0; col < 32; col++) {
          mmu.writeByte(0x9800 + row * 32 + col, 1);
        }
      }

      // Sprite tile 0: row 0 has color 3, rows 1-7 have color 0 (transparent)
      const spriteData: number[] = [];
      // Row 0: all color 3 (lo=0xFF, hi=0xFF)
      spriteData.push(0xFF, 0xFF);
      // Rows 1-7: all color 0 (transparent)
      for (let r = 1; r < 8; r++) {
        spriteData.push(0x00, 0x00);
      }
      writeTile(mmu, 0, spriteData);
      writeSprite(mmu, 0, 16, 8, 0, 0x00); // top-left corner

      tickFrame(ppu);
      const fb = ppu.getFramebuffer();

      // Row 0: sprite color 3 -> black (0)
      for (let x = 0; x < 8; x++) {
        expect(getPixel(fb, x, 0)).toBe(0);
      }
      // Row 1: sprite color 0 (transparent), BG color 1 shows through -> 192
      for (let x = 0; x < 8; x++) {
        expect(getPixel(fb, x, 1)).toBe(192);
      }
    });

    it("sprite uses OBP0 palette by default", () => {
      const { mmu, ppu } = setupPPU();
      // OBP0 = 0xE4: color 1 -> shade 1 -> 192
      writeTile(mmu, 0, solidTileData(1));
      writeSprite(mmu, 0, 16, 8, 0, 0x00); // attr bit4=0 -> OBP0

      tickFrame(ppu);
      const fb = ppu.getFramebuffer();

      expect(getPixel(fb, 0, 0)).toBe(192); // OBP0 maps color 1 -> 192
    });

    it("sprite uses OBP1 when bit 4 set", () => {
      const { mmu, ppu } = setupPPU();
      // OBP1 = 0xD2 = 11 01 00 10
      //   color 0 -> shade 2 -> 96 (but color 0 is transparent, doesn't matter)
      //   color 1 -> shade 0 -> 255
      //   color 2 -> shade 1 -> 192
      //   color 3 -> shade 3 -> 0
      writeTile(mmu, 0, solidTileData(1));
      writeSprite(mmu, 0, 16, 8, 0, 0x10); // attr bit4=1 -> OBP1

      tickFrame(ppu);
      const fb = ppu.getFramebuffer();

      // OBP1 color 1 -> shade 0 -> 255 (white)
      // OBP0 would give 192, so this must differ
      expect(getPixel(fb, 0, 0)).toBe(255);
    });
  });

  describe("Sprite flipping", () => {
    it("X flip reverses pixel order", () => {
      // Asymmetric tile: left half (pixels 0-3) = color 3, right half (pixels 4-7) = color 0
      // lo = 0xF0, hi = 0xF0 -> left 4 pixels = color 3, right 4 = color 0
      const asymData: number[] = [];
      for (let r = 0; r < 8; r++) {
        asymData.push(0xF0, 0xF0);
      }

      // Test normal (no flip)
      {
        const { mmu, ppu } = setupPPU();
        // Set BG to a white tile so transparent sprite pixels show white
        writeTile(mmu, 1, solidTileData(0));
        mmu.writeByte(0x9800, 1);
        writeTile(mmu, 0, asymData);
        writeSprite(mmu, 0, 16, 8, 0, 0x00);
        tickFrame(ppu);
        const fb = ppu.getFramebuffer();

        expect(getPixel(fb, 0, 0)).toBe(0);   // color 3 -> black
        expect(getPixel(fb, 3, 0)).toBe(0);
        expect(getPixel(fb, 4, 0)).toBe(255); // color 0 -> transparent (BG white)
        expect(getPixel(fb, 7, 0)).toBe(255);
      }

      // Test with X flip (bit 5)
      {
        const { mmu, ppu } = setupPPU();
        // Set BG to use a white tile so transparent sprite pixels show white
        writeTile(mmu, 1, solidTileData(0));
        mmu.writeByte(0x9800, 1); // BG tile map -> tile 1 (white)
        writeTile(mmu, 0, asymData);
        writeSprite(mmu, 0, 16, 8, 0, 0x20);
        tickFrame(ppu);
        const fb = ppu.getFramebuffer();

        expect(getPixel(fb, 0, 0)).toBe(255); // flipped: right half (color 0) now on left
        expect(getPixel(fb, 3, 0)).toBe(255);
        expect(getPixel(fb, 4, 0)).toBe(0);   // flipped: left half (color 3) now on right
        expect(getPixel(fb, 7, 0)).toBe(0);
      }
    });

    it("Y flip reverses row order", () => {
      const { mmu, ppu } = setupPPU();

      // Tile with distinct top and bottom:
      // Row 0: all color 3 (black)
      // Rows 1-6: all color 0 (transparent)
      // Row 7: all color 1 (light gray)
      const tileData: number[] = [];
      // Row 0: color 3
      tileData.push(0xFF, 0xFF);
      // Rows 1-6: color 0
      for (let r = 1; r < 7; r++) {
        tileData.push(0x00, 0x00);
      }
      // Row 7: color 1 (lo=0xFF, hi=0x00)
      tileData.push(0xFF, 0x00);
      writeTile(mmu, 0, tileData);

      // Normal (no flip)
      writeSprite(mmu, 0, 16, 8, 0, 0x00);
      tickFrame(ppu);
      const fb = ppu.getFramebuffer();

      expect(getPixel(fb, 0, 0)).toBe(0);   // row 0 = color 3 = black
      expect(getPixel(fb, 0, 7)).toBe(192);  // row 7 = color 1 = 192

      // Y flip (bit 6)
      ppu.reset();
      writeSprite(mmu, 0, 16, 8, 0, 0x40);
      tickFrame(ppu);
      const fb2 = ppu.getFramebuffer();

      // Flipped: row 0 on screen = original row 7 = color 1 = 192
      expect(getPixel(fb2, 0, 0)).toBe(192);
      // Flipped: row 7 on screen = original row 0 = color 3 = 0
      expect(getPixel(fb2, 0, 7)).toBe(0);
    });
  });

  describe("Sprite priority", () => {
    it("sprite behind BG: BG non-zero color shows through, BG color 0 shows sprite", () => {
      const { mmu, ppu } = setupPPU();

      // BG: left half (tile col 0) = color 2, right half (tile col 1+) = color 0
      writeTile(mmu, 1, solidTileData(2)); // dark gray tile
      writeTile(mmu, 2, solidTileData(0)); // white tile (color 0)

      for (let row = 0; row < 4; row++) {
        mmu.writeByte(0x9800 + row * 32, 1);     // col 0 -> tile 1 (color 2)
        mmu.writeByte(0x9800 + row * 32 + 1, 2); // col 1 -> tile 2 (color 0)
        for (let col = 2; col < 32; col++) {
          mmu.writeByte(0x9800 + row * 32 + col, 2);
        }
      }

      // Sprite tile 0: solid color 3
      writeTile(mmu, 0, solidTileData(3));
      // Sprite at X=8 (screen X=0), behind BG (bit 7 set)
      writeSprite(mmu, 0, 16, 8, 0, 0x80);

      tickFrame(ppu);
      const fb = ppu.getFramebuffer();

      // BG at (0,0) = color 2 (non-zero). Sprite behind BG -> BG shows.
      // BG color 2 with BGP=0xE4 -> shade 2 -> 96
      expect(getPixel(fb, 0, 0)).toBe(96);

      // Now test: sprite at X=16 (screen X=8), over BG color 0 area
      ppu.reset();
      writeSprite(mmu, 0, 16, 16, 0, 0x80); // X=16 -> screen X=8, on tile col 1 (color 0)
      tickFrame(ppu);
      const fb2 = ppu.getFramebuffer();

      // BG at (8,0) = color 0. Sprite behind BG, but BG is color 0 -> sprite shows
      expect(getPixel(fb2, 8, 0)).toBe(0); // sprite color 3 -> 0 (black)
    });

    it("sprite over BG: sprite overwrites BG regardless of BG color", () => {
      const { mmu, ppu } = setupPPU();

      // BG: solid color 2
      writeTile(mmu, 1, solidTileData(2));
      for (let row = 0; row < 2; row++) {
        for (let col = 0; col < 20; col++) {
          mmu.writeByte(0x9800 + row * 32 + col, 1);
        }
      }

      // Sprite tile 0: solid color 3
      writeTile(mmu, 0, solidTileData(3));
      // No bit 7 -> sprite on top
      writeSprite(mmu, 0, 16, 8, 0, 0x00);

      tickFrame(ppu);
      const fb = ppu.getFramebuffer();

      // Sprite color 3 -> black (0) should overwrite BG color 2 -> dark (96)
      expect(getPixel(fb, 0, 0)).toBe(0);
    });
  });

  describe("8x16 sprite mode", () => {
    it("tall sprites render 16 pixels tall using two consecutive tiles", () => {
      const { mmu, ppu } = setupPPU();
      // Set LCDC bit 2 for 8x16 sprites
      mmu.writeByte(LCDC, 0x87); // LCD on, BG on, sprites on, 8x16 mode

      // Tile 0: solid color 1 (top half)
      writeTile(mmu, 0, solidTileData(1));
      // Tile 1: solid color 3 (bottom half)
      writeTile(mmu, 1, solidTileData(3));

      // Sprite at top-left, tile index 0
      writeSprite(mmu, 0, 16, 8, 0, 0x00);

      tickFrame(ppu);
      const fb = ppu.getFramebuffer();

      // Top 8 rows: tile 0, color 1 -> 192
      for (let y = 0; y < 8; y++) {
        expect(getPixel(fb, 0, y)).toBe(192);
      }
      // Bottom 8 rows: tile 1, color 3 -> 0
      for (let y = 8; y < 16; y++) {
        expect(getPixel(fb, 0, y)).toBe(0);
      }
    });

    it("tile index bit 0 is ignored in 8x16 mode", () => {
      const { mmu, ppu } = setupPPU();
      mmu.writeByte(LCDC, 0x87);

      writeTile(mmu, 0, solidTileData(1));
      writeTile(mmu, 1, solidTileData(3));

      // Use tile index 1 -- bit 0 should be cleared to 0, rendering tiles 0+1
      writeSprite(mmu, 0, 16, 8, 1, 0x00);

      tickFrame(ppu);
      const fb = ppu.getFramebuffer();

      // Same result as tile index 0: top = tile 0, bottom = tile 1
      for (let y = 0; y < 8; y++) {
        expect(getPixel(fb, 0, y)).toBe(192);
      }
      for (let y = 8; y < 16; y++) {
        expect(getPixel(fb, 0, y)).toBe(0);
      }
    });
  });

  describe("10 sprite per line limit", () => {
    it("only the first 10 sprites by OAM order render per scanline", () => {
      const { mmu, ppu } = setupPPU();

      // Use tile 15 for BG (white / color 0) so sprite tiles don't interfere
      writeTile(mmu, 15, solidTileData(0));
      for (let col = 0; col < 32; col++) {
        mmu.writeByte(0x9800 + col, 15);
      }

      // All 12 sprites on the same line (Y=16 -> screen Y=0), spread across X
      // Use tiles 0-11 for sprites, all solid black
      for (let i = 0; i < 12; i++) {
        writeTile(mmu, i, solidTileData(3));
        writeSprite(mmu, i, 16, 8 + i * 8, i, 0x00);
      }

      tickFrame(ppu);
      const fb = ppu.getFramebuffer();

      // Sprites 0-9 (OAM index 0-9) should render: pixels at X=0..79 should be black
      for (let i = 0; i < 10; i++) {
        expect(getPixel(fb, i * 8, 0)).toBe(0);
      }
      // Sprites 10-11 (OAM index 10-11) should NOT render: pixels at X=80,88 should be white (BG)
      expect(getPixel(fb, 80, 0)).toBe(255);
      expect(getPixel(fb, 88, 0)).toBe(255);
    });
  });

  describe("Sprite X-coordinate priority", () => {
    it("lower X sprite has higher priority (rendered on top)", () => {
      const { mmu, ppu } = setupPPU();

      // Tile 0: solid color 1 (will use OBP0 -> 192)
      writeTile(mmu, 0, solidTileData(1));
      // Tile 1: solid color 3 (will use OBP0 -> 0)
      writeTile(mmu, 1, solidTileData(3));

      // Sprite A at OAM 1: X=8 (screen X=0), tile 1 -> black
      // Sprite B at OAM 0: X=12 (screen X=4), tile 0 -> gray
      // They overlap at screen pixels 4-7
      // Sprite A has lower X (0 < 4), so it should be on top in the overlap region
      writeSprite(mmu, 0, 16, 12, 0, 0x00); // higher OAM index but X=4
      writeSprite(mmu, 1, 16, 8, 1, 0x00);  // lower OAM index, X=0

      tickFrame(ppu);
      const fb = ppu.getFramebuffer();

      // At pixel 4 (overlap region): sprite at X=0 (tile 1, black) has lower X -> on top
      expect(getPixel(fb, 4, 0)).toBe(0); // black from the lower-X sprite
    });
  });

  describe("Window rendering", () => {
    it("window renders over BG", () => {
      const { mmu, ppu } = setupPPU();
      // Enable window: LCDC bit 5
      mmu.writeByte(LCDC, 0xA3); // LCD on, BG on, sprites on, window on (0x83 | 0x20)
      mmu.writeByte(WY, 0);   // window starts at line 0
      mmu.writeByte(WX, 7);   // WX=7 means window starts at screen X=0

      // BG tile 1: color 1 (192)
      writeTile(mmu, 1, solidTileData(1));
      for (let row = 0; row < 2; row++) {
        for (let col = 0; col < 32; col++) {
          mmu.writeByte(0x9800 + row * 32 + col, 1);
        }
      }

      // Window tile 2: color 3 (0, black) in the window tile map at 0x9800
      writeTile(mmu, 2, solidTileData(3));
      // Window tile map (LCDC bit 6=0 -> 0x9800, same as BG in this config)
      // But window uses its own map base. With LCDC bit 6=0, window map is 0x9800.
      // To differentiate, we need different tile map entries. The BG and window share the
      // same map address 0x9800 here. Let's use a different LCDC config.
      // Set LCDC to use BG map at 0x9C00 (bit 3=1) and window map at 0x9800 (bit 6=0).
      mmu.writeByte(LCDC, 0xBB); // 0x80|0x20|0x10|0x08|0x02|0x01 = LCD, win, unsigned data, BG map 9C00, sprites, BG on

      // BG at 0x9C00: tile 1
      for (let row = 0; row < 2; row++) {
        for (let col = 0; col < 32; col++) {
          mmu.writeByte(0x9C00 + row * 32 + col, 1);
        }
      }
      // Window at 0x9800: tile 2
      for (let row = 0; row < 20; row++) {
        for (let col = 0; col < 32; col++) {
          mmu.writeByte(0x9800 + row * 32 + col, 2);
        }
      }

      tickFrame(ppu);
      const fb = ppu.getFramebuffer();

      // Window should overwrite BG: pixel (0,0) should be window tile 2 = color 3 = 0
      expect(getPixel(fb, 0, 0)).toBe(0);
    });

    it("window respects WY: top half BG, bottom half window", () => {
      const { mmu, ppu } = setupPPU();
      mmu.writeByte(LCDC, 0xBB); // LCD, win, unsigned data, BG map 9C00, sprites, BG
      mmu.writeByte(WY, 72);     // window starts at line 72
      mmu.writeByte(WX, 7);      // window at screen X=0

      // BG at 0x9C00: tile 1 (color 1 -> 192)
      writeTile(mmu, 1, solidTileData(1));
      for (let row = 0; row < 32; row++) {
        for (let col = 0; col < 32; col++) {
          mmu.writeByte(0x9C00 + row * 32 + col, 1);
        }
      }

      // Window at 0x9800: tile 2 (color 3 -> 0)
      writeTile(mmu, 2, solidTileData(3));
      for (let row = 0; row < 32; row++) {
        for (let col = 0; col < 32; col++) {
          mmu.writeByte(0x9800 + row * 32 + col, 2);
        }
      }

      tickFrame(ppu);
      const fb = ppu.getFramebuffer();

      // Above WY (line 0): BG shows -> 192
      expect(getPixel(fb, 0, 0)).toBe(192);
      expect(getPixel(fb, 0, 71)).toBe(192);

      // At/below WY (line 72): window shows -> 0
      expect(getPixel(fb, 0, 72)).toBe(0);
      expect(getPixel(fb, 0, 100)).toBe(0);
    });

    it("window uses correct tile map based on LCDC bit 6", () => {
      const { mmu, ppu } = setupPPU();

      writeTile(mmu, 1, solidTileData(1)); // color 1 -> 192
      writeTile(mmu, 2, solidTileData(3)); // color 3 -> 0

      // Window map at 0x9800 (bit 6=0): tile 1
      for (let row = 0; row < 32; row++) {
        for (let col = 0; col < 32; col++) {
          mmu.writeByte(0x9800 + row * 32 + col, 1);
        }
      }
      // Window map at 0x9C00 (bit 6=1): tile 2
      for (let row = 0; row < 32; row++) {
        for (let col = 0; col < 32; col++) {
          mmu.writeByte(0x9C00 + row * 32 + col, 2);
        }
      }

      // LCDC: LCD on, window on, BG on, sprites on, BG map=0x9800 (bit3=0), window map bit6=0 -> 0x9800
      // Also need unsigned tile data (bit 4=1)
      mmu.writeByte(LCDC, 0xB3); // 0x80|0x20|0x10|0x02|0x01 = LCD, win, unsigned data, sprites, BG
      mmu.writeByte(WY, 0);
      mmu.writeByte(WX, 7);

      tickFrame(ppu);
      const fb = ppu.getFramebuffer();

      // Window map 0x9800 -> tile 1 -> color 1 -> 192
      expect(getPixel(fb, 0, 0)).toBe(192);

      // Now toggle bit 6 to select 0x9C00 for window
      ppu.reset();
      mmu.writeByte(LCDC, 0xF3); // add bit 6 = 0x40 -> 0xB3 | 0x40
      tickFrame(ppu);
      const fb2 = ppu.getFramebuffer();

      // Window map 0x9C00 -> tile 2 -> color 3 -> 0
      expect(getPixel(fb2, 0, 0)).toBe(0);
    });

    it("window disabled when LCDC bit 5 = 0", () => {
      const { mmu, ppu } = setupPPU();
      // LCDC without bit 5 (no window), with unsigned tile data
      mmu.writeByte(LCDC, 0x93); // LCD, BG, sprites, unsigned data — no window

      // BG at 0x9800: tile 1 (color 1 -> 192)
      writeTile(mmu, 1, solidTileData(1));
      for (let col = 0; col < 32; col++) {
        mmu.writeByte(0x9800 + col, 1);
      }

      // Window tile map: tile 2 (color 3 -> 0)
      writeTile(mmu, 2, solidTileData(3));
      // Write to both possible window map locations
      for (let col = 0; col < 32; col++) {
        mmu.writeByte(0x9800 + col, 1); // keep BG as tile 1
      }

      mmu.writeByte(WY, 0);
      mmu.writeByte(WX, 7);

      tickFrame(ppu);
      const fb = ppu.getFramebuffer();

      // Only BG should show -> 192, not window
      expect(getPixel(fb, 0, 0)).toBe(192);
    });
  });

  describe("Sprites + Window combined", () => {
    it("sprites render on top of window", () => {
      const { mmu, ppu } = setupPPU();
      // Enable LCD, BG, sprites, window, unsigned tile data
      // BG map at 0x9C00 (bit 3), window map at 0x9800 (bit 6=0)
      mmu.writeByte(LCDC, 0xBB); // 0x80|0x20|0x10|0x08|0x02|0x01

      // BG at 0x9C00: tile 1 (color 1 -> 192)
      writeTile(mmu, 1, solidTileData(1));
      for (let row = 0; row < 32; row++) {
        for (let col = 0; col < 32; col++) {
          mmu.writeByte(0x9C00 + row * 32 + col, 1);
        }
      }

      // Window at 0x9800: tile 2 (color 2 -> 96)
      writeTile(mmu, 2, solidTileData(2));
      for (let row = 0; row < 32; row++) {
        for (let col = 0; col < 32; col++) {
          mmu.writeByte(0x9800 + row * 32 + col, 2);
        }
      }

      mmu.writeByte(WY, 0);
      mmu.writeByte(WX, 7);

      // Sprite tile 0: solid color 3 -> black (0)
      writeTile(mmu, 0, solidTileData(3));
      writeSprite(mmu, 0, 16, 8, 0, 0x00);

      tickFrame(ppu);
      const fb = ppu.getFramebuffer();

      // The window covers the entire screen (color 2 -> 96).
      // The sprite at (0,0) 8x8 should overwrite with color 3 -> 0.
      expect(getPixel(fb, 0, 0)).toBe(0);   // sprite on top of window
      expect(getPixel(fb, 10, 0)).toBe(96);  // outside sprite: window shows
    });
  });
});
