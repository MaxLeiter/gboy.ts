import { describe, it, expect } from "bun:test";
import { CPU } from "../cpu";
import { MMU } from "../mmu";
import { PPU } from "../ppu";
import { Timer } from "../timer";
import { Joypad, Button } from "../input";
import { Cartridge } from "../cartridge";

const ROM_PATH =
  "/System/Volumes/Data/Users/maxleiter/Documents/bluesky-plays-games/public/roms/yellow.gb";

async function loadROM(): Promise<Uint8Array> {
  return new Uint8Array(await Bun.file(ROM_PATH).arrayBuffer());
}

function createEmulator(romData: Uint8Array) {
  const cartridge = Cartridge.fromROM(romData);
  const mmu = new MMU();
  const timer = new Timer();
  const joypad = new Joypad();

  mmu.cartridge = cartridge;
  mmu.timer = timer;
  mmu.joypad = joypad;

  mmu.loadROM(romData.subarray(0, 0x8000));

  const cpu = new CPU(mmu);
  const ppu = new PPU(mmu);

  const CYCLES_PER_FRAME = 70224;

  function runCycle(): number {
    const intCycles = cpu.handleInterrupts();
    if (intCycles > 0) {
      timer.tick(intCycles);
      ppu.tick(intCycles);
      return intCycles;
    }

    const cycles = cpu.step();

    const timerOverflow = timer.tick(cycles);
    if (timerOverflow) {
      const ifReg = mmu.readByte(0xff0f);
      mmu.writeByte(0xff0f, ifReg | 0x04);
    }

    const ppuResult = ppu.tick(cycles);
    if (ppuResult.requestVBlankInterrupt) {
      const ifReg = mmu.readByte(0xff0f);
      mmu.writeByte(0xff0f, ifReg | 0x01);
    }
    if (ppuResult.requestStatInterrupt) {
      const ifReg = mmu.readByte(0xff0f);
      mmu.writeByte(0xff0f, ifReg | 0x02);
    }

    return cycles;
  }

  function runFrame(): void {
    let cycles = 0;
    while (cycles < CYCLES_PER_FRAME) {
      cycles += runCycle();
    }
  }

  function runFrames(count: number): void {
    for (let i = 0; i < count; i++) {
      runFrame();
    }
  }

  return { cpu, mmu, ppu, timer, joypad, cartridge, runCycle, runFrame, runFrames };
}

describe("Pokemon Yellow - Cartridge Header", () => {
  it("ROM loads successfully (1MB)", async () => {
    const romData = await loadROM();
    expect(romData.length).toBe(1048576);
  });

  it("title is POKEMON YELLOW", async () => {
    const romData = await loadROM();
    const cartridge = Cartridge.fromROM(romData);
    const title = cartridge.getTitle();
    expect(title).toContain("POKEMON YELLOW");
  });

  it("MBC type is MBC5", async () => {
    const romData = await loadROM();
    const cartridge = Cartridge.fromROM(romData);
    // This ROM dump reports cartridge type 0x1B = MBC5+RAM+BATTERY
    expect(cartridge.getMBCType()).toBe("MBC5");
  });

  it("cartridge reads bank 0 data correctly", async () => {
    const romData = await loadROM();
    const cartridge = Cartridge.fromROM(romData);
    // First byte of a Game Boy ROM is usually a NOP or JP instruction
    // Address 0x0100 is the entry point - should be a NOP (0x00) then JP
    const entryByte = cartridge.readByte(0x0100);
    expect(entryByte).toBe(0x00); // NOP at entry point
    const jpByte = cartridge.readByte(0x0101);
    expect(jpByte).toBe(0xc3); // JP instruction
    // Nintendo logo starts at 0x0104
    const logoStart = cartridge.readByte(0x0104);
    expect(logoStart).toBe(0xce); // First byte of Nintendo logo
  });
});

describe("Pokemon Yellow - Boot Sequence", () => {
  it(
    "runs 1 frame without crashing",
    async () => {
      const romData = await loadROM();
      const emu = createEmulator(romData);
      try {
        emu.runFrame();
      } catch (e: any) {
        throw new Error(`Crashed during frame 1: ${e.message}`);
      }
    },
    { timeout: 30000 },
  );

  it(
    "runs 10 frames without crashing",
    async () => {
      const romData = await loadROM();
      const emu = createEmulator(romData);
      try {
        emu.runFrames(10);
      } catch (e: any) {
        throw new Error(
          `Crashed during first 10 frames: ${e.message} (PC=0x${emu.cpu.pc.toString(16).padStart(4, "0")})`,
        );
      }
    },
    { timeout: 30000 },
  );

  it(
    "after 10 frames, PC has advanced from 0x0100",
    async () => {
      const romData = await loadROM();
      const emu = createEmulator(romData);
      try {
        emu.runFrames(10);
      } catch (e: any) {
        throw new Error(`Crashed before checking PC: ${e.message}`);
      }
      expect(emu.cpu.pc).not.toBe(0x0100);
    },
    { timeout: 30000 },
  );

  it(
    "after 10 frames, SP is still in valid range",
    async () => {
      const romData = await loadROM();
      const emu = createEmulator(romData);
      try {
        emu.runFrames(10);
      } catch (e: any) {
        throw new Error(`Crashed before checking SP: ${e.message}`);
      }
      // SP should be somewhere in HRAM/WRAM area, or at least a valid 16-bit value
      expect(emu.cpu.sp).toBeGreaterThan(0);
      expect(emu.cpu.sp).toBeLessThanOrEqual(0xfffe);
    },
    { timeout: 30000 },
  );

  it(
    "PPU framebuffer is no longer all-white by 300 frames",
    async () => {
      const romData = await loadROM();
      const emu = createEmulator(romData);
      try {
        // We start directly at cartridge entry (no boot ROM), so visual output can
        // remain white for early frames while the game initializes VRAM/LCDC.
        emu.runFrames(300);
      } catch (e: any) {
        throw new Error(`Crashed before checking framebuffer: ${e.message}`);
      }
      const fb = emu.ppu.getFramebuffer();
      let allWhite = true;
      for (let i = 0; i < fb.length; i += 4) {
        // Check RGB channels (skip alpha)
        if (fb[i] !== 255 || fb[i + 1] !== 255 || fb[i + 2] !== 255) {
          allWhite = false;
          break;
        }
      }
      expect(allWhite).toBe(false);
    },
    { timeout: 30000 },
  );

  it(
    "VBlank interrupt has been requested after 10 frames",
    async () => {
      const romData = await loadROM();
      const emu = createEmulator(romData);
      // Track VBlank by monitoring IF register bit 0 across frames
      let vblankSeen = false;
      for (let f = 0; f < 10; f++) {
        let cycles = 0;
        while (cycles < 70224) {
          const intCycles = emu.cpu.handleInterrupts();
          if (intCycles > 0) {
            emu.timer.tick(intCycles);
            emu.ppu.tick(intCycles);
            cycles += intCycles;
            continue;
          }
          try {
            const c = emu.cpu.step();
            const timerOverflow = emu.timer.tick(c);
            if (timerOverflow) {
              const ifReg = emu.mmu.readByte(0xff0f);
              emu.mmu.writeByte(0xff0f, ifReg | 0x04);
            }
            const ppuResult = emu.ppu.tick(c);
            if (ppuResult.requestVBlankInterrupt) {
              vblankSeen = true;
              const ifReg = emu.mmu.readByte(0xff0f);
              emu.mmu.writeByte(0xff0f, ifReg | 0x01);
            }
            if (ppuResult.requestStatInterrupt) {
              const ifReg = emu.mmu.readByte(0xff0f);
              emu.mmu.writeByte(0xff0f, ifReg | 0x02);
            }
            cycles += c;
          } catch (e: any) {
            throw new Error(`Crashed during VBlank test: ${e.message}`);
          }
        }
      }
      expect(vblankSeen).toBe(true);
    },
    { timeout: 30000 },
  );
});

describe("Pokemon Yellow - Extended Boot", () => {
  it(
    "runs 60 frames (~1 second) without unimplemented opcode crash",
    async () => {
      const romData = await loadROM();
      const emu = createEmulator(romData);
      try {
        emu.runFrames(60);
      } catch (e: any) {
        const msg = e.message || String(e);
        if (msg.includes("Unimplemented opcode")) {
          throw new Error(
            `Unimplemented opcode at frame ~60: ${msg} (PC=0x${emu.cpu.pc.toString(16).padStart(4, "0")})`,
          );
        }
        throw new Error(
          `Unexpected crash during 60 frames: ${msg} (PC=0x${emu.cpu.pc.toString(16).padStart(4, "0")})`,
        );
      }
    },
    { timeout: 30000 },
  );

  it(
    "runs 300 frames (~5 seconds) without crash",
    async () => {
      const romData = await loadROM();
      const emu = createEmulator(romData);
      try {
        emu.runFrames(300);
      } catch (e: any) {
        const msg = e.message || String(e);
        if (msg.includes("Unimplemented opcode")) {
          throw new Error(
            `Unimplemented opcode during 300 frames: ${msg} (PC=0x${emu.cpu.pc.toString(16).padStart(4, "0")})`,
          );
        }
        throw new Error(
          `Unexpected crash during 300 frames: ${msg} (PC=0x${emu.cpu.pc.toString(16).padStart(4, "0")})`,
        );
      }
    },
    { timeout: 30000 },
  );
});

describe("Pokemon Yellow - Serialize Mid-Boot", () => {
  it(
    "serializes full state after 30 frames and data is non-empty",
    async () => {
      const romData = await loadROM();
      const emu = createEmulator(romData);
      try {
        emu.runFrames(30);
      } catch (e: any) {
        throw new Error(`Crashed before serialization: ${e.message}`);
      }

      const cpuState = emu.cpu.serialize();
      const mmuState = emu.mmu.serialize();
      const timerState = emu.timer.serialize();
      const ppuState = emu.ppu.serialize();
      const joypadState = emu.joypad.serialize();
      const cartridgeState = emu.cartridge.serialize();

      expect(cpuState.length).toBeGreaterThan(0);
      expect(mmuState.length).toBeGreaterThan(0);
      expect(timerState.length).toBeGreaterThan(0);
      expect(ppuState.length).toBeGreaterThan(0);
      expect(joypadState.length).toBeGreaterThan(0);
      expect(cartridgeState.length).toBeGreaterThan(0);
    },
    { timeout: 30000 },
  );

  it(
    "deserializes into new instances and runs 10 more frames",
    async () => {
      const romData = await loadROM();
      const emu = createEmulator(romData);
      try {
        emu.runFrames(30);
      } catch (e: any) {
        throw new Error(`Crashed before serialization: ${e.message}`);
      }

      const cpuState = emu.cpu.serialize();
      const mmuState = emu.mmu.serialize();
      const timerState = emu.timer.serialize();
      const ppuState = emu.ppu.serialize();
      const joypadState = emu.joypad.serialize();
      const cartridgeState = emu.cartridge.serialize();

      // Recreate all components from serialized state
      const newCartridge = Cartridge.deserialize(cartridgeState, romData);
      const newMmu = MMU.deserialize(mmuState, romData.subarray(0, 0x8000));
      const newTimer = Timer.deserialize(timerState);
      const newJoypad = Joypad.deserialize(joypadState);

      newMmu.cartridge = newCartridge;
      newMmu.timer = newTimer;
      newMmu.joypad = newJoypad;

      const newCpu = CPU.deserialize(cpuState, newMmu);
      const newPpu = PPU.deserialize(ppuState, newMmu);

      const emu2 = createEmulatorFromComponents(
        newCpu,
        newMmu,
        newPpu,
        newTimer,
        newJoypad,
        newCartridge,
      );

      try {
        emu2.runFrames(10);
      } catch (e: any) {
        const msg = e.message || String(e);
        throw new Error(
          `Crashed after deserialization: ${msg} (PC=0x${emu2.cpu.pc.toString(16).padStart(4, "0")})`,
        );
      }
    },
    { timeout: 30000 },
  );
});

describe("Pokemon Yellow - Input During Execution", () => {
  it(
    "press A button after 60 frames, run 5 more frames",
    async () => {
      const romData = await loadROM();
      const emu = createEmulator(romData);
      try {
        emu.runFrames(60);
      } catch (e: any) {
        throw new Error(`Crashed before input test: ${e.message}`);
      }

      emu.joypad.pressButton(Button.A);
      try {
        emu.runFrames(5);
      } catch (e: any) {
        const msg = e.message || String(e);
        throw new Error(
          `Crashed after pressing A: ${msg} (PC=0x${emu.cpu.pc.toString(16).padStart(4, "0")})`,
        );
      }
      emu.joypad.releaseButton(Button.A);
    },
    { timeout: 30000 },
  );

  it(
    "press Start button after 60 frames, run 5 more frames",
    async () => {
      const romData = await loadROM();
      const emu = createEmulator(romData);
      try {
        emu.runFrames(60);
      } catch (e: any) {
        throw new Error(`Crashed before input test: ${e.message}`);
      }

      emu.joypad.pressButton(Button.Start);
      try {
        emu.runFrames(5);
      } catch (e: any) {
        const msg = e.message || String(e);
        throw new Error(
          `Crashed after pressing Start: ${msg} (PC=0x${emu.cpu.pc.toString(16).padStart(4, "0")})`,
        );
      }
      emu.joypad.releaseButton(Button.Start);
    },
    { timeout: 30000 },
  );
});

describe("Pokemon Yellow - Stress Test", () => {
  it(
    "runs 600 frames (~10 seconds) past the Nintendo logo",
    async () => {
      const romData = await loadROM();
      const emu = createEmulator(romData);
      try {
        emu.runFrames(600);
      } catch (e: any) {
        const msg = e.message || String(e);
        if (msg.includes("Unimplemented opcode")) {
          throw new Error(
            `Unimplemented opcode during 600 frames: ${msg} (PC=0x${emu.cpu.pc.toString(16).padStart(4, "0")})`,
          );
        }
        throw new Error(
          `Crash during 600 frames: ${msg} (PC=0x${emu.cpu.pc.toString(16).padStart(4, "0")})`,
        );
      }
    },
    { timeout: 30000 },
  );
});

// Helper to build emulator from pre-existing (deserialized) components
function createEmulatorFromComponents(
  cpu: CPU,
  mmu: MMU,
  ppu: PPU,
  timer: Timer,
  joypad: Joypad,
  cartridge: Cartridge,
) {
  const CYCLES_PER_FRAME = 70224;

  function runCycle(): number {
    const intCycles = cpu.handleInterrupts();
    if (intCycles > 0) {
      timer.tick(intCycles);
      ppu.tick(intCycles);
      return intCycles;
    }

    const cycles = cpu.step();

    const timerOverflow = timer.tick(cycles);
    if (timerOverflow) {
      const ifReg = mmu.readByte(0xff0f);
      mmu.writeByte(0xff0f, ifReg | 0x04);
    }

    const ppuResult = ppu.tick(cycles);
    if (ppuResult.requestVBlankInterrupt) {
      const ifReg = mmu.readByte(0xff0f);
      mmu.writeByte(0xff0f, ifReg | 0x01);
    }
    if (ppuResult.requestStatInterrupt) {
      const ifReg = mmu.readByte(0xff0f);
      mmu.writeByte(0xff0f, ifReg | 0x02);
    }

    return cycles;
  }

  function runFrame(): void {
    let cycles = 0;
    while (cycles < CYCLES_PER_FRAME) {
      cycles += runCycle();
    }
  }

  function runFrames(count: number): void {
    for (let i = 0; i < count; i++) {
      runFrame();
    }
  }

  return { cpu, mmu, ppu, timer, joypad, cartridge, runCycle, runFrame, runFrames };
}
