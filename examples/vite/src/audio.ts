function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function resampleInterleavedStereo(
  input: Float32Array,
  srcRate: number,
  dstRate: number,
): Float32Array {
  if (input.length === 0 || srcRate === dstRate) {
    return input;
  }

  const srcFrames = Math.floor(input.length / 2);
  if (srcFrames <= 1) {
    return input;
  }

  const ratio = srcRate / dstRate;
  const dstFrames = Math.max(1, Math.floor(srcFrames / ratio));
  const output = new Float32Array(dstFrames * 2);

  for (let i = 0; i < dstFrames; i++) {
    const sourcePosition = i * ratio;
    const low = Math.floor(sourcePosition);
    const high = Math.min(srcFrames - 1, low + 1);
    const frac = sourcePosition - low;

    const lowBase = low * 2;
    const highBase = high * 2;
    const outBase = i * 2;

    output[outBase] =
      (input[lowBase]! * (1 - frac)) +
      (input[highBase]! * frac);
    output[outBase + 1] =
      (input[lowBase + 1]! * (1 - frac)) +
      (input[highBase + 1]! * frac);
  }

  return output;
}

export class WebAudioPcmPlayer {
  private context: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private enabled = false;
  private scheduledUntil = 0;

  get isEnabled(): boolean {
    return this.enabled;
  }

  private async ensureStarted(): Promise<void> {
    if (!this.context) {
      const context = new AudioContext({ latencyHint: "interactive" });
      const gain = context.createGain();
      gain.gain.value = 0.8;
      gain.connect(context.destination);

      this.context = context;
      this.masterGain = gain;
      this.scheduledUntil = context.currentTime;
    }

    if (this.context.state !== "running") {
      await this.context.resume();
    }
  }

  async setEnabled(enabled: boolean): Promise<void> {
    if (enabled) {
      await this.ensureStarted();
      this.enabled = true;
      if (this.context) {
        this.scheduledUntil = this.context.currentTime;
      }
      return;
    }

    this.enabled = false;
    if (this.context) {
      this.scheduledUntil = this.context.currentTime;
    }
  }

  queueInterleaved(samples: Float32Array, sampleRate: number): void {
    if (!this.enabled || !this.context || !this.masterGain) return;
    if (samples.length === 0) return;

    const converted = resampleInterleavedStereo(
      samples,
      sampleRate,
      this.context.sampleRate,
    );

    const frameCount = Math.floor(converted.length / 2);
    if (frameCount === 0) return;

    const buffer = this.context.createBuffer(2, frameCount, this.context.sampleRate);
    const left = buffer.getChannelData(0);
    const right = buffer.getChannelData(1);

    for (let i = 0; i < frameCount; i++) {
      const src = i * 2;
      left[i] = clamp(converted[src]!, -1, 1);
      right[i] = clamp(converted[src + 1]!, -1, 1);
    }

    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.masterGain);

    const now = this.context.currentTime;
    const startAt = Math.max(now + 0.005, this.scheduledUntil);
    source.start(startAt);

    this.scheduledUntil = startAt + buffer.duration;
  }

  getBufferedSeconds(): number {
    if (!this.context) return 0;
    return Math.max(0, this.scheduledUntil - this.context.currentTime);
  }

  dispose(): void {
    this.enabled = false;
    if (this.context) {
      void this.context.close();
    }
    this.context = null;
    this.masterGain = null;
    this.scheduledUntil = 0;
  }
}
