import { createChannel } from "bidc";
import { Emulator } from "../emulator";
import { Button } from "../input";
import {
  DEFAULT_BROWSER_CHANNEL_ID,
  type AudioRegistersSnapshot,
  type EmulatorWorkerRequest,
  type EmulatorWorkerResponse,
} from "./protocol";

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isValidButton(value: number): value is Button {
  return Number.isInteger(value) && value >= Button.Right && value <= Button.Start;
}

function toSafeFrameCount(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.floor(value));
}

function toSafeOptionalFrameCount(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isFinite(value)) return undefined;
  return Math.max(1, Math.floor(value));
}

function snapshotAudioRegisters(emu: Emulator): AudioRegistersSnapshot {
  return {
    nr10: emu.mmu.readByte(0xff10),
    nr11: emu.mmu.readByte(0xff11),
    nr12: emu.mmu.readByte(0xff12),
    nr13: emu.mmu.readByte(0xff13),
    nr14: emu.mmu.readByte(0xff14),
    nr21: emu.mmu.readByte(0xff16),
    nr22: emu.mmu.readByte(0xff17),
    nr23: emu.mmu.readByte(0xff18),
    nr24: emu.mmu.readByte(0xff19),
    nr30: emu.mmu.readByte(0xff1a),
    nr31: emu.mmu.readByte(0xff1b),
    nr32: emu.mmu.readByte(0xff1c),
    nr33: emu.mmu.readByte(0xff1d),
    nr34: emu.mmu.readByte(0xff1e),
    nr41: emu.mmu.readByte(0xff20),
    nr42: emu.mmu.readByte(0xff21),
    nr43: emu.mmu.readByte(0xff22),
    nr44: emu.mmu.readByte(0xff23),
    nr50: emu.mmu.readByte(0xff24),
    nr51: emu.mmu.readByte(0xff25),
    nr52: emu.mmu.readByte(0xff26),
  };
}

export function startBrowserEmulatorWorkerServer(
  channelId = DEFAULT_BROWSER_CHANNEL_ID,
): void {
  const channel = createChannel(channelId);

  let rom: Uint8Array | null = null;
  let emulator: Emulator | null = null;

  function requireEmulator(requestType: EmulatorWorkerRequest["type"]): Emulator {
    if (!emulator) {
      throw new Error(
        `Emulator is not initialized. Call init() before ${requestType}.`,
      );
    }
    return emulator;
  }

  function snapshotFramebuffer(emu: Emulator): Uint8Array {
    return new Uint8Array(emu.getFramebuffer());
  }

  const receive = async (request: EmulatorWorkerRequest): Promise<EmulatorWorkerResponse> => {
    try {
      switch (request.type) {
        case "init": {
          rom = new Uint8Array(request.rom);
          emulator = new Emulator(rom);
          return { ok: true, type: "init" };
        }

        case "runFrames": {
          const emu = requireEmulator(request.type);
          emu.runFrames(toSafeFrameCount(request.count));
          return {
            ok: true,
            type: "framebuffer",
            framebuffer: snapshotFramebuffer(emu),
          };
        }

        case "press": {
          const emu = requireEmulator(request.type);
          if (!isValidButton(request.button)) {
            return {
              ok: false,
              type: request.type,
              message: `Invalid button value: ${request.button}`,
            };
          }
          emu.pressButton(request.button);
          return { ok: true, type: "press" };
        }

        case "release": {
          const emu = requireEmulator(request.type);
          if (!isValidButton(request.button)) {
            return {
              ok: false,
              type: request.type,
              message: `Invalid button value: ${request.button}`,
            };
          }
          emu.releaseButton(request.button);
          return { ok: true, type: "release" };
        }

        case "pressForFrames": {
          const emu = requireEmulator(request.type);
          if (!isValidButton(request.button)) {
            return {
              ok: false,
              type: request.type,
              message: `Invalid button value: ${request.button}`,
            };
          }
          const framebuffer = emu.pressButtonForFrames(
            request.button,
            toSafeFrameCount(request.frames),
          );
          return {
            ok: true,
            type: "framebuffer",
            framebuffer: new Uint8Array(framebuffer),
          };
        }

        case "getFramebuffer": {
          const emu = requireEmulator(request.type);
          return {
            ok: true,
            type: "framebuffer",
            framebuffer: snapshotFramebuffer(emu),
          };
        }

        case "setAudioOutput": {
          const emu = requireEmulator(request.type);
          emu.setAudioOutputEnabled(request.enabled);
          return { ok: true, type: "setAudioOutput" };
        }

        case "consumeAudioSamples": {
          const emu = requireEmulator(request.type);
          const maxFrames = toSafeOptionalFrameCount(request.maxFrames);
          const samples = emu.consumeAudioSamples(maxFrames);
          return {
            ok: true,
            type: "audioSamples",
            audio: {
              sampleRate: emu.getAudioSampleRate(),
              queuedFrames: emu.getQueuedAudioSampleFrames(),
              samples,
            },
          };
        }

        case "getAudioRegisters": {
          const emu = requireEmulator(request.type);
          return {
            ok: true,
            type: "audioRegisters",
            registers: snapshotAudioRegisters(emu),
          };
        }

        case "serialize": {
          const emu = requireEmulator(request.type);
          return {
            ok: true,
            type: "state",
            state: emu.serialize(),
          };
        }

        case "deserialize": {
          if (!rom) {
            return {
              ok: false,
              type: request.type,
              message: "Cannot deserialize before init().",
            };
          }
          emulator = Emulator.deserialize(rom, new Uint8Array(request.state));
          return { ok: true, type: "deserialize" };
        }

        case "reset": {
          if (!rom) {
            return {
              ok: false,
              type: request.type,
              message: "Cannot reset before init().",
            };
          }
          emulator = new Emulator(rom);
          return { ok: true, type: "reset" };
        }
      }
    } catch (error: unknown) {
      return {
        ok: false,
        type: request.type,
        message: toErrorMessage(error),
      };
    }
  };

  void channel.receive(receive);
}
