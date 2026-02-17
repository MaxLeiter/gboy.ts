import type { Timer } from "./timer";
import type { Joypad } from "./input";
import type { Cartridge } from "./cartridge";
import type { APU } from "./apu";
import type { PPU } from "./ppu";

export interface IMemory {
  readByte(address: number): number;
  writeByte(address: number, value: number): void;
  setLY?(value: number): void;
}

const ROM_SIZE = 0x8000; // 32KB (bank 0 + bank 1)
const VRAM_SIZE = 0x2000; // 8KB
const ERAM_SIZE = 0x2000; // 8KB
const WRAM_SIZE = 0x2000; // 8KB (bank 0 + bank 1)
const OAM_SIZE = 0xA0; // 160 bytes
const IO_SIZE = 0x80; // 128 bytes
const HRAM_SIZE = 0x7F; // 127 bytes

export const EXPECTED_SERIALIZE_SIZE =
  VRAM_SIZE + ERAM_SIZE + WRAM_SIZE + OAM_SIZE + IO_SIZE + HRAM_SIZE + 1;

export class MMU implements IMemory {
  private rom: Uint8Array;
  private vram: Uint8Array;
  private eram: Uint8Array;
  private wram: Uint8Array;
  private oam: Uint8Array;
  private io: Uint8Array;
  private hram: Uint8Array;
  private ie: number;

  public timer: Timer | null = null;
  public joypad: Joypad | null = null;
  public cartridge: Cartridge | null = null;
  public apu: APU | null = null;
  public ppu: PPU | null = null;

  constructor() {
    this.rom = new Uint8Array(ROM_SIZE);
    this.vram = new Uint8Array(VRAM_SIZE);
    this.eram = new Uint8Array(ERAM_SIZE);
    this.wram = new Uint8Array(WRAM_SIZE);
    this.oam = new Uint8Array(OAM_SIZE);
    this.io = new Uint8Array(IO_SIZE);
    this.hram = new Uint8Array(HRAM_SIZE);
    this.ie = 0;
  }

  readByte(address: number): number {
    address &= 0xFFFF;

    if (address <= 0x7FFF) {
      if (this.cartridge) return this.cartridge.readByte(address);
      return this.rom[address]!;
    }

    if (address <= 0x9FFF) {
      if (this.ppu && this.ppu.mode === 3) return 0xFF;
      return this.vram[address - 0x8000]!;
    }

    if (address <= 0xBFFF) {
      if (this.cartridge) return this.cartridge.readByte(address);
      return this.eram[address - 0xA000]!;
    }

    if (address <= 0xDFFF) {
      return this.wram[address - 0xC000]!;
    }

    if (address <= 0xFDFF) {
      return this.wram[address - 0xE000]!;
    }

    if (address <= 0xFE9F) {
      if (this.ppu && (this.ppu.mode === 2 || this.ppu.mode === 3)) return 0xFF;
      return this.oam[address - 0xFE00]!;
    }

    if (address <= 0xFEFF) {
      return 0xFF;
    }

    if (address <= 0xFF7F) {
      if (address === 0xFF00) {
        if (this.joypad) {
          return this.joypad.read(this.io[0]!);
        }
        // Without joypad: bits 7-6 always 1, bits 3-0 = 0xF (no buttons pressed)
        return 0xC0 | (this.io[0]! & 0x30) | 0x0F;
      }
      if (address >= 0xFF04 && address <= 0xFF07 && this.timer) {
        return this.timer.readRegister(address);
      }
      if (address >= 0xFF10 && address <= 0xFF3F && this.apu) {
        return this.apu.readRegister(address);
      }
      if (address === 0xFF0F) {
        // IF: upper 3 bits are unused and always read as 1
        return this.io[address - 0xFF00]! | 0xE0;
      }
      if (address === 0xFF41) {
        // STAT: bit 7 always reads as 1
        return this.io[address - 0xFF00]! | 0x80;
      }
      return this.io[address - 0xFF00]!;
    }

    if (address <= 0xFFFE) {
      return this.hram[address - 0xFF80]!;
    }

    // 0xFFFF
    return this.ie;
  }

  writeByte(address: number, value: number): void {
    address &= 0xFFFF;
    value &= 0xFF;

    if (address <= 0x7FFF) {
      if (this.cartridge) {
        this.cartridge.writeByte(address, value);
      }
      return;
    }

    if (address <= 0x9FFF) {
      if (this.ppu && this.ppu.mode === 3) return;
      this.vram[address - 0x8000] = value;
      return;
    }

    if (address <= 0xBFFF) {
      if (this.cartridge) {
        this.cartridge.writeByte(address, value);
      } else {
        this.eram[address - 0xA000] = value;
      }
      return;
    }

    if (address <= 0xDFFF) {
      this.wram[address - 0xC000] = value;
      return;
    }

    if (address <= 0xFDFF) {
      this.wram[address - 0xE000] = value;
      return;
    }

    if (address <= 0xFE9F) {
      if (this.ppu && (this.ppu.mode === 2 || this.ppu.mode === 3)) return;
      this.oam[address - 0xFE00] = value;
      return;
    }

    if (address <= 0xFEFF) {
      // Unusable; ignore writes
      return;
    }

    if (address <= 0xFF7F) {
      if (address === 0xFF44) {
        // LY is read-only from CPU perspective; writes reset it.
        this.io[address - 0xFF00] = 0;
        return;
      }
      if (address === 0xFF46) {
        // OAM DMA: copy 160 bytes from (value << 8) to FE00-FE9F.
        this.io[address - 0xFF00] = value;
        const sourceBase = (value << 8) & 0xffff;
        for (let i = 0; i < OAM_SIZE; i++) {
          this.oam[i] = this.readByte((sourceBase + i) & 0xffff);
        }
        return;
      }
      if (address >= 0xFF04 && address <= 0xFF07) {
        if (this.timer) {
          this.timer.writeRegister(address, value);
        }
        // DIV: any write resets to 0 (per hardware behavior)
        if (address === 0xFF04) {
          this.io[address - 0xFF00] = 0;
        } else {
          this.io[address - 0xFF00] = value;
        }
        return;
      }
      if (address >= 0xFF10 && address <= 0xFF3F && this.apu) {
        this.io[address - 0xFF00] = value;
        this.apu.writeRegister(address, value);
        return;
      }
      if (address === 0xFF00) {
        // P1/JOYP: only bits 5-4 are writable (selection bits)
        this.io[0] = (this.io[0]! & ~0x30) | (value & 0x30);
        if (this.joypad) {
          this.joypad.writeSelect(value);
        }
        return;
      }
      this.io[address - 0xFF00] = value;
      return;
    }

    if (address <= 0xFFFE) {
      this.hram[address - 0xFF80] = value;
      return;
    }

    // 0xFFFF
    this.ie = value;
  }

  setLY(value: number): void {
    this.io[0x44] = value & 0xFF;
  }

  readWord(address: number): number {
    const lo = this.readByte(address);
    const hi = this.readByte(address + 1);
    return (hi << 8) | lo;
  }

  writeWord(address: number, value: number): void {
    value &= 0xFFFF;
    this.writeByte(address, value & 0xFF);
    this.writeByte(address + 1, (value >> 8) & 0xFF);
  }

  loadROM(data: Uint8Array): void {
    this.rom = new Uint8Array(ROM_SIZE);
    const length = Math.min(data.length, ROM_SIZE);
    this.rom.set(data.subarray(0, length));
  }

  serialize(): Uint8Array {
    // Layout: vram | eram | wram | oam | io | hram | ie
    const buffer = new Uint8Array(EXPECTED_SERIALIZE_SIZE);
    let offset = 0;

    buffer.set(this.vram, offset);
    offset += VRAM_SIZE;

    buffer.set(this.eram, offset);
    offset += ERAM_SIZE;

    buffer.set(this.wram, offset);
    offset += WRAM_SIZE;

    buffer.set(this.oam, offset);
    offset += OAM_SIZE;

    buffer.set(this.io, offset);
    offset += IO_SIZE;

    buffer.set(this.hram, offset);
    offset += HRAM_SIZE;

    buffer[offset] = this.ie;

    return buffer;
  }

  static deserialize(data: Uint8Array, rom?: Uint8Array): MMU {
    if (data.length < EXPECTED_SERIALIZE_SIZE) {
      throw new Error(
        `MMU state buffer too short: expected ${EXPECTED_SERIALIZE_SIZE} bytes, got ${data.length}`
      );
    }

    const mmu = new MMU();
    let offset = 0;

    mmu.vram = new Uint8Array(VRAM_SIZE);
    mmu.vram.set(data.subarray(offset, offset + VRAM_SIZE));
    offset += VRAM_SIZE;

    mmu.eram = new Uint8Array(ERAM_SIZE);
    mmu.eram.set(data.subarray(offset, offset + ERAM_SIZE));
    offset += ERAM_SIZE;

    mmu.wram = new Uint8Array(WRAM_SIZE);
    mmu.wram.set(data.subarray(offset, offset + WRAM_SIZE));
    offset += WRAM_SIZE;

    mmu.oam = new Uint8Array(OAM_SIZE);
    mmu.oam.set(data.subarray(offset, offset + OAM_SIZE));
    offset += OAM_SIZE;

    mmu.io = new Uint8Array(IO_SIZE);
    mmu.io.set(data.subarray(offset, offset + IO_SIZE));
    offset += IO_SIZE;

    mmu.hram = new Uint8Array(HRAM_SIZE);
    mmu.hram.set(data.subarray(offset, offset + HRAM_SIZE));
    offset += HRAM_SIZE;

    mmu.ie = data[offset]!;

    if (rom) {
      mmu.loadROM(rom);
    }

    return mmu;
  }
}
