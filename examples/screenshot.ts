import { readFileSync, writeFileSync } from "node:fs";
import { Emulator, Button } from "../src/emulator";
import { encodePNG } from "../src/png";

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

const GB_WIDTH = 160;
const GB_HEIGHT = 144;

function scaleFramebuffer(
  fb: Uint8Array,
  srcW: number,
  srcH: number,
  scale: number,
): { data: Uint8Array; width: number; height: number } {
  if (scale === 1) return { data: fb, width: srcW, height: srcH };
  const dstW = srcW * scale;
  const dstH = srcH * scale;
  const out = new Uint8Array(dstW * dstH * 4);
  for (let y = 0; y < srcH; y++) {
    for (let x = 0; x < srcW; x++) {
      const si = (y * srcW + x) * 4;
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const di = ((y * scale + dy) * dstW + (x * scale + dx)) * 4;
          out[di] = fb[si]!;
          out[di + 1] = fb[si + 1]!;
          out[di + 2] = fb[si + 2]!;
          out[di + 3] = fb[si + 3]!;
        }
      }
    }
  }
  return { data: out, width: dstW, height: dstH };
}

function printHelp() {
  console.log(`Usage: bun examples/screenshot.ts <rom-path> [options]

Options:
  --frames <n>      Frames to run before capture (default: 900)
  --output <path>   Output PNG path (default: frame.png)
  --press <button>  Press button at frame N/2 (a,b,start,select,up,down,left,right)
  --scale <n>       Scale factor for output (default: 1, meaning 160x144)
  --help            Show help`);
}

function parseArgs(args: string[]) {
  let romPath: string | null = null;
  let frames = 900;
  let output = "frame.png";
  let press: string | null = null;
  let scale = 1;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--help") {
      printHelp();
      process.exit(0);
    } else if (arg === "--frames") {
      frames = parseInt(args[++i]!, 10);
      if (isNaN(frames) || frames < 1) {
        console.error("Error: --frames must be a positive integer");
        process.exit(1);
      }
    } else if (arg === "--output") {
      output = args[++i]!;
    } else if (arg === "--press") {
      press = args[++i]!.toLowerCase();
      if (!(press in BUTTON_MAP)) {
        console.error(`Error: unknown button "${press}". Valid: ${Object.keys(BUTTON_MAP).join(", ")}`);
        process.exit(1);
      }
    } else if (arg === "--scale") {
      scale = parseInt(args[++i]!, 10);
      if (isNaN(scale) || scale < 1) {
        console.error("Error: --scale must be a positive integer");
        process.exit(1);
      }
    } else if (!arg.startsWith("--")) {
      romPath = arg;
    } else {
      console.error(`Unknown option: ${arg}`);
      printHelp();
      process.exit(1);
    }
  }

  if (!romPath) {
    console.error("Error: ROM path is required");
    printHelp();
    process.exit(1);
  }

  return { romPath, frames, output, press, scale };
}

function main() {
  const args = process.argv.slice(2);
  const { romPath, frames, output, press, scale } = parseArgs(args);

  console.log(`Loading ROM: ${romPath}`);
  const romData = new Uint8Array(readFileSync(romPath!));
  console.log(`ROM size: ${romData.length} bytes`);

  const emu = new Emulator(romData);
  const pressFrame = press ? Math.floor(frames / 2) : -1;
  const releaseFrame = press ? pressFrame + 10 : -1;

  console.log(`Running ${frames} frames...`);
  if (press) {
    console.log(`Will press "${press}" at frame ${pressFrame}, release at frame ${releaseFrame}`);
  }

  const startTime = performance.now();
  let fb: Uint8Array = emu.getFramebuffer();

  for (let i = 0; i < frames; i++) {
    if (press && i === pressFrame) {
      emu.pressButton(BUTTON_MAP[press]!);
    }
    if (press && i === releaseFrame) {
      emu.releaseButton(BUTTON_MAP[press]!);
    }

    fb = emu.runFrame();

    if ((i + 1) % 100 === 0 || i === frames - 1) {
      const pct = Math.round(((i + 1) / frames) * 100);
      const elapsed = ((performance.now() - startTime) / 1000).toFixed(1);
      process.stdout.write(`\r  ${i + 1}/${frames} frames (${pct}%) - ${elapsed}s`);
    }
  }
  process.stdout.write("\n");

  const endTime = performance.now();
  const elapsed = endTime - startTime;

  const { data, width, height } = scaleFramebuffer(fb, GB_WIDTH, GB_HEIGHT, scale);
  const png = encodePNG(data, width, height);
  writeFileSync(output, png);

  const fileSizeKB = (png.length / 1024).toFixed(1);
  console.log(`\nDone!`);
  console.log(`  Output:     ${output}`);
  console.log(`  Dimensions: ${width}x${height} (scale ${scale}x)`);
  console.log(`  File size:  ${png.length} bytes (${fileSizeKB} KB)`);
  console.log(`  Frames:     ${frames}`);
  console.log(`  Time:       ${(elapsed / 1000).toFixed(2)}s`);
}

main();
