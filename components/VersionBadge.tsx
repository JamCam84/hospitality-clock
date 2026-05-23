"use client";

import { useEffect, useState } from "react";
import { APP_VERSION, DEPLOY_TIMESTAMP } from "@/lib/version";

// ─── Environment detection ────────────────────────────────────────────────────

function getEnvironment(): "LOCAL" | "PRODUCTION" {
  if (typeof window === "undefined") return "LOCAL"; // SSR fallback
  const host = window.location.hostname;
  if (host === "localhost" || host === "127.0.0.1") return "LOCAL";
  return "PRODUCTION";
}

// Format ISO timestamp to a short readable string: "23 May 2026, 14:32"
function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString([], {
    day:    "numeric",
    month:  "short",
    year:   "numeric",
    hour:   "2-digit",
    minute: "2-digit",
  });
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function VersionBadge() {
  // Detect environment client-side to avoid SSR mismatch
  const [env, setEnv] = useState<"LOCAL" | "PRODUCTION" | null>(null);

  useEffect(() => {
    setEnv(getEnvironment());
  }, []);

  // Don't render until we know the environment (avoids hydration flash)
  if (!env) return null;

  const isLocal = env === "LOCAL";

  return (
    <div
      className="fixed bottom-3 left-3 z-50 flex items-center gap-1.5
                 bg-black/70 backdrop-blur-sm text-white/80
                 rounded-lg px-2.5 py-1.5 text-[10px] font-mono
                 shadow-lg select-none pointer-events-none"
      title={`Deployed: ${formatTimestamp(DEPLOY_TIMESTAMP)}`}
    >
      {/* Version number */}
      <span className="font-semibold text-white">v{APP_VERSION}</span>

      {/* Divider */}
      <span className="text-white/30">|</span>

      {/* Environment pill */}
      <span className={`font-semibold ${isLocal ? "text-amber-300" : "text-emerald-400"}`}>
        {env}
      </span>
    </div>
  );
}
