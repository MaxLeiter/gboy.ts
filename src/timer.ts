const DIV = 0xff04;
const TIMA = 0xff05;
const TMA = 0xff06;
const TAC = 0xff07;

const TIMER_STATE_SIZE = 12;

// TAC clock select -> falling-edge source bit on the M-cycle counter.
// M-cycle periods: 00=256, 01=4, 10=16, 11=64.
const TAC_BIT_BY_SELECT: readonly number[] = [7, 1, 3, 5];

export class Timer {
  private systemCounter = 0;
  private subCycleCounter = 0;

  private tima = 0;
  private tma = 0;
  private tac = 0;

  private reloadDelay = -1;

  private currentTimerSignal(counter = this.systemCounter): boolean {
    if ((this.tac & 0x04) === 0) return false;
    const bit = TAC_BIT_BY_SELECT[this.tac & 0x03]!;
    return ((counter >> bit) & 1) !== 0;
  }

  private incrementTima(): void {
    if (this.tima === 0xff) {
      // TIMA overflow: hardware keeps 0x00 briefly, then reloads TMA one M-cycle later.
      this.tima = 0x00;
      this.reloadDelay = 1;
      return;
    }
    this.tima = (this.tima + 1) & 0xff;
  }

  private applySignalTransition(oldSignal: boolean, newSignal: boolean): void {
    if (oldSignal && !newSignal) {
      this.incrementTima();
    }
  }

  private advanceReloadPipeline(): void {
    if (this.reloadDelay > 0) {
      this.reloadDelay--;
    }
  }

  private tickMcycle(): boolean {
    let requestInterrupt = false;

    const oldSignal = this.currentTimerSignal();
    this.systemCounter = (this.systemCounter + 1) & 0xffff;
    const newSignal = this.currentTimerSignal();
    this.applySignalTransition(oldSignal, newSignal);

    if (this.reloadDelay > 0) {
      this.reloadDelay--;
    } else if (this.reloadDelay === 0) {
      this.tima = this.tma;
      this.reloadDelay = -1;
      requestInterrupt = true;
    }

    return requestInterrupt;
  }

  tick(tCycles: number): boolean {
    let requestInterrupt = false;

    for (let i = 0; i < tCycles; i++) {
      this.subCycleCounter++;
      if (this.subCycleCounter === 4) {
        this.subCycleCounter = 0;
        if (this.tickMcycle()) {
          requestInterrupt = true;
        }
      }
    }

    return requestInterrupt;
  }

  readRegister(address: number): number {
    switch (address) {
      case DIV:
        return (this.systemCounter >> 6) & 0xff;
      case TIMA:
        return this.tima;
      case TMA:
        return this.tma;
      case TAC:
        // Upper 5 bits are unused and read as 1 on DMG
        return this.tac | 0xf8;
      default:
        return 0xff;
    }
  }

  writeRegister(address: number, value: number): void {
    value &= 0xff;

    switch (address) {
      case DIV: {
        const oldSignal = this.currentTimerSignal();
        this.systemCounter = 0;
        this.subCycleCounter = 0;
        const newSignal = this.currentTimerSignal();
        this.applySignalTransition(oldSignal, newSignal);
        this.advanceReloadPipeline();
        break;
      }
      case TIMA:
        this.tima = value;
        if (this.reloadDelay >= 0) {
          this.reloadDelay = -1;
        }
        break;
      case TMA:
        this.tma = value;
        // Per hardware: writing TMA on the same M-cycle as TMA→TIMA reload
        // also updates TIMA with the new TMA value (TIMA latches TMA input).
        if (this.reloadDelay === 0) {
          this.tima = value;
        }
        break;
      case TAC: {
        const oldSignal = this.currentTimerSignal();
        this.tac = value & 0x07;
        const newSignal = this.currentTimerSignal();
        this.applySignalTransition(oldSignal, newSignal);
        this.advanceReloadPipeline();
        break;
      }
    }
  }

  reset(): void {
    this.systemCounter = 0;
    this.subCycleCounter = 0;
    this.tima = 0;
    this.tma = 0;
    this.tac = 0;
    this.reloadDelay = -1;
  }

  serialize(): Uint8Array {
    const buffer = new Uint8Array(TIMER_STATE_SIZE);
    const view = new DataView(buffer.buffer);
    view.setUint16(0, this.systemCounter, true);
    buffer[2] = this.subCycleCounter & 0x03;
    buffer[3] = this.tima;
    buffer[4] = this.tma;
    buffer[5] = this.tac;
    buffer[6] = (this.reloadDelay + 1) & 0xff;
    return buffer;
  }

  static deserialize(data: Uint8Array): Timer {
    if (data.length < TIMER_STATE_SIZE) {
      throw new Error(
        `Timer state buffer too short: expected ${TIMER_STATE_SIZE} bytes, got ${data.length}`,
      );
    }

    const timer = new Timer();
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    timer.systemCounter = view.getUint16(0, true);
    timer.subCycleCounter = data[2]! & 0x03;
    timer.tima = data[3]!;
    timer.tma = data[4]!;
    timer.tac = data[5]! & 0x07;
    timer.reloadDelay = (data[6]! & 0xff) - 1;
    return timer;
  }
}
