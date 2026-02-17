"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type ButtonName =
  | "a"
  | "b"
  | "start"
  | "select"
  | "up"
  | "down"
  | "left"
  | "right";

type GameInfo = {
  title: string;
  mbc: string;
  romSize: number;
  frameCount: number;
};

const KEY_MAP: Record<string, ButtonName> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  z: "a",
  Z: "a",
  x: "b",
  X: "b",
  Enter: "start",
  Backspace: "select",
};

const SPEEDS = [
  { label: "\u23F8", frames: 0, interval: 500 },
  { label: "1\u00D7", frames: 10, interval: 500 },
  { label: "2\u00D7", frames: 20, interval: 500 },
  { label: "4\u00D7", frames: 40, interval: 400 },
  { label: "8\u00D7", frames: 80, interval: 300 },
  { label: "16\u00D7", frames: 160, interval: 200 },
];

export default function Home() {
  const [frameSrc, setFrameSrc] = useState("/api/frame?t=0");
  const [gameInfo, setGameInfo] = useState<GameInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pressing, setPressing] = useState(false);
  const [lastButton, setLastButton] = useState<string>("\u2014");
  const [speedIdx, setSpeedIdx] = useState(1);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const speedUp = useCallback(() => {
    setSpeedIdx((i) => Math.min(i + 1, SPEEDS.length - 1));
  }, []);

  const speedDown = useCallback(() => {
    setSpeedIdx((i) => Math.max(i - 1, 0));
  }, []);

  const togglePause = useCallback(() => {
    setSpeedIdx((i) => (i === 0 ? 1 : 0));
  }, []);

  const updateFrame = useCallback((pngBlob?: Blob) => {
    if (pngBlob) {
      const url = URL.createObjectURL(pngBlob);
      setFrameSrc((prev) => {
        if (prev.startsWith("blob:")) URL.revokeObjectURL(prev);
        return url;
      });
    } else {
      setFrameSrc(`/api/frame?t=${Date.now()}`);
    }
  }, []);

  const sendInput = useCallback(
    async (button: ButtonName) => {
      setPressing(true);
      setLastButton(button.toUpperCase());
      setError(null);
      try {
        const res = await fetch("/api/input", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ button }),
        });
        if (!res.ok) {
          const data = await res.json();
          setError(data.error || "Input failed");
          return;
        }
        const blob = await res.blob();
        updateFrame(blob);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Network error");
      } finally {
        setPressing(false);
      }
    },
    [updateFrame],
  );

  const resetGame = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/reset", { method: "POST" });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Reset failed");
        return;
      }
      const blob = await res.blob();
      updateFrame(blob);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    }
  }, [updateFrame]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === " ") { e.preventDefault(); togglePause(); return; }
      if (e.key === "]" || e.key === "f" || e.key === "F") { e.preventDefault(); speedUp(); return; }
      if (e.key === "[" || e.key === "d" || e.key === "D") { e.preventDefault(); speedDown(); return; }
      const num = parseInt(e.key, 10);
      if (num >= 0 && num <= 5) { e.preventDefault(); setSpeedIdx(num); return; }
      const button = KEY_MAP[e.key];
      if (button) { e.preventDefault(); sendInput(button); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [sendInput, togglePause, speedUp, speedDown]);

  useEffect(() => {
    const speed = SPEEDS[speedIdx]!;
    if (speed.frames === 0) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = null;
      return;
    }
    intervalRef.current = setInterval(async () => {
      if (pressing) return;
      try {
        const res = await fetch(`/api/frame?advance=${speed.frames}&t=${Date.now()}`);
        if (res.ok) {
          const blob = await res.blob();
          updateFrame(blob);
        }
      } catch { /* ignore */ }
    }, speed.interval);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [pressing, updateFrame, speedIdx]);

  useEffect(() => {
    const fetchInfo = async () => {
      try {
        const res = await fetch("/api/state");
        if (res.ok) setGameInfo(await res.json());
      } catch { /* ignore */ }
    };
    fetchInfo();
    const id = setInterval(fetchInfo, 3000);
    return () => clearInterval(id);
  }, []);

  const paused = speedIdx === 0;

  return (
    <main style={styles.main}>
      <div style={styles.shell}>
        <div style={styles.header}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={styles.powerLed} />
            <span style={styles.brandLabel}>gboy.ts</span>
          </div>
          <span style={styles.subLabel}>GAME BOY</span>
        </div>

        <div style={styles.bezel}>
          <div style={styles.screenWrap}>
            <img
              src={frameSrc}
              alt="Game Boy screen"
              width={320}
              height={288}
              style={styles.screen}
              draggable={false}
            />
            {paused && <div style={styles.pauseOverlay}>PAUSED</div>}
          </div>
          <div style={styles.statusRow}>
            <div
              style={{
                ...styles.statusDot,
                backgroundColor: error ? "#ff4444" : pressing ? "#ffaa00" : "var(--gb-lightest)",
                boxShadow: `0 0 6px ${error ? "#ff4444" : pressing ? "#ffaa00" : "var(--gb-lightest)"}`,
              }}
            />
            <span style={styles.statusText}>
              {error || (gameInfo ? `${gameInfo.title} \u2022 Frame ${gameInfo.frameCount}` : "Connecting...")}
            </span>
          </div>
        </div>

        <div style={styles.controlsRow}>
          <div style={styles.dpadGrid}>
            <div />
            <DPadBtn dir="up" onClick={() => sendInput("up")} />
            <div />
            <DPadBtn dir="left" onClick={() => sendInput("left")} />
            <div style={styles.dpadCenter} />
            <DPadBtn dir="right" onClick={() => sendInput("right")} />
            <div />
            <DPadBtn dir="down" onClick={() => sendInput("down")} />
            <div />
          </div>

          <div style={styles.abWrap}>
            <div style={styles.abCol}>
              <ABBtn label="B" onClick={() => sendInput("b")} />
              <span style={styles.abLabel}>B</span>
            </div>
            <div style={{ ...styles.abCol, marginTop: -20 }}>
              <ABBtn label="A" onClick={() => sendInput("a")} />
              <span style={styles.abLabel}>A</span>
            </div>
          </div>
        </div>

        <div style={styles.pillRow}>
          <PillBtn label="SELECT" onClick={() => sendInput("select")} />
          <PillBtn label="START" onClick={() => sendInput("start")} />
        </div>

        <div style={styles.speakerWrap}>
          {[...Array(6)].map((_, i) => (
            <div key={i} style={styles.speakerLine} />
          ))}
        </div>
      </div>

      <div style={styles.toolbar}>
        <div style={styles.speedRow}>
          {SPEEDS.map((s, i) => (
            <button
              key={i}
              onClick={() => setSpeedIdx(i)}
              style={{
                ...styles.speedBtn,
                backgroundColor: i === speedIdx
                  ? (i === 0 ? "var(--gb-ab)" : "var(--gb-dark)")
                  : "transparent",
                color: i === speedIdx ? "#fff" : "#666",
                fontWeight: i === speedIdx ? 700 : 400,
              }}
            >
              {s.label}
            </button>
          ))}
        </div>

        <div style={styles.infoRow}>
          <span style={styles.infoItem}>Last: {lastButton}</span>
          <span style={styles.infoDivider}>{"\u2022"}</span>
          <span style={styles.infoItem}>Speed: {SPEEDS[speedIdx]!.label}</span>
          <span style={styles.infoDivider}>{"\u2022"}</span>
          <button onClick={resetGame} style={styles.resetBtn}>Reset</button>
        </div>

        <div style={styles.hints}>
          Arrows=D-pad &nbsp; Z=A &nbsp; X=B &nbsp; Enter=Start &nbsp; Space=Pause &nbsp; ]/[=Speed
        </div>
      </div>
    </main>
  );
}

const DPAD_ARROWS: Record<string, string> = {
  up: "\u25B2",
  down: "\u25BC",
  left: "\u25C0",
  right: "\u25B6",
};

const DPAD_RADIUS: Record<string, string> = {
  up: "6px 6px 0 0",
  down: "0 0 6px 6px",
  left: "6px 0 0 6px",
  right: "0 6px 6px 0",
};

function DPadBtn({ dir, onClick }: { dir: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        width: "100%",
        height: "100%",
        borderRadius: DPAD_RADIUS[dir],
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 13,
        backgroundColor: "var(--gb-dpad)",
        color: "var(--gb-shell)",
      }}
    >
      {DPAD_ARROWS[dir]}
    </button>
  );
}

function ABBtn({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        width: 50,
        height: 50,
        borderRadius: "50%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 15,
        fontWeight: 700,
        backgroundColor: "var(--gb-ab)",
        color: "#eee",
        boxShadow: "inset 0 -2px 4px rgba(0,0,0,0.3)",
      }}
    >
      {label}
    </button>
  );
}

function PillBtn({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "5px 18px",
        borderRadius: 16,
        fontSize: 9,
        fontWeight: 700,
        letterSpacing: 2,
        backgroundColor: "var(--gb-btn)",
        color: "#aaa",
        transform: "rotate(-25deg)",
      }}
    >
      {label}
    </button>
  );
}

const styles: Record<string, React.CSSProperties> = {
  main: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    minHeight: "100vh",
    padding: 16,
    userSelect: "none",
    gap: 16,
  },

  shell: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    borderRadius: "20px 20px 20px 80px",
    padding: "20px 22px 28px",
    backgroundColor: "var(--gb-shell)",
    maxWidth: 400,
    width: "100%",
    boxShadow: "0 20px 60px -15px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.1)",
  },

  header: {
    width: "100%",
    marginBottom: 10,
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },
  powerLed: {
    width: 6,
    height: 6,
    borderRadius: "50%",
    backgroundColor: "var(--gb-ab)",
  },
  brandLabel: {
    fontSize: 13,
    fontWeight: 800,
    letterSpacing: 4,
    textTransform: "uppercase" as const,
    color: "var(--gb-darkest)",
  },
  subLabel: {
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: 3,
    color: "var(--gb-shell-dark)",
  },

  bezel: {
    borderRadius: "8px 8px 8px 32px",
    padding: "16px 14px 10px",
    width: "100%",
    backgroundColor: "var(--gb-dark)",
    boxShadow: "inset 0 2px 8px rgba(0,0,0,0.3)",
  },
  screenWrap: {
    borderRadius: 4,
    overflow: "hidden",
    backgroundColor: "var(--gb-darkest)",
    position: "relative" as const,
  },
  screen: {
    display: "block",
    width: "100%",
    height: "auto",
    imageRendering: "pixelated" as const,
  },
  pauseOverlay: {
    position: "absolute" as const,
    inset: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(15,56,15,0.6)",
    color: "var(--gb-lightest)",
    fontSize: 24,
    fontWeight: 800,
    letterSpacing: 6,
  },

  statusRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginTop: 8,
    height: 16,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: "50%",
    flexShrink: 0,
  },
  statusText: {
    fontSize: 9,
    color: "var(--gb-light)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
  },

  controlsRow: {
    width: "100%",
    marginTop: 20,
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    padding: "0 4px",
  },
  dpadGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(3, 38px)",
    gridTemplateRows: "repeat(3, 38px)",
  },
  dpadCenter: {
    backgroundColor: "var(--gb-dpad)",
    borderRadius: 2,
  },
  abWrap: {
    display: "flex",
    gap: 10,
    alignItems: "center",
    marginTop: 14,
    transform: "rotate(-25deg)",
  },
  abCol: {
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
  },
  abLabel: {
    fontSize: 9,
    fontWeight: 700,
    marginTop: 3,
    color: "var(--gb-darkest)",
  },

  pillRow: {
    display: "flex",
    gap: 20,
    marginTop: 20,
  },

  speakerWrap: {
    display: "flex",
    gap: 3,
    marginTop: 20,
    alignSelf: "flex-end" as const,
    transform: "rotate(-25deg)",
    marginRight: 10,
  },
  speakerLine: {
    width: 3,
    height: 24,
    borderRadius: 2,
    backgroundColor: "var(--gb-shell-dark)",
  },

  toolbar: {
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    gap: 8,
    maxWidth: 400,
    width: "100%",
  },
  speedRow: {
    display: "flex",
    gap: 2,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderRadius: 6,
    padding: 2,
  },
  speedBtn: {
    padding: "5px 10px",
    borderRadius: 4,
    fontSize: 11,
    minWidth: 36,
    textAlign: "center" as const,
  },
  infoRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 11,
    color: "#777",
  },
  infoItem: {
    color: "#888",
  },
  infoDivider: {
    color: "#444",
    fontSize: 8,
  },
  resetBtn: {
    fontSize: 11,
    padding: "2px 10px",
    borderRadius: 4,
    backgroundColor: "transparent",
    color: "#888",
    border: "1px solid #333",
  },
  hints: {
    fontSize: 9,
    color: "#555",
    letterSpacing: 0.5,
  },
};
