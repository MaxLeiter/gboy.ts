import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { availableParallelism, tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Emulator } from "../src/emulator";

type WorkerResult = {
  failures: string[];
  processed: number;
  elapsedMs: number;
};

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.floor(parsed));
}

function parseParallelism(value: string | undefined): number {
  if (value === "auto") {
    return Math.max(1, availableParallelism());
  }
  return parsePositiveInt(value, 1);
}

const romRoot = resolve(
  process.env.GB_TEST_ROMS_DIR ??
    join(process.cwd(), "external", "game-boy-test-roms-release"),
);
const frameBudget = parsePositiveInt(process.env.GB_TEST_ROM_FRAMES, 600);
const progressEvery = parsePositiveInt(process.env.GB_TEST_PROGRESS_EVERY, 50);
const maxFailuresToPrint = parsePositiveInt(process.env.GB_TEST_MAX_FAILURES_PRINT, 50);
const requestedParallelism = parseParallelism(process.env.GB_TEST_PARALLEL);

function collectRoms(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectRoms(fullPath));
      continue;
    }
    if (!entry.isFile()) continue;
    if (entry.name.endsWith(".gb") || entry.name.endsWith(".gbc")) {
      files.push(fullPath);
    }
  }

  return files;
}

function formatDurationMs(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m${seconds.toString().padStart(2, "0")}s`;
}

function printSummary(total: number, failures: string[], elapsedMs: number): void {
  const passed = total - failures.length;

  console.log("");
  console.log("Smoke summary");
  console.log(`passed: ${passed}`);
  console.log(`failed: ${failures.length}`);
  console.log(`elapsed: ${formatDurationMs(elapsedMs)}`);

  if (failures.length > 0) {
    console.log("");
    console.log(
      `Failures (showing up to ${Math.min(failures.length, maxFailuresToPrint)}):`,
    );
    for (let i = 0; i < Math.min(failures.length, maxFailuresToPrint); i++) {
      console.log(`${i + 1}. ${failures[i]}`);
    }
    if (failures.length > maxFailuresToPrint) {
      console.log(
        `... ${failures.length - maxFailuresToPrint} additional failures omitted.`,
      );
    }
  }
}

async function runRoms(roms: string[], workerLabel = ""): Promise<WorkerResult> {
  const startedAt = Date.now();
  const failures: string[] = [];

  for (let i = 0; i < roms.length; i++) {
    const romPath = roms[i]!;
    const rel = relative(romRoot, romPath);
    let emulator: Emulator | null = null;
    try {
      const romData = new Uint8Array(await Bun.file(romPath).arrayBuffer());
      emulator = new Emulator(romData);
      emulator.runFrames(frameBudget);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      if (emulator) {
        failures.push(
          `${rel}: ${message} ` +
            `(PC=0x${emulator.cpu.pc.toString(16).padStart(4, "0")}, ` +
            `SP=0x${emulator.cpu.sp.toString(16).padStart(4, "0")})`,
        );
      } else {
        failures.push(`${rel}: ${message}`);
      }
    }

    const done = i + 1;
    if (done % progressEvery === 0 || done === roms.length) {
      const elapsed = Date.now() - startedAt;
      const prefix = workerLabel.length > 0 ? `${workerLabel} ` : "";
      console.log(
        `${prefix}[${done}/${roms.length}] elapsed=${formatDurationMs(elapsed)} failures=${failures.length}`,
      );
    }
  }

  return {
    failures,
    processed: roms.length,
    elapsedMs: Date.now() - startedAt,
  };
}

const rootStat = statSync(romRoot, { throwIfNoEntry: false });
if (!rootStat || !rootStat.isDirectory()) {
  console.error(`ROM directory not found: ${romRoot}`);
  process.exit(1);
}

const roms = collectRoms(romRoot).sort();
if (roms.length === 0) {
  console.error(`No .gb/.gbc ROM files found under: ${romRoot}`);
  process.exit(1);
}

console.log(`ROM root: ${romRoot}`);
console.log(`ROM count: ${roms.length}`);
console.log(`Frame budget per ROM: ${frameBudget}`);
console.log(`Parallel workers requested: ${requestedParallelism}`);

const workerStart = process.env.GB_TEST_WORKER_START;
const workerEnd = process.env.GB_TEST_WORKER_END;
const workerId = process.env.GB_TEST_WORKER_ID ?? "?";
const resultFile = process.env.GB_TEST_RESULT_FILE;

if (workerStart !== undefined || workerEnd !== undefined) {
  if (workerStart === undefined || workerEnd === undefined) {
    console.error("Worker start/end must both be set");
    process.exit(2);
  }
  const parsedStart = Number(workerStart);
  const parsedEnd = Number(workerEnd);
  if (!Number.isFinite(parsedStart) || !Number.isFinite(parsedEnd)) {
    console.error(`Invalid worker slice bounds: start=${workerStart} end=${workerEnd}`);
    process.exit(2);
  }
  const start = Math.max(0, Math.min(roms.length, Math.floor(parsedStart)));
  const end = Math.max(start, Math.min(roms.length, Math.floor(parsedEnd)));
  const subset = roms.slice(start, end);
  const label = `[w${workerId}]`;

  console.log(`${label} ROM slice: ${start + 1}-${end} (${subset.length} ROMs)`);
  const workerResult = await runRoms(subset, label);

  if (resultFile) {
    writeFileSync(resultFile, JSON.stringify(workerResult));
  }

  process.exit(0);
}

const workerCount = Math.min(roms.length, requestedParallelism);
console.log(`Parallel workers active: ${workerCount}`);

if (workerCount <= 1) {
  const startedAt = Date.now();
  const result = await runRoms(roms);
  printSummary(roms.length, result.failures, Date.now() - startedAt);
  if (result.failures.length > 0) {
    process.exit(1);
  }
} else {
  const startedAt = Date.now();
  const tempDir = mkdtempSync(join(tmpdir(), "gb-test-roms-"));
  const scriptPath = fileURLToPath(import.meta.url);
  const sliceSize = Math.ceil(roms.length / workerCount);

  const workers: Array<{
    id: number;
    resultPath: string;
    process: ReturnType<typeof Bun.spawn>;
  }> = [];

  try {
    for (let i = 0; i < workerCount; i++) {
      const start = i * sliceSize;
      const end = Math.min(roms.length, start + sliceSize);
      if (start >= end) continue;

      const id = i + 1;
      const resultPath = join(tempDir, `worker-${id}.json`);
      console.log(`worker ${id}: ROMs ${start + 1}-${end} (${end - start})`);

      const workerProcess = Bun.spawn([process.execPath, scriptPath], {
        cwd: process.cwd(),
        stdout: "inherit",
        stderr: "inherit",
        env: {
          ...process.env,
          GB_TEST_PARALLEL: "1",
          GB_TEST_WORKER_ID: String(id),
          GB_TEST_WORKER_START: String(start),
          GB_TEST_WORKER_END: String(end),
          GB_TEST_RESULT_FILE: resultPath,
        },
      });

      workers.push({ id, resultPath, process: workerProcess });
    }

    const exitCodes = await Promise.all(workers.map((worker) => worker.process.exited));
    const failures: string[] = [];

    for (let i = 0; i < workers.length; i++) {
      const worker = workers[i]!;
      const exitCode = exitCodes[i];

      if (exitCode !== 0) {
        failures.push(`[worker ${worker.id}] exited with code ${exitCode}`);
      }

      try {
        const raw = readFileSync(worker.resultPath, "utf8");
        const parsed = JSON.parse(raw) as Partial<WorkerResult>;
        if (Array.isArray(parsed.failures)) {
          for (const failure of parsed.failures) {
            if (typeof failure === "string") {
              failures.push(failure);
            }
          }
        } else if (exitCode === 0) {
          failures.push(`[worker ${worker.id}] missing failures array in result file`);
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        failures.push(`[worker ${worker.id}] failed to read result file: ${message}`);
      }
    }

    printSummary(roms.length, failures, Date.now() - startedAt);
    if (failures.length > 0) {
      process.exit(1);
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}
