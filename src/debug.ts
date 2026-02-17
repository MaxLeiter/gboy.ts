import { Emulator, Button } from "./emulator";
import { renderFramebuffer, framebufferStats } from "./renderer";
import type { RenderFormat } from "./renderer";

const USAGE = `Usage: bun src/debug.ts <rom-path> [options]

Options:
  --frames <n>       Number of frames to run (default: 300)
  --format <fmt>     green-half, green, ansi-half, ansi, ascii, blocks, half-blocks (default: green-half)
  --width <n>        Output width in characters (default: 80)
  --interval <n>     Print frame every N frames (default: only final frame)
  --press <button>   Press a button at frame N/2
  --stats            Print framebuffer stats
  --watch            Interactive mode with keyboard controls
  --help             Show this help

Watch mode controls:
  Arrow keys         D-pad (Up/Down/Left/Right)
  Z                  A button
  X                  B button
  Enter              Start
  Backspace          Select
  Space              Pause / Resume
  ]  or  F           Fast forward (2x → 4x → 8x → 16x)
  [  or  D           Slow down
  1-5                Set speed directly (1x, 2x, 4x, 8x, 16x)
  S                  Step one frame (while paused)
  I                  Toggle stats overlay
  R                  Reset emulator
  Q  or  Ctrl+C      Quit
`;

const BUTTON_MAP: Record<string, Button> = {
  a: Button.A,
  b: Button.B,
  start: Button.Start,
  select: Button.Select,
  up: Button.Up,
  down: Button.Down,
  left: Button.Left,
  right: Button.Right,
};

const SPEED_LEVELS = [1, 2, 4, 8, 16];

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    romPath: "",
    frames: 300,
    format: "green-half" as RenderFormat,
    width: 80,
    interval: 0,
    press: null as Button | null,
    stats: false,
    watch: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--help") {
      console.log(USAGE);
      process.exit(0);
    } else if (arg === "--frames") {
      opts.frames = parseInt(args[++i]!, 10);
    } else if (arg === "--format") {
      opts.format = args[++i]! as typeof opts.format;
    } else if (arg === "--width") {
      opts.width = parseInt(args[++i]!, 10);
    } else if (arg === "--interval") {
      opts.interval = parseInt(args[++i]!, 10);
    } else if (arg === "--press") {
      const name = args[++i]!.toLowerCase();
      opts.press = BUTTON_MAP[name] ?? null;
    } else if (arg === "--stats") {
      opts.stats = true;
    } else if (arg === "--watch") {
      opts.watch = true;
    } else if (!arg.startsWith("--")) {
      opts.romPath = arg;
    }
  }

  return opts;
}

function clearScreen() {
  process.stdout.write("\x1b[2J\x1b[H");
}

function hideCursor() {
  process.stdout.write("\x1b[?25l");
}

function showCursor() {
  process.stdout.write("\x1b[?25h");
}

function render(fb: Uint8Array, format: string, width: number): string {
  return renderFramebuffer(fb, format as RenderFormat, width);
}

interface WatchState {
  paused: boolean;
  speedIdx: number;
  showStats: boolean;
  frame: number;
  buttonsHeld: Set<Button>;
  shouldQuit: boolean;
  stepOne: boolean;
  shouldReset: boolean;
}

function setupRawInput(state: WatchState, emu: Emulator) {
  if (!process.stdin.isTTY) return;

  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");

  process.stdin.on("data", (data: string) => {
    for (let ci = 0; ci < data.length; ci++) {
      const ch = data[ci]!;
      const code = ch.charCodeAt(0);

      if (code === 3) {
        state.shouldQuit = true;
        return;
      }

      if (ch === "\x1b" && data[ci + 1] === "[") {
        const seq = data[ci + 2];
        ci += 2;
        switch (seq) {
          case "A": state.buttonsHeld.add(Button.Up); break;
          case "B": state.buttonsHeld.add(Button.Down); break;
          case "C": state.buttonsHeld.add(Button.Right); break;
          case "D": state.buttonsHeld.add(Button.Left); break;
        }
        continue;
      }

      switch (ch.toLowerCase()) {
        case "z": state.buttonsHeld.add(Button.A); break;
        case "x": state.buttonsHeld.add(Button.B); break;
        case "\r": state.buttonsHeld.add(Button.Start); break;
        case "\x7f": state.buttonsHeld.add(Button.Select); break;
        case " ": state.paused = !state.paused; break;
        case "s": state.stepOne = true; break;
        case "]": case "f":
          state.speedIdx = Math.min(state.speedIdx + 1, SPEED_LEVELS.length - 1);
          break;
        case "[": case "d":
          state.speedIdx = Math.max(state.speedIdx - 1, 0);
          break;
        case "1": state.speedIdx = 0; break;
        case "2": state.speedIdx = 1; break;
        case "3": state.speedIdx = 2; break;
        case "4": state.speedIdx = 3; break;
        case "5": state.speedIdx = 4; break;

        case "i": state.showStats = !state.showStats; break;
        case "r": state.shouldReset = true; break;
        case "q": state.shouldQuit = true; break;
      }
    }
  });
}

function teardownRawInput() {
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(false);
  }
  process.stdin.pause();
  showCursor();
}

async function runWatch(emu: Emulator, opts: ReturnType<typeof parseArgs>, romData: Uint8Array) {
  const state: WatchState = {
    paused: false,
    speedIdx: 0,
    showStats: opts.stats,
    frame: 0,
    buttonsHeld: new Set(),
    shouldQuit: false,
    stepOne: false,
    shouldReset: false,
  };

  setupRawInput(state, emu);
  hideCursor();

  process.on("exit", () => {
    teardownRawInput();
  });

  const HELD_FRAMES = 6;
  const buttonTimers = new Map<Button, number>();

  while (!state.shouldQuit) {
    if (state.shouldReset) {
      state.shouldReset = false;
      state.frame = 0;
      emu.reset();
    }

    for (const btn of state.buttonsHeld) {
      emu.pressButton(btn);
      buttonTimers.set(btn, HELD_FRAMES);
    }
    state.buttonsHeld.clear();

    for (const [btn, remaining] of buttonTimers) {
      if (remaining <= 1) {
        emu.releaseButton(btn);
        buttonTimers.delete(btn);
      } else {
        buttonTimers.set(btn, remaining - 1);
      }
    }

    const shouldRun = !state.paused || state.stepOne;
    state.stepOne = false;

    if (shouldRun) {
      const speed = SPEED_LEVELS[state.speedIdx]!;

      try {
        for (let i = 0; i < speed; i++) {
          emu.runFrame();
          state.frame++;
        }
      } catch (e: any) {
        clearScreen();
        showCursor();
        console.error(`Crash at frame ${state.frame}: ${e.message}`);
        console.error(`PC=0x${emu.cpu.pc.toString(16).padStart(4, "0")} SP=0x${emu.cpu.sp.toString(16).padStart(4, "0")}`);
        const fb = emu.getFramebuffer();
        console.log("\nLast frame:");
        console.log(render(fb, opts.format, opts.width));
        break;
      }
    }

    clearScreen();
    const fb = emu.getFramebuffer();

    if (state.showStats) {
      const s = framebufferStats(fb);
      console.log(`Colors: ${s.uniqueColors} | Black: ${s.blackPixels} | White: ${s.whitePixels}`);
    }

    console.log(render(fb, opts.format, opts.width));

    const speed = SPEED_LEVELS[state.speedIdx]!;
    const pauseStr = state.paused ? "\x1b[33m PAUSED \x1b[0m" : "";
    const speedStr = speed > 1 ? `\x1b[36m${speed}x\x1b[0m` : "1x";
    const heldBtns = [...buttonTimers.keys()].map(b => Button[b]).join("+");
    const btnStr = heldBtns ? ` | Btn: \x1b[32m${heldBtns}\x1b[0m` : "";

    console.log(
      `\nFrame: ${state.frame} | Speed: ${speedStr}${pauseStr}${btnStr}` +
      ` | PC: 0x${emu.cpu.pc.toString(16).padStart(4, "0")}` +
      ` | LCDC: 0x${emu.mmu.readByte(0xFF40).toString(16)}` +
      ` | BGP: 0x${emu.mmu.readByte(0xFF47).toString(16)}`
    );
    console.log("\x1b[2mArrows=D-pad Z=A X=B Enter=Start | Space=Pause ]/[=Speed S=Step R=Reset Q=Quit\x1b[0m");

    await Bun.sleep(speed > 2 ? 1 : 33);
  }

  teardownRawInput();
}

async function runBatch(emu: Emulator, opts: ReturnType<typeof parseArgs>) {
  const pressFrame = opts.press !== null ? Math.floor(opts.frames / 2) : -1;

  for (let f = 0; f < opts.frames; f++) {
    if (opts.press !== null && f === pressFrame) {
      emu.pressButton(opts.press);
    }
    if (opts.press !== null && f === pressFrame + 10) {
      emu.releaseButton(opts.press);
    }

    try {
      emu.runFrame();
    } catch (e: any) {
      console.error(`\nCrash at frame ${f}: ${e.message}`);
      console.error(`PC=0x${emu.cpu.pc.toString(16).padStart(4, "0")} SP=0x${emu.cpu.sp.toString(16).padStart(4, "0")}`);
      const fb = emu.getFramebuffer();
      console.log("\nLast rendered frame:");
      console.log(render(fb, opts.format, opts.width));
      process.exit(1);
    }

    if (opts.interval > 0 && (f + 1) % opts.interval === 0) {
      const fb = emu.getFramebuffer();
      console.log(`--- Frame ${f + 1} ---`);
      if (opts.stats) {
        const s = framebufferStats(fb);
        console.log(`Colors: ${s.uniqueColors} | Black: ${s.blackPixels} | White: ${s.whitePixels}`);
      }
      console.log(render(fb, opts.format, opts.width));
      console.log("");
    }
  }

  const fb = emu.getFramebuffer();
  if (opts.stats) {
    const s = framebufferStats(fb);
    console.log("Framebuffer stats:");
    console.log(`  Total pixels: ${s.totalPixels}`);
    console.log(`  Unique colors: ${s.uniqueColors}`);
    console.log(`  Black pixels: ${s.blackPixels}`);
    console.log(`  White pixels: ${s.whitePixels}`);
    console.log(`  All white: ${s.allWhite}`);
    console.log(`  All black: ${s.allBlack}`);
    console.log("");
  }

  console.log(`--- Final frame (${opts.frames}) ---`);
  console.log(render(fb, opts.format, opts.width));
  console.log(`\nPC: 0x${emu.cpu.pc.toString(16).padStart(4, "0")} | SP: 0x${emu.cpu.sp.toString(16).padStart(4, "0")} | LCDC: 0x${emu.mmu.readByte(0xFF40).toString(16)} | BGP: 0x${emu.mmu.readByte(0xFF47).toString(16)}`);
}

async function main() {
  const opts = parseArgs();

  if (!opts.romPath) {
    console.error("Error: no ROM path specified\n");
    console.log(USAGE);
    process.exit(1);
  }

  const file = Bun.file(opts.romPath);
  if (!(await file.exists())) {
    console.error(`Error: ROM file not found: ${opts.romPath}`);
    process.exit(1);
  }

  const romData = new Uint8Array(await file.arrayBuffer());
  console.log(`Loaded ROM: ${opts.romPath} (${romData.length} bytes)`);

  const emu = new Emulator(romData);
  console.log(`Title: ${emu.cartridge.getTitle()}`);
  console.log(`MBC: ${emu.cartridge.getMBCType()}`);
  console.log(`Format: ${opts.format}, Width: ${opts.width}`);
  console.log("");

  if (opts.watch) {
    await runWatch(emu, opts, romData);
  } else {
    await runBatch(emu, opts);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
