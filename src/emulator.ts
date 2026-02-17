import { CPU } from "./cpu";
import { MMU } from "./mmu";
import { PPU } from "./ppu";
import { Timer } from "./timer";
import { Joypad, Button } from "./input";
import { Cartridge } from "./cartridge";
import { APU } from "./apu";

export { Button } from "./input";

const CYCLES_PER_FRAME = 70224; // 4194304 Hz / ~59.7 FPS

export class Emulator {
  cpu: CPU;
  mmu: MMU;
  ppu: PPU;
  timer: Timer;
  joypad: Joypad;
  cartridge: Cartridge;
  apu: APU;
  private romData: Uint8Array;
  private cycleDebt = 0;

  constructor(romData: Uint8Array) {
    this.romData = romData;
    this.cartridge = Cartridge.fromROM(romData);
    this.mmu = new MMU();
    this.timer = new Timer();
    this.joypad = new Joypad();
    this.ppu = new PPU(this.mmu);
    this.apu = new APU();

    this.mmu.cartridge = this.cartridge;
    this.mmu.timer = this.timer;
    this.mmu.joypad = this.joypad;
    this.mmu.apu = this.apu;
    this.mmu.ppu = this.ppu;

    this.mmu.loadROM(romData.subarray(0, Math.min(romData.length, 0x8000)));
    this.initializePostBootIO();

    this.cpu = new CPU(this.mmu);
  }

  private initializePostBootIO(): void {
    // DMG post-boot hardware register state when boot ROM execution is skipped.
    const ioDefaults: Array<[number, number]> = [
      [0xFF00, 0xCF],
      [0xFF05, 0x00],
      [0xFF06, 0x00],
      [0xFF07, 0x00],
      [0xFF10, 0x80],
      [0xFF11, 0xBF],
      [0xFF12, 0xF3],
      [0xFF14, 0xBF],
      [0xFF16, 0x3F],
      [0xFF17, 0x00],
      [0xFF19, 0xBF],
      [0xFF1A, 0x7F],
      [0xFF1B, 0xFF],
      [0xFF1C, 0x9F],
      [0xFF1E, 0xBF],
      [0xFF20, 0xFF],
      [0xFF21, 0x00],
      [0xFF22, 0x00],
      [0xFF23, 0xBF],
      [0xFF24, 0x77],
      [0xFF25, 0xF3],
      [0xFF26, 0xF1],
      [0xFF40, 0x91],
      [0xFF42, 0x00],
      [0xFF43, 0x00],
      [0xFF45, 0x00],
      [0xFF47, 0xFC],
      [0xFF48, 0xFF],
      [0xFF49, 0xFF],
      [0xFF4A, 0x00],
      [0xFF4B, 0x00],
      [0xFFFF, 0x00],
    ];

    for (const [address, value] of ioDefaults) {
      this.mmu.writeByte(address, value);
    }
  }

  private requestInterrupt(mask: number): void {
    const ifReg = this.mmu.readByte(0xFF0F);
    const next = ifReg | (mask & 0x1F);
    if (next !== ifReg) {
      this.mmu.writeByte(0xFF0F, next);
    }
  }

  private tickPeripherals(cycles: number): void {
    if (this.timer.tick(cycles)) {
      this.requestInterrupt(0x04);
    }

    const ppuResult = this.ppu.tick(cycles);
    if (ppuResult.requestVBlankInterrupt) {
      this.requestInterrupt(0x01);
    }
    if (ppuResult.requestStatInterrupt) {
      this.requestInterrupt(0x02);
    }

    this.apu.tick(cycles);

    if (this.joypad.isInterruptRequested()) {
      this.requestInterrupt(0x10);
    }
  }

  runFrame(): Uint8Array {
    let cyclesThisFrame = this.cycleDebt;

    while (cyclesThisFrame < CYCLES_PER_FRAME) {
      const cycles = this.cpu.step();
      cyclesThisFrame += cycles;
      this.tickPeripherals(cycles);
    }

    this.cycleDebt = cyclesThisFrame - CYCLES_PER_FRAME;

    return this.ppu.getFramebuffer();
  }

  runFrames(count: number): Uint8Array {
    let fb: Uint8Array = this.ppu.getFramebuffer();
    for (let i = 0; i < count; i++) {
      fb = this.runFrame();
    }
    return fb;
  }

  pressButton(button: Button): void {
    this.joypad.pressButton(button);
  }

  releaseButton(button: Button): void {
    this.joypad.releaseButton(button);
  }

  pressButtonForFrames(button: Button, frames: number): Uint8Array {
    this.joypad.pressButton(button);
    let fb: Uint8Array = this.ppu.getFramebuffer();
    for (let i = 0; i < frames; i++) {
      fb = this.runFrame();
    }
    this.joypad.releaseButton(button);
    return fb;
  }

  getFramebuffer(): Uint8Array {
    return this.ppu.getFramebuffer();
  }

  setAudioOutputEnabled(enabled: boolean): void {
    this.apu.setOutputEnabled(enabled);
  }

  getAudioSampleRate(): number {
    return this.apu.getSampleRate();
  }

  consumeAudioSamples(maxFrames?: number): Float32Array {
    return this.apu.consumeSamples(maxFrames);
  }

  getQueuedAudioSampleFrames(): number {
    return this.apu.getQueuedSampleFrames();
  }

  reset(): void {
    this.cartridge = Cartridge.fromROM(this.romData);
    this.mmu = new MMU();
    this.timer = new Timer();
    this.joypad = new Joypad();
    this.ppu = new PPU(this.mmu);
    this.apu = new APU();

    this.mmu.cartridge = this.cartridge;
    this.mmu.timer = this.timer;
    this.mmu.joypad = this.joypad;
    this.mmu.apu = this.apu;
    this.mmu.ppu = this.ppu;

    this.mmu.loadROM(this.romData.subarray(0, Math.min(this.romData.length, 0x8000)));
    this.initializePostBootIO();

    this.cpu = new CPU(this.mmu);
    this.cycleDebt = 0;
  }

  serialize(): Uint8Array {
    const cpuState = this.cpu.serialize();
    const mmuState = this.mmu.serialize();
    const ppuState = this.ppu.serialize();
    const timerState = this.timer.serialize();
    const joypadState = this.joypad.serialize();
    const cartState = this.cartridge.serialize();
    const apuState = this.apu.serialize();

    const headerSize = 7 * 4;
    const totalSize =
      headerSize +
      cpuState.length +
      mmuState.length +
      ppuState.length +
      timerState.length +
      joypadState.length +
      cartState.length +
      apuState.length;

    const buffer = new Uint8Array(totalSize);
    const view = new DataView(buffer.buffer);

    view.setUint32(0, cpuState.length, true);
    view.setUint32(4, mmuState.length, true);
    view.setUint32(8, ppuState.length, true);
    view.setUint32(12, timerState.length, true);
    view.setUint32(16, joypadState.length, true);
    view.setUint32(20, cartState.length, true);
    view.setUint32(24, apuState.length, true);

    let offset = headerSize;
    buffer.set(cpuState, offset); offset += cpuState.length;
    buffer.set(mmuState, offset); offset += mmuState.length;
    buffer.set(ppuState, offset); offset += ppuState.length;
    buffer.set(timerState, offset); offset += timerState.length;
    buffer.set(joypadState, offset); offset += joypadState.length;
    buffer.set(cartState, offset); offset += cartState.length;
    buffer.set(apuState, offset);

    return buffer;
  }

  static deserialize(romData: Uint8Array, state: Uint8Array): Emulator {
    const MIN_HEADER_SIZE = 28; // 7 component lengths * 4 bytes each
    if (state.length < MIN_HEADER_SIZE) {
      throw new Error(`Emulator state buffer too short: expected at least ${MIN_HEADER_SIZE} bytes, got ${state.length}`);
    }

    const emu = new Emulator(romData);
    const view = new DataView(state.buffer, state.byteOffset, state.byteLength);

    const cpuLen = view.getUint32(0, true);
    const mmuLen = view.getUint32(4, true);
    const ppuLen = view.getUint32(8, true);
    const timerLen = view.getUint32(12, true);
    const joypadLen = view.getUint32(16, true);
    const cartLen = view.getUint32(20, true);
    const apuLen = view.getUint32(24, true);

    let offset = MIN_HEADER_SIZE;
    const cpuState = state.subarray(offset, offset + cpuLen); offset += cpuLen;
    const mmuState = state.subarray(offset, offset + mmuLen); offset += mmuLen;
    const ppuState = state.subarray(offset, offset + ppuLen); offset += ppuLen;
    const timerState = state.subarray(offset, offset + timerLen); offset += timerLen;
    const joypadState = state.subarray(offset, offset + joypadLen); offset += joypadLen;
    const cartState = state.subarray(offset, offset + cartLen); offset += cartLen;
    const apuState = apuLen > 0 ? state.subarray(offset, offset + apuLen) : null;

    const cart = Cartridge.deserialize(cartState, romData);
    const timer = Timer.deserialize(timerState);
    const joypad = Joypad.deserialize(joypadState);
    const apu = apuState ? APU.deserialize(apuState) : new APU();

    const mmu = MMU.deserialize(mmuState);
    mmu.cartridge = cart;
    mmu.timer = timer;
    mmu.joypad = joypad;
    mmu.apu = apu;

    const cpu = CPU.deserialize(cpuState, mmu);
    const ppu = PPU.deserialize(ppuState, mmu);
    mmu.ppu = ppu;

    emu.cartridge = cart;
    emu.mmu = mmu;
    emu.timer = timer;
    emu.joypad = joypad;
    emu.apu = apu;
    emu.cpu = cpu;
    emu.ppu = ppu;

    return emu;
  }
}
