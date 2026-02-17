const GB_WIDTH = 160;
const GB_HEIGHT = 144;


export type RenderFormat = "ansi" | "ansi-half" | "green" | "green-half" | "ascii" | "blocks" | "half-blocks";

function luminance(r: number, g: number, b: number): number {
  return Math.round(0.299 * r + 0.587 * g + 0.114 * b);
}

function dimensions(width: number) {
  const height = Math.round((width * GB_HEIGHT) / GB_WIDTH / 2);
  const xStep = GB_WIDTH / width;
  const yStep = GB_HEIGHT / height;
  return { height, xStep, yStep };
}

function samplePixel(fb: Uint8Array, srcX: number, srcY: number): number {
  const i = (srcY * GB_WIDTH + srcX) * 4;
  return luminance(fb[i]!, fb[i + 1]!, fb[i + 2]!);
}

function sampleRGB(fb: Uint8Array, srcX: number, srcY: number): [number, number, number] {
  const i = (srcY * GB_WIDTH + srcX) * 4;
  return [fb[i]!, fb[i + 1]!, fb[i + 2]!];
}

const GB_GREEN_PALETTE: [number, number, number][] = [
  [155, 188, 15],
  [139, 172, 15],
  [48, 98, 48],
  [15, 56, 15],
];

function lumToGBGreen(lum: number): [number, number, number] {
  if (lum > 224) return GB_GREEN_PALETTE[0]!;
  if (lum > 144) return GB_GREEN_PALETTE[1]!;
  if (lum > 48) return GB_GREEN_PALETTE[2]!;
  return GB_GREEN_PALETTE[3]!;
}

export function renderFramebuffer(
  fb: Uint8Array,
  format: RenderFormat = "ansi",
  width: number = 80,
): string {
  switch (format) {
    case "ansi":
      return renderANSI(fb, width);
    case "ansi-half":
      return renderANSIHalf(fb, width);
    case "green":
      return renderTruecolor(fb, width, false);
    case "green-half":
      return renderTruecolor(fb, width, true);
    case "half-blocks":
      return renderHalfBlocks(fb, width);
    case "ascii":
      return renderChars(fb, width, " .:-=+*#%@");
    case "blocks":
      return renderChars(fb, width, " ░▓█");
  }
}

export function renderANSI(fb: Uint8Array, width: number = 80): string {
  const { height, xStep, yStep } = dimensions(width);
  const lines: string[] = [];

  for (let row = 0; row < height; row++) {
    let line = "";
    const srcY = Math.floor(row * yStep);
    let prevColor = -1;

    for (let col = 0; col < width; col++) {
      const srcX = Math.floor(col * xStep);
      const lum = samplePixel(fb, srcX, srcY);

      const ansiColor = 232 + Math.round((lum / 255) * 23);

      if (ansiColor !== prevColor) {
        line += `\x1b[48;5;${ansiColor}m`;
        prevColor = ansiColor;
      }
      line += " ";
    }

    line += "\x1b[0m";
    lines.push(line);
  }

  return lines.join("\n");
}

export function renderANSIHalf(fb: Uint8Array, width: number = 80): string {
  const fullHeight = Math.round((width * GB_HEIGHT) / GB_WIDTH);
  const height = fullHeight + (fullHeight % 2);
  const xStep = GB_WIDTH / width;
  const yStep = GB_HEIGHT / height;
  const lines: string[] = [];

  for (let row = 0; row < height; row += 2) {
    let line = "";
    const srcY1 = Math.min(Math.floor(row * yStep), GB_HEIGHT - 1);
    const srcY2 = Math.min(Math.floor((row + 1) * yStep), GB_HEIGHT - 1);

    for (let col = 0; col < width; col++) {
      const srcX = Math.floor(col * xStep);
      const lum1 = samplePixel(fb, srcX, srcY1);
      const lum2 = samplePixel(fb, srcX, srcY2);

      const fg = 232 + Math.round((lum1 / 255) * 23);
      const bg = 232 + Math.round((lum2 / 255) * 23);

      line += `\x1b[38;5;${fg};48;5;${bg}m▀`;
    }

    line += "\x1b[0m";
    lines.push(line);
  }

  return lines.join("\n");
}

export function renderTruecolor(fb: Uint8Array, width: number = 80, halfBlock: boolean = false): string {
  if (halfBlock) {
    return renderTruecolorHalf(fb, width);
  }

  const { height, xStep, yStep } = dimensions(width);
  const lines: string[] = [];

  for (let row = 0; row < height; row++) {
    let line = "";
    const srcY = Math.floor(row * yStep);
    let prevR = -1, prevG = -1, prevB = -1;

    for (let col = 0; col < width; col++) {
      const srcX = Math.floor(col * xStep);
      const lum = samplePixel(fb, srcX, srcY);
      const [r, g, b] = lumToGBGreen(lum);

      if (r !== prevR || g !== prevG || b !== prevB) {
        line += `\x1b[48;2;${r};${g};${b}m`;
        prevR = r; prevG = g; prevB = b;
      }
      line += " ";
    }

    line += "\x1b[0m";
    lines.push(line);
  }

  return lines.join("\n");
}

function renderTruecolorHalf(fb: Uint8Array, width: number): string {
  const fullHeight = Math.round((width * GB_HEIGHT) / GB_WIDTH);
  const height = fullHeight + (fullHeight % 2);
  const xStep = GB_WIDTH / width;
  const yStep = GB_HEIGHT / height;
  const lines: string[] = [];

  for (let row = 0; row < height; row += 2) {
    let line = "";
    const srcY1 = Math.min(Math.floor(row * yStep), GB_HEIGHT - 1);
    const srcY2 = Math.min(Math.floor((row + 1) * yStep), GB_HEIGHT - 1);

    for (let col = 0; col < width; col++) {
      const srcX = Math.floor(col * xStep);
      const lum1 = samplePixel(fb, srcX, srcY1);
      const lum2 = samplePixel(fb, srcX, srcY2);
      const [r1, g1, b1] = lumToGBGreen(lum1);
      const [r2, g2, b2] = lumToGBGreen(lum2);

      line += `\x1b[38;2;${r1};${g1};${b1};48;2;${r2};${g2};${b2}m▀`;
    }

    line += "\x1b[0m";
    lines.push(line);
  }

  return lines.join("\n");
}

function renderChars(fb: Uint8Array, width: number, charSet: string): string {
  const maxIdx = charSet.length - 1;
  const { height, xStep, yStep } = dimensions(width);
  const lines: string[] = [];

  lines.push("┌" + "─".repeat(width) + "┐");

  for (let row = 0; row < height; row++) {
    let line = "│";
    const srcY = Math.floor(row * yStep);

    for (let col = 0; col < width; col++) {
      const srcX = Math.floor(col * xStep);
      const lum = samplePixel(fb, srcX, srcY);
      const idx = Math.round((1 - lum / 255) * maxIdx);
      line += charSet[idx];
    }

    line += "│";
    lines.push(line);
  }

  lines.push("└" + "─".repeat(width) + "┘");

  return lines.join("\n");
}

function renderHalfBlocks(fb: Uint8Array, width: number): string {
  const fullHeight = Math.round((width * GB_HEIGHT) / GB_WIDTH);
  const height = fullHeight + (fullHeight % 2);
  const xStep = GB_WIDTH / width;
  const yStep = GB_HEIGHT / height;
  const lines: string[] = [];

  lines.push("┌" + "─".repeat(width) + "┐");

  for (let row = 0; row < height; row += 2) {
    let line = "│";
    const srcY1 = Math.min(Math.floor(row * yStep), GB_HEIGHT - 1);
    const srcY2 = Math.min(Math.floor((row + 1) * yStep), GB_HEIGHT - 1);

    for (let col = 0; col < width; col++) {
      const srcX = Math.floor(col * xStep);
      const dark1 = samplePixel(fb, srcX, srcY1) < 128;
      const dark2 = samplePixel(fb, srcX, srcY2) < 128;

      if (dark1 && dark2) line += "█";
      else if (dark1) line += "▀";
      else if (dark2) line += "▄";
      else line += " ";
    }

    line += "│";
    lines.push(line);
  }

  lines.push("└" + "─".repeat(width) + "┘");
  return lines.join("\n");
}

export function framebufferStats(fb: Uint8Array): {
  totalPixels: number;
  uniqueColors: number;
  blackPixels: number;
  whitePixels: number;
  allWhite: boolean;
  allBlack: boolean;
} {
  const colors = new Set<number>();
  let black = 0;
  let white = 0;

  for (let i = 0; i < fb.length; i += 4) {
    const r = fb[i]!;
    const g = fb[i + 1]!;
    const b = fb[i + 2]!;
    colors.add((r << 16) | (g << 8) | b);
    if (r === 0 && g === 0 && b === 0) black++;
    if (r === 255 && g === 255 && b === 255) white++;
  }

  const total = GB_WIDTH * GB_HEIGHT;
  return {
    totalPixels: total,
    uniqueColors: colors.size,
    blackPixels: black,
    whitePixels: white,
    allWhite: white === total,
    allBlack: black === total,
  };
}
