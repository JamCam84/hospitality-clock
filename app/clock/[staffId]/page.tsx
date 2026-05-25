"use client";

/**
 * app/clock/[staffId]/page.tsx  —  Gamified Clock UI
 *
 * Designed to make staff WANT to clock in.
 * Feels like Duolingo + Uber Driver + modern SaaS — premium, addictive, smooth.
 *
 * Animation stack: CSS @keyframes + Web Animations API + canvas confetti.
 * (Framer Motion is listed as a dependency in package.json but the registry is
 * blocked in this environment — equivalent quality achieved with CSS.)
 *
 * ─── CRITICAL: ALL SUPABASE LOGIC IS PRESERVED EXACTLY ────────────────────
 * Only the render layer has changed. Every field written to clock_sessions
 * (clock_in_time, location fields, reminder fields, etc.) is identical to the
 * original. The existing reminder modal interval logic is also unchanged.
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
// TYPES (unchanged from original)
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
  latitude:            number | null;
  longitude:           number | null;
  accuracy:            number | null;
  location_status:     "granted" | "denied" | "unavailable";
  suspicious:          boolean;
  suspicious_reason:   "ok" | "permission_denied" | "location_unavailable" | "low_accuracy";
};

// ─────────────────────────────────────────────────────────────────────────────
// GAMIFICATION CONTENT
// ─────────────────────────────────────────────────────────────────────────────

type Mood = {
  label:    string;
  emoji:    string;
  greeting: string;
  color:    string;  // hex for canvas / inline use
  ring:     string;  // CSS ring colour class
  glow:     string;  // glow animation class
  from:     string;  // tailwind gradient-from
  to:       string;  // tailwind gradient-to
  bg:       string;  // success overlay bg
};

const MOODS: readonly Mood[] = [
  {
    label: "Early Shift Hero",     emoji: "🌅",
    greeting: "Rising before the world — absolute legend.",
    color: "#f97316", ring: "border-orange-500/40", glow: "animate-glow-green",
    from: "from-orange-500", to: "to-amber-400", bg: "from-orange-900",
    hours: [5,6,7,8],
  } as Mood & { hours: number[] },
  {
    label: "Morning Grinder",      emoji: "☕",
    greeting: "Coffee optional. Dedication mandatory.",
    color: "#f59e0b", ring: "border-amber-500/40", glow: "animate-glow-green",
    from: "from-amber-500", to: "to-yellow-400", bg: "from-amber-900",
    hours: [9,10,11],
  } as Mood & { hours: number[] },
  {
    label: "Lunch Escape Artist",  emoji: "🥗",
    greeting: "The midday maestro has entered the building.",
    color: "#10b981", ring: "border-emerald-500/40", glow: "animate-glow-green",
    from: "from-emerald-500", to: "to-teal-400", bg: "from-emerald-900",
    hours: [12,13],
  } as Mood & { hours: number[] },
  {
    label: "Afternoon Ace",        emoji: "⚡",
    greeting: "Second half? You OWN the second half.",
    color: "#3b82f6", ring: "border-blue-500/40", glow: "animate-glow-green",
    from: "from-blue-500", to: "to-cyan-400", bg: "from-blue-900",
    hours: [14,15,16,17],
  } as Mood & { hours: number[] },
  {
    label: "Overtime Warrior",     emoji: "🔥",
    greeting: "They asked for extra. You delivered.",
    color: "#f43f5e", ring: "border-rose-500/40", glow: "animate-glow-red",
    from: "from-rose-500", to: "to-orange-400", bg: "from-rose-900",
    hours: [18,19,20,21],
  } as Mood & { hours: number[] },
  {
    label: "Night Owl",            emoji: "🦉",
    greeting: "When the world sleeps, legends work.",
    color: "#8b5cf6", ring: "border-violet-500/40", glow: "animate-glow-green",
    from: "from-violet-600", to: "to-purple-500", bg: "from-violet-900",
    hours: [22,23,0,1,2,3,4],
  } as Mood & { hours: number[] },
] as unknown as Mood[];

// We need to access hours on the mood objects at runtime:
const MOOD_HOURS: number[][] = [
  [5,6,7,8], [9,10,11], [12,13], [14,15,16,17], [18,19,20,21], [22,23,0,1,2,3,4],
];

function getMood(): Mood {
  const h = new Date().getHours();
  const idx = MOOD_HOURS.findIndex((hrs) => hrs.includes(h));
  return MOODS[idx >= 0 ? idx : 3];
}

// Messages shown before clocking in
const PRECLOCK_MESSAGES: readonly string[] = [
  "Ready to be today's MVP? 🏆",
  "The team is counting on you. Let's go! 💪",
  "Your guests are waiting. Time to shine ✨",
  "Another day to be unreasonably good at this 🎯",
  "Plot twist: you're the best one here 🎭",
  "Making hospitality look easy since day one 😎",
  "The shift doesn't start until you do 🚀",
  "Go on — you know they can't do it without you 👑",
];

// Messages shown while clocked in (changes based on hours)
const SHIFT_COMMENTS: readonly { maxH: number; msg: string }[] = [
  { maxH: 1,   msg: "Just getting warmed up! 🌱" },
  { maxH: 2,   msg: "Finding that flow state 🌊" },
  { maxH: 3,   msg: "You're locked in now 🔒" },
  { maxH: 4.5, msg: "Halfway through — crushing it 💪" },
  { maxH: 6,   msg: "Deep in the zone. Respect 🎯" },
  { maxH: 7.5, msg: "Almost legendary — keep going 🏆" },
  { maxH: 99,  msg: "Full shift warrior. Absolute unit 🔥" },
];

// Clock-out celebration messages
const CLOCKOUT_QUIPS: readonly string[] = [
  "Absolute legend. See you soon! 🏆",
  "Another day dominated. Go rest — you've earned it 💤",
  "The guests will be talking about tonight 🌟",
  "That shift? Totally carried 🎯",
  "You showed up. You delivered. Enough said 💪",
  "Hospitality GOAT confirmed 🐐",
  "Smashed it from start to finish 🔥",
];

type Badge = { id: string; emoji: string; label: string; desc: string };

const BADGES: readonly Badge[] = [
  { id: "timing",  emoji: "⏱️", label: "Perfect Timing",    desc: "Clocked in right on the dot" },
  { id: "streak",  emoji: "🔥", label: "7-Day Streak",       desc: "7 days straight — a machine" },
  { id: "early",   emoji: "🐦", label: "Early Bird",         desc: "First one through the door today" },
  { id: "weekend", emoji: "⚔️", label: "Weekend Warrior",    desc: "Working while others sleep in" },
  { id: "boss",    emoji: "☕", label: "Break Boss",          desc: "Perfectly paced rest periods" },
  { id: "night",   emoji: "🦉", label: "Night Owl",          desc: "Late shift legend, zero complaints" },
  { id: "clean",   emoji: "✅", label: "No Late Clock-ins",  desc: "Always on time this month" },
];

// Mock gamification state — replace with real DB values when gamification backend is ready
const MOCK_STREAK    = 7;
const MOCK_LEVEL     = 5;
const MOCK_XP        = 1240;
const MOCK_XP_MAX    = 2000;
const XP_PER_SHIFT   = 75;
const SHIFT_HOURS    = 8;      // target shift length for the progress ring
const HOURLY_RATE    = 85;     // ZAR placeholder shown with disclaimer

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

const ACCURACY_THRESHOLD_METRES = 100;

/** Unchanged from original */
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
  const totalMin = Math.floor(ms / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h === 0 ? `${m}m` : `${h}h ${String(m).padStart(2, "0")}m`;
}

function pickRandom<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function getShiftComment(ms: number): string {
  const h = ms / 3_600_000;
  return (SHIFT_COMMENTS.find((c) => h < c.maxH) ?? SHIFT_COMMENTS.at(-1)!).msg;
}

// ─────────────────────────────────────────────────────────────────────────────
// SUB-COMPONENT: Canvas Confetti
// Fires from the button's screen position. No library needed.
// ─────────────────────────────────────────────────────────────────────────────

type BurstFn = (originX: number, originY: number) => void;

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

    const COLORS = ["#f59e0b","#10b981","#3b82f6","#ec4899","#8b5cf6","#f97316","#06b6d4","#a3e635"];
    const N = 110;

    const particles = Array.from({ length: N }, () => {
      const angle = Math.random() * Math.PI * 2;
      const speed = Math.random() * 22 + 8;
      return {
        x:     ox,
        y:     oy,
        vx:    Math.cos(angle) * speed,
        vy:    Math.sin(angle) * speed - 12,   // bias upward
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
        w:     Math.random() * 11 + 5,
        h:     Math.random() * 6 + 2,
        rot:   Math.random() * Math.PI * 2,
        spin:  (Math.random() - 0.5) * 0.35,
        g:     0.42,
        alpha: 1,
        fade:  0.013 + Math.random() * 0.009,
      };
    });

    cancelAnimationFrame(animRef.current);

    function draw() {
      ctx!.clearRect(0, 0, canvas!.width, canvas!.height);
      let alive = false;
      for (const p of particles) {
        p.x  += p.vx;
        p.y  += p.vy;
        p.vy += p.g;
        p.vx *= 0.987;
        p.rot  += p.spin;
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
      className="fixed inset-0 pointer-events-none"
      style={{ zIndex: 60, width: "100%", height: "100%" }}
      aria-hidden
    />
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SUB-COMPONENT: Floating ambient orbs
// ─────────────────────────────────────────────────────────────────────────────

function FloatingOrbs({ mood }: { mood: Mood }) {
  return (
    <div className="fixed inset-0 overflow-hidden pointer-events-none" aria-hidden>
      <div
        className={`absolute -top-40 -left-28 w-96 h-96 rounded-full blur-3xl opacity-20
                    bg-gradient-to-br ${mood.from} ${mood.to} animate-orb-a`}
      />
      <div
        className="absolute top-1/3 -right-32 w-80 h-80 rounded-full blur-3xl opacity-12
                   bg-gradient-to-br from-violet-600 to-indigo-500 animate-orb-b"
      />
      <div
        className="absolute -bottom-24 left-1/3 w-80 h-80 rounded-full blur-3xl opacity-10
                   bg-gradient-to-br from-blue-700 to-cyan-600 animate-orb-c"
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SUB-COMPONENT: SVG progress ring with hour tick marks
// ─────────────────────────────────────────────────────────────────────────────

function ProgressRing({ ms, size = 232 }: { ms: number; size?: number }) {
  const stroke  = 7;
  const cx = size / 2;
  const cy = size / 2;
  const r  = cx - stroke - 2;
  const circum = 2 * Math.PI * r;
  const pct = Math.min(ms / (SHIFT_HOURS * 3_600_000), 1);
  const offset = circum * (1 - pct);
  const arcColor = pct < 0.5 ? "#10b981" : pct < 0.85 ? "#f59e0b" : "#f43f5e";

  // Hour tick marks (one per target shift hour)
  const ticks = Array.from({ length: SHIFT_HOURS }, (_, i) => {
    const frac  = i / SHIFT_HOURS;
    const angle = frac * 2 * Math.PI - Math.PI / 2;
    const inner = r - 6;
    const outer = r + 5;
    const done  = frac <= pct;
    return {
      x1: cx + inner * Math.cos(angle),
      y1: cy + inner * Math.sin(angle),
      x2: cx + outer * Math.cos(angle),
      y2: cy + outer * Math.sin(angle),
      done,
    };
  });

  return (
    <svg
      width={size} height={size}
      className="absolute inset-0 pointer-events-none"
      style={{ transform: "rotate(-90deg)" }}
      aria-hidden
    >
      {/* Track */}
      <circle cx={cx} cy={cy} r={r}
        fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={stroke} />
      {/* Progress arc — glowing */}
      <circle cx={cx} cy={cy} r={r}
        fill="none" stroke={arcColor} strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={circum} strokeDashoffset={offset}
        style={{
          transition: "stroke-dashoffset 1.4s cubic-bezier(0.4,0,0.2,1), stroke 0.8s ease",
          filter: pct > 0 ? `drop-shadow(0 0 5px ${arcColor})` : "none",
        }}
      />
      {/* Tick marks */}
      {ticks.map((t, i) => (
        <line key={i}
          x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2}
          stroke={t.done ? arcColor : "rgba(255,255,255,0.12)"}
          strokeWidth={t.done ? 2 : 1.5}
          strokeLinecap="round"
          style={{ transition: "stroke 0.8s ease" }}
        />
      ))}
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SUB-COMPONENT: THE BIG BUTTON
// ─────────────────────────────────────────────────────────────────────────────

type ClockButtonProps = {
  clockedIn:   boolean;
  busy:        boolean;
  workedMs:    number;
  mood:        Mood;
  onClick:     () => void;
  buttonRef:   React.RefObject<HTMLButtonElement | null>;
};

function ClockButton({ clockedIn, busy, workedMs, mood, onClick, buttonRef }: ClockButtonProps) {
  const [pressed, setPressed] = useState(false);

  function handlePress() {
    if (busy) return;
    setPressed(true);
    setTimeout(() => setPressed(false), 150);
    onClick();
  }

  const bgClass = clockedIn
    ? "from-rose-500 via-red-500 to-rose-600"
    : `${mood.from} ${mood.to}`;

  const glowClass = clockedIn ? "animate-glow-red" : "animate-glow-green";

  const label = busy
    ? clockedIn ? "Clocking out…" : "Clocking in…"
    : clockedIn ? "Clock Out"     : "Clock In";

  return (
    <div className="relative" style={{ width: 232, height: 232 }}>

      {/* Radiating pulse rings — only while clocked in and not busy */}
      {clockedIn && !busy && (
        <>
          <div
            className={`absolute inset-0 rounded-full border-2 ${mood.ring} animate-ring-1`}
            style={{ margin: "-14px" }}
          />
          <div
            className={`absolute inset-0 rounded-full border ${mood.ring} animate-ring-2`}
            style={{ margin: "-14px" }}
          />
          <div
            className={`absolute inset-0 rounded-full border ${mood.ring} animate-ring-3`}
            style={{ margin: "-14px" }}
          />
        </>
      )}

      {/* SVG progress ring */}
      <ProgressRing ms={workedMs} size={232} />

      {/* THE BUTTON — fills inner area leaving room for progress ring */}
      <button
        ref={buttonRef}
        onClick={handlePress}
        disabled={busy}
        aria-label={label}
        className={`absolute rounded-full flex flex-col items-center justify-center gap-1
                    select-none overflow-hidden
                    bg-gradient-to-br ${bgClass}
                    ${glowClass}
                    transition-transform duration-100
                    disabled:opacity-60 disabled:cursor-wait
                    ${pressed ? "scale-90" : "scale-100"}
                    active:scale-90`}
        style={{ inset: "18px" }}
      >
        {/* Top gloss */}
        <div className="absolute top-0 inset-x-0 h-1/2 rounded-full
                        bg-gradient-to-b from-white/20 to-transparent pointer-events-none" />

        {/* Icon */}
        <div className="relative z-10">
          {busy ? (
            <svg className="w-10 h-10 text-white/80 animate-spin" fill="none"
              stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" d="M4 4v5h5M20 20v-5h-5" />
              <path strokeLinecap="round" d="M4 9a9 9 0 0114.13-3.36M20 15A9 9 0 015.87 18.36" />
            </svg>
          ) : clockedIn ? (
            /* Pause / stop bars */
            <svg className="w-10 h-10 text-white" viewBox="0 0 24 24" fill="currentColor">
              <rect x="5"  y="4" width="4" height="16" rx="1.5" />
              <rect x="15" y="4" width="4" height="16" rx="1.5" />
            </svg>
          ) : (
            /* Play arrow */
            <svg className="w-11 h-11 text-white" viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5.14v14l11-7-11-7z" />
            </svg>
          )}
        </div>

        {/* Main label */}
        <span className="relative z-10 text-white font-black text-[17px] tracking-wide leading-none">
          {label}
        </span>

        {/* Sub-label: hours worked if on shift */}
        {clockedIn && !busy && workedMs > 60_000 && (
          <span className="relative z-10 text-white/60 text-xs font-medium">
            {formatDuration(workedMs)}
          </span>
        )}
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SUB-COMPONENT: Full-screen success overlay
// Auto-dismisses after ~1.8 s (matches the CSS animation duration)
// ─────────────────────────────────────────────────────────────────────────────

type SuccessKind = "clockin" | "clockout";

function SuccessOverlay({ kind, onDone }: { kind: SuccessKind; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 1850);
    return () => clearTimeout(t);
  }, [onDone]);

  const isIn = kind === "clockin";
  return (
    <div
      className={`fixed inset-0 z-50 flex flex-col items-center justify-center
                  bg-gradient-to-b pointer-events-none
                  ${isIn ? "from-emerald-950 to-slate-950" : "from-violet-950 to-slate-950"}
                  animate-success`}
    >
      <span className="text-8xl animate-emoji block mb-4">
        {isIn ? "🎉" : "👋"}
      </span>
      <p className="text-white text-2xl font-black tracking-tight">
        {isIn ? "You're on the clock!" : "See you next time!"}
      </p>
      <p className="text-white/50 text-sm mt-2">
        {isIn ? "Go make today epic ⚡" : "Rest up — you've earned it 💤"}
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SUB-COMPONENT: Achievement toast (drops from top)
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
      className={`fixed left-0 right-0 z-50 flex justify-center
                  ${leaving ? "animate-toast-out" : "animate-toast-in"}`}
      style={{ top: 16 }}
    >
      <div className="relative w-80 bg-slate-800/95 backdrop-blur-xl border border-white/10
                      rounded-2xl px-4 py-3 shadow-2xl flex items-center gap-3 overflow-hidden">
        {/* Shimmer */}
        <div className="absolute inset-0 animate-shimmer pointer-events-none" />
        <span className="text-2xl relative z-10">{badge.emoji}</span>
        <div className="relative z-10">
          <p className="text-violet-300 text-[10px] font-bold uppercase tracking-widest">
            Badge Unlocked
          </p>
          <p className="text-white font-bold text-sm leading-tight">{badge.label}</p>
          <p className="text-slate-400 text-xs">{badge.desc}</p>
        </div>
        {/* Timer bar */}
        <div className="absolute bottom-0 left-0 h-0.5 bg-violet-500 rounded-full w-full"
             style={{ animation: "bar-fill 3.1s linear both reverse", animationDirection: "reverse",
                      animationFillMode: "both" }} />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SUB-COMPONENT: Clock-out shift summary card (slides up)
// ─────────────────────────────────────────────────────────────────────────────

function ShiftSummaryCard({
  ms, mood, name, onClose,
}: {
  ms: number; mood: Mood; name: string; onClose: () => void;
}) {
  const hours       = ms / 3_600_000;
  const badge       = pickRandom(BADGES);
  const quip        = pickRandom(CLOCKOUT_QUIPS);
  const earnings    = (hours * HOURLY_RATE).toFixed(2);
  const xpEarned    = Math.round(XP_PER_SHIFT + hours * 7);
  const firstName   = name.split(" ")[0] ?? name;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      {/* Tap-outside to close */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />

      <div
        className="relative w-full max-w-sm rounded-t-3xl overflow-hidden
                   bg-slate-900 border-t border-x border-white/10 shadow-2xl
                   animate-slide-up"
      >
        {/* Mood-coloured gradient accent */}
        <div className={`absolute -top-32 -right-20 w-64 h-64 rounded-full blur-3xl opacity-25
                         bg-gradient-to-br ${mood.from} ${mood.to}`} />

        <div className="relative px-6 pt-8 pb-10">
          {/* Header */}
          <div className="text-center mb-7">
            <div className="text-6xl mb-3">🎉</div>
            <h2 className="text-2xl font-black text-white tracking-tight">
              Shift complete!
            </h2>
            <p className="text-slate-400 text-sm mt-1">
              {firstName}, {quip}
            </p>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 gap-3 mb-4">
            <SummaryTile label="Hours worked"  value={formatDuration(ms)}   colour="text-white" />
            <SummaryTile label="XP earned"     value={`+${xpEarned}`}       colour="text-violet-400" />
            <div className="col-span-2">
              <SummaryTile
                label="Est. earnings"
                value={`R ${earnings}`}
                colour="text-emerald-400"
                note="Ask your manager for the exact figure"
              />
            </div>
          </div>

          {/* Badge unlocked */}
          <div className="relative bg-violet-500/10 border border-violet-500/20
                          rounded-2xl px-4 py-3 flex items-center gap-3 mb-6 overflow-hidden">
            <div className="absolute inset-0 animate-shimmer pointer-events-none" />
            <span className="text-3xl relative z-10">{badge.emoji}</span>
            <div className="relative z-10">
              <p className="text-violet-300 text-[10px] font-bold uppercase tracking-widest">
                Badge Unlocked
              </p>
              <p className="text-white font-bold text-sm">{badge.label}</p>
              <p className="text-slate-400 text-xs">{badge.desc}</p>
            </div>
          </div>

          {/* XP gained animation */}
          <div className="bg-white/5 rounded-xl px-4 py-2 flex items-center gap-3 mb-5">
            <span className="text-violet-400 text-sm font-bold">Lv.{MOCK_LEVEL}</span>
            <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-violet-500 to-purple-400 rounded-full animate-bar-fill"
                style={{ width: `${Math.min(((MOCK_XP + xpEarned) / MOCK_XP_MAX) * 100, 100)}%` }}
              />
            </div>
            <span className="text-slate-500 text-xs">{MOCK_XP + xpEarned}/{MOCK_XP_MAX}</span>
          </div>

          <button
            onClick={onClose}
            className={`w-full py-4 rounded-2xl font-black text-white text-base
                        bg-gradient-to-r ${mood.from} ${mood.to}
                        active:scale-95 transition-transform duration-100 shadow-lg`}
          >
            Nice work! 💪
          </button>
        </div>
      </div>
    </div>
  );
}

function SummaryTile({
  label, value, colour, note,
}: { label: string; value: string; colour: string; note?: string }) {
  return (
    <div className="bg-white/5 border border-white/5 rounded-2xl p-4 text-center">
      <p className="text-slate-500 text-[10px] font-bold uppercase tracking-widest mb-1">
        {label}
      </p>
      <p className={`text-2xl font-black ${colour}`}>{value}</p>
      {note && <p className="text-slate-600 text-[10px] mt-0.5">{note}</p>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SUB-COMPONENT: XP progress bar
// ─────────────────────────────────────────────────────────────────────────────

function XPBar({ level, xp, max }: { level: number; xp: number; max: number }) {
  const pct = `${Math.min((xp / max) * 100, 100).toFixed(1)}%`;
  return (
    <div className="flex items-center gap-3">
      <span className="text-[11px] font-black text-violet-400 shrink-0">Lv.{level}</span>
      <div className="flex-1 h-1.5 bg-white/8 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full animate-bar-fill
                     bg-gradient-to-r from-violet-500 via-purple-400 to-fuchsia-400"
          style={{ width: pct }}
        />
      </div>
      <span className="text-[11px] text-slate-600 shrink-0">{xp}/{max} XP</span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SUB-COMPONENT: Rotating motivational message
// ─────────────────────────────────────────────────────────────────────────────

function MotivMessage({ clockedIn, workedMs }: { clockedIn: boolean; workedMs: number }) {
  const [key, setKey]   = useState(0);
  const [text, setText] = useState(() =>
    clockedIn ? getShiftComment(workedMs) : pickRandom(PRECLOCK_MESSAGES)
  );

  // Rotate every 9 s; also refresh immediately when clockedIn changes
  useEffect(() => {
    setText(clockedIn ? getShiftComment(workedMs) : pickRandom(PRECLOCK_MESSAGES));
    setKey((k) => k + 1);
    const id = setInterval(() => {
      setText(clockedIn ? getShiftComment(workedMs) : pickRandom(PRECLOCK_MESSAGES));
      setKey((k) => k + 1);
    }, 9_000);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clockedIn]);

  // Update comment when hours milestone crossed (without resetting rotation timer)
  useEffect(() => {
    if (clockedIn) {
      const next = getShiftComment(workedMs);
      if (next !== text) {
        setText(next);
        setKey((k) => k + 1);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workedMs, clockedIn]);

  return (
    <p key={key} className="text-slate-400 text-sm text-center animate-fade-up px-4">
      {text}
    </p>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN PAGE COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

export default function ClockPage({ params }: { params: Promise<{ staffId: string }> }) {
  const { staffId } = use(params);

  // ── Core state (identical to original) ───────────────────────────────────
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
  const [now,        setNow]        = useState(new Date());
  const [workedMs,   setWorkedMs]   = useState(0);
  const [success,    setSuccess]    = useState<SuccessKind | null>(null);
  const [showSummary,setShowSummary]= useState(false);
  const [summaryMs,  setSummaryMs]  = useState(0);
  const [badge,      setBadge]      = useState<Badge | null>(null);

  const confettiBurstRef  = useRef<BurstFn | null>(null);
  const buttonRef         = useRef<HTMLButtonElement>(null);

  // ── Live clock ticker (every second for HH:MM display) ───────────────────
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1_000);
    return () => clearInterval(id);
  }, []);

  // ── Worked-ms ticker (every 30 s to avoid excessive re-renders) ───────────
  useEffect(() => {
    if (!openSession?.clock_in_time) { setWorkedMs(0); return; }
    const update = () =>
      setWorkedMs(Date.now() - new Date(openSession.clock_in_time).getTime());
    update();
    const id = setInterval(update, 30_000);
    return () => clearInterval(id);
  }, [openSession]);

  // ─── Load data (unchanged) ────────────────────────────────────────────────
  async function loadData() {
    setIsLoading(true);
    setMessage("");

    const [staffRes, settingsRes] = await Promise.all([
      supabase.from("staff")
        .select("id, first_name, last_name, role, branch")
        .eq("id", staffId)
        .single(),
      supabase.from("payroll_settings")
        .select("reminder_enabled, reminder_time")
        .limit(1)
        .maybeSingle(),
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
      .limit(1)
      .maybeSingle();

    setOpenSession(sessionData as OpenSession | null);
    setIsLoading(false);
  }

  useEffect(() => {
    if (!staffId?.trim()) {
      setMessage("Invalid staff link.");
      setIsError(true);
      setIsLoading(false);
      return;
    }
    loadData();
  }, [staffId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Reminder modal interval (unchanged) ──────────────────────────────────
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

  // ─── Clock In (logic unchanged; gamification added after success) ─────────
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
      setMessage("Could not clock in. Please try again.");
      setIsError(true);
    } else {
      setIsError(false);
      setLocallyDismissed(false);
      // 🎉 Fire confetti from button position
      const rect = buttonRef.current?.getBoundingClientRect();
      const ox = rect ? rect.left + rect.width  / 2 : window.innerWidth  / 2;
      const oy = rect ? rect.top  + rect.height / 2 : window.innerHeight * 0.45;
      setTimeout(() => confettiBurstRef.current?.(ox, oy), 100);
      // Show success overlay
      setSuccess("clockin");
      // Show badge after overlay fades
      setTimeout(() => setBadge(pickRandom(BADGES)), 2000);
      await loadData();
    }
    setIsWorking(false);
  }

  // ─── Core clock-out (unchanged) ───────────────────────────────────────────
  async function performClockOut(reminderResponse?: "clocked_out"): Promise<boolean> {
    if (!openSession) {
      setMessage("You are not currently clocked in.");
      setIsError(true);
      return false;
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

    if (error) {
      setMessage("Could not clock out. Please try again.");
      setIsError(true);
      return false;
    }
    return true;
  }

  // ─── Clock Out (logic unchanged; summary card added on success) ───────────
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
      setTimeout(() => setShowSummary(true), 1900);
    }
    setIsWorking(false);
  }

  // ─── Reminder: Still Working (unchanged) ──────────────────────────────────
  async function handleStillWorking() {
    if (!openSession) return;
    setIsRespondingToReminder(true);
    const now = new Date().toISOString();
    await supabase.from("clock_sessions").update({
      clock_out_reminder_response:        "still_working",
      clock_out_reminder_acknowledged_at: now,
      clock_out_reminder_sent_at:         openSession.clock_out_reminder_sent_at ?? now,
    }).eq("id", openSession.id);
    setOpenSession((p) => p
      ? { ...p, clock_out_reminder_response: "still_working",
          clock_out_reminder_acknowledged_at: now }
      : p);
    setLocallyDismissed(true);
    setShowModal(false);
    setIsRespondingToReminder(false);
  }

  // ─── Reminder: Clock Out (unchanged) ─────────────────────────────────────
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

  // ─── Derived ──────────────────────────────────────────────────────────────
  const isBusy     = isWorking || isGettingLocation;
  const clockedIn  = !!openSession;
  const staffName  = staff ? `${staff.first_name} ${staff.last_name}` : "";
  const initials   = staff
    ? `${staff.first_name[0] ?? ""}${staff.last_name[0] ?? ""}`.toUpperCase()
    : "?";
  const minutesLate = reminderSettings?.reminder_time
    ? minutesLateForReminder(reminderSettings.reminder_time)
    : 0;

  // HH:MM with blinking colon
  const hh  = String(now.getHours()).padStart(2, "0");
  const mm  = String(now.getMinutes()).padStart(2, "0");

  // ─── RENDER ───────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-slate-950 text-white relative overflow-x-hidden">

      {/* Ambient orbs */}
      <FloatingOrbs mood={mood} />

      {/* Confetti canvas */}
      <ConfettiCanvas burstRef={confettiBurstRef} />

      {/* ── Success overlay (clock-in or clock-out) ── */}
      {success && (
        <SuccessOverlay kind={success} onDone={() => setSuccess(null)} />
      )}

      {/* ── Achievement toast ── */}
      {badge && <AchievementToast badge={badge} onDone={() => setBadge(null)} />}

      {/* ── Clock-out summary ── */}
      {showSummary && staff && (
        <ShiftSummaryCard
          ms={summaryMs}
          mood={mood}
          name={staffName}
          onClose={() => setShowSummary(false)}
        />
      )}

      {/* ══════════════════════════════════ MAIN CONTENT ══════════════════════════════════ */}
      <main className="relative flex flex-col items-center max-w-sm mx-auto px-5 min-h-screen">

        {/* ── HEADER ── */}
        <header className="w-full flex items-center justify-between pt-12 pb-5">
          {/* Avatar + name */}
          <div className="flex items-center gap-3">
            <div className="relative">
              {/* Pulsing ring when on shift */}
              {clockedIn && (
                <div className={`absolute -inset-1 rounded-full border-2 ${mood.ring}
                                 animate-ring-1`} />
              )}
              <div
                className={`relative w-12 h-12 rounded-full flex items-center justify-center
                             font-black text-sm text-white shadow-lg
                             bg-gradient-to-br ${mood.from} ${mood.to}`}
              >
                {isLoading ? "…" : initials}
              </div>
            </div>
            <div>
              {!isLoading && staff ? (
                <>
                  <p className="font-bold text-white text-sm leading-tight">{staff.first_name}</p>
                  <p className="text-slate-500 text-xs">
                    {[staff.role, staff.branch].filter(Boolean).join(" · ")}
                  </p>
                </>
              ) : (
                <div className="space-y-1.5">
                  <div className="h-3.5 w-20 bg-white/8 rounded animate-pulse" />
                  <div className="h-3 w-16 bg-white/5 rounded animate-pulse" />
                </div>
              )}
            </div>
          </div>

          {/* Mood badge */}
          <div
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold
                         text-white shadow-md bg-gradient-to-r ${mood.from} ${mood.to}`}
          >
            <span>{mood.emoji}</span>
            <span className="hidden sm:inline">{mood.label}</span>
          </div>
        </header>

        {/* ── STRIP: streak + level + status ── */}
        {!isLoading && staff && (
          <div className="w-full flex flex-wrap items-center gap-2 mb-3">
            <Chip icon="🔥" text={`${MOCK_STREAK}-day streak`} color="amber" />
            <Chip icon="⚡" text={`Level ${MOCK_LEVEL}`}         color="violet" />
            {clockedIn && (
              <div className="ml-auto flex items-center gap-1.5 px-3 py-1 rounded-full
                              bg-emerald-500/10 border border-emerald-500/20 text-xs
                              font-bold text-emerald-400">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                On shift
              </div>
            )}
          </div>
        )}

        {/* ── Mood greeting ── */}
        {!isLoading && staff && (
          <p className="w-full text-slate-500 text-xs mb-6">
            {mood.emoji} {mood.greeting}
          </p>
        )}

        {/* ── LOADING skeleton ── */}
        {isLoading && (
          <div className="flex flex-col items-center gap-4 py-16 w-full animate-pulse">
            <div className="w-56 h-56 rounded-full bg-white/5" />
            <div className="h-10 w-10 bg-white/8 rounded-full" />
            <div className="h-4 w-48 bg-white/8 rounded" />
            <div className="h-3 w-32 bg-white/5 rounded" />
          </div>
        )}

        {/* ── Not found ── */}
        {!isLoading && !staff && (
          <div className="mt-10 bg-red-950/50 border border-red-800/30 rounded-2xl
                          px-5 py-8 text-center w-full animate-scale-in">
            <p className="text-5xl mb-3">😕</p>
            <p className="text-red-400 font-bold">{message}</p>
            <p className="text-red-700/70 text-sm mt-1">
              Ask your manager to resend the correct link.
            </p>
          </div>
        )}

        {/* ══════════════════ CLOCK BUTTON SECTION ══════════════════ */}
        {!isLoading && staff && (
          <>
            {/* Live clock display */}
            <div className="flex items-center justify-center mb-2">
              <span className="text-4xl font-black text-white tracking-widest tabular-nums">
                {hh}
                <span className="animate-tick">:</span>
                {mm}
              </span>
            </div>

            {/* Status line */}
            <p className="text-slate-500 text-xs mb-6 text-center">
              {clockedIn
                ? `Clocked in at ${formatHHMM(new Date(openSession!.clock_in_time))}`
                : "Ready to start your shift"}
            </p>

            {/* The button + ring */}
            <div className="flex justify-center mb-5">
              <ClockButton
                clockedIn={clockedIn}
                busy={isBusy}
                workedMs={workedMs}
                mood={mood}
                onClick={clockedIn ? handleClockOut : handleClockIn}
                buttonRef={buttonRef}
              />
            </div>

            {/* Shift AI comment */}
            <div className="mb-6 min-h-[20px]">
              <MotivMessage clockedIn={clockedIn} workedMs={workedMs} />
            </div>

            {/* Error/info message */}
            {message && !isGettingLocation && (
              <div
                className={`w-full text-sm font-semibold text-center rounded-2xl px-4 py-3 mb-5
                             animate-scale-in
                             ${isError
                               ? "bg-red-950/60 border border-red-800/30 text-red-400"
                               : "bg-emerald-950/60 border border-emerald-800/30 text-emerald-400"}`}
              >
                {message}
              </div>
            )}

            {/* XP bar */}
            <div className="w-full mb-6">
              <XPBar level={MOCK_LEVEL} xp={MOCK_XP} max={MOCK_XP_MAX} />
            </div>

            {/* Progress ring info */}
            {clockedIn && workedMs > 0 && (
              <div className="w-full flex items-center justify-between mb-5
                              bg-white/3 border border-white/6 rounded-2xl px-4 py-3
                              animate-scale-in">
                <div>
                  <p className="text-slate-500 text-[10px] uppercase tracking-widest font-bold">
                    Shift progress
                  </p>
                  <p className="text-white font-black text-lg leading-tight">
                    {formatDuration(workedMs)}
                    <span className="text-slate-500 text-sm font-medium"> / {SHIFT_HOURS}h</span>
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-slate-500 text-[10px] uppercase tracking-widest font-bold">
                    Est. so far
                  </p>
                  <p className="text-emerald-400 font-black text-lg leading-tight">
                    R {((workedMs / 3_600_000) * HOURLY_RATE).toFixed(0)}
                  </p>
                </div>
              </div>
            )}

            {/* Badges row */}
            <div className="w-full mb-6">
              <p className="text-[10px] font-bold text-slate-600 uppercase tracking-widest mb-2">
                Your Badges
              </p>
              <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-hide">
                {BADGES.map((b) => (
                  <div
                    key={b.id}
                    title={b.desc}
                    className="flex-none flex items-center gap-1.5 px-3 py-1.5 rounded-full
                               bg-white/5 border border-white/8 text-xs text-slate-400
                               whitespace-nowrap hover:bg-white/10 transition-colors cursor-default"
                  >
                    <span>{b.emoji}</span>
                    <span className="font-medium text-slate-300">{b.label}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Team widget */}
            <div className="w-full bg-white/3 border border-white/6 rounded-2xl
                            px-4 py-3 mb-6 animate-scale-in">
              <p className="text-[10px] font-bold text-slate-600 uppercase tracking-widest mb-2">
                Team on shift now
              </p>
              <div className="flex items-center gap-2.5">
                {["K","T","A","M"].map((initial, i) => (
                  <div
                    key={i}
                    className={`w-8 h-8 rounded-full flex items-center justify-center
                                text-xs font-black text-white shadow-md
                                bg-gradient-to-br ${mood.from} ${mood.to}`}
                    style={{ opacity: 0.6 + i * 0.1 }}
                  >
                    {initial}
                  </div>
                ))}
                <p className="text-slate-500 text-xs ml-1">4 teammates working</p>
              </div>
            </div>

            {/* View My Times */}
            <a
              href={`/clock/${staffId}/times`}
              className="w-full flex items-center justify-center gap-2.5 mb-12
                         bg-white/5 border border-white/8 rounded-2xl py-4
                         text-slate-400 text-sm font-bold
                         hover:bg-white/10 hover:text-white hover:border-white/15
                         active:scale-95 transition-all duration-150"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor"
                strokeWidth={2} viewBox="0 0 24 24">
                <rect x="3" y="4" width="18" height="18" rx="2" />
                <path strokeLinecap="round" d="M16 2v4M8 2v4M3 10h18" />
              </svg>
              View My Times
            </a>
          </>
        )}
      </main>

      {/* ══════════════════════════════════ REMINDER MODAL ══════════════════════════════════
          Logic is 100% identical to original — only styled for dark theme.
      ══════════════════════════════════════════════════════════════════════════════════════ */}
      {showModal && reminderSettings?.reminder_time && (
        <>
          <div className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm" />
          <div
            className="fixed bottom-0 left-0 right-0 z-50 mx-auto max-w-sm animate-slide-up"
            role="dialog" aria-modal="true" aria-labelledby="reminder-title"
          >
            <div className="bg-slate-900 border-t border-x border-white/10
                            rounded-t-3xl shadow-2xl px-6 pt-8 pb-10">

              {/* Animated clock icon */}
              <div className="flex justify-center mb-5">
                <div className="relative flex items-center justify-center">
                  <div className="absolute w-20 h-20 rounded-full bg-amber-500/15 animate-ring-1" />
                  <div className="relative w-16 h-16 rounded-full bg-amber-500/15
                                  flex items-center justify-center">
                    <svg className="w-8 h-8 text-amber-400" fill="none"
                      stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <circle cx="12" cy="12" r="9" />
                      <path strokeLinecap="round" d="M12 7v5l3.5 2" />
                    </svg>
                  </div>
                </div>
              </div>

              <h2 id="reminder-title"
                className="text-2xl font-black text-white text-center">
                Still on shift?
              </h2>
              <p className="text-slate-400 text-center text-sm mt-2 leading-relaxed">
                It&apos;s past{" "}
                <span className="font-bold text-white">
                  {formatReminderTime(reminderSettings.reminder_time)}
                </span>
                {minutesLate > 0 && (
                  <> — {minutesLate} min{minutesLate !== 1 ? "s" : ""} ago</>
                )}
                .
              </p>

              <div className="my-6 h-px bg-white/5" />

              <div className="flex flex-col gap-3">
                <button
                  onClick={handleStillWorking}
                  disabled={isRespondingToReminder}
                  className="w-full bg-emerald-600 hover:bg-emerald-500 active:scale-95
                             disabled:opacity-60 text-white font-black text-lg
                             rounded-2xl py-4 transition-all duration-100"
                >
                  {isRespondingToReminder ? "Saving…" : "✅ Still Working"}
                </button>
                <button
                  onClick={handleClockOutFromReminder}
                  disabled={isRespondingToReminder || isGettingLocation}
                  className="w-full bg-white/5 hover:bg-rose-500/15 active:scale-95
                             disabled:opacity-60 text-rose-400 font-black text-lg
                             rounded-2xl py-4 border border-rose-500/25 hover:border-rose-500/50
                             transition-all duration-100"
                >
                  {isGettingLocation
                    ? "Getting location…"
                    : isRespondingToReminder
                    ? "Clocking out…"
                    : "🕐 Clock Out"}
                </button>
              </div>

              <p className="text-[11px] text-slate-700 text-center mt-4">
                This reminder is automatic. You can always clock back in.
              </p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TINY HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function Chip({ icon, text, color }: { icon: string; text: string; color: "amber"|"violet"|"emerald" }) {
  const cls = {
    amber:   "bg-amber-500/10  border-amber-500/20  text-amber-400",
    violet:  "bg-violet-500/10 border-violet-500/20 text-violet-400",
    emerald: "bg-emerald-500/10 border-emerald-500/20 text-emerald-400",
  }[color];
  return (
    <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full border text-xs font-bold ${cls}`}>
      <span>{icon}</span>
      <span>{text}</span>
    </div>
  );
}
