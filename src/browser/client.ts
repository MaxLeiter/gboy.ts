import { createChannel } from "bidc";
import type { Button } from "../input";
import {
  DEFAULT_BROWSER_CHANNEL_ID,
  type AudioSamplesSnapshot,
  type AudioRegistersSnapshot,
  type EmulatorWorkerReceiver,
  type EmulatorWorkerRequest,
  type EmulatorWorkerResponse,
} from "./protocol";

export interface BrowserEmulatorClientOptions {
  channelId?: string;
  terminateWorkerOnDispose?: boolean;
}

function toUint8Array(value: Uint8Array | ArrayBuffer): Uint8Array {
  return value instanceof Uint8Array ? value : new Uint8Array(value);
}

export class BrowserEmulatorClient {
  private readonly channel;
  private readonly terminateWorkerOnDispose: boolean;
  private disposed = false;

  constructor(
    private readonly worker: Worker,
    options: BrowserEmulatorClientOptions = {},
  ) {
    const channelId = options.channelId ?? DEFAULT_BROWSER_CHANNEL_ID;
    this.channel = createChannel(worker, channelId);
    this.terminateWorkerOnDispose = options.terminateWorkerOnDispose ?? true;
  }

  private ensureActive(): void {
    if (this.disposed) {
      throw new Error("BrowserEmulatorClient is disposed");
    }
  }

  private async request(
    request: EmulatorWorkerRequest,
  ): Promise<EmulatorWorkerResponse> {
    this.ensureActive();
    return this.channel.send<EmulatorWorkerReceiver>(request);
  }

  private assertOk(response: EmulatorWorkerResponse): asserts response is Exclude<EmulatorWorkerResponse, { ok: false }> {
    if (!response.ok) {
      throw new Error(response.message);
    }
  }

  async init(rom: Uint8Array | ArrayBuffer): Promise<void> {
    const response = await this.request({
      type: "init",
      rom: toUint8Array(rom),
    });
    this.assertOk(response);
  }

  async runFrames(count: number): Promise<Uint8Array> {
    const response = await this.request({
      type: "runFrames",
      count,
    });
    this.assertOk(response);
    if (response.type !== "framebuffer") {
      throw new Error(`Unexpected response type: ${response.type}`);
    }
    return response.framebuffer;
  }

  async press(button: Button): Promise<void> {
    const response = await this.request({
      type: "press",
      button,
    });
    this.assertOk(response);
  }

  async release(button: Button): Promise<void> {
    const response = await this.request({
      type: "release",
      button,
    });
    this.assertOk(response);
  }

  async pressForFrames(button: Button, frames: number): Promise<Uint8Array> {
    const response = await this.request({
      type: "pressForFrames",
      button,
      frames,
    });
    this.assertOk(response);
    if (response.type !== "framebuffer") {
      throw new Error(`Unexpected response type: ${response.type}`);
    }
    return response.framebuffer;
  }

  async getFramebuffer(): Promise<Uint8Array> {
    const response = await this.request({
      type: "getFramebuffer",
    });
    this.assertOk(response);
    if (response.type !== "framebuffer") {
      throw new Error(`Unexpected response type: ${response.type}`);
    }
    return response.framebuffer;
  }

  async getAudioRegisters(): Promise<AudioRegistersSnapshot> {
    const response = await this.request({
      type: "getAudioRegisters",
    });
    this.assertOk(response);
    if (response.type !== "audioRegisters") {
      throw new Error(`Unexpected response type: ${response.type}`);
    }
    return response.registers;
  }

  async setAudioOutput(enabled: boolean): Promise<void> {
    const response = await this.request({
      type: "setAudioOutput",
      enabled,
    });
    this.assertOk(response);
  }

  async consumeAudioSamples(maxFrames?: number): Promise<AudioSamplesSnapshot> {
    const response = await this.request({
      type: "consumeAudioSamples",
      maxFrames,
    });
    this.assertOk(response);
    if (response.type !== "audioSamples") {
      throw new Error(`Unexpected response type: ${response.type}`);
    }
    return response.audio;
  }

  async serialize(): Promise<Uint8Array> {
    const response = await this.request({
      type: "serialize",
    });
    this.assertOk(response);
    if (response.type !== "state") {
      throw new Error(`Unexpected response type: ${response.type}`);
    }
    return response.state;
  }

  async deserialize(state: Uint8Array | ArrayBuffer): Promise<void> {
    const response = await this.request({
      type: "deserialize",
      state: toUint8Array(state),
    });
    this.assertOk(response);
  }

  async reset(): Promise<void> {
    const response = await this.request({
      type: "reset",
    });
    this.assertOk(response);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.channel.cleanup();
    if (this.terminateWorkerOnDispose) {
      this.worker.terminate();
    }
  }
}
