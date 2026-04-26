"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import ManagerNav from "@/components/ManagerNav";

// ─── Types ────────────────────────────────────────────────────────────────────

type StaffMember = {
  id: string;
  first_name: string;
  last_name: string;
  role: string;
  branch: string;
  phone_number: string | null;
};

type WaStatus = "idle" | "sending" | "sent" | "error";

// Full debug snapshot captured after each send attempt.
type WaDebug = {
  phoneSent:    string;
  messageSent:  string;
  apiResponse:  Record<string, unknown>;
  timestamp:    string;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getDefaultBaseUrl(): string {
  const envUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (envUrl) return envUrl.replace(/\/$/, "");
  if (typeof window === "undefined") return "";
  return window.location.origin;
}

function clockLink(baseUrl: string, staffId: string): string {
  return `${baseUrl.replace(/\/$/, "")}/clock/${staffId}`;
}

function whatsappMessage(firstName: string, link: string): string {
  return `Hi ${firstName} 👋\nPlease use this link to clock in or out:\n${link}`;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ClockLinksPage() {

  const [staffList, setStaffList] = useState<StaffMember[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [baseUrl,   setBaseUrl]   = useState("");

  const [copiedLinkId, setCopiedLinkId] = useState<string | null>(null);

  // Per-employee WhatsApp state
  const [waStatus, setWaStatus] = useState<Record<string, WaStatus>>({});
  const [waError,  setWaError]  = useState<Record<string, string>>({});
  const [waDebug,  setWaDebug]  = useState<Record<string, WaDebug>>({});

  // ─── Fetch staff ────────────────────────────────────────────────────────────
  useEffect(() => {
    setBaseUrl(getDefaultBaseUrl());

    async function fetchStaff() {
      setIsLoading(true);
      const { data, error } = await supabase
        .from("staff")
        .select("id, first_name, last_name, role, branch, phone_number")
        .order("first_name", { ascending: true });

      if (error) {
        setLoadError("Could not load staff. Please refresh and try again.");
      } else {
        setStaffList((data ?? []) as StaffMember[]);
      }
      setIsLoading(false);
    }

    fetchStaff();
  }, []);

  // ─── Copy link ──────────────────────────────────────────────────────────────
  async function copyLink(link: string, staffId: string) {
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      const el = document.createElement("textarea");
      el.value = link;
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
    }
    setCopiedLinkId(staffId);
    setTimeout(() => setCopiedLinkId(null), 2000);
  }

  // ─── Send WhatsApp ──────────────────────────────────────────────────────────
  async function sendWhatsApp(staff: StaffMember) {
    if (!staff.phone_number) return;

    const link    = clockLink(baseUrl, staff.id);
    const message = whatsappMessage(staff.first_name, link);
    const phone   = staff.phone_number;

    console.log("[clock-links] ─── Sending WhatsApp ────────────────────────────");
    console.log("[clock-links]   employee:  ", staff.first_name, staff.last_name);
    console.log("[clock-links]   phone:     ", phone);
    console.log("[clock-links]   message:   ", message);

    setWaStatus((prev) => ({ ...prev, [staff.id]: "sending" }));
    setWaError( (prev) => ({ ...prev, [staff.id]: "" }));

    let apiResponse: Record<string, unknown> = {};

    try {
      const res = await fetch("/api/send-whatsapp", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ phoneNumber: phone, message }),
      });

      apiResponse = await res.json().catch(() => ({ parseError: "Could not parse response body" }));
      console.log("[clock-links]   HTTP status:", res.status);
      console.log("[clock-links]   API response:", apiResponse);

      if (res.ok && apiResponse.success) {
        console.log("[clock-links] ✅ Sent! SID:", apiResponse.sid);
        setWaStatus((prev) => ({ ...prev, [staff.id]: "sent" }));
        setWaError( (prev) => ({ ...prev, [staff.id]: "" }));
      } else {
        const errText = String(apiResponse.error ?? `HTTP ${res.status}`);
        console.error("[clock-links] ❌ Send failed:", errText);
        setWaStatus((prev) => ({ ...prev, [staff.id]: "error" }));
        setWaError( (prev) => ({ ...prev, [staff.id]: errText }));
      }

    } catch (fetchErr) {
      const errText = fetchErr instanceof Error
        ? fetchErr.message
        : "Network error — could not reach server.";
      console.error("[clock-links] ❌ Fetch error:", fetchErr);
      apiResponse = { fetchError: errText };
      setWaStatus((prev) => ({ ...prev, [staff.id]: "error" }));
      setWaError( (prev) => ({ ...prev, [staff.id]: errText }));
    }

    // Capture debug snapshot
    setWaDebug((prev) => ({
      ...prev,
      [staff.id]: {
        phoneSent:   phone,
        messageSent: message,
        apiResponse,
        timestamp:   new Date().toLocaleTimeString(),
      },
    }));

    console.log("[clock-links] ────────────────────────────────────────────────");

    // Reset status after 10 s (longer so you can read the debug box)
    setTimeout(() => {
      setWaStatus((prev) => ({ ...prev, [staff.id]: "idle" }));
      setWaError( (prev) => ({ ...prev, [staff.id]: "" }));
      // Keep debug snapshot — don't clear it so it stays readable
    }, 10000);
  }

  // ─── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-stone-50 font-sans">

      {/* ── Top bar ── */}
      <header className="bg-white border-b border-stone-200 px-4 py-4 flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-emerald-600 flex items-center justify-center shrink-0">
          <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M13.828 10.172a4 4 0 010 5.656l-3 3a4 4 0 01-5.656-5.656l1.5-1.5
                 m4.5-4.5l3-3a4 4 0 015.656 5.656l-1.5 1.5" />
          </svg>
        </div>
        <div>
          <h1 className="text-lg font-semibold text-stone-800 tracking-tight leading-tight">Clock Links</h1>
          <p className="text-xs text-stone-400">Share links so staff can clock in and out</p>
        </div>
      </header>

      <ManagerNav />

      <main className="max-w-lg mx-auto px-4 py-6 space-y-4">

        {/* ── Base URL input ── */}
        <div className="bg-white rounded-2xl border border-stone-200 shadow-sm px-4 py-4 space-y-1.5">
          <label className="block text-xs font-semibold text-stone-500 uppercase tracking-wider">
            Base URL for links
          </label>
          <input
            type="text"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="e.g. https://yourapp.vercel.app"
            className="w-full rounded-xl border border-stone-300 px-3 py-2 text-sm font-mono
                       text-stone-700 focus:outline-none focus:ring-2 focus:ring-emerald-500
                       focus:border-transparent transition"
          />
          <p className="text-xs text-stone-400">
            {baseUrl.includes("localhost")
              ? "⚠️ Localhost links won't open on staff phones and won't be clickable in WhatsApp. Set NEXT_PUBLIC_APP_URL in your .env to your real domain, or paste your network IP above."
              : !baseUrl.startsWith("http")
                ? "⚠️ URL must start with https:// or http:// to be clickable in WhatsApp."
                : "✓ Links will be clickable in WhatsApp and will work on any device."}
          </p>
        </div>

        {/* ── Loading skeleton ── */}
        {isLoading && (
          <div className="space-y-3">
            {[1, 2, 3].map((n) => (
              <div key={n} className="bg-white rounded-2xl border border-stone-200 shadow-sm p-5 animate-pulse space-y-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-stone-200 shrink-0" />
                  <div className="space-y-1.5 flex-1">
                    <div className="h-4 bg-stone-200 rounded w-32" />
                    <div className="h-3 bg-stone-100 rounded w-20" />
                  </div>
                </div>
                <div className="h-9 bg-stone-100 rounded-xl" />
                <div className="grid grid-cols-2 gap-2">
                  <div className="h-10 bg-stone-100 rounded-xl" />
                  <div className="h-10 bg-stone-100 rounded-xl" />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Load error ── */}
        {!isLoading && loadError && (
          <p className="text-center text-red-500 text-sm bg-red-50 rounded-2xl px-4 py-5 border border-red-100">
            {loadError}
          </p>
        )}

        {/* ── Empty state ── */}
        {!isLoading && !loadError && staffList.length === 0 && (
          <p className="text-center text-stone-400 text-sm py-10">
            No staff found. Add staff first before sharing clock links.
          </p>
        )}

        {/* ── Staff cards ── */}
        {!isLoading && staffList.map((staff) => {
          const link       = clockLink(baseUrl, staff.id);
          const hasPhone   = !!staff.phone_number;
          const status     = waStatus[staff.id] ?? "idle";
          const isSending  = status === "sending";
          const justCopied = copiedLinkId === staff.id;
          const errorText  = waError[staff.id] ?? "";
          const debug      = waDebug[staff.id] ?? null;

          return (
            <div key={staff.id} className="bg-white rounded-2xl border border-stone-200 shadow-sm p-5 space-y-4">

              {/* ── Staff identity ── */}
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-emerald-100 text-emerald-700 flex items-center
                                justify-center text-base font-bold shrink-0">
                  {staff.first_name.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-stone-800 truncate">
                    {staff.first_name} {staff.last_name}
                  </p>
                  <div className="flex flex-wrap gap-1.5 mt-0.5">
                    {staff.role && (
                      <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-sky-100 text-sky-700">
                        {staff.role}
                      </span>
                    )}
                    {staff.branch && (
                      <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-stone-100 text-stone-500">
                        📍 {staff.branch}
                      </span>
                    )}
                    {!hasPhone && (
                      <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
                        No phone number
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* ── Link preview ── */}
              <div className="bg-stone-50 border border-stone-200 rounded-xl px-3 py-2">
                <p className="text-xs text-stone-400 font-medium mb-0.5">Clock link</p>
                <p className="text-sm text-stone-600 break-all font-mono leading-snug">{link}</p>
              </div>

              {/* ── Action buttons ── */}
              <div className="grid grid-cols-2 gap-2">

                {/* Copy Link */}
                <button
                  onClick={() => copyLink(link, staff.id)}
                  className={`flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-sm font-semibold
                              transition-all duration-150 active:scale-95
                              ${justCopied ? "bg-emerald-500 text-white" : "bg-stone-100 text-stone-700 hover:bg-stone-200"}`}
                >
                  {justCopied ? (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round"
                        d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2
                           m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                  )}
                  {justCopied ? "Copied!" : "Copy Link"}
                </button>

                {/* Send WhatsApp */}
                <button
                  onClick={() => sendWhatsApp(staff)}
                  disabled={!hasPhone || isSending}
                  title={!hasPhone ? "No phone number on file for this employee" : undefined}
                  className={`flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-sm font-semibold
                              transition-all duration-150 active:scale-95
                              ${!hasPhone
                                ? "bg-stone-100 text-stone-400 cursor-not-allowed"
                                : status === "sent"
                                  ? "bg-emerald-500 text-white"
                                  : status === "error"
                                    ? "bg-red-100 text-red-700"
                                    : isSending
                                      ? "bg-green-100 text-green-700 opacity-70 cursor-not-allowed"
                                      : "bg-green-100 text-green-800 hover:bg-green-200"
                              }`}
                >
                  {status === "sent" ? (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  ) : status === "error" ? (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  ) : isSending ? (
                    <svg className="w-4 h-4 animate-spin" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round"
                        d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0
                           0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15
                               -.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475
                               -.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52
                               .149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207
                               -.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372
                               -.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2
                               5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085
                               1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z" />
                      <path d="M12 0C5.373 0 0 5.373 0 12c0 2.117.554 4.103 1.523 5.824L0 24l6.335-1.509
                               A11.945 11.945 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.818
                               a9.818 9.818 0 01-5.001-1.371l-.36-.214-3.726.888.916-3.618-.235-.372
                               A9.818 9.818 0 0112 2.182c5.424 0 9.818 4.394 9.818 9.818s-4.394 9.818-9.818 9.818z" />
                    </svg>
                  )}
                  {status === "sent"
                    ? "Sent ✅"
                    : status === "error"
                      ? "Failed ❌"
                      : isSending
                        ? "Sending…"
                        : !hasPhone
                          ? "No Phone"
                          : "Send WhatsApp"}
                </button>

              </div>

              {/* ── Error banner ── */}
              {status === "error" && errorText && (
                <div className="flex items-start gap-2 bg-red-50 border border-red-100 rounded-xl px-3 py-2.5">
                  <svg className="w-4 h-4 text-red-400 mt-0.5 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round"
                      d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94
                         a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                  </svg>
                  <p className="text-xs text-red-700 leading-snug">{errorText}</p>
                </div>
              )}

              {/* ── DEBUG BOX — remove this section once WhatsApp is working ── */}
              {debug && (
                <details className="rounded-xl border border-amber-200 bg-amber-50 text-xs overflow-hidden">
                  <summary className="px-3 py-2 font-semibold text-amber-700 cursor-pointer select-none
                                      flex items-center gap-1.5">
                    <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round"
                        d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
                    </svg>
                    Debug info
                    <span className="ml-auto text-amber-400 font-normal">{debug.timestamp}</span>
                  </summary>

                  <div className="px-3 pb-3 space-y-2 border-t border-amber-200 pt-2">

                    {/* Phone number sent */}
                    <div>
                      <p className="font-semibold text-amber-700 mb-0.5">Phone sent</p>
                      <p className="font-mono text-amber-900 bg-white rounded px-2 py-1 border border-amber-100">
                        {debug.phoneSent}
                      </p>
                    </div>

                    {/* Message sent */}
                    <div>
                      <p className="font-semibold text-amber-700 mb-0.5">Message sent</p>
                      <pre className="font-mono text-amber-900 bg-white rounded px-2 py-1 border border-amber-100
                                      whitespace-pre-wrap break-all leading-snug">
                        {debug.messageSent}
                      </pre>
                    </div>

                    {/* Full API response */}
                    <div>
                      <p className="font-semibold text-amber-700 mb-0.5">API response</p>
                      <pre className="font-mono text-amber-900 bg-white rounded px-2 py-1 border border-amber-100
                                      whitespace-pre-wrap break-all leading-snug overflow-x-auto">
                        {JSON.stringify(debug.apiResponse, null, 2)}
                      </pre>
                    </div>

                  </div>
                </details>
              )}
              {/* ── END DEBUG BOX ── */}

            </div>
          );
        })}

      </main>
    </div>
  );
}
