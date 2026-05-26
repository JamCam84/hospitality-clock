"use client";

/**
 * app/clock/[staffId]/page.tsx  —  Gamified Worker Clock UI
 *
 * Critical design decisions (production-safe):
 *   • Inline styles for ALL critical visual properties (shape, color, shadow).
 *     This avoids Tailwind CSS v4 purging of dynamically constructed class names.
 *   • Explicit width/height + border-radius:50% for the circular button (NOT
 *     `inset` shorthand, which breaks on some browsers/versions).
 *   • Animation keyframes live in globals.css; the class names are referenced
 *     as string literals here so Tailwind's scanner keeps them.
 *   • All Supabase clock-in/clock-out / GPS / reminder logic is 100% unchanged.
 */

import { use, useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
  shouldShowReminderModal,
  formatReminderTime,
  minutesLateForReminder,
  type ReminderSettings,
  type ReminderSessionFields,
} from "@/lib/reminder-utils";

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

type StaffMember = {
  id: string;
  first_name: string;
  last_name: string;
  role: string;
  branch: string;
};

type OpenSession = ReminderSessionFields & {
  clock_in_time: string;
};

type LocationResult = {
  latitude:           number | null;
  longitude:          number | null;
  accuracy:           number | null;
  location_status:    "granted" | "denied" | "unavailable";
  suspicious:         boolean;
  suspicious_reason:  "ok" | "permission_denied" | "location_unavailable" | "low_accuracy";
};

// ─────────────────────────────────────────────────────────────────────────────
// GAMIFICATION — MOODS (time-of-day aware)
// ─────────────────────────────────────────────────────────────────────────────

type Mood = {
  label:    string;
  emoji:    string;
  greeting: string;
  grad:     [string, string];   // CSS color pair for gradient
  ring:     string;             // rgba border colour for pulse rings
};

const MOODS: Mood[] = [
  { label: "Early Shift Hero",    emoji: "🌅",
    greeting: "Rising before the world — absolute respect.",
    grad: ["#f97316", "#fbbf24"], ring: "rgba(249,115,22,0.45)" },
  { label: "Morning Grinder",     emoji: "☕",
    greeting: "Coffee optional. Dedication mandatory.",
    grad: ["#f59e0b", "#fde047"], ring: "rgba(245,158,11,0.45)" },
  { label: "Lunch Escape Artist", emoji: "🥗",
    greeting: "The midday maestro has entered the building.",
    grad: ["#10b981", "#2dd4bf"], ring: "rgba(16,185,129,0.45)" },
  { label: "Afternoon Ace",       emoji: "⚡",
    greeting: "Second half? You OWN the second half.",
    grad: ["#3b82f6", "#22d3ee"], ring: "rgba(59,130,246,0.45)" },
  { label: "Overtime Warrior",    emoji: "🔥",
    greeting: "They asked for extra — you delivered.",
    grad: ["#f43f5e", "#fb923c"], ring: "rgba(244,63,94,0.45)" },
  { label: "Night Owl",           emoji: "🦉",
    greeting: "When the world sleeps, legends work.",
    grad: ["#7c3aed", "#a855f7"], ring: "rgba(139,92,246,0.45)" },
];

const MOOD_HOURS: readonly number[][] = [
  [5,6,7,8], [9,10,11], [12,13], [14,15,16,17], [18,19,20,21], [22,23,0,1,2,3,4],
];

function getMood(): Mood {
  const h   = new Date().getHours();
  const idx = MOOD_HOURS.findIndex((hrs) => hrs.includes(h));
  return MOODS[idx >= 0 ? idx : 3];
}

// ─────────────────────────────────────────────────────────────────────────────
// COPY
// ─────────────────────────────────────────────────────────────────────────────

const PRECLOCK_MSGS: readonly string[] = [
  "Ready to be today's MVP? 🏆",
  "The team is counting on you. LFG! 💪",
  "Your guests are waiting. Time to shine ✨",
  "Another day to be unreasonably good at this 🎯",
  "Plot twist: you're the best one here 🎭",
  "Making hospitality look easy since day one 😎",
  "The shift doesn't start until you do 🚀",
  "They genuinely cannot do it without you 👑",
];

const WORKING_MSGS: readonly { maxH: number; msg: string }[] = [
  { maxH: 0.5, msg: "Warming up the engines 🚀" },
  { maxH: 1.5, msg: "Just finding that flow state 🌊" },
  { maxH: 2.5, msg: "Locked in. Nothing stops you now 🔒" },
  { maxH: 4,   msg: "Halfway through — absolutely crushing it 💪" },
  { maxH: 5.5, msg: "Deep in the zone. Pure respect 🎯" },
  { maxH: 7,   msg: "Almost legendary — final stretch! 🏆" },
  { maxH: 99,  msg: "Full shift warrior. Absolute unit 🔥" },
];

const CLOCKOUT_QUIPS: readonly string[] = [
  "Absolute legend. Rest up — you've earned it! 🏆",
  "Another day dominated. Go sleep 💤",
  "The guests will be talking about tonight 🌟",
  "That shift? Totally carried 🎯",
  "You showed up. You delivered. Enough said 💪",
];

type Badge = { id: string; emoji: string; label: string; desc: string };

const BADGES: readonly Badge[] = [
  { id: "timing",  emoji: "⏱️", label: "Perfect Timing",    desc: "Clocked in right on the dot" },
  { id: "streak",  emoji: "🔥", label: "7-Day Streak",       desc: "7 consecutive shifts — a machine" },
  { id: "early",   emoji: "🐦", label: "Early Bird",         desc: "First one through the door today" },
  { id: "weekend", emoji: "⚔️", label: "Weekend Warrior",    desc: "Working while others sleep in" },
  { id: "boss",    emoji: "☕", label: "Break Boss",          desc: "Perfectly paced rest periods" },
  { id: "night",   emoji: "🦉", label: "Night Owl",          desc: "Late shift, zero complaints" },
  { id: "clean",   emoji: "✅", label: "No Late Clock-ins",  desc: "Always on time this month" },
];

// Mock gamification constants — wire to real DB when backend is ready
const MOCK_STREAK  = 7;
const MOCK_LEVEL   = 5;
const MOCK_XP      = 1240;
const MOCK_XP_MAX  = 2000;
const XP_PER_SHIFT = 75;
const SHIFT_HOURS  = 8;
const HOURLY_RATE  = 85;   // ZAR

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

const ACCURACY_THRESHOLD_METRES = 100;

function getLocation(): Promise<LocationResult> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve({ latitude: null, longitude: null, accuracy: null,
        location_status: "unavailable", suspicious: true,
        suspicious_reason: "location_unavailable" });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      ({ coords: { latitude, longitude, accuracy } }) => {
        const low = accuracy > ACCURACY_THRESHOLD_METRES;
        resolve({ latitude, longitude, accuracy, location_status: "granted",
          suspicious: low, suspicious_reason: low ? "low_accuracy" : "ok" });
      },
      (err) => {
        const denied = err.code === 1;
        resolve({ latitude: null, longitude: null, accuracy: null,
          location_status: denied ? "denied" : "unavailable", suspicious: true,
          suspicious_reason: denied ? "permission_denied" : "location_unavailable" });
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
    );
  });
}

function formatHHMM(date: Date): string {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatDuration(ms: number): string {
  const m = Math.floor(ms / 60_000);
  const h = Math.floor(m / 60);
  return h === 0 ? `${m}m` : `${h}h ${String(m % 60).padStart(2, "0")}m`;
}

function pickRandom<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function getWorkingMsg(ms: number): string {
  const h = ms / 3_600_000;
  return (WORKING_MSGS.find((c) => h < c.maxH) ?? WORKING_MSGS.at(-1)!).msg;
}

function vibrate(pattern: number | number[]): void {
  try {
    (navigator as Navigator & { vibrate?: (p: number | number[]) => void })
      .vibrate?.(pattern);
  } catch { /* ignore */ }
}

// ─────────────────────────────────────────────────────────────────────────────
// CSS helpers — inline gradient / shadow builders
// ─────────────────────────────────────────────────────────────────────────────

function moodGrad([a, b]: [string, string]): string {
  return `linear-gradient(135deg, ${a}, ${b})`;
}

function glowShadow(color: string, intensity = 1): string {
  const a = Math.round(0.35 * intensity * 100) / 100;
  return `0 0 28px 4px rgba(${color},${a}), 0 10px 40px rgba(0,0,0,0.60)`;
}

const GREEN_RGB  = "16,185,129";
const RED_RGB    = "244,63,94";

// ─────────────────────────────────────────────────────────────────────────────
// CANVAS CONFETTI
// ─────────────────────────────────────────────────────────────────────────────

type BurstFn = (ox: number, oy: number) => void;

function ConfettiCanvas({ burstRef }: { burstRef: React.MutableRefObject<BurstFn | null> }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef   = useRef<number>(0);

  const burst = useCallback<BurstFn>((ox, oy) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;

    const COLORS = [
      "#f59e0b","#10b981","#3b82f6","#ec4899","#8b5cf6",
      "#f97316","#06b6d4","#a3e635","#fb923c","#34d399",
    ];

    function makeParticles(n: number, speedMult: number) {
      return Array.from({ length: n }, () => {
        const angle = Math.random() * Math.PI * 2;
        const speed = (Math.random() * 20 + 9) * speedMult;
        return {
          x: ox, y: oy,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - 14 * speedMult,
          color: COLORS[Math.floor(Math.random() * COLORS.length)],
          w: Math.random() * 12 + 5,
          h: Math.random() * 6  + 2,
          rot:  Math.random() * Math.PI * 2,
          spin: (Math.random() - 0.5) * 0.38,
          g:    0.44,
          alpha: 1,
          fade: 0.012 + Math.random() * 0.01,
        };
      });
    }

    let particles = makeParticles(100, 1);
    let wave2Added = false;
    cancelAnimationFrame(animRef.current);
    let frame = 0;

    function draw() {
      frame++;
      if (frame === 18 && !wave2Added) {
        particles = [...particles, ...makeParticles(45, 0.7)];
        wave2Added = true;
      }
      ctx!.clearRect(0, 0, canvas!.width, canvas!.height);
      let alive = false;
      for (const p of particles) {
        p.x  += p.vx;  p.y  += p.vy;
        p.vy += p.g;   p.vx *= 0.988;
        p.rot   += p.spin;
        p.alpha -= p.fade;
        if (p.alpha <= 0) continue;
        alive = true;
        ctx!.save();
        ctx!.globalAlpha = p.alpha;
        ctx!.translate(p.x, p.y);
        ctx!.rotate(p.rot);
        ctx!.fillStyle = p.color;
        ctx!.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx!.restore();
      }
      if (alive) animRef.current = requestAnimationFrame(draw);
      else ctx!.clearRect(0, 0, canvas!.width, canvas!.height);
    }
    draw();
  }, []);

  useEffect(() => { burstRef.current = burst; }, [burst, burstRef]);

  return (
    <canvas
      ref={canvasRef}
      style={{ position: "fixed", inset: 0, width: "100%", height: "100%",
               pointerEvents: "none", zIndex: 55 }}
      aria-hidden
    />
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// FLOATING AMBIENT ORBS — pure CSS animation (class names are static strings)
// ─────────────────────────────────────────────────────────────────────────────

function FloatingOrbs({ mood }: { mood: Mood }) {
  const [a, b] = mood.grad;
  return (
    <div style={{ position: "fixed", inset: 0, overflow: "hidden", pointerEvents: "none" }}
         aria-hidden>
      <div
        className="animate-orb-a"
        style={{
          position: "absolute", top: -176, left: -128,
          width: 420, height: 420, borderRadius: "50%",
          background: `radial-gradient(circle, ${a}33, ${b}11)`,
          filter: "blur(60px)", willChange: "transform",
        }}
      />
      <div
        className="animate-orb-b"
        style={{
          position: "absolute", top: "30%", right: -144,
          width: 340, height: 340, borderRadius: "50%",
          background: "radial-gradient(circle, #7c3aed33, #6366f111)",
          filter: "blur(60px)", willChange: "transform",
        }}
      />
      <div
        className="animate-orb-c"
        style={{
          position: "absolute", bottom: -112, left: "25%",
          width: 380, height: 380, borderRadius: "50%",
          background: "radial-gradient(circle, #1e40af22, #0891b211)",
          filter: "blur(60px)", willChange: "transform",
        }}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SVG PROGRESS RING
// ─────────────────────────────────────────────────────────────────────────────

function ProgressRing({ ms, size = 240 }: { ms: number; size?: number }) {
  const stroke = 8;
  const cx     = size / 2;
  const cy     = size / 2;
  const r      = cx - stroke - 4;
  const circ   = 2 * Math.PI * r;
  const pct    = Math.min(ms / (SHIFT_HOURS * 3_600_000), 1);
  const offset = circ * (1 - pct);
  const arc    = pct < 0.50 ? "#10b981" : pct < 0.85 ? "#f59e0b" : "#f43f5e";

  const ticks = Array.from({ length: SHIFT_HOURS }, (_, i) => {
    const frac  = i / SHIFT_HOURS;
    const angle = frac * 2 * Math.PI - Math.PI / 2;
    const ir = r - 6;
    const or = r + 5;
    return {
      x1: cx + ir * Math.cos(angle), y1: cy + ir * Math.sin(angle),
      x2: cx + or * Math.cos(angle), y2: cy + or * Math.sin(angle),
      lit: frac < pct,
    };
  });

  return (
    <svg
      width={size} height={size}
      style={{
        position: "absolute", inset: 0,
        transform: "rotate(-90deg)",
        pointerEvents: "none", willChange: "transform",
      }}
      aria-hidden
    >
      <circle cx={cx} cy={cy} r={r}
        fill="none" stroke="rgba(255,255,255,0.055)" strokeWidth={stroke} />
      <circle cx={cx} cy={cy} r={r}
        fill="none" stroke={arc} strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={circ}
        strokeDashoffset={offset}
        style={{
          transition: "stroke-dashoffset 1.5s cubic-bezier(0.4,0,0.2,1), stroke 0.8s ease",
          filter: pct > 0.01 ? `drop-shadow(0 0 6px ${arc})` : "none",
        }}
      />
      {ticks.map((t, i) => (
        <line key={i}
          x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2}
          stroke={t.lit ? arc : "rgba(255,255,255,0.10)"}
          strokeWidth={t.lit ? 2.5 : 1.5}
          strokeLinecap="round"
          style={{ transition: "stroke 0.8s ease, stroke-width 0.4s ease" }}
        />
      ))}
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// THE GAMIFIED CLOCK BUTTON
// Circular, 198 × 198 px, explicit inline styles for shape + colour + shadow.
// Ripple fires from exact pointer position. Haptic via navigator.vibrate().
// ─────────────────────────────────────────────────────────────────────────────

type Ripple = { x: number; y: number; id: number };

type ClockButtonProps = {
  clockedIn:  boolean;
  busy:       boolean;
  workedMs:   number;
  mood:       Mood;
  onClick:    () => void;
  btnRef:     React.RefObject<HTMLButtonElement | null>;
};

function ClockButton({ clockedIn, busy, workedMs, mood, onClick, btnRef }: ClockButtonProps) {
  const [ripples,   setRipples]   = useState<Ripple[]>([]);
  const [glowPulse, setGlowPulse] = useState(false);
  const SIZE = 198;

  // Animate glow on mount so it pulses immediately
  useEffect(() => {
    const t = setTimeout(() => setGlowPulse(true), 300);
    return () => clearTimeout(t);
  }, []);

  function handlePointerDown(e: React.PointerEvent<HTMLButtonElement>) {
    if (busy) return;
    vibrate(clockedIn ? [12, 60, 18] : [10]);
    const rect = e.currentTarget.getBoundingClientRect();
    const id   = Date.now() + Math.random();
    setRipples((r) => [...r, { x: e.clientX - rect.left, y: e.clientY - rect.top, id }]);
    setTimeout(() => setRipples((r) => r.filter((rp) => rp.id !== id)), 750);
  }

  const btnBg     = clockedIn
    ? "linear-gradient(135deg, #f43f5e, #ef4444, #f43f5e)"
    : moodGrad(mood.grad);
  const shadowRgb = clockedIn ? RED_RGB : GREEN_RGB;
  const btnShadow = glowPulse ? glowShadow(shadowRgb, 1) : glowShadow(shadowRgb, 0.5);

  const label = busy
    ? (clockedIn ? "Clocking out…" : "Clocking in…")
    : (clockedIn ? "Clock Out"      : "Clock In");

  return (
    <div style={{ position: "relative", width: 240, height: 240,
                  display: "flex", alignItems: "center", justifyContent: "center" }}>

      {/* ── SVG progress ring ── */}
      <ProgressRing ms={workedMs} size={240} />

      {/* ── Pulse rings when on shift ── */}
      {clockedIn && !busy && (
        <>
          <div className="animate-ring-1" style={{
            position: "absolute", width: SIZE + 32, height: SIZE + 32,
            borderRadius: "50%", border: `1.5px solid ${mood.ring}`,
            willChange: "transform, opacity",
          }} />
          <div className="animate-ring-2" style={{
            position: "absolute", width: SIZE + 32, height: SIZE + 32,
            borderRadius: "50%", border: `1.5px solid ${mood.ring}`,
            willChange: "transform, opacity",
          }} />
          <div className="animate-ring-3" style={{
            position: "absolute", width: SIZE + 32, height: SIZE + 32,
            borderRadius: "50%", border: `1.5px solid ${mood.ring}`,
            willChange: "transform, opacity",
          }} />
        </>
      )}

      {/* ── THE BUTTON ── */}
      <button
        ref={btnRef}
        onPointerDown={handlePointerDown}
        onClick={busy ? undefined : onClick}
        disabled={busy}
        aria-label={label}
        style={{
          width: SIZE,
          height: SIZE,
          borderRadius: "50%",
          border: "none",
          background: btnBg,
          boxShadow: btnShadow,
          cursor: busy ? "wait" : "pointer",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
          position: "relative",
          overflow: "hidden",
          userSelect: "none",
          WebkitTapHighlightColor: "transparent",
          touchAction: "manipulation",
          willChange: "transform",
          transition: "transform 0.1s ease-out, box-shadow 0.6s ease-in-out",
          opacity: busy ? 0.6 : 1,
        } as React.CSSProperties}
        onMouseDown={(e) => { (e.currentTarget as HTMLButtonElement).style.transform = "scale(0.90)"; }}
        onMouseUp={(e) => { (e.currentTarget as HTMLButtonElement).style.transform = "scale(1)"; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.transform = "scale(1)"; }}
        onTouchStart={(e) => { (e.currentTarget as HTMLButtonElement).style.transform = "scale(0.90)"; }}
        onTouchEnd={(e) => { (e.currentTarget as HTMLButtonElement).style.transform = "scale(1)"; }}
      >
        {/* Top-half gloss */}
        <div style={{
          position: "absolute", top: 0, left: 0, right: 0, height: "50%",
          borderRadius: "50% 50% 0 0",
          background: "linear-gradient(to bottom, rgba(255,255,255,0.22), transparent)",
          pointerEvents: "none",
        }} />

        {/* Ripples */}
        {ripples.map((rp) => (
          <span
            key={rp.id}
            className="animate-ripple"
            style={{
              position: "absolute", width: 20, height: 20,
              borderRadius: "50%",
              background: "rgba(255,255,255,0.30)",
              left: rp.x - 10, top: rp.y - 10,
              pointerEvents: "none",
              willChange: "transform, opacity",
            }}
          />
        ))}

        {/* Icon */}
        <div style={{ position: "relative", zIndex: 10 }}>
          {busy ? (
            <svg className="animate-spin" style={{ width: 40, height: 40, color: "rgba(255,255,255,0.8)" }}
              fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" d="M4 4v5h5M20 20v-5h-5" />
              <path strokeLinecap="round" d="M4 9a9 9 0 0114.13-3.36M20 15A9 9 0 015.87 18.36" />
            </svg>
          ) : clockedIn ? (
            <svg style={{ width: 44, height: 44, color: "white" }} viewBox="0 0 24 24" fill="currentColor">
              <rect x="5"  y="4" width="4" height="16" rx="1.5" />
              <rect x="15" y="4" width="4" height="16" rx="1.5" />
            </svg>
          ) : (
            <svg style={{ width: 48, height: 48, color: "white" }} viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5.14v14l11-7-11-7z" />
            </svg>
          )}
        </div>

        {/* Label */}
        <span style={{
          position: "relative", zIndex: 10,
          color: "white", fontWeight: 900, fontSize: 18,
          letterSpacing: "0.04em", lineHeight: 1, fontFamily: "inherit",
        }}>
          {label}
        </span>

        {/* Sub-label: time worked */}
        {clockedIn && !busy && workedMs > 60_000 && (
          <span style={{
            position: "relative", zIndex: 10,
            color: "rgba(255,255,255,0.55)", fontSize: 12,
            fontWeight: 700, fontFamily: "inherit",
          }}>
            {formatDuration(workedMs)}
          </span>
        )}
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// FULL-SCREEN SUCCESS OVERLAY  (1.9 s auto-dismiss)
// ─────────────────────────────────────────────────────────────────────────────

type SuccessKind = "clockin" | "clockout";

function SuccessOverlay({ kind, onDone }: { kind: SuccessKind; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 1950);
    return () => clearTimeout(t);
  }, [onDone]);

  const isIn = kind === "clockin";
  return (
    <div
      className="animate-success"
      style={{
        position: "fixed", inset: 0, zIndex: 50,
        display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
        background: isIn
          ? "linear-gradient(to bottom, #064e3b, #0f172a)"
          : "linear-gradient(to bottom, #2e1065, #0f172a)",
        pointerEvents: "none", userSelect: "none",
        willChange: "opacity",
      }}
    >
      <span className="animate-emoji" style={{ fontSize: 96, display: "block", willChange: "transform" }}>
        {isIn ? "🎉" : "👋"}
      </span>
      <p style={{ color: "white", fontSize: 26, fontWeight: 900,
                  letterSpacing: "-0.02em", marginTop: 8, textAlign: "center" }}>
        {isIn ? "You're on the clock!" : "See you next time!"}
      </p>
      <p style={{ color: "rgba(255,255,255,0.45)", fontSize: 14, marginTop: 8 }}>
        {isIn ? "Go make today epic ⚡" : "Rest up — you've earned it 💤"}
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ACHIEVEMENT TOAST  (drops from top, shimmer + drain bar)
// ─────────────────────────────────────────────────────────────────────────────

function AchievementToast({ badge, onDone }: { badge: Badge; onDone: () => void }) {
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    const t1 = setTimeout(() => setLeaving(true), 3000);
    const t2 = setTimeout(onDone, 3400);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [onDone]);

  return (
    <div
      className={leaving ? "animate-toast-out" : "animate-toast-in"}
      style={{
        position: "fixed", top: 12, left: 0, right: 0,
        zIndex: 50, display: "flex", justifyContent: "center",
        willChange: "transform, opacity",
      }}
    >
      <div style={{
        position: "relative", width: 320, borderRadius: 20,
        background: "rgba(15,23,42,0.97)",
        backdropFilter: "blur(20px)",
        border: "1px solid rgba(255,255,255,0.10)",
        boxShadow: "0 20px 60px rgba(0,0,0,0.7)",
        padding: "12px 16px",
        display: "flex", alignItems: "center", gap: 12,
        overflow: "hidden",
      }}>
        <div className="animate-shimmer" style={{
          position: "absolute", inset: 0, pointerEvents: "none",
        }} />
        <span style={{ fontSize: 24, position: "relative", zIndex: 1 }}>{badge.emoji}</span>
        <div style={{ position: "relative", zIndex: 1, minWidth: 0 }}>
          <p style={{ color: "#a78bfa", fontSize: 10, fontWeight: 900,
                      textTransform: "uppercase", letterSpacing: "0.1em", margin: 0 }}>
            Badge Unlocked
          </p>
          <p style={{ color: "white", fontWeight: 900, fontSize: 14,
                      lineHeight: 1.2, margin: "2px 0 0" }}>
            {badge.label}
          </p>
          <p style={{ color: "#64748b", fontSize: 12, margin: "1px 0 0",
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {badge.desc}
          </p>
        </div>
        {/* Countdown drain bar */}
        <div style={{
          position: "absolute", bottom: 0, left: 0, height: 3, borderRadius: 2,
          background: "linear-gradient(90deg, #8b5cf6, #a78bfa)",
          animation: "bar-fill 3.1s linear both reverse",
        }} />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CLOCK-OUT SUMMARY CARD  (slides up from bottom)
// ─────────────────────────────────────────────────────────────────────────────

function ShiftSummaryCard({
  ms, mood, name, onClose,
}: { ms: number; mood: Mood; name: string; onClose: () => void }) {
  const hours     = ms / 3_600_000;
  const badge     = pickRandom(BADGES);
  const quip      = pickRandom(CLOCKOUT_QUIPS);
  const earnings  = (hours * HOURLY_RATE).toFixed(2);
  const xpEarned  = Math.round(XP_PER_SHIFT + hours * 7);
  const firstName = name.split(" ")[0] ?? name;
  const newXP     = Math.min(MOCK_XP + xpEarned, MOCK_XP_MAX);
  const [a, b]    = mood.grad;

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, []);

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 50,
      display: "flex", alignItems: "flex-end", justifyContent: "center",
    }}>
      {/* Backdrop */}
      <div style={{
        position: "absolute", inset: 0,
        background: "rgba(0,0,0,0.72)",
        backdropFilter: "blur(6px)",
      }} onClick={onClose} />

      {/* Card */}
      <div
        className="animate-slide-up"
        style={{
          position: "relative", width: "100%", maxWidth: 440,
          borderRadius: "24px 24px 0 0",
          background: "#0f172a",
          border: "1px solid rgba(255,255,255,0.08)",
          borderBottom: "none",
          boxShadow: "0 -20px 80px rgba(0,0,0,0.8)",
          overflow: "hidden",
          willChange: "transform",
        }}
      >
        {/* Mood glow blob */}
        <div style={{
          position: "absolute", top: -140, right: -96,
          width: 288, height: 288, borderRadius: "50%",
          background: `radial-gradient(circle, ${a}38, ${b}18)`,
          filter: "blur(40px)", pointerEvents: "none",
        }} />

        <div style={{ padding: "32px 24px 40px", position: "relative" }}>
          {/* Header */}
          <div style={{ textAlign: "center", marginBottom: 28 }}>
            <div style={{ fontSize: 64, lineHeight: 1, marginBottom: 12 }}>🎉</div>
            <h2 style={{ color: "white", fontSize: 24, fontWeight: 900,
                         letterSpacing: "-0.02em", margin: 0 }}>
              Shift complete!
            </h2>
            <p style={{ color: "#64748b", fontSize: 14, margin: "6px 0 0" }}>
              {firstName}, {quip}
            </p>
          </div>

          {/* Stat grid */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
            <StatTile label="Hours worked" val={formatDuration(ms)}    colour="#ffffff" />
            <StatTile label="XP earned"    val={`+${xpEarned}`}        colour="#a78bfa" />
            <div style={{ gridColumn: "1 / -1" }}>
              <StatTile label="Est. earnings" val={`R ${earnings}`}     colour="#34d399"
                        note="Ask your manager for the exact figure" />
            </div>
          </div>

          {/* Badge */}
          <div style={{
            position: "relative", borderRadius: 16, overflow: "hidden",
            background: "rgba(139,92,246,0.10)",
            border: "1px solid rgba(139,92,246,0.20)",
            padding: "12px 16px",
            display: "flex", alignItems: "center", gap: 12, marginBottom: 20,
          }}>
            <div className="animate-shimmer" style={{
              position: "absolute", inset: 0, pointerEvents: "none",
            }} />
            <span style={{ fontSize: 28, position: "relative", zIndex: 1 }}>{badge.emoji}</span>
            <div style={{ position: "relative", zIndex: 1 }}>
              <p style={{ color: "#a78bfa", fontSize: 10, fontWeight: 900,
                          textTransform: "uppercase", letterSpacing: "0.1em", margin: 0 }}>
                Badge Unlocked
              </p>
              <p style={{ color: "white", fontWeight: 900, fontSize: 14,
                          lineHeight: 1.2, margin: "2px 0 0" }}>{badge.label}</p>
              <p style={{ color: "#64748b", fontSize: 12, margin: "1px 0 0" }}>{badge.desc}</p>
            </div>
          </div>

          {/* XP bar */}
          <div style={{
            display: "flex", alignItems: "center", gap: 12,
            background: "rgba(255,255,255,0.04)", borderRadius: 12,
            padding: "10px 16px", marginBottom: 24,
          }}>
            <span style={{ color: "#a78bfa", fontSize: 11, fontWeight: 900,
                           width: 32, flexShrink: 0 }}>Lv.{MOCK_LEVEL}</span>
            <div style={{
              flex: 1, height: 6, background: "rgba(255,255,255,0.08)",
              borderRadius: 999, overflow: "hidden",
            }}>
              <div
                className="animate-bar-fill"
                style={{
                  height: "100%", borderRadius: 999,
                  background: "linear-gradient(90deg, #7c3aed, #a855f7)",
                  width: `${(newXP / MOCK_XP_MAX) * 100}%`,
                }}
              />
            </div>
            <span style={{ color: "#475569", fontSize: 11, flexShrink: 0,
                           fontVariantNumeric: "tabular-nums" }}>
              {newXP}/{MOCK_XP_MAX}
            </span>
          </div>

          {/* CTA */}
          <button
            onClick={onClose}
            style={{
              width: "100%", padding: "16px 0", borderRadius: 16,
              border: "none", fontWeight: 900, color: "white", fontSize: 17,
              background: moodGrad(mood.grad),
              cursor: "pointer", boxShadow: "0 8px 30px rgba(0,0,0,0.4)",
              transition: "transform 0.1s",
              fontFamily: "inherit",
            }}
            onMouseDown={(e) => { (e.currentTarget as HTMLButtonElement).style.transform = "scale(0.97)"; }}
            onMouseUp={(e) => { (e.currentTarget as HTMLButtonElement).style.transform = "scale(1)"; }}
          >
            Nice work! 💪
          </button>
        </div>
      </div>
    </div>
  );
}

function StatTile({
  label, val, colour, note,
}: { label: string; val: string; colour: string; note?: string }) {
  return (
    <div style={{
      background: "rgba(255,255,255,0.04)",
      border: "1px solid rgba(255,255,255,0.05)",
      borderRadius: 16, padding: 16, textAlign: "center",
    }}>
      <p style={{ color: "#475569", fontSize: 10, fontWeight: 900,
                  textTransform: "uppercase", letterSpacing: "0.1em", margin: "0 0 4px" }}>
        {label}
      </p>
      <p style={{ color: colour, fontSize: 24, fontWeight: 900, margin: 0 }}>{val}</p>
      {note && <p style={{ color: "#334155", fontSize: 10, margin: "2px 0 0" }}>{note}</p>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// XP PROGRESS BAR
// ─────────────────────────────────────────────────────────────────────────────

function XPBar({ level, xp, max }: { level: number; xp: number; max: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <span style={{ fontSize: 11, fontWeight: 900, color: "#a78bfa",
                     width: 32, flexShrink: 0 }}>
        Lv.{level}
      </span>
      <div style={{
        flex: 1, height: 6,
        background: "rgba(255,255,255,0.07)", borderRadius: 999, overflow: "hidden",
      }}>
        <div
          className="animate-bar-fill"
          style={{
            height: "100%", borderRadius: 999,
            background: "linear-gradient(90deg, #7c3aed, #a855f7, #e879f9)",
            width: `${(xp / max) * 100}%`,
            willChange: "width",
          }}
        />
      </div>
      <span style={{ fontSize: 11, color: "#475569", flexShrink: 0,
                     fontVariantNumeric: "tabular-nums" }}>
        {xp}/{max}
      </span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ROTATING MOTIVATIONAL MESSAGE
// ─────────────────────────────────────────────────────────────────────────────

function MotivMessage({ clockedIn, workedMs }: { clockedIn: boolean; workedMs: number }) {
  const [msgKey, setMsgKey] = useState(0);
  const [text,   setText]   = useState<string>("");
  const lastMsg             = useRef<string>("");

  useEffect(() => {
    const next = clockedIn ? getWorkingMsg(workedMs) : pickRandom(PRECLOCK_MSGS);
    setText(next);
    lastMsg.current = next;
    setMsgKey((k) => k + 1);
    const id = setInterval(() => {
      const t = clockedIn ? getWorkingMsg(workedMs) : pickRandom(PRECLOCK_MSGS);
      setText(t);
      setMsgKey((k) => k + 1);
    }, 9_000);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clockedIn]);

  useEffect(() => {
    if (!clockedIn) return;
    const next = getWorkingMsg(workedMs);
    if (next !== lastMsg.current) {
      lastMsg.current = next;
      setText(next);
      setMsgKey((k) => k + 1);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workedMs]);

  return (
    <p
      key={msgKey}
      className="animate-fade-up"
      style={{
        color: "#64748b", fontSize: 13, textAlign: "center",
        padding: "0 24px", minHeight: 20,
      }}
    >
      {text}
    </p>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// LIVE WORKING INDICATOR — animated pulse dots + live timer
// ─────────────────────────────────────────────────────────────────────────────

function WorkingIndicator({ workedMs }: { workedMs: number }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "center",
      gap: 10, padding: "10px 20px", borderRadius: 999,
      background: "rgba(16,185,129,0.08)",
      border: "1px solid rgba(16,185,129,0.20)",
    }}>
      {/* Animated dots */}
      <div style={{ display: "flex", gap: 4 }}>
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="animate-pulse"
            style={{
              width: 6, height: 6, borderRadius: "50%",
              background: "#10b981",
              animationDelay: `${i * 0.18}s`,
              opacity: 0.85,
            }}
          />
        ))}
      </div>
      <span style={{ color: "#10b981", fontWeight: 900, fontSize: 14, letterSpacing: "0.01em" }}>
        {formatDuration(workedMs)} on shift
      </span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN PAGE COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

export default function ClockPage({ params }: { params: Promise<{ staffId: string }> }) {
  const { staffId } = use(params);

  // ── Core state (unchanged from original) ─────────────────────────────────
  const [staff,             setStaff]             = useState<StaffMember | null>(null);
  const [openSession,       setOpenSession]       = useState<OpenSession | null>(null);
  const [reminderSettings,  setReminderSettings]  = useState<ReminderSettings | null>(null);
  const [isLoading,         setIsLoading]         = useState(true);
  const [isGettingLocation, setIsGettingLocation] = useState(false);
  const [isWorking,         setIsWorking]         = useState(false);
  const [message,           setMessage]           = useState("");
  const [isError,           setIsError]           = useState(false);
  const [showModal,         setShowModal]         = useState(false);
  const [locallyDismissed,  setLocallyDismissed]  = useState(false);
  const [isRespondingToReminder, setIsRespondingToReminder] = useState(false);
  const reminderIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Gamification state ────────────────────────────────────────────────────
  const mood             = getMood();
  const [now,            setNow]          = useState(new Date());
  const [workedMs,       setWorkedMs]     = useState(0);
  const [success,        setSuccess]      = useState<SuccessKind | null>(null);
  const [showSummary,    setShowSummary]  = useState(false);
  const [summaryMs,      setSummaryMs]    = useState(0);
  const [badge,          setBadge]        = useState<Badge | null>(null);

  const confettiBurstRef = useRef<BurstFn | null>(null);
  const btnRef           = useRef<HTMLButtonElement>(null);

  // ── Live clock (1 s tick) ────────────────────────────────────────────────
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1_000);
    return () => clearInterval(id);
  }, []);

  // ── Worked-ms ticker (30 s refresh) ──────────────────────────────────────
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!openSession?.clock_in_time) { setWorkedMs(0); return; }
    const update = () =>
      setWorkedMs(Date.now() - new Date(openSession.clock_in_time).getTime());
    update();
    const id = setInterval(update, 30_000);
    return () => clearInterval(id);
  }, [openSession]);

  // ── Scroll lock when overlays open ───────────────────────────────────────
  useEffect(() => {
    if (success !== null) document.body.style.overflow = "hidden";
    else                  document.body.style.overflow = "";
    return () => { document.body.style.overflow = ""; };
  }, [success]);

  // ── loadData (unchanged) ─────────────────────────────────────────────────
  async function loadData() {
    setIsLoading(true);
    setMessage("");

    const [staffRes, settingsRes] = await Promise.all([
      supabase.from("staff")
        .select("id, first_name, last_name, role, branch")
        .eq("id", staffId).single(),
      supabase.from("payroll_settings")
        .select("reminder_enabled, reminder_time")
        .limit(1).maybeSingle(),
    ]);

    if (staffRes.error || !staffRes.data) {
      setMessage("Staff member not found. Please check your link.");
      setIsError(true);
      setIsLoading(false);
      return;
    }
    setStaff(staffRes.data as StaffMember);

    const raw = settingsRes.data;
    setReminderSettings(raw
      ? { reminder_enabled: raw.reminder_enabled ?? false,
          reminder_time: raw.reminder_time ? String(raw.reminder_time).slice(0, 5) : null }
      : { reminder_enabled: false, reminder_time: null });

    const { data: sessionData } = await supabase
      .from("clock_sessions")
      .select(
        "id, clock_in_time, " +
        "clock_out_reminder_sent_at, clock_out_reminder_response, " +
        "clock_out_reminder_acknowledged_at"
      )
      .eq("staff_id", staffId)
      .is("clock_out_time", null)
      .order("clock_in_time", { ascending: false })
      .limit(1).maybeSingle();

    setOpenSession(sessionData as OpenSession | null);
    setIsLoading(false);
  }

  useEffect(() => {
    if (!staffId?.trim()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMessage("Invalid staff link."); setIsError(true); setIsLoading(false); return;
    }
    loadData();
  }, [staffId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Reminder interval (unchanged) ────────────────────────────────────────
  useEffect(() => {
    function check() {
      setShowModal(
        shouldShowReminderModal({ settings: reminderSettings, openSession, locallyDismissed })
      );
    }
    check();
    reminderIntervalRef.current = setInterval(check, 60_000);
    return () => { if (reminderIntervalRef.current) clearInterval(reminderIntervalRef.current); };
  }, [reminderSettings, openSession, locallyDismissed]);

  // ── Clock In (unchanged logic + gamification) ────────────────────────────
  async function handleClockIn() {
    if (!staff) return;
    setIsWorking(true);
    setMessage("");
    setIsGettingLocation(true);
    const loc = await getLocation();
    setIsGettingLocation(false);

    const { error } = await supabase.from("clock_sessions").insert([{
      staff_id:                   staff.id,
      work_date:                  new Date().toISOString().slice(0, 10),
      clock_in_time:              new Date().toISOString(),
      status:                     "clocked_in",
      clock_in_latitude:          loc.latitude,
      clock_in_longitude:         loc.longitude,
      clock_in_accuracy:          loc.accuracy,
      clock_in_location_status:   loc.location_status,
      suspicious_clock_in:        loc.suspicious,
      suspicious_clock_in_reason: loc.suspicious_reason,
    }]);

    if (error) {
      setMessage("Could not clock in. Please try again."); setIsError(true);
    } else {
      setIsError(false);
      setLocallyDismissed(false);
      const rect = btnRef.current?.getBoundingClientRect();
      const ox = rect ? rect.left + rect.width  / 2 : window.innerWidth  / 2;
      const oy = rect ? rect.top  + rect.height / 2 : window.innerHeight * 0.44;
      setTimeout(() => confettiBurstRef.current?.(ox, oy), 80);
      setSuccess("clockin");
      setTimeout(() => setBadge(pickRandom(BADGES)), 2100);
      await loadData();
    }
    setIsWorking(false);
  }

  // ── performClockOut (unchanged) ──────────────────────────────────────────
  async function performClockOut(reminderResponse?: "clocked_out"): Promise<boolean> {
    if (!openSession) {
      setMessage("You are not currently clocked in."); setIsError(true); return false;
    }
    setIsGettingLocation(true);
    const loc = await getLocation();
    setIsGettingLocation(false);

    const payload: Record<string, unknown> = {
      clock_out_time:              new Date().toISOString(),
      status:                      "clocked_out",
      clock_out_latitude:          loc.latitude,
      clock_out_longitude:         loc.longitude,
      clock_out_accuracy:          loc.accuracy,
      clock_out_location_status:   loc.location_status,
      suspicious_clock_out:        loc.suspicious,
      suspicious_clock_out_reason: loc.suspicious_reason,
    };
    if (reminderResponse) {
      payload.clock_out_reminder_response        = reminderResponse;
      payload.clock_out_reminder_acknowledged_at = new Date().toISOString();
    }
    const { error } = await supabase.from("clock_sessions")
      .update(payload).eq("id", openSession.id);
    if (error) { setMessage("Could not clock out. Please try again."); setIsError(true); return false; }
    return true;
  }

  // ── Clock Out (unchanged logic + summary card) ───────────────────────────
  async function handleClockOut() {
    setIsWorking(true);
    setMessage("");
    const captured = workedMs;
    const ok = await performClockOut();
    if (ok) {
      setIsError(false);
      setShowModal(false);
      setSummaryMs(captured);
      setSuccess("clockout");
      await loadData();
      setTimeout(() => setShowSummary(true), 2000);
    }
    setIsWorking(false);
  }

  // ── Reminder: Still Working (unchanged) ──────────────────────────────────
  async function handleStillWorking() {
    if (!openSession) return;
    setIsRespondingToReminder(true);
    const ts = new Date().toISOString();
    await supabase.from("clock_sessions").update({
      clock_out_reminder_response:        "still_working",
      clock_out_reminder_acknowledged_at: ts,
      clock_out_reminder_sent_at:         openSession.clock_out_reminder_sent_at ?? ts,
    }).eq("id", openSession.id);
    setOpenSession((p) =>
      p ? { ...p, clock_out_reminder_response: "still_working",
            clock_out_reminder_acknowledged_at: ts } : p);
    setLocallyDismissed(true);
    setShowModal(false);
    setIsRespondingToReminder(false);
  }

  // ── Reminder: Clock Out (unchanged) ──────────────────────────────────────
  async function handleClockOutFromReminder() {
    setIsRespondingToReminder(true);
    setMessage("");
    const captured = workedMs;
    const ok = await performClockOut("clocked_out");
    if (ok) {
      setIsError(false);
      setShowModal(false);
      setSummaryMs(captured);
      await loadData();
      setTimeout(() => setShowSummary(true), 400);
    }
    setIsRespondingToReminder(false);
  }

  // ── Derived ──────────────────────────────────────────────────────────────
  const isBusy    = isWorking || isGettingLocation;
  const clockedIn = !!openSession;
  const staffName = staff ? `${staff.first_name} ${staff.last_name}` : "";
  const initials  = staff
    ? `${staff.first_name[0] ?? ""}${staff.last_name[0] ?? ""}`.toUpperCase()
    : "?";
  const minutesLate = reminderSettings?.reminder_time
    ? minutesLateForReminder(reminderSettings.reminder_time)
    : 0;

  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const [gradA, gradB] = mood.grad;

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════════════════
  return (
    <div style={{
      minHeight: "100vh",
      background: "#020617",
      color: "white",
      position: "relative",
      overflowX: "hidden",
      userSelect: "none",
    } as React.CSSProperties}>

      {/* ── Ambient background ── */}
      <FloatingOrbs mood={mood} />

      {/* ── Canvas confetti ── */}
      <ConfettiCanvas burstRef={confettiBurstRef} />

      {/* ── Success overlay ── */}
      {success && <SuccessOverlay kind={success} onDone={() => setSuccess(null)} />}

      {/* ── Achievement toast ── */}
      {badge && <AchievementToast badge={badge} onDone={() => setBadge(null)} />}

      {/* ── Shift summary ── */}
      {showSummary && staff && (
        <ShiftSummaryCard
          ms={summaryMs}
          mood={mood}
          name={staffName}
          onClose={() => setShowSummary(false)}
        />
      )}

      {/* ══════════════════════ MAIN CONTENT ══════════════════════ */}
      <main style={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        maxWidth: 400,
        margin: "0 auto",
        padding: "0 20px 48px",
        minHeight: "100vh",
      }}>

        {/* ── HEADER ── */}
        <header
          className="animate-fade-up stagger-1"
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            paddingTop: 48,
            paddingBottom: 20,
          }}
        >
          {/* Avatar + name */}
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{
              width: 48, height: 48, borderRadius: "50%",
              background: `linear-gradient(135deg, ${gradA}, ${gradB})`,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontWeight: 900, fontSize: 14, color: "white",
              boxShadow: clockedIn
                ? `0 0 0 2px rgba(16,185,129,0.5), 0 0 0 4px rgba(16,185,129,0.12)`
                : "none",
              transition: "box-shadow 0.4s ease",
            }}>
              {isLoading ? "…" : initials}
            </div>
            {!isLoading && staff ? (
              <div>
                <p style={{ color: "white", fontWeight: 900, fontSize: 14,
                            lineHeight: 1.2, margin: 0 }}>
                  {staff.first_name}
                </p>
                <p style={{ color: "#475569", fontSize: 12, margin: "2px 0 0" }}>
                  {[staff.role, staff.branch].filter(Boolean).join(" · ")}
                </p>
              </div>
            ) : (
              <div className="animate-pulse" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ height: 14, width: 80, background: "rgba(255,255,255,0.08)", borderRadius: 6 }} />
                <div style={{ height: 12, width: 56, background: "rgba(255,255,255,0.05)", borderRadius: 6 }} />
              </div>
            )}
          </div>

          {/* Mood badge */}
          <div style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "6px 12px", borderRadius: 999,
            background: `linear-gradient(135deg, ${gradA}, ${gradB})`,
            fontSize: 12, fontWeight: 900, color: "white",
            boxShadow: `0 4px 20px ${gradA}55`,
          }}>
            {mood.emoji}
            <span style={{ display: "none" }}>{mood.label}</span>
          </div>
        </header>

        {/* ── STREAK + LEVEL CHIPS ── */}
        {!isLoading && staff && (
          <div
            className="animate-fade-up stagger-2"
            style={{
              width: "100%",
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              gap: 8,
              marginBottom: 12,
            }}
          >
            {/* Streak chip */}
            <div style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "4px 12px", borderRadius: 999,
              background: "rgba(245,158,11,0.10)",
              border: "1px solid rgba(245,158,11,0.20)",
              color: "#fbbf24", fontSize: 12, fontWeight: 900,
            }}>
              🔥 {MOCK_STREAK}-day streak
            </div>
            {/* Level chip */}
            <div style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "4px 12px", borderRadius: 999,
              background: "rgba(139,92,246,0.10)",
              border: "1px solid rgba(139,92,246,0.20)",
              color: "#a78bfa", fontSize: 12, fontWeight: 900,
            }}>
              ⚡ Level {MOCK_LEVEL}
            </div>
            {/* On shift pill */}
            {clockedIn && (
              <div style={{
                marginLeft: "auto",
                display: "flex", alignItems: "center", gap: 6,
                padding: "4px 12px", borderRadius: 999,
                background: "rgba(16,185,129,0.10)",
                border: "1px solid rgba(16,185,129,0.20)",
                color: "#10b981", fontSize: 12, fontWeight: 900,
              }}>
                <span className="animate-pulse" style={{
                  width: 6, height: 6, borderRadius: "50%", background: "#10b981",
                  display: "inline-block",
                }} />
                On shift
              </div>
            )}
          </div>
        )}

        {/* ── MOOD GREETING ── */}
        {!isLoading && staff && (
          <p
            className="animate-fade-up stagger-2"
            style={{ width: "100%", color: "#475569", fontSize: 12,
                     marginBottom: 24, margin: "0 0 24px" }}
          >
            {mood.emoji} {mood.greeting}
          </p>
        )}

        {/* ── LOADING SKELETON ── */}
        {isLoading && (
          <div className="animate-pulse"
            style={{ display: "flex", flexDirection: "column",
                     alignItems: "center", gap: 20, padding: "64px 0", width: "100%" }}>
            <div style={{ width: 240, height: 240, borderRadius: "50%",
                          background: "rgba(255,255,255,0.05)" }} />
            <div style={{ height: 16, width: 208, background: "rgba(255,255,255,0.08)", borderRadius: 8 }} />
            <div style={{ height: 12, width: 144, background: "rgba(255,255,255,0.05)", borderRadius: 8 }} />
          </div>
        )}

        {/* ── NOT FOUND ── */}
        {!isLoading && !staff && (
          <div
            className="animate-scale-in"
            style={{
              marginTop: 40, width: "100%",
              background: "rgba(127,29,29,0.40)",
              border: "1px solid rgba(185,28,28,0.25)",
              borderRadius: 20, padding: "32px 20px",
              textAlign: "center",
            }}
          >
            <p style={{ fontSize: 48, margin: "0 0 12px" }}>😕</p>
            <p style={{ color: "#f87171", fontWeight: 700, margin: 0 }}>{message}</p>
            <p style={{ color: "rgba(185,28,28,0.60)", fontSize: 14, margin: "4px 0 0" }}>
              Ask your manager to resend the correct link.
            </p>
          </div>
        )}

        {/* ══════════════════ CLOCK SECTION ══════════════════ */}
        {!isLoading && staff && (
          <>
            {/* Live HH:MM with blinking colon */}
            <div className="animate-fade-up stagger-3" style={{ marginBottom: 4 }}>
              <span style={{
                fontSize: 40, fontWeight: 900,
                letterSpacing: "0.08em",
                fontVariantNumeric: "tabular-nums",
                color: "white",
              }}>
                {hh}
                <span className="animate-blink">:</span>
                {mm}
              </span>
            </div>

            {/* Status line */}
            <p
              className="animate-fade-up stagger-3"
              style={{ color: "#475569", fontSize: 12, marginBottom: 28, textAlign: "center" }}
            >
              {clockedIn
                ? `Clocked in at ${formatHHMM(new Date(openSession!.clock_in_time))}`
                : "Ready to start your shift"}
            </p>

            {/* ── THE BIG CIRCULAR BUTTON ── */}
            <div className="animate-fade-up stagger-4" style={{ marginBottom: 16 }}>
              <ClockButton
                clockedIn={clockedIn}
                busy={isBusy}
                workedMs={workedMs}
                mood={mood}
                onClick={clockedIn ? handleClockOut : handleClockIn}
                btnRef={btnRef}
              />
            </div>

            {/* ── LIVE WORKING INDICATOR ── */}
            {clockedIn && workedMs > 0 && (
              <div className="animate-scale-in" style={{ marginBottom: 16 }}>
                <WorkingIndicator workedMs={workedMs} />
              </div>
            )}

            {/* ── ROTATING QUOTE ── */}
            <div className="animate-fade-up stagger-4" style={{ marginBottom: 24 }}>
              <MotivMessage clockedIn={clockedIn} workedMs={workedMs} />
            </div>

            {/* ── ERROR / INFO MESSAGE ── */}
            {message && !isGettingLocation && (
              <div
                className="animate-scale-in"
                style={{
                  width: "100%",
                  fontSize: 14, fontWeight: 700, textAlign: "center",
                  borderRadius: 16, padding: "12px 16px", marginBottom: 20,
                  background: isError
                    ? "rgba(127,29,29,0.50)" : "rgba(6,78,59,0.50)",
                  border: `1px solid ${isError
                    ? "rgba(185,28,28,0.25)" : "rgba(5,150,105,0.25)"}`,
                  color: isError ? "#f87171" : "#34d399",
                }}
              >
                {message}
              </div>
            )}

            {/* ── XP BAR ── */}
            <div
              className="animate-fade-up stagger-5"
              style={{ width: "100%", marginBottom: 20 }}
            >
              <XPBar level={MOCK_LEVEL} xp={MOCK_XP} max={MOCK_XP_MAX} />
            </div>

            {/* ── SHIFT PROGRESS CARD (while clocked in) ── */}
            {clockedIn && workedMs > 0 && (
              <div
                className="animate-scale-in"
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  background: "rgba(255,255,255,0.03)",
                  border: "1px solid rgba(255,255,255,0.06)",
                  borderRadius: 20,
                  padding: "14px 16px",
                  marginBottom: 20,
                }}
              >
                <div>
                  <p style={{ color: "#475569", fontSize: 10, fontWeight: 900,
                              textTransform: "uppercase", letterSpacing: "0.1em", margin: 0 }}>
                    Shift progress
                  </p>
                  <p style={{ color: "white", fontWeight: 900, fontSize: 20,
                              lineHeight: 1.2, margin: "4px 0 0" }}>
                    {formatDuration(workedMs)}
                    <span style={{ color: "#475569", fontSize: 14, fontWeight: 600 }}>
                      {" "}/ {SHIFT_HOURS}h
                    </span>
                  </p>
                </div>
                <div style={{ textAlign: "right" }}>
                  <p style={{ color: "#475569", fontSize: 10, fontWeight: 900,
                              textTransform: "uppercase", letterSpacing: "0.1em", margin: 0 }}>
                    Est. so far
                  </p>
                  <p style={{ color: "#34d399", fontWeight: 900, fontSize: 20,
                              lineHeight: 1.2, margin: "4px 0 0" }}>
                    R {Math.round((workedMs / 3_600_000) * HOURLY_RATE)}
                  </p>
                </div>
              </div>
            )}

            {/* ── BADGES ROW ── */}
            <div
              className="animate-fade-up stagger-5"
              style={{ width: "100%", marginBottom: 20 }}
            >
              <p style={{ color: "#334155", fontSize: 10, fontWeight: 900,
                          textTransform: "uppercase", letterSpacing: "0.1em",
                          margin: "0 0 8px" }}>
                Your Badges
              </p>
              <div style={{
                display: "flex", gap: 8,
                overflowX: "auto", paddingBottom: 4,
                msOverflowStyle: "none", scrollbarWidth: "none",
              } as React.CSSProperties}>
                {BADGES.map((b) => (
                  <div
                    key={b.id}
                    title={b.desc}
                    style={{
                      flexShrink: 0,
                      display: "flex", alignItems: "center", gap: 6,
                      padding: "6px 12px", borderRadius: 999,
                      background: "rgba(255,255,255,0.04)",
                      border: "1px solid rgba(255,255,255,0.07)",
                      fontSize: 12, color: "#94a3b8",
                      whiteSpace: "nowrap", cursor: "default",
                    }}
                  >
                    {b.emoji}
                    <span style={{ fontWeight: 700, color: "#cbd5e1" }}>{b.label}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* ── VIEW MY TIMES LINK ── */}
            <a
              href={`/clock/${staffId}/times`}
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 10,
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.07)",
                borderRadius: 20,
                padding: "16px 0",
                color: "#64748b",
                fontSize: 14,
                fontWeight: 700,
                textDecoration: "none",
                touchAction: "manipulation",
                transition: "background 0.15s, color 0.15s, border-color 0.15s",
              }}
              onMouseEnter={(e) => {
                const el = e.currentTarget as HTMLAnchorElement;
                el.style.background = "rgba(255,255,255,0.10)";
                el.style.color = "white";
              }}
              onMouseLeave={(e) => {
                const el = e.currentTarget as HTMLAnchorElement;
                el.style.background = "rgba(255,255,255,0.04)";
                el.style.color = "#64748b";
              }}
            >
              <svg style={{ width: 16, height: 16 }} fill="none" stroke="currentColor"
                strokeWidth={2} viewBox="0 0 24 24">
                <rect x="3" y="4" width="18" height="18" rx="2" />
                <path strokeLinecap="round" d="M16 2v4M8 2v4M3 10h18" />
              </svg>
              View My Times
            </a>
          </>
        )}
      </main>

      {/* ═══════════════════════════════════════════════════════════
          CLOCK-OUT REMINDER MODAL
          Logic 100% unchanged — styled for dark theme.
          ═══════════════════════════════════════════════════════════ */}
      {showModal && reminderSettings?.reminder_time && (
        <>
          <div style={{
            position: "fixed", inset: 0, zIndex: 40,
            background: "rgba(0,0,0,0.70)", backdropFilter: "blur(6px)",
          }} />
          <div
            className="animate-slide-up"
            style={{
              position: "fixed", bottom: 0, left: 0, right: 0,
              zIndex: 50, margin: "0 auto", maxWidth: 440,
            }}
            role="dialog" aria-modal="true" aria-labelledby="reminder-title"
          >
            <div style={{
              background: "#0f172a",
              border: "1px solid rgba(255,255,255,0.08)",
              borderBottom: "none",
              borderRadius: "24px 24px 0 0",
              boxShadow: "0 -20px 80px rgba(0,0,0,0.8)",
              padding: "32px 24px 40px",
            }}>
              {/* Pulsing clock icon */}
              <div style={{ display: "flex", justifyContent: "center", marginBottom: 20 }}>
                <div style={{ position: "relative", display: "flex",
                              alignItems: "center", justifyContent: "center" }}>
                  <div className="animate-ring-1" style={{
                    position: "absolute", width: 80, height: 80, borderRadius: "50%",
                    border: "1.5px solid rgba(245,158,11,0.30)",
                  }} />
                  <div style={{
                    width: 64, height: 64, borderRadius: "50%",
                    background: "rgba(245,158,11,0.12)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}>
                    <svg style={{ width: 32, height: 32, color: "#fbbf24" }}
                      fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <circle cx="12" cy="12" r="9" />
                      <path strokeLinecap="round" d="M12 7v5l3.5 2" />
                    </svg>
                  </div>
                </div>
              </div>

              <h2 id="reminder-title"
                style={{ color: "white", fontSize: 24, fontWeight: 900,
                         textAlign: "center", margin: "0 0 8px" }}>
                Still on shift?
              </h2>
              <p style={{ color: "#64748b", textAlign: "center", fontSize: 14,
                          margin: "0 0 24px", lineHeight: 1.5 }}>
                It&apos;s past{" "}
                <span style={{ fontWeight: 700, color: "white" }}>
                  {formatReminderTime(reminderSettings.reminder_time)}
                </span>
                {minutesLate > 0 && (
                  <> — {minutesLate} min{minutesLate !== 1 ? "s" : ""} ago</>
                )}.
              </p>

              <div style={{ height: 1, background: "rgba(255,255,255,0.05)", margin: "0 0 24px" }} />

              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <button
                  onClick={handleStillWorking}
                  disabled={isRespondingToReminder}
                  style={{
                    width: "100%", padding: "16px 0", borderRadius: 16,
                    border: "none", fontWeight: 900, color: "white", fontSize: 18,
                    background: "#059669", cursor: isRespondingToReminder ? "wait" : "pointer",
                    opacity: isRespondingToReminder ? 0.6 : 1, fontFamily: "inherit",
                    touchAction: "manipulation",
                  }}
                >
                  {isRespondingToReminder ? "Saving…" : "✅ Still Working"}
                </button>
                <button
                  onClick={handleClockOutFromReminder}
                  disabled={isRespondingToReminder || isGettingLocation}
                  style={{
                    width: "100%", padding: "16px 0", borderRadius: 16,
                    background: "rgba(255,255,255,0.05)",
                    border: "1px solid rgba(244,63,94,0.25)",
                    fontWeight: 900, color: "#fb7185", fontSize: 18,
                    cursor: (isRespondingToReminder || isGettingLocation) ? "wait" : "pointer",
                    opacity: (isRespondingToReminder || isGettingLocation) ? 0.6 : 1,
                    fontFamily: "inherit", touchAction: "manipulation",
                  }}
                >
                  {isGettingLocation ? "Getting location…" :
                   isRespondingToReminder ? "Clocking out…" : "🕐 Clock Out"}
                </button>
              </div>

              <p style={{ fontSize: 11, color: "#1e293b", textAlign: "center", margin: "16px 0 0" }}>
                This reminder is automatic. You can always clock back in.
              </p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
