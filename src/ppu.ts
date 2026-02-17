import type { IMemory } from "./mmu";

export const GB_SHADES: readonly number[] = [255, 192, 96, 0];

const OAM_SCAN_CYCLES = 80;
const PIXEL_TRANSFER_CYCLES = 172;
const HBLANK_CYCLES = 204;
const SCANLINE_CYCLES = 456;

interface SpriteEntry {
  x: number;
  y: number;
  tile: number;
  flags: number;
  oamIdx: number;
}

export class PPU {
  private memory: IMemory;
  private modeClock = 0;
  private _mode: 0 | 1 | 2 | 3 = 2;
  private _line = 0;
  private _framebuffer: Uint8Array;
  private lcdEnabled = false;
  private statInterruptSignal = false;

  constructor(memory: IMemory) {
    this.memory = memory;
    this._framebuffer = new Uint8Array(160 * 144 * 4);
    this._framebuffer.fill(255);
  }

  get mode() { return this._mode; }
  get line() { return this._line; }

  getFramebuffer(): Uint8Array { return this._framebuffer; }

  private writeLY(value: number): void {
    if (this.memory.setLY) {
      this.memory.setLY(value);
      return;
    }
    this.memory.writeByte(0xFF44, value);
  }

  tick(tCycles: number): { requestVBlankInterrupt: boolean; requestStatInterrupt: boolean } {
    let vblank = false;
    let stat = false;

    const lcdEnabled = (this.memory.readByte(0xFF40) & 0x80) !== 0;
    if (!lcdEnabled) {
      // LCD disabled: LY is forced to 0 and mode to HBlank (0).
      this.lcdEnabled = false;
      this.modeClock = 0;
      this._mode = 0;
      this._line = 0;
      this._windowLineCounter = 0;
      this.writeLY(0);
      this.writeStat();
      this.statInterruptSignal = false;
      return { requestVBlankInterrupt: false, requestStatInterrupt: false };
    }

    if (!this.lcdEnabled) {
      // LCD enable transition starts a fresh frame at mode 2 / line 0.
      this.lcdEnabled = true;
      this.modeClock = 0;
      this._mode = 2;
      this._line = 0;
      this._windowLineCounter = 0;
      this.writeLY(0);
      this.writeStat();
      if (this.updateStatInterruptEdge()) {
        stat = true;
      }
    }

    // Keep STAT bit2 (LYC=LY) synchronized, including when LYC changes mid-line.
    this.writeStat();
    if (this.updateStatInterruptEdge()) {
      stat = true;
    }

    this.modeClock += tCycles;

    // Handle as many mode transitions as the elapsed t-cycles cover.
    let progressed = true;
    while (progressed) {
      progressed = false;
      switch (this._mode) {
        case 2:
          if (this.modeClock >= OAM_SCAN_CYCLES) {
            this.modeClock -= OAM_SCAN_CYCLES;
            this._mode = 3;
            this.writeStat();
            if (this.updateStatInterruptEdge()) {
              stat = true;
            }
            progressed = true;
          }
          break;
        case 3:
          if (this.modeClock >= PIXEL_TRANSFER_CYCLES) {
            this.modeClock -= PIXEL_TRANSFER_CYCLES;
            this._mode = 0;
            this.renderScanline();
            this.writeStat();
            if (this.updateStatInterruptEdge()) {
              stat = true;
            }
            progressed = true;
          }
          break;
        case 0:
          if (this.modeClock >= HBLANK_CYCLES) {
            this.modeClock -= HBLANK_CYCLES;
            this._line++;
            if (this._line === 144) {
              this._mode = 1;
              vblank = true;
            } else {
              this._mode = 2;
            }
            this.writeLY(this._line);
            this.writeStat();
            if (this.updateStatInterruptEdge()) {
              stat = true;
            }
            progressed = true;
          }
          break;
        case 1:
          if (this.modeClock >= SCANLINE_CYCLES) {
            this.modeClock -= SCANLINE_CYCLES;
            this._line++;
            if (this._line > 153) {
              this._line = 0;
              this._mode = 2;
              this._windowLineCounter = 0;
            }
            this.writeLY(this._line);
            this.writeStat();
            if (this.updateStatInterruptEdge()) {
              stat = true;
            }
            progressed = true;
          }
          break;
      }
    }

    return { requestVBlankInterrupt: vblank, requestStatInterrupt: stat };
  }

  private writeStat(): void {
    const current = this.memory.readByte(0xFF41);
    const lycFlag = (this._line === this.memory.readByte(0xFF45)) ? 0x04 : 0;
    this.memory.writeByte(0xFF41, (current & 0xF8) | lycFlag | this._mode);
  }

  private updateStatInterruptEdge(): boolean {
    const stat = this.memory.readByte(0xFF41);

    const lycSource = (stat & 0x40) !== 0 && (stat & 0x04) !== 0;
    let modeSource = false;
    if (this._mode === 0) modeSource = (stat & 0x08) !== 0;
    else if (this._mode === 1) modeSource = (stat & 0x10) !== 0;
    else if (this._mode === 2) modeSource = (stat & 0x20) !== 0;

    const signal = lycSource || modeSource;
    const risingEdge = signal && !this.statInterruptSignal;
    this.statInterruptSignal = signal;
    return risingEdge;
  }

  // Per-scanline BG color index buffer for sprite priority
  private bgColorIdx = new Uint8Array(160);

  // Pre-allocated sprite collection buffer (max 10 per scanline)
  private readonly spriteBuffer: SpriteEntry[] = Array.from(
    { length: 10 },
    () => ({ x: 0, y: 0, tile: 0, flags: 0, oamIdx: 0 }),
  );
  private spriteCount = 0;

  // Cached palettes - invalidated when palette registers change
  private cachedBGP = -1;
  private cachedBGPalette: [number, number, number, number] = [255, 192, 96, 0];
  private cachedOBP0 = -1;
  private cachedOBP0Palette: [number, number, number, number] = [255, 192, 96, 0];
  private cachedOBP1 = -1;
  private cachedOBP1Palette: [number, number, number, number] = [255, 192, 96, 0];

  // Internal window line counter (tracks which window line to render next)
  private _windowLineCounter = 0;

  private renderScanline(): void {
    const lcdc = this.memory.readByte(0xFF40);
    const fbOffset = this._line * 160 * 4;

    // BG/Window disabled: fill white, color indices = 0
    if (!(lcdc & 0x01)) {
      for (let x = 0; x < 160; x++) {
        const i = fbOffset + x * 4;
        this._framebuffer[i] = 255;
        this._framebuffer[i + 1] = 255;
        this._framebuffer[i + 2] = 255;
        this._framebuffer[i + 3] = 255;
        this.bgColorIdx[x] = 0;
      }
    } else {
      this.renderBG(lcdc, fbOffset);
      this.renderWindow(lcdc, fbOffset);
    }

    // Sprites (OBJ) - rendered on top, controlled by LCDC bit 1
    if (lcdc & 0x02) {
      this.renderSprites(lcdc, fbOffset);
    }
  }

  private renderBG(lcdc: number, fbOffset: number): void {
    const scy = this.memory.readByte(0xFF42);
    const scx = this.memory.readByte(0xFF43);
    const bgp = this.memory.readByte(0xFF47);
    const tileDataSigned = !(lcdc & 0x10);
    const tileMapBase = (lcdc & 0x08) ? 0x9C00 : 0x9800;
    const palette = this.getCachedBGPalette(bgp);

    const y = (this._line + scy) & 0xFF;
    const tileRow = (y >> 3) & 31;
    const tileYOffset = y & 7;

    let cachedTileCol = -1;
    let lo = 0;
    let hi = 0;

    for (let px = 0; px < 160; px++) {
      const x = (px + scx) & 0xFF;
      const tileCol = (x >> 3) & 31;

      if (tileCol !== cachedTileCol) {
        cachedTileCol = tileCol;
        const tileIndex = this.memory.readByte(tileMapBase + tileRow * 32 + tileCol);
        const tileAddr = this.tileAddress(tileIndex, tileDataSigned);
        lo = this.memory.readByte(tileAddr + tileYOffset * 2);
        hi = this.memory.readByte(tileAddr + tileYOffset * 2 + 1);
      }

      const tileXBit = 7 - (x & 7);
      const colorIdx = ((hi >> tileXBit) & 1) << 1 | ((lo >> tileXBit) & 1);

      this.bgColorIdx[px] = colorIdx;
      const shade = palette[colorIdx]!;
      const i = fbOffset + px * 4;
      this._framebuffer[i] = shade;
      this._framebuffer[i + 1] = shade;
      this._framebuffer[i + 2] = shade;
      this._framebuffer[i + 3] = 255;
    }
  }

  private renderWindow(lcdc: number, fbOffset: number): void {
    // Window enabled? (LCDC bit 5)
    if (!(lcdc & 0x20)) return;

    const wy = this.memory.readByte(0xFF4A);
    const wx = this.memory.readByte(0xFF4B) - 7; // WX is offset by 7

    // Window only renders if current line >= WY
    if (this._line < wy) return;

    const bgp = this.memory.readByte(0xFF47);
    const tileDataSigned = !(lcdc & 0x10);
    const windowMapBase = (lcdc & 0x40) ? 0x9C00 : 0x9800;
    const palette = this.getCachedBGPalette(bgp);

    const windowLine = this._windowLineCounter;
    const tileRow = (windowLine >> 3) & 31;
    const tileYOffset = windowLine & 7;

    let renderedPixel = false;
    let cachedTileCol = -1;
    let lo = 0;
    let hi = 0;

    for (let px = 0; px < 160; px++) {
      if (px < wx) continue;

      renderedPixel = true;
      const windowX = px - wx;
      const tileCol = (windowX >> 3) & 31;

      if (tileCol !== cachedTileCol) {
        cachedTileCol = tileCol;
        const tileIndex = this.memory.readByte(windowMapBase + tileRow * 32 + tileCol);
        const tileAddr = this.tileAddress(tileIndex, tileDataSigned);
        lo = this.memory.readByte(tileAddr + tileYOffset * 2);
        hi = this.memory.readByte(tileAddr + tileYOffset * 2 + 1);
      }

      const tileXBit = 7 - (windowX & 7);
      const colorIdx = ((hi >> tileXBit) & 1) << 1 | ((lo >> tileXBit) & 1);

      this.bgColorIdx[px] = colorIdx;
      const shade = palette[colorIdx]!;
      const i = fbOffset + px * 4;
      this._framebuffer[i] = shade;
      this._framebuffer[i + 1] = shade;
      this._framebuffer[i + 2] = shade;
      this._framebuffer[i + 3] = 255;
    }

    // Window line counter only increments if the window was actually rendered
    if (renderedPixel) {
      this._windowLineCounter++;
    }
  }

  private renderSprites(lcdc: number, fbOffset: number): void {
    const tallSprites = (lcdc & 0x04) !== 0; // 8x16 mode
    const spriteHeight = tallSprites ? 16 : 8;
    const obp0 = this.memory.readByte(0xFF48);
    const obp1 = this.memory.readByte(0xFF49);
    if (obp0 !== this.cachedOBP0) { this.cachedOBP0 = obp0; this.cachedOBP0Palette = this.decodePalette(obp0); }
    if (obp1 !== this.cachedOBP1) { this.cachedOBP1 = obp1; this.cachedOBP1Palette = this.decodePalette(obp1); }
    const palette0 = this.cachedOBP0Palette;
    const palette1 = this.cachedOBP1Palette;

    // Collect sprites on this scanline (max 10) using pre-allocated buffer
    this.spriteCount = 0;
    for (let i = 0; i < 40 && this.spriteCount < 10; i++) {
      const oamAddr = 0xFE00 + i * 4;
      const sy = this.memory.readByte(oamAddr) - 16;
      const sx = this.memory.readByte(oamAddr + 1) - 8;

      if (this._line >= sy && this._line < sy + spriteHeight) {
        const entry = this.spriteBuffer[this.spriteCount]!;
        entry.x = sx;
        entry.y = sy;
        entry.tile = this.memory.readByte(oamAddr + 2);
        entry.flags = this.memory.readByte(oamAddr + 3);
        entry.oamIdx = i;
        this.spriteCount++;
      }
    }

    // Sort by X coordinate (lower X = higher priority). For equal X, lower OAM index wins.
    const sprites = this.spriteBuffer;
    const count = this.spriteCount;
    // Simple insertion sort (max 10 elements)
    for (let i = 1; i < count; i++) {
      const tmp = sprites[i]!;
      let j = i - 1;
      while (j >= 0 && (sprites[j]!.x > tmp.x || (sprites[j]!.x === tmp.x && sprites[j]!.oamIdx > tmp.oamIdx))) {
        sprites[j + 1] = sprites[j]!;
        j--;
      }
      sprites[j + 1] = tmp;
    }

    // Render back-to-front (last in sorted order is lowest priority, draw first)
    for (let si = count - 1; si >= 0; si--) {
      const sprite = sprites[si]!;
      const { x: sx, y: sy, flags } = sprite;
      let tileIdx = sprite.tile;

      const flipX = (flags & 0x20) !== 0;
      const flipY = (flags & 0x40) !== 0;
      const behindBG = (flags & 0x80) !== 0;
      const palette = (flags & 0x10) ? palette1 : palette0;

      // For 8x16 sprites, the lower bit of tile index is ignored
      if (tallSprites) {
        tileIdx &= 0xFE;
      }

      let row = this._line - sy;
      if (flipY) {
        row = spriteHeight - 1 - row;
      }

      // Tile address: sprites always use 0x8000 base (unsigned)
      const tileAddr = 0x8000 + tileIdx * 16 + row * 2;
      const lo = this.memory.readByte(tileAddr);
      const hi = this.memory.readByte(tileAddr + 1);

      for (let px = 0; px < 8; px++) {
        const screenX = sx + px;
        if (screenX < 0 || screenX >= 160) continue;

        const bit = flipX ? px : 7 - px;
        const colorIdx = ((hi >> bit) & 1) << 1 | ((lo >> bit) & 1);

        // Color index 0 is transparent for sprites
        if (colorIdx === 0) continue;

        // BG priority: if behindBG flag set, sprite only shows over BG color 0
        if (behindBG && this.bgColorIdx[screenX]! !== 0) continue;

        const shade = palette[colorIdx]!;
        const i = fbOffset + screenX * 4;
        this._framebuffer[i] = shade;
        this._framebuffer[i + 1] = shade;
        this._framebuffer[i + 2] = shade;
        this._framebuffer[i + 3] = 255;
      }
    }
  }

  private tileAddress(tileIndex: number, signed: boolean): number {
    if (signed) {
      const s = tileIndex > 127 ? tileIndex - 256 : tileIndex;
      return 0x9000 + s * 16;
    }
    return 0x8000 + tileIndex * 16;
  }

  private decodePalette(reg: number): [number, number, number, number] {
    return [
      this.shade(reg & 0x03),
      this.shade((reg >> 2) & 0x03),
      this.shade((reg >> 4) & 0x03),
      this.shade((reg >> 6) & 0x03),
    ];
  }

  private getCachedBGPalette(bgp: number): [number, number, number, number] {
    if (bgp !== this.cachedBGP) {
      this.cachedBGP = bgp;
      this.cachedBGPalette = this.decodePalette(bgp);
    }
    return this.cachedBGPalette;
  }

  private shade(colorValue: number): number {
    return GB_SHADES[colorValue & 0x03]!;
  }

  reset(): void {
    this.modeClock = 0;
    this._mode = 2;
    this._line = 0;
    this.lcdEnabled = false;
    this.statInterruptSignal = false;
    this._windowLineCounter = 0;
    this._framebuffer.fill(255);
    this.bgColorIdx.fill(0);
    this.spriteCount = 0;
    this.cachedBGP = -1;
    this.cachedOBP0 = -1;
    this.cachedOBP1 = -1;
  }

  private static readonly HEADER_SIZE = 7;
  private static readonly FRAMEBUFFER_SIZE = 160 * 144 * 4;

  serialize(): Uint8Array {
    const data = new Uint8Array(PPU.HEADER_SIZE + this._framebuffer.length);
    data[0] = this._mode;
    data[1] = this._line;
    data[2] = (this.modeClock >> 8) & 0xFF;
    data[3] = this.modeClock & 0xFF;
    data[4] = this.lcdEnabled ? 1 : 0;
    data[5] = this.statInterruptSignal ? 1 : 0;
    data[6] = this._windowLineCounter;
    data.set(this._framebuffer, PPU.HEADER_SIZE);
    return data;
  }

  static deserialize(data: Uint8Array, memory: IMemory): PPU {
    const expectedSize = PPU.HEADER_SIZE + PPU.FRAMEBUFFER_SIZE;
    if (data.length < expectedSize) {
      throw new Error(
        `PPU state buffer too short: expected ${expectedSize} bytes, got ${data.length}`
      );
    }
    const ppu = new PPU(memory);
    const rawMode = data[0]!;
    if (rawMode > 3) {
      throw new Error(`Invalid PPU mode in save state: ${rawMode}`);
    }
    ppu._mode = rawMode as 0 | 1 | 2 | 3;
    ppu._line = data[1]!;
    ppu.modeClock = (data[2]! << 8) | data[3]!;
    ppu.lcdEnabled = data[4] === 1;
    ppu.statInterruptSignal = data[5] === 1;
    ppu._windowLineCounter = data[6]!;
    ppu._framebuffer.set(data.subarray(PPU.HEADER_SIZE, PPU.HEADER_SIZE + PPU.FRAMEBUFFER_SIZE));
    return ppu;
  }
}
