import type { Button } from "../input";

export const DEFAULT_BROWSER_CHANNEL_ID = "gboy-ts-emulator";

// Index signatures required by bidc SerializableValue constraint
export interface AudioRegistersSnapshot {
  [key: string]: number;
  nr10: number;
  nr11: number;
  nr12: number;
  nr13: number;
  nr14: number;
  nr21: number;
  nr22: number;
  nr23: number;
  nr24: number;
  nr30: number;
  nr31: number;
  nr32: number;
  nr33: number;
  nr34: number;
  nr41: number;
  nr42: number;
  nr43: number;
  nr44: number;
  nr50: number;
  nr51: number;
  nr52: number;
}

export interface AudioSamplesSnapshot {
  [key: string]: number | Float32Array;
  sampleRate: number;
  queuedFrames: number;
  samples: Float32Array;
}

export type EmulatorWorkerRequest =
  | { type: "init"; rom: Uint8Array }
  | { type: "runFrames"; count: number }
  | { type: "press"; button: Button }
  | { type: "release"; button: Button }
  | { type: "pressForFrames"; button: Button; frames: number }
  | { type: "getFramebuffer" }
  | { type: "setAudioOutput"; enabled: boolean }
  | { type: "consumeAudioSamples"; maxFrames?: number }
  | { type: "getAudioRegisters" }
  | { type: "serialize" }
  | { type: "deserialize"; state: Uint8Array }
  | { type: "reset" };

type AckResponseType = "init" | "press" | "release" | "deserialize" | "reset" | "setAudioOutput";

export type EmulatorWorkerResponse =
  | { ok: true; type: AckResponseType }
  | { ok: true; type: "framebuffer"; framebuffer: Uint8Array }
  | { ok: true; type: "audioRegisters"; registers: AudioRegistersSnapshot }
  | { ok: true; type: "audioSamples"; audio: AudioSamplesSnapshot }
  | { ok: true; type: "state"; state: Uint8Array }
  | { ok: false; type: EmulatorWorkerRequest["type"]; message: string };

export type EmulatorWorkerReceiver = (
  request: EmulatorWorkerRequest,
) => EmulatorWorkerResponse | Promise<EmulatorWorkerResponse>;
