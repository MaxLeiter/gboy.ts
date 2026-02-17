import { Emulator, Button } from "gboy-ts/emulator";
import { WebAudioPcmPlayer } from "./audio";

const canvas = document.getElementById("screen") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
const statusText = document.getElementById("status-text")!;
const dot = document.getElementById("dot")!;
const infoLast = document.getElementById("info-last")!;
const infoFps = document.getElementById("info-fps")!;
const audioToggleButton = document.getElementById("audio-toggle") as HTMLButtonElement;

const GB_FPS = 4194304 / 70224;
const GB_FRAME_MS = 1000 / GB_FPS;
const MAX_FRAMES_PER_TICK = 10;
const MAX_DELTA_MS = 250;
const AUDIO_BUFFER_TARGET_SECONDS = 0.18;
const AUDIO_MAX_PULL_FRAMES = 8192;

let emu: Emulator | null = null;
let romData: Uint8Array | null = null;

let speed = 1;
let paused = false;
let running = false;
let audioEnabled = false;

let frameCount = 0;
let lastFpsTime = performance.now();
let fpsDisplay = 0;

let lastTickTime = performance.now();
let accumulatorMs = 0;

const imageData = ctx.createImageData(160, 144);
const audioPlayer = new WebAudioPcmPlayer();

const KEY_MAP: Record<string, Button> = {
  ArrowUp: Button.Up,
  ArrowDown: Button.Down,
  ArrowLeft: Button.Left,
  ArrowRight: Button.Right,
  z: Button.A,
  Z: Button.A,
  x: Button.B,
  X: Button.B,
  Enter: Button.Start,
  Backspace: Button.Select,
};

const BUTTON_NAMES: Record<number, string> = {
  [Button.Up]: "UP",
  [Button.Down]: "DOWN",
  [Button.Left]: "LEFT",
  [Button.Right]: "RIGHT",
  [Button.A]: "A",
  [Button.B]: "B",
  [Button.Start]: "START",
  [Button.Select]: "SELECT",
};

const buttonTimers = new Map<Button, number>();
const HOLD_FRAMES = 6;

function resetTiming(now = performance.now()): void {
  accumulatorMs = 0;
  lastTickTime = now;
  lastFpsTime = now;
  frameCount = 0;
  fpsDisplay = 0;
  infoFps.textContent = "0 fps";
}

async function loadROMFromURL(url: string): Promise<void> {
  statusText.textContent = "Loading ROM...";
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = await res.arrayBuffer();
    startEmulator(new Uint8Array(buf));
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    statusText.textContent = `Failed to load: ${message}`;
    dot.className = "dot error";
  }
}

function loadROMFromFile(file: File): void {
  const reader = new FileReader();
  reader.onload = () => {
    startEmulator(new Uint8Array(reader.result as ArrayBuffer));
  };
  reader.readAsArrayBuffer(file);
}

function startEmulator(rom: Uint8Array): void {
  romData = rom;
  emu = new Emulator(rom);
  emu.setAudioOutputEnabled(audioEnabled);
  const title = emu.cartridge.getTitle();
  statusText.textContent = `${title} (${emu.cartridge.getMBCType()})`;
  dot.className = "dot running";

  buttonTimers.clear();
  paused = false;
  resetTiming();
  updateSpeedUI();

  running = true;
}

function drawFramebuffer(): void {
  if (!emu) return;
  const fb = emu.getFramebuffer();
  imageData.data.set(fb);
  ctx.putImageData(imageData, 0, 0);
}

function updateButtonTimers(): void {
  if (!emu || buttonTimers.size === 0) return;

  for (const [btn, remaining] of buttonTimers) {
    if (remaining <= 1) {
      emu.releaseButton(btn);
      buttonTimers.delete(btn);
    } else {
      buttonTimers.set(btn, remaining - 1);
    }
  }
}

function pressGameButton(btn: Button): void {
  if (!emu) return;
  emu.pressButton(btn);
  buttonTimers.set(btn, HOLD_FRAMES);
  infoLast.textContent = `Last: ${BUTTON_NAMES[btn] ?? "?"}`;
}

function runEmulationFrames(now: number): void {
  if (!emu || paused) return;

  let deltaMs = now - lastTickTime;
  lastTickTime = now;

  if (!Number.isFinite(deltaMs) || deltaMs < 0) {
    deltaMs = 0;
  } else if (deltaMs > MAX_DELTA_MS) {
    deltaMs = MAX_DELTA_MS;
  }

  accumulatorMs += deltaMs * speed;

  let framesDue = Math.floor(accumulatorMs / GB_FRAME_MS);
  if (framesDue <= 0) return;

  if (framesDue > MAX_FRAMES_PER_TICK) {
    framesDue = MAX_FRAMES_PER_TICK;
    accumulatorMs = framesDue * GB_FRAME_MS;
  }

  try {
    for (let i = 0; i < framesDue; i++) {
      emu.runFrame();
      updateButtonTimers();
      frameCount++;
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    statusText.textContent = `Crash: ${message}`;
    dot.className = "dot error";
    running = false;
    return;
  }

  accumulatorMs -= framesDue * GB_FRAME_MS;
  if (accumulatorMs < 0) {
    accumulatorMs = 0;
  }

  pumpAudio();
  drawFramebuffer();

  const fpsElapsed = now - lastFpsTime;
  if (fpsElapsed >= 1000) {
    fpsDisplay = Math.round((frameCount / fpsElapsed) * 1000);
    frameCount = 0;
    lastFpsTime = now;
    infoFps.textContent = `${fpsDisplay} fps`;
  }
}

function pumpAudio(): void {
  if (!emu || !audioEnabled) return;

  let guard = 0;
  while (
    audioPlayer.getBufferedSeconds() < AUDIO_BUFFER_TARGET_SECONDS &&
    guard < 4
  ) {
    const samples = emu.consumeAudioSamples(AUDIO_MAX_PULL_FRAMES);
    if (samples.length === 0) break;
    audioPlayer.queueInterleaved(samples, emu.getAudioSampleRate());
    guard++;
  }
}

function mainLoop(now: number): void {
  requestAnimationFrame(mainLoop);

  if (!running || !emu) {
    lastTickTime = now;
    return;
  }

  runEmulationFrames(now);
}

function setSpeed(s: number): void {
  speed = s;
  paused = false;
  updateSpeedUI();
}

function togglePause(): void {
  paused = !paused;
  if (!paused) {
    resetTiming();
  }
  updateSpeedUI();
}

function updateSpeedUI(): void {
  document.querySelectorAll<HTMLButtonElement>(".speed-btn").forEach((el) => {
    const s = parseInt(el.dataset.speed!, 10);
    el.classList.remove("active", "paused");
    if (paused && s === 0) {
      el.classList.add("paused");
    } else if (!paused && s === speed) {
      el.classList.add("active");
    }
  });
}

function updateAudioUI(): void {
  audioToggleButton.textContent = audioEnabled
    ? "Disable Audio"
    : "Enable Audio";
}

document.addEventListener("keydown", (event) => {
  if (event.key === " ") {
    event.preventDefault();
    togglePause();
    return;
  }
  if (event.key === "]" || event.key === "f" || event.key === "F") {
    event.preventDefault();
    setSpeed(Math.min(speed * 2, 16));
    return;
  }
  if (event.key === "[" || event.key === "d" || event.key === "D") {
    event.preventDefault();
    setSpeed(Math.max(speed / 2, 1));
    return;
  }

  const num = parseInt(event.key, 10);
  if (event.key === "0") {
    event.preventDefault();
    togglePause();
    return;
  }
  if (num >= 1 && num <= 5) {
    event.preventDefault();
    setSpeed([1, 2, 4, 8, 16][num - 1]!);
    return;
  }

  const btn = KEY_MAP[event.key];
  if (btn === undefined) return;

  event.preventDefault();
  pressGameButton(btn);
});

document.querySelectorAll<HTMLButtonElement>("[data-btn]").forEach((el) => {
  const name = el.dataset.btn!;
  const btnMap: Record<string, Button> = {
    up: Button.Up,
    down: Button.Down,
    left: Button.Left,
    right: Button.Right,
    a: Button.A,
    b: Button.B,
    start: Button.Start,
    select: Button.Select,
  };

  const btn = btnMap[name];
  if (btn === undefined) return;

  el.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    pressGameButton(btn);
  });
});

document.querySelectorAll<HTMLButtonElement>(".speed-btn").forEach((el) => {
  el.addEventListener("click", () => {
    const s = parseInt(el.dataset.speed!, 10);
    if (s === 0) {
      togglePause();
    } else {
      setSpeed(s);
    }
  });
});

audioToggleButton.addEventListener("click", () => {
  void (async () => {
    try {
      const next = !audioEnabled;
      await audioPlayer.setEnabled(next);
      audioEnabled = next;
      if (emu) {
        emu.setAudioOutputEnabled(audioEnabled);
        pumpAudio();
      }
      updateAudioUI();
      statusText.textContent = audioEnabled ? "Audio enabled" : "Audio disabled";
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      audioEnabled = false;
      if (emu) {
        emu.setAudioOutputEnabled(false);
      }
      updateAudioUI();
      statusText.textContent = `Audio error: ${message}`;
    }
  })();
});

document.querySelectorAll<HTMLButtonElement>(".rom-btn[data-rom]").forEach((el) => {
  el.addEventListener("click", () => {
    void loadROMFromURL(`/roms/${el.dataset.rom}`);
  });
});

document.getElementById("file-input")!.addEventListener("change", (event) => {
  const input = event.target as HTMLInputElement;
  if (input.files?.[0]) {
    loadROMFromFile(input.files[0]);
  }
});

let dropOverlay: HTMLDivElement | null = null;

document.addEventListener("dragover", (event) => {
  event.preventDefault();
  if (dropOverlay) return;

  dropOverlay = document.createElement("div");
  dropOverlay.className = "drop-overlay";
  dropOverlay.textContent = "DROP ROM";
  document.body.appendChild(dropOverlay);
});

document.addEventListener("dragleave", (event) => {
  if (event.relatedTarget !== null || !dropOverlay) return;
  dropOverlay.remove();
  dropOverlay = null;
});

document.addEventListener("drop", (event) => {
  event.preventDefault();
  if (dropOverlay) {
    dropOverlay.remove();
    dropOverlay = null;
  }

  const file = event.dataTransfer?.files[0];
  if (!file) return;
  if (!file.name.endsWith(".gb") && !file.name.endsWith(".gbc")) return;

  loadROMFromFile(file);
});

document.getElementById("reset-btn")!.addEventListener("click", () => {
  if (romData) {
    startEmulator(romData);
  }
});

ctx.fillStyle = "#0f380f";
ctx.fillRect(0, 0, 160, 144);

requestAnimationFrame(mainLoop);
updateAudioUI();
void loadROMFromURL("/roms/pocket.gb");

window.addEventListener("beforeunload", () => {
  audioPlayer.dispose();
});
