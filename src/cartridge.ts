export type MBCType = "ROM_ONLY" | "MBC1" | "MBC3" | "MBC5";

export class Cartridge {
  private rom: Uint8Array;
  private ram: Uint8Array;
  private mbcType: MBCType;
  private romBankCount: number;
  private ramSize: number;

  private ramEnabled = false;
  private romBank = 1;
  private ramBank = 0;
  private bankingMode = 0;
  private romBankLow = 1;
  private romBankHigh = 0;

  private constructor(rom: Uint8Array, mbcType: MBCType, romBankCount: number, ramSize: number) {
    this.rom = rom;
    this.mbcType = mbcType;
    this.romBankCount = romBankCount;
    this.ramSize = ramSize;
    this.ram = new Uint8Array(ramSize);
  }

  static fromROM(data: Uint8Array): Cartridge {
    const typeCode = data[0x0147] ?? 0;
    let mbcType: MBCType;
    if (typeCode === 0x00) mbcType = "ROM_ONLY";
    else if (typeCode >= 0x01 && typeCode <= 0x03) mbcType = "MBC1";
    else if (typeCode >= 0x0F && typeCode <= 0x13) mbcType = "MBC3";
    else if (typeCode >= 0x19 && typeCode <= 0x1E) mbcType = "MBC5";
    else mbcType = "ROM_ONLY";

    const romSizeCode = data[0x0148] ?? 0;
    const romBankCount = 2 << romSizeCode;

    const ramSizeCode = data[0x0149] ?? 0;
    let ramSize = 0;
    switch (ramSizeCode) {
      case 0: ramSize = 0; break;
      case 1: ramSize = 2048; break;
      case 2: ramSize = 8192; break;
      case 3: ramSize = 32768; break;
      case 4: ramSize = 131072; break;
      case 5: ramSize = 65536; break;
    }

    return new Cartridge(new Uint8Array(data), mbcType, romBankCount, ramSize);
  }

  getTitle(): string {
    const bytes: number[] = [];
    for (let i = 0x0134; i <= 0x0143; i++) {
      const b = this.rom[i]!;
      if (b === 0) break;
      bytes.push(b);
    }
    return String.fromCharCode(...bytes);
  }

  getMBCType(): MBCType { return this.mbcType; }

  readByte(address: number): number {
    if (address <= 0x3FFF) {
      if (this.mbcType === "MBC1" && this.bankingMode === 1) {
        const bank = ((this.romBankHigh << 5) % this.romBankCount) & 0xFF;
        const offset = bank * 0x4000 + address;
        return this.rom[offset % this.rom.length] ?? 0xFF;
      }
      return this.rom[address] ?? 0xFF;
    }

    if (address <= 0x7FFF) {
      const bank = this.getEffectiveRomBank();
      const offset = bank * 0x4000 + (address - 0x4000);
      return this.rom[offset % this.rom.length] ?? 0xFF;
    }

    if (address >= 0xA000 && address <= 0xBFFF) {
      if (!this.ramEnabled || this.ramSize === 0) return 0xFF;
      if (this.isRtcSelected()) return 0xFF;
      const bank = this.getEffectiveRamBank();
      const offset = bank * 0x2000 + (address - 0xA000);
      return this.ram[offset % this.ramSize] ?? 0xFF;
    }

    return 0xFF;
  }

  writeByte(address: number, value: number): void {
    value &= 0xFF;

    if (this.mbcType === "ROM_ONLY") {
      return;
    }

    if (address <= 0x1FFF) {
      this.ramEnabled = (value & 0x0F) === 0x0A;
      return;
    }

    if (address <= 0x2FFF) {
      if (this.mbcType === "MBC1") {
        this.romBankLow = value & 0x1F;
        if (this.romBankLow === 0) this.romBankLow = 1;
        this.updateRomBank();
      } else if (this.mbcType === "MBC3") {
        this.romBank = value & 0x7F;
        if (this.romBank === 0) this.romBank = 1;
      } else if (this.mbcType === "MBC5") {
        this.romBankLow = value;
        this.romBank = (this.romBankHigh << 8) | this.romBankLow;
      }
      return;
    }

    if (address <= 0x3FFF) {
      if (this.mbcType === "MBC1") {
        this.romBankLow = value & 0x1F;
        if (this.romBankLow === 0) this.romBankLow = 1;
        this.updateRomBank();
      } else if (this.mbcType === "MBC3") {
        this.romBank = value & 0x7F;
        if (this.romBank === 0) this.romBank = 1;
      } else if (this.mbcType === "MBC5") {
        this.romBankHigh = value & 0x01;
        this.romBank = (this.romBankHigh << 8) | this.romBankLow;
      }
      return;
    }

    if (address <= 0x5FFF) {
      if (this.mbcType === "MBC1") {
        this.romBankHigh = value & 0x03;
        this.updateRomBank();
      } else if (this.mbcType === "MBC3") {
        this.ramBank = value & 0x0F;
      } else if (this.mbcType === "MBC5") {
        this.ramBank = value & 0x0F;
      }
      return;
    }

    if (address <= 0x7FFF) {
      if (this.mbcType === "MBC1") {
        this.bankingMode = value & 0x01;
      }
      return;
    }

    if (address >= 0xA000 && address <= 0xBFFF) {
      if (!this.ramEnabled || this.ramSize === 0) return;
      if (this.isRtcSelected()) return;
      const bank = this.getEffectiveRamBank();
      const offset = bank * 0x2000 + (address - 0xA000);
      if (offset < this.ramSize) {
        this.ram[offset] = value;
      }
      return;
    }
  }

  private updateRomBank(): void {
    if (this.bankingMode === 0) {
      this.romBank = (this.romBankHigh << 5) | this.romBankLow;
    } else {
      this.romBank = this.romBankLow;
    }
  }

  private getEffectiveRomBank(): number {
    if (this.mbcType === "ROM_ONLY") return 1;
    let bank = this.romBank;
    if (this.mbcType === "MBC1" && this.bankingMode === 0) {
      bank = (this.romBankHigh << 5) | this.romBankLow;
    } else if (this.mbcType === "MBC1") {
      bank = this.romBankLow;
    }
    return bank % this.romBankCount;
  }

  private getEffectiveRamBank(): number {
    if (this.mbcType === "MBC1") {
      return this.bankingMode === 1 ? this.romBankHigh : 0;
    }
    return this.ramBank;
  }

  private isRtcSelected(): boolean {
    return this.mbcType === "MBC3" && this.ramBank >= 0x08 && this.ramBank <= 0x0C;
  }

  serialize(): Uint8Array {
    const data = new Uint8Array(8 + this.ram.length);
    data[0] = this.ramEnabled ? 1 : 0;
    data[1] = this.romBank & 0xFF;
    data[2] = this.ramBank;
    data[3] = this.bankingMode;
    data[4] = this.romBankLow;
    data[5] = this.romBankHigh;
    data[6] = (this.romBank >> 8) & 0xFF;
    data.set(this.ram, 8);
    return data;
  }

  static deserialize(data: Uint8Array, rom: Uint8Array): Cartridge {
    if (data.length < 8) {
      throw new Error(
        `Cartridge state buffer too short: expected at least 8 bytes, got ${data.length}`
      );
    }
    const cart = Cartridge.fromROM(rom);
    cart.ramEnabled = data[0]! === 1;
    cart.romBank = data[1]! | ((data[6]! & 0x01) << 8);
    cart.ramBank = data[2]!;
    cart.bankingMode = data[3]!;
    cart.romBankLow = data[4]!;
    cart.romBankHigh = data[5]!;

    if (cart.mbcType === "MBC1") {
      cart.romBankLow &= 0x1F;
      if (cart.romBankLow === 0) cart.romBankLow = 1;
      cart.romBankHigh &= 0x03;
      cart.bankingMode &= 0x01;
      cart.updateRomBank();
    } else if (cart.mbcType === "MBC3") {
      cart.romBank &= 0x7F;
      if (cart.romBank === 0) cart.romBank = 1;
      cart.ramBank &= 0x0F;
    } else if (cart.mbcType === "MBC5") {
      cart.romBankLow &= 0xFF;
      cart.romBankHigh &= 0x01;
      cart.romBank = (cart.romBankHigh << 8) | cart.romBankLow;
      cart.ramBank &= 0x0F;
    }

    cart.ram.set(data.subarray(8, 8 + cart.ramSize));
    return cart;
  }
}
