const APU_REGISTER_START = 0xff10;
const APU_REGISTER_END = 0xff3f;
const APU_REGISTER_COUNT = APU_REGISTER_END - APU_REGISTER_START + 1;

const NR10 = 0xff10;
const NR11 = 0xff11;
const NR12 = 0xff12;
const NR13 = 0xff13;
const NR14 = 0xff14;
const NR21 = 0xff16;
const NR22 = 0xff17;
const NR23 = 0xff18;
const NR24 = 0xff19;
const NR30 = 0xff1a;
const NR31 = 0xff1b;
const NR32 = 0xff1c;
const NR33 = 0xff1d;
const NR34 = 0xff1e;
const NR41 = 0xff20;
const NR42 = 0xff21;
const NR43 = 0xff22;
const NR44 = 0xff23;
const NR50 = 0xff24;
const NR51 = 0xff25;
const NR52 = 0xff26;
const WAVE_RAM_START = 0xff30;
const WAVE_RAM_END = 0xff3f;

const FRAME_SEQUENCER_PERIOD_T_CYCLES = 512;
const CPU_CLOCK_HZ = 4194304;
const DEFAULT_MAX_BUFFERED_FRAMES = 48000 * 4;

const DUTY_PATTERNS: readonly number[][] = [
  [0, 0, 0, 0, 0, 0, 0, 1],
  [1, 0, 0, 0, 0, 0, 0, 1],
  [1, 0, 0, 0, 0, 1, 1, 1],
  [0, 1, 1, 1, 1, 1, 1, 0],
];

const NOISE_DIVISORS: readonly number[] = [8, 16, 32, 48, 64, 80, 96, 112];

const APU_SERIALIZE_VERSION = 1;
const APU_STATE_SIZE = 160;

export const DEFAULT_APU_SAMPLE_RATE = 48000;

interface EnvelopeChannelState {
  envelopeVolume: number;
  envelopePeriod: number;
  envelopeIncrease: boolean;
  envelopeTimer: number;
}

interface SquareChannelState extends EnvelopeChannelState {
  enabled: boolean;
  dacEnabled: boolean;
  lengthCounter: number;
  lengthEnabled: boolean;
  dutyStep: number;
  timer: number;
  frequency: number;
}

interface Square1ChannelState extends SquareChannelState {
  sweepPeriod: number;
  sweepNegate: boolean;
  sweepShift: number;
  sweepTimer: number;
  sweepEnabled: boolean;
  shadowFrequency: number;
}

interface WaveChannelState {
  enabled: boolean;
  dacEnabled: boolean;
  lengthCounter: number;
  lengthEnabled: boolean;
  timer: number;
  frequency: number;
  position: number;
}

interface NoiseChannelState extends EnvelopeChannelState {
  enabled: boolean;
  dacEnabled: boolean;
  lengthCounter: number;
  lengthEnabled: boolean;
  timer: number;
  lfsr: number;
}

function clampSample(value: number): number {
  if (value > 1) return 1;
  if (value < -1) return -1;
  return value;
}

function toRegisterIndex(address: number): number {
  return address - APU_REGISTER_START;
}

export class APU {
  private readonly registers = new Uint8Array(APU_REGISTER_COUNT);

  private powerEnabled = true;
  private outputEnabled = false;

  private frameSequencerStep = 0;
  private frameSequencerClock = 0;

  private readonly sampleRate: number;
  private readonly cyclesPerSample: number;
  private sampleClock = 0;

  private readonly maxBufferedFrames: number;
  private readonly sampleRing: Float32Array;
  private queuedFrames = 0;
  private queueReadFrame = 0;
  private queueWriteFrame = 0;

  private readonly ch1: Square1ChannelState = {
    enabled: false,
    dacEnabled: false,
    lengthCounter: 0,
    lengthEnabled: false,
    dutyStep: 0,
    timer: 0,
    frequency: 0,
    envelopeVolume: 0,
    envelopePeriod: 0,
    envelopeIncrease: false,
    envelopeTimer: 0,
    sweepPeriod: 0,
    sweepNegate: false,
    sweepShift: 0,
    sweepTimer: 0,
    sweepEnabled: false,
    shadowFrequency: 0,
  };

  private readonly ch2: SquareChannelState = {
    enabled: false,
    dacEnabled: false,
    lengthCounter: 0,
    lengthEnabled: false,
    dutyStep: 0,
    timer: 0,
    frequency: 0,
    envelopeVolume: 0,
    envelopePeriod: 0,
    envelopeIncrease: false,
    envelopeTimer: 0,
  };

  private readonly ch3: WaveChannelState = {
    enabled: false,
    dacEnabled: false,
    lengthCounter: 0,
    lengthEnabled: false,
    timer: 0,
    frequency: 0,
    position: 0,
  };

  private readonly ch4: NoiseChannelState = {
    enabled: false,
    dacEnabled: false,
    lengthCounter: 0,
    lengthEnabled: false,
    timer: 0,
    lfsr: 0x7fff,
    envelopeVolume: 0,
    envelopePeriod: 0,
    envelopeIncrease: false,
    envelopeTimer: 0,
  };

  constructor(sampleRate = DEFAULT_APU_SAMPLE_RATE, maxBufferedFrames = DEFAULT_MAX_BUFFERED_FRAMES) {
    this.sampleRate = Math.max(8000, Math.floor(sampleRate));
    this.cyclesPerSample = CPU_CLOCK_HZ / this.sampleRate;
    this.maxBufferedFrames = Math.max(1024, Math.floor(maxBufferedFrames));
    this.sampleRing = new Float32Array(this.maxBufferedFrames * 2);
    this.reset();
  }

  getSampleRate(): number {
    return this.sampleRate;
  }

  setOutputEnabled(enabled: boolean): void {
    this.outputEnabled = enabled;
    if (!enabled) {
      this.clearSamples();
    }
  }

  getOutputEnabled(): boolean {
    return this.outputEnabled;
  }

  reset(): void {
    this.registers.fill(0);
    this.powerEnabled = true;
    this.outputEnabled = false;

    this.frameSequencerStep = 0;
    this.frameSequencerClock = 0;
    this.sampleClock = 0;

    this.resetChannel1();
    this.resetChannel2();
    this.resetChannel3();
    this.resetChannel4();

    this.clearSamples();
  }

  private resetChannel1(): void {
    this.ch1.enabled = false;
    this.ch1.dacEnabled = false;
    this.ch1.lengthCounter = 0;
    this.ch1.lengthEnabled = false;
    this.ch1.dutyStep = 0;
    this.ch1.timer = 0;
    this.ch1.frequency = 0;
    this.ch1.envelopeVolume = 0;
    this.ch1.envelopePeriod = 0;
    this.ch1.envelopeIncrease = false;
    this.ch1.envelopeTimer = 0;
    this.ch1.sweepPeriod = 0;
    this.ch1.sweepNegate = false;
    this.ch1.sweepShift = 0;
    this.ch1.sweepTimer = 0;
    this.ch1.sweepEnabled = false;
    this.ch1.shadowFrequency = 0;
  }

  private resetChannel2(): void {
    this.ch2.enabled = false;
    this.ch2.dacEnabled = false;
    this.ch2.lengthCounter = 0;
    this.ch2.lengthEnabled = false;
    this.ch2.dutyStep = 0;
    this.ch2.timer = 0;
    this.ch2.frequency = 0;
    this.ch2.envelopeVolume = 0;
    this.ch2.envelopePeriod = 0;
    this.ch2.envelopeIncrease = false;
    this.ch2.envelopeTimer = 0;
  }

  private resetChannel3(): void {
    this.ch3.enabled = false;
    this.ch3.dacEnabled = false;
    this.ch3.lengthCounter = 0;
    this.ch3.lengthEnabled = false;
    this.ch3.timer = 0;
    this.ch3.frequency = 0;
    this.ch3.position = 0;
  }

  private resetChannel4(): void {
    this.ch4.enabled = false;
    this.ch4.dacEnabled = false;
    this.ch4.lengthCounter = 0;
    this.ch4.lengthEnabled = false;
    this.ch4.timer = 0;
    this.ch4.lfsr = 0x7fff;
    this.ch4.envelopeVolume = 0;
    this.ch4.envelopePeriod = 0;
    this.ch4.envelopeIncrease = false;
    this.ch4.envelopeTimer = 0;
  }

  private clearSamples(): void {
    this.queuedFrames = 0;
    this.queueReadFrame = 0;
    this.queueWriteFrame = 0;
  }

  tick(tCycles: number): void {
    const cycles = Math.max(0, Math.floor(tCycles));
    if (cycles === 0) return;

    if (this.powerEnabled) {
      this.advanceFrameSequencer(cycles);
      this.advanceChannelWaveforms(cycles);
    }

    if (!this.outputEnabled) {
      return;
    }

    if (!this.powerEnabled) {
      this.sampleClock = 0;
      return;
    }

    this.sampleClock += cycles;
    while (this.sampleClock >= this.cyclesPerSample) {
      this.sampleClock -= this.cyclesPerSample;
      const [left, right] = this.mixSample();
      this.pushSample(left, right);
    }
  }

  consumeSamples(maxFrames = this.queuedFrames): Float32Array {
    const requestedFrames = Math.max(0, Math.floor(maxFrames));
    const frames = Math.min(requestedFrames, this.queuedFrames);
    if (frames === 0) {
      return new Float32Array(0);
    }

    const out = new Float32Array(frames * 2);
    for (let i = 0; i < frames; i++) {
      const srcBase = this.queueReadFrame * 2;
      const dstBase = i * 2;
      out[dstBase] = this.sampleRing[srcBase]!;
      out[dstBase + 1] = this.sampleRing[srcBase + 1]!;
      this.queueReadFrame = (this.queueReadFrame + 1) % this.maxBufferedFrames;
    }

    this.queuedFrames -= frames;
    return out;
  }

  getQueuedSampleFrames(): number {
    return this.queuedFrames;
  }

  readRegister(address: number): number {
    address &= 0xffff;
    if (address < APU_REGISTER_START || address > APU_REGISTER_END) {
      return 0xff;
    }

    if (address >= WAVE_RAM_START && address <= WAVE_RAM_END) {
      return this.registers[toRegisterIndex(address)]!;
    }

    switch (address) {
      case NR10:
        return this.registers[toRegisterIndex(address)]! | 0x80;
      case NR11:
        return this.registers[toRegisterIndex(address)]! | 0x3f;
      case NR12:
        return this.registers[toRegisterIndex(address)]!;
      case NR13:
        return 0xff;
      case NR14:
        return this.registers[toRegisterIndex(address)]! | 0xbf;
      case NR21:
        return this.registers[toRegisterIndex(address)]! | 0x3f;
      case NR22:
        return this.registers[toRegisterIndex(address)]!;
      case NR23:
        return 0xff;
      case NR24:
        return this.registers[toRegisterIndex(address)]! | 0xbf;
      case NR30:
        return this.registers[toRegisterIndex(address)]! | 0x7f;
      case NR31:
        return 0xff;
      case NR32:
        return this.registers[toRegisterIndex(address)]! | 0x9f;
      case NR33:
        return 0xff;
      case NR34:
        return this.registers[toRegisterIndex(address)]! | 0xbf;
      case NR41:
        return 0xff;
      case NR42:
        return this.registers[toRegisterIndex(address)]!;
      case NR43:
        return this.registers[toRegisterIndex(address)]!;
      case NR44:
        return this.registers[toRegisterIndex(address)]! | 0xbf;
      case NR50:
      case NR51:
        return this.registers[toRegisterIndex(address)]!;
      case NR52: {
        const status =
          (this.ch1.enabled ? 0x01 : 0) |
          (this.ch2.enabled ? 0x02 : 0) |
          (this.ch3.enabled ? 0x04 : 0) |
          (this.ch4.enabled ? 0x08 : 0);
        return (this.powerEnabled ? 0x80 : 0x00) | 0x70 | status;
      }
      default:
        // FF27-FF2F are not used and read as 0xFF.
        return 0xff;
    }
  }

  writeRegister(address: number, value: number): void {
    address &= 0xffff;
    value &= 0xff;

    if (address < APU_REGISTER_START || address > APU_REGISTER_END) {
      return;
    }

    if (address === NR52) {
      this.writeNR52(value);
      return;
    }

    if (!this.powerEnabled && (address < WAVE_RAM_START || address > WAVE_RAM_END)) {
      return;
    }

    if (address >= WAVE_RAM_START && address <= WAVE_RAM_END) {
      this.registers[toRegisterIndex(address)] = value;
      return;
    }

    this.registers[toRegisterIndex(address)] = value;

    switch (address) {
      case NR10:
        this.ch1.sweepPeriod = (value >> 4) & 0x07;
        this.ch1.sweepNegate = (value & 0x08) !== 0;
        this.ch1.sweepShift = value & 0x07;
        break;

      case NR11:
        this.ch1.lengthCounter = 64 - (value & 0x3f);
        break;

      case NR12:
        this.ch1.dacEnabled = (value & 0xf8) !== 0;
        this.ch1.envelopePeriod = value & 0x07;
        this.ch1.envelopeIncrease = (value & 0x08) !== 0;
        if (!this.ch1.dacEnabled) {
          this.ch1.enabled = false;
        }
        break;

      case NR13:
        this.ch1.frequency = ((this.registers[toRegisterIndex(NR14)]! & 0x07) << 8) | value;
        break;

      case NR14:
        this.ch1.lengthEnabled = (value & 0x40) !== 0;
        this.ch1.frequency = ((value & 0x07) << 8) | this.registers[toRegisterIndex(NR13)]!;
        if ((value & 0x80) !== 0) {
          this.triggerChannel1();
        }
        break;

      case NR21:
        this.ch2.lengthCounter = 64 - (value & 0x3f);
        break;

      case NR22:
        this.ch2.dacEnabled = (value & 0xf8) !== 0;
        this.ch2.envelopePeriod = value & 0x07;
        this.ch2.envelopeIncrease = (value & 0x08) !== 0;
        if (!this.ch2.dacEnabled) {
          this.ch2.enabled = false;
        }
        break;

      case NR23:
        this.ch2.frequency = ((this.registers[toRegisterIndex(NR24)]! & 0x07) << 8) | value;
        break;

      case NR24:
        this.ch2.lengthEnabled = (value & 0x40) !== 0;
        this.ch2.frequency = ((value & 0x07) << 8) | this.registers[toRegisterIndex(NR23)]!;
        if ((value & 0x80) !== 0) {
          this.triggerChannel2();
        }
        break;

      case NR30:
        this.ch3.dacEnabled = (value & 0x80) !== 0;
        if (!this.ch3.dacEnabled) {
          this.ch3.enabled = false;
        }
        break;

      case NR31:
        this.ch3.lengthCounter = 256 - value;
        break;

      case NR32:
        break;

      case NR33:
        this.ch3.frequency = ((this.registers[toRegisterIndex(NR34)]! & 0x07) << 8) | value;
        break;

      case NR34:
        this.ch3.lengthEnabled = (value & 0x40) !== 0;
        this.ch3.frequency = ((value & 0x07) << 8) | this.registers[toRegisterIndex(NR33)]!;
        if ((value & 0x80) !== 0) {
          this.triggerChannel3();
        }
        break;

      case NR41:
        this.ch4.lengthCounter = 64 - (value & 0x3f);
        break;

      case NR42:
        this.ch4.dacEnabled = (value & 0xf8) !== 0;
        this.ch4.envelopePeriod = value & 0x07;
        this.ch4.envelopeIncrease = (value & 0x08) !== 0;
        if (!this.ch4.dacEnabled) {
          this.ch4.enabled = false;
        }
        break;

      case NR43:
        break;

      case NR44:
        this.ch4.lengthEnabled = (value & 0x40) !== 0;
        if ((value & 0x80) !== 0) {
          this.triggerChannel4();
        }
        break;

      case NR50:
      case NR51:
        break;
    }
  }

  private writeNR52(value: number): void {
    const nextPower = (value & 0x80) !== 0;

    if (this.powerEnabled && !nextPower) {
      this.powerEnabled = false;
      this.resetChannel1();
      this.resetChannel2();
      this.resetChannel3();
      this.resetChannel4();
      this.frameSequencerStep = 0;
      this.frameSequencerClock = 0;
      this.sampleClock = 0;

      for (let address = NR10; address <= NR51; address++) {
        this.registers[toRegisterIndex(address)] = 0;
      }
      this.clearSamples();
      this.registers[toRegisterIndex(NR52)] = 0;
      return;
    }

    if (!this.powerEnabled && nextPower) {
      this.powerEnabled = true;
      this.frameSequencerStep = 0;
      this.frameSequencerClock = 0;
      this.sampleClock = 0;
      this.registers[toRegisterIndex(NR52)] = 0x80;
      return;
    }

    this.registers[toRegisterIndex(NR52)] = nextPower ? 0x80 : 0x00;
  }

  private triggerChannel1(): void {
    if (this.ch1.lengthCounter === 0) {
      this.ch1.lengthCounter = 64;
    }

    this.ch1.timer = this.squareTimerPeriod(this.ch1.frequency);
    this.ch1.dutyStep = 0;

    this.ch1.envelopeVolume = (this.registers[toRegisterIndex(NR12)]! >> 4) & 0x0f;
    this.ch1.envelopePeriod = this.registers[toRegisterIndex(NR12)]! & 0x07;
    this.ch1.envelopeIncrease = (this.registers[toRegisterIndex(NR12)]! & 0x08) !== 0;
    this.ch1.envelopeTimer = this.ch1.envelopePeriod === 0 ? 8 : this.ch1.envelopePeriod;

    this.ch1.sweepPeriod = (this.registers[toRegisterIndex(NR10)]! >> 4) & 0x07;
    this.ch1.sweepNegate = (this.registers[toRegisterIndex(NR10)]! & 0x08) !== 0;
    this.ch1.sweepShift = this.registers[toRegisterIndex(NR10)]! & 0x07;
    this.ch1.sweepTimer = this.ch1.sweepPeriod === 0 ? 8 : this.ch1.sweepPeriod;
    this.ch1.shadowFrequency = this.ch1.frequency;
    this.ch1.sweepEnabled = this.ch1.sweepPeriod !== 0 || this.ch1.sweepShift !== 0;

    this.ch1.enabled = this.ch1.dacEnabled;

    if (this.ch1.sweepShift !== 0) {
      const overflowCheck = this.calculateSweepFrequency();
      if (overflowCheck > 2047) {
        this.ch1.enabled = false;
      }
    }
  }

  private triggerChannel2(): void {
    if (this.ch2.lengthCounter === 0) {
      this.ch2.lengthCounter = 64;
    }

    this.ch2.timer = this.squareTimerPeriod(this.ch2.frequency);
    this.ch2.dutyStep = 0;

    this.ch2.envelopeVolume = (this.registers[toRegisterIndex(NR22)]! >> 4) & 0x0f;
    this.ch2.envelopePeriod = this.registers[toRegisterIndex(NR22)]! & 0x07;
    this.ch2.envelopeIncrease = (this.registers[toRegisterIndex(NR22)]! & 0x08) !== 0;
    this.ch2.envelopeTimer = this.ch2.envelopePeriod === 0 ? 8 : this.ch2.envelopePeriod;

    this.ch2.enabled = this.ch2.dacEnabled;
  }

  private triggerChannel3(): void {
    if (this.ch3.lengthCounter === 0) {
      this.ch3.lengthCounter = 256;
    }

    this.ch3.timer = this.waveTimerPeriod(this.ch3.frequency);
    this.ch3.position = 0;
    this.ch3.enabled = this.ch3.dacEnabled;
  }

  private triggerChannel4(): void {
    if (this.ch4.lengthCounter === 0) {
      this.ch4.lengthCounter = 64;
    }

    this.ch4.timer = this.noiseTimerPeriod();
    this.ch4.lfsr = 0x7fff;

    this.ch4.envelopeVolume = (this.registers[toRegisterIndex(NR42)]! >> 4) & 0x0f;
    this.ch4.envelopePeriod = this.registers[toRegisterIndex(NR42)]! & 0x07;
    this.ch4.envelopeIncrease = (this.registers[toRegisterIndex(NR42)]! & 0x08) !== 0;
    this.ch4.envelopeTimer = this.ch4.envelopePeriod === 0 ? 8 : this.ch4.envelopePeriod;

    this.ch4.enabled = this.ch4.dacEnabled;
  }

  private advanceFrameSequencer(cycles: number): void {
    this.frameSequencerClock += cycles;

    while (this.frameSequencerClock >= FRAME_SEQUENCER_PERIOD_T_CYCLES) {
      this.frameSequencerClock -= FRAME_SEQUENCER_PERIOD_T_CYCLES;

      if ((this.frameSequencerStep & 1) === 0) {
        this.clockLengthCounters();
      }

      if (this.frameSequencerStep === 2 || this.frameSequencerStep === 6) {
        this.clockSweep();
      }

      if (this.frameSequencerStep === 7) {
        this.clockEnvelopes();
      }

      this.frameSequencerStep = (this.frameSequencerStep + 1) & 0x07;
    }
  }

  private clockLengthCounters(): void {
    if (this.ch1.lengthEnabled && this.ch1.lengthCounter > 0) {
      this.ch1.lengthCounter--;
      if (this.ch1.lengthCounter === 0) {
        this.ch1.enabled = false;
      }
    }

    if (this.ch2.lengthEnabled && this.ch2.lengthCounter > 0) {
      this.ch2.lengthCounter--;
      if (this.ch2.lengthCounter === 0) {
        this.ch2.enabled = false;
      }
    }

    if (this.ch3.lengthEnabled && this.ch3.lengthCounter > 0) {
      this.ch3.lengthCounter--;
      if (this.ch3.lengthCounter === 0) {
        this.ch3.enabled = false;
      }
    }

    if (this.ch4.lengthEnabled && this.ch4.lengthCounter > 0) {
      this.ch4.lengthCounter--;
      if (this.ch4.lengthCounter === 0) {
        this.ch4.enabled = false;
      }
    }
  }

  private clockEnvelopes(): void {
    this.clockEnvelope(this.ch1);
    this.clockEnvelope(this.ch2);
    this.clockEnvelope(this.ch4);
  }

  private clockEnvelope(channel: EnvelopeChannelState): void {
    if (channel.envelopePeriod === 0) {
      return;
    }

    channel.envelopeTimer--;
    if (channel.envelopeTimer > 0) {
      return;
    }

    channel.envelopeTimer = channel.envelopePeriod;

    if (channel.envelopeIncrease) {
      if (channel.envelopeVolume < 15) {
        channel.envelopeVolume++;
      }
      return;
    }

    if (channel.envelopeVolume > 0) {
      channel.envelopeVolume--;
    }
  }

  private clockSweep(): void {
    if (!this.ch1.sweepEnabled) {
      return;
    }

    this.ch1.sweepTimer--;
    if (this.ch1.sweepTimer > 0) {
      return;
    }

    this.ch1.sweepTimer = this.ch1.sweepPeriod === 0 ? 8 : this.ch1.sweepPeriod;

    if (this.ch1.sweepPeriod === 0) {
      return;
    }

    const newFrequency = this.calculateSweepFrequency();
    if (newFrequency > 2047) {
      this.ch1.enabled = false;
      return;
    }

    if (this.ch1.sweepShift > 0) {
      this.ch1.shadowFrequency = newFrequency;
      this.ch1.frequency = newFrequency;
      this.registers[toRegisterIndex(NR13)] = newFrequency & 0xff;
      this.registers[toRegisterIndex(NR14)] =
        (this.registers[toRegisterIndex(NR14)]! & 0xf8) | ((newFrequency >> 8) & 0x07);

      const secondOverflowCheck = this.calculateSweepFrequency();
      if (secondOverflowCheck > 2047) {
        this.ch1.enabled = false;
      }
    }
  }

  private calculateSweepFrequency(): number {
    const delta = this.ch1.shadowFrequency >> this.ch1.sweepShift;
    if (this.ch1.sweepNegate) {
      return this.ch1.shadowFrequency - delta;
    }
    return this.ch1.shadowFrequency + delta;
  }

  private advanceChannelWaveforms(cycles: number): void {
    this.advanceSquareWave(this.ch1, (this.registers[toRegisterIndex(NR11)]! >> 6) & 0x03, cycles);
    this.advanceSquareWave(this.ch2, (this.registers[toRegisterIndex(NR21)]! >> 6) & 0x03, cycles);
    this.advanceWaveChannel(cycles);
    this.advanceNoiseChannel(cycles);
  }

  private advanceSquareWave(channel: SquareChannelState, duty: number, cycles: number): void {
    if (!channel.enabled) {
      return;
    }

    if (channel.timer <= 0) {
      channel.timer = this.squareTimerPeriod(channel.frequency);
    }

    let remaining = cycles;
    while (remaining > 0) {
      if (channel.timer > remaining) {
        channel.timer -= remaining;
        break;
      }

      remaining -= channel.timer;
      channel.timer = this.squareTimerPeriod(channel.frequency);
      channel.dutyStep = (channel.dutyStep + 1) & 0x07;
    }
  }

  private advanceWaveChannel(cycles: number): void {
    if (!this.ch3.enabled) {
      return;
    }

    if (this.ch3.timer <= 0) {
      this.ch3.timer = this.waveTimerPeriod(this.ch3.frequency);
    }

    let remaining = cycles;
    while (remaining > 0) {
      if (this.ch3.timer > remaining) {
        this.ch3.timer -= remaining;
        break;
      }

      remaining -= this.ch3.timer;
      this.ch3.timer = this.waveTimerPeriod(this.ch3.frequency);
      this.ch3.position = (this.ch3.position + 1) & 0x1f;
    }
  }

  private advanceNoiseChannel(cycles: number): void {
    if (!this.ch4.enabled) {
      return;
    }

    if (this.ch4.timer <= 0) {
      this.ch4.timer = this.noiseTimerPeriod();
    }

    let remaining = cycles;
    while (remaining > 0) {
      if (this.ch4.timer > remaining) {
        this.ch4.timer -= remaining;
        break;
      }

      remaining -= this.ch4.timer;
      this.ch4.timer = this.noiseTimerPeriod();

      const xorBit = (this.ch4.lfsr & 0x01) ^ ((this.ch4.lfsr >> 1) & 0x01);
      this.ch4.lfsr = (this.ch4.lfsr >> 1) | (xorBit << 14);

      if ((this.registers[toRegisterIndex(NR43)]! & 0x08) !== 0) {
        this.ch4.lfsr = (this.ch4.lfsr & ~(1 << 6)) | (xorBit << 6);
      }

      this.ch4.lfsr &= 0x7fff;
    }
  }

  private squareTimerPeriod(frequency: number): number {
    const freq = Math.max(0, Math.min(2047, frequency));
    const period = (2048 - freq) * 4;
    return period <= 0 ? 4 : period;
  }

  private waveTimerPeriod(frequency: number): number {
    const freq = Math.max(0, Math.min(2047, frequency));
    const period = (2048 - freq) * 2;
    return period <= 0 ? 2 : period;
  }

  private noiseTimerPeriod(): number {
    const nr43 = this.registers[toRegisterIndex(NR43)]!;
    const divisorCode = nr43 & 0x07;
    const shift = (nr43 >> 4) & 0x0f;
    const base = NOISE_DIVISORS[divisorCode]!;
    const period = base << shift;
    return period <= 0 ? 8 : period;
  }

  private mixSample(): [number, number] {
    const ch1 = this.channel1DacOutput();
    const ch2 = this.channel2DacOutput();
    const ch3 = this.channel3DacOutput();
    const ch4 = this.channel4DacOutput();

    const nr51 = this.registers[toRegisterIndex(NR51)]!;

    let leftMix = 0;
    let rightMix = 0;

    if ((nr51 & 0x10) !== 0) leftMix += ch1;
    if ((nr51 & 0x20) !== 0) leftMix += ch2;
    if ((nr51 & 0x40) !== 0) leftMix += ch3;
    if ((nr51 & 0x80) !== 0) leftMix += ch4;

    if ((nr51 & 0x01) !== 0) rightMix += ch1;
    if ((nr51 & 0x02) !== 0) rightMix += ch2;
    if ((nr51 & 0x04) !== 0) rightMix += ch3;
    if ((nr51 & 0x08) !== 0) rightMix += ch4;

    const nr50 = this.registers[toRegisterIndex(NR50)]!;
    const leftVolume = ((nr50 >> 4) & 0x07) / 7;
    const rightVolume = (nr50 & 0x07) / 7;

    const mixedLeft = clampSample((leftMix / 4) * leftVolume * 0.85);
    const mixedRight = clampSample((rightMix / 4) * rightVolume * 0.85);

    return [mixedLeft, mixedRight];
  }

  private channel1DacOutput(): number {
    if (!this.ch1.enabled || !this.ch1.dacEnabled) return 0;

    const duty = (this.registers[toRegisterIndex(NR11)]! >> 6) & 0x03;
    const waveHigh = DUTY_PATTERNS[duty]![this.ch1.dutyStep]!;
    const raw = waveHigh === 0 ? 0 : this.ch1.envelopeVolume;
    return (raw / 7.5) - 1;
  }

  private channel2DacOutput(): number {
    if (!this.ch2.enabled || !this.ch2.dacEnabled) return 0;

    const duty = (this.registers[toRegisterIndex(NR21)]! >> 6) & 0x03;
    const waveHigh = DUTY_PATTERNS[duty]![this.ch2.dutyStep]!;
    const raw = waveHigh === 0 ? 0 : this.ch2.envelopeVolume;
    return (raw / 7.5) - 1;
  }

  private channel3DacOutput(): number {
    if (!this.ch3.enabled || !this.ch3.dacEnabled) return 0;

    const waveAddress = toRegisterIndex(WAVE_RAM_START) + (this.ch3.position >> 1);
    const waveByte = this.registers[waveAddress]!;
    const rawSample = (this.ch3.position & 1) === 0 ? ((waveByte >> 4) & 0x0f) : (waveByte & 0x0f);

    const volumeCode = (this.registers[toRegisterIndex(NR32)]! >> 5) & 0x03;
    let shifted = rawSample;
    if (volumeCode === 0) shifted = 0;
    else if (volumeCode === 2) shifted >>= 1;
    else if (volumeCode === 3) shifted >>= 2;

    return (shifted / 7.5) - 1;
  }

  private channel4DacOutput(): number {
    if (!this.ch4.enabled || !this.ch4.dacEnabled) return 0;

    const waveHigh = (~this.ch4.lfsr) & 0x01;
    const raw = waveHigh === 0 ? 0 : this.ch4.envelopeVolume;
    return (raw / 7.5) - 1;
  }

  private pushSample(left: number, right: number): void {
    if (this.queuedFrames >= this.maxBufferedFrames) {
      this.queueReadFrame = (this.queueReadFrame + 1) % this.maxBufferedFrames;
      this.queuedFrames--;
    }

    const dstBase = this.queueWriteFrame * 2;
    this.sampleRing[dstBase] = left;
    this.sampleRing[dstBase + 1] = right;

    this.queueWriteFrame = (this.queueWriteFrame + 1) % this.maxBufferedFrames;
    this.queuedFrames++;
  }

  serialize(): Uint8Array {
    const data = new Uint8Array(APU_STATE_SIZE);
    const view = new DataView(data.buffer);

    let offset = 0;

    data[offset++] = APU_SERIALIZE_VERSION;
    data[offset++] = this.powerEnabled ? 1 : 0;
    data[offset++] = this.outputEnabled ? 1 : 0;
    data[offset++] = this.frameSequencerStep & 0x07;

    view.setUint16(offset, this.frameSequencerClock & 0xffff, true);
    offset += 2;

    view.setFloat64(offset, this.sampleClock, true);
    offset += 8;

    view.setUint32(offset, this.sampleRate, true);
    offset += 4;

    data.set(this.registers, offset);
    offset += APU_REGISTER_COUNT;

    offset = this.serializeSquare1(view, data, offset);
    offset = this.serializeSquare2(view, data, offset);
    offset = this.serializeWave(view, data, offset);
    offset = this.serializeNoise(view, data, offset);

    // Remaining bytes are reserved.
    return data;
  }

  private serializeSquare1(view: DataView, data: Uint8Array, startOffset: number): number {
    let offset = startOffset;

    data[offset++] = this.ch1.enabled ? 1 : 0;
    data[offset++] = this.ch1.dacEnabled ? 1 : 0;
    view.setUint16(offset, this.ch1.lengthCounter & 0xffff, true);
    offset += 2;
    data[offset++] = this.ch1.lengthEnabled ? 1 : 0;
    data[offset++] = this.ch1.dutyStep & 0x07;
    view.setUint16(offset, this.ch1.timer & 0xffff, true);
    offset += 2;
    view.setUint16(offset, this.ch1.frequency & 0x07ff, true);
    offset += 2;
    data[offset++] = this.ch1.envelopeVolume & 0x0f;
    data[offset++] = this.ch1.envelopePeriod & 0x07;
    data[offset++] = this.ch1.envelopeIncrease ? 1 : 0;
    data[offset++] = this.ch1.envelopeTimer & 0xff;
    data[offset++] = this.ch1.sweepPeriod & 0x07;
    data[offset++] = this.ch1.sweepNegate ? 1 : 0;
    data[offset++] = this.ch1.sweepShift & 0x07;
    data[offset++] = this.ch1.sweepTimer & 0xff;
    data[offset++] = this.ch1.sweepEnabled ? 1 : 0;
    view.setUint16(offset, this.ch1.shadowFrequency & 0x07ff, true);
    offset += 2;

    return offset;
  }

  private serializeSquare2(view: DataView, data: Uint8Array, startOffset: number): number {
    let offset = startOffset;

    data[offset++] = this.ch2.enabled ? 1 : 0;
    data[offset++] = this.ch2.dacEnabled ? 1 : 0;
    view.setUint16(offset, this.ch2.lengthCounter & 0xffff, true);
    offset += 2;
    data[offset++] = this.ch2.lengthEnabled ? 1 : 0;
    data[offset++] = this.ch2.dutyStep & 0x07;
    view.setUint16(offset, this.ch2.timer & 0xffff, true);
    offset += 2;
    view.setUint16(offset, this.ch2.frequency & 0x07ff, true);
    offset += 2;
    data[offset++] = this.ch2.envelopeVolume & 0x0f;
    data[offset++] = this.ch2.envelopePeriod & 0x07;
    data[offset++] = this.ch2.envelopeIncrease ? 1 : 0;
    data[offset++] = this.ch2.envelopeTimer & 0xff;

    return offset;
  }

  private serializeWave(view: DataView, data: Uint8Array, startOffset: number): number {
    let offset = startOffset;

    data[offset++] = this.ch3.enabled ? 1 : 0;
    data[offset++] = this.ch3.dacEnabled ? 1 : 0;
    view.setUint16(offset, this.ch3.lengthCounter & 0xffff, true);
    offset += 2;
    data[offset++] = this.ch3.lengthEnabled ? 1 : 0;
    view.setUint16(offset, this.ch3.timer & 0xffff, true);
    offset += 2;
    view.setUint16(offset, this.ch3.frequency & 0x07ff, true);
    offset += 2;
    data[offset++] = this.ch3.position & 0x1f;

    return offset;
  }

  private serializeNoise(view: DataView, data: Uint8Array, startOffset: number): number {
    let offset = startOffset;

    data[offset++] = this.ch4.enabled ? 1 : 0;
    data[offset++] = this.ch4.dacEnabled ? 1 : 0;
    view.setUint16(offset, this.ch4.lengthCounter & 0xffff, true);
    offset += 2;
    data[offset++] = this.ch4.lengthEnabled ? 1 : 0;
    view.setUint16(offset, this.ch4.timer & 0xffff, true);
    offset += 2;
    view.setUint16(offset, this.ch4.lfsr & 0x7fff, true);
    offset += 2;
    data[offset++] = this.ch4.envelopeVolume & 0x0f;
    data[offset++] = this.ch4.envelopePeriod & 0x07;
    data[offset++] = this.ch4.envelopeIncrease ? 1 : 0;
    data[offset++] = this.ch4.envelopeTimer & 0xff;

    return offset;
  }

  static deserialize(data: Uint8Array): APU {
    if (data.length < APU_STATE_SIZE) {
      throw new Error(
        `APU state buffer too short: expected ${APU_STATE_SIZE} bytes, got ${data.length}`,
      );
    }

    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

    let offset = 0;
    const version = data[offset++]!;
    if (version !== APU_SERIALIZE_VERSION) {
      throw new Error(`Unsupported APU state version: ${version}`);
    }

    const powerEnabled = data[offset++]! === 1;
    const outputEnabled = data[offset++]! === 1;
    const frameSequencerStep = data[offset++]! & 0x07;

    const frameSequencerClock = view.getUint16(offset, true);
    offset += 2;

    const sampleClock = view.getFloat64(offset, true);
    offset += 8;

    const sampleRate = view.getUint32(offset, true);
    offset += 4;

    const apu = new APU(sampleRate);

    apu.registers.set(data.subarray(offset, offset + APU_REGISTER_COUNT));
    offset += APU_REGISTER_COUNT;

    offset = apu.deserializeSquare1(view, data, offset);
    offset = apu.deserializeSquare2(view, data, offset);
    offset = apu.deserializeWave(view, data, offset);
    offset = apu.deserializeNoise(view, data, offset);

    apu.powerEnabled = powerEnabled;
    apu.outputEnabled = outputEnabled;
    apu.frameSequencerStep = frameSequencerStep;
    apu.frameSequencerClock = frameSequencerClock;
    apu.sampleClock = sampleClock;
    apu.clearSamples();

    return apu;
  }

  private deserializeSquare1(view: DataView, data: Uint8Array, startOffset: number): number {
    let offset = startOffset;

    this.ch1.enabled = data[offset++]! === 1;
    this.ch1.dacEnabled = data[offset++]! === 1;
    this.ch1.lengthCounter = view.getUint16(offset, true);
    offset += 2;
    this.ch1.lengthEnabled = data[offset++]! === 1;
    this.ch1.dutyStep = data[offset++]! & 0x07;
    this.ch1.timer = view.getUint16(offset, true);
    offset += 2;
    this.ch1.frequency = view.getUint16(offset, true) & 0x07ff;
    offset += 2;
    this.ch1.envelopeVolume = data[offset++]! & 0x0f;
    this.ch1.envelopePeriod = data[offset++]! & 0x07;
    this.ch1.envelopeIncrease = data[offset++]! === 1;
    this.ch1.envelopeTimer = data[offset++]! & 0xff;
    this.ch1.sweepPeriod = data[offset++]! & 0x07;
    this.ch1.sweepNegate = data[offset++]! === 1;
    this.ch1.sweepShift = data[offset++]! & 0x07;
    this.ch1.sweepTimer = data[offset++]! & 0xff;
    this.ch1.sweepEnabled = data[offset++]! === 1;
    this.ch1.shadowFrequency = view.getUint16(offset, true) & 0x07ff;
    offset += 2;

    return offset;
  }

  private deserializeSquare2(view: DataView, data: Uint8Array, startOffset: number): number {
    let offset = startOffset;

    this.ch2.enabled = data[offset++]! === 1;
    this.ch2.dacEnabled = data[offset++]! === 1;
    this.ch2.lengthCounter = view.getUint16(offset, true);
    offset += 2;
    this.ch2.lengthEnabled = data[offset++]! === 1;
    this.ch2.dutyStep = data[offset++]! & 0x07;
    this.ch2.timer = view.getUint16(offset, true);
    offset += 2;
    this.ch2.frequency = view.getUint16(offset, true) & 0x07ff;
    offset += 2;
    this.ch2.envelopeVolume = data[offset++]! & 0x0f;
    this.ch2.envelopePeriod = data[offset++]! & 0x07;
    this.ch2.envelopeIncrease = data[offset++]! === 1;
    this.ch2.envelopeTimer = data[offset++]! & 0xff;

    return offset;
  }

  private deserializeWave(view: DataView, data: Uint8Array, startOffset: number): number {
    let offset = startOffset;

    this.ch3.enabled = data[offset++]! === 1;
    this.ch3.dacEnabled = data[offset++]! === 1;
    this.ch3.lengthCounter = view.getUint16(offset, true);
    offset += 2;
    this.ch3.lengthEnabled = data[offset++]! === 1;
    this.ch3.timer = view.getUint16(offset, true);
    offset += 2;
    this.ch3.frequency = view.getUint16(offset, true) & 0x07ff;
    offset += 2;
    this.ch3.position = data[offset++]! & 0x1f;

    return offset;
  }

  private deserializeNoise(view: DataView, data: Uint8Array, startOffset: number): number {
    let offset = startOffset;

    this.ch4.enabled = data[offset++]! === 1;
    this.ch4.dacEnabled = data[offset++]! === 1;
    this.ch4.lengthCounter = view.getUint16(offset, true);
    offset += 2;
    this.ch4.lengthEnabled = data[offset++]! === 1;
    this.ch4.timer = view.getUint16(offset, true);
    offset += 2;
    this.ch4.lfsr = view.getUint16(offset, true) & 0x7fff;
    offset += 2;
    this.ch4.envelopeVolume = data[offset++]! & 0x0f;
    this.ch4.envelopePeriod = data[offset++]! & 0x07;
    this.ch4.envelopeIncrease = data[offset++]! === 1;
    this.ch4.envelopeTimer = data[offset++]! & 0xff;

    return offset;
  }
}
