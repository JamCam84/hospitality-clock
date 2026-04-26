"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import ManagerNav from "@/components/ManagerNav";

// ─── Types ────────────────────────────────────────────────────────────────────

type PayrollSettings = {
  id: string;
  monthly_cutoff_day: number;
  weekly_processing_day: string;
  updated_at: string;
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function SettingsPage() {

  // ── Form state ───────────────────────────────────────────────────────────────
  const [monthlyCutoffDay, setMonthlyCutoffDay]         = useState<number>(25);
  const [weeklyProcessingDay, setWeeklyProcessingDay]   = useState<string>("Friday");

  // ── Tracks whether a settings row already exists in Supabase ─────────────────
  const [settingsId, setSettingsId] = useState<string | null>(null);
  const [lastSaved, setLastSaved]   = useState<string | null>(null);

  // ── UI state ─────────────────────────────────────────────────────────────────
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving]   = useState(false);
  const [message, setMessage]     = useState("");
  const [isError, setIsError]     = useState(false);

  // ─── Load existing settings on mount ──────────────────────────────────────────
  useEffect(() => {
    async function fetchSettings() {
      const { data, error } = await supabase
        .from("payroll_settings")
        .select("*")
        .limit(1)
        .maybeSingle(); // returns null (not an error) if no row exists

      if (error) {
        setMessage("Could not load settings. Please refresh.");
        setIsError(true);
      } else if (data) {
        const s = data as PayrollSettings;
        setSettingsId(s.id);
        setMonthlyCutoffDay(s.monthly_cutoff_day);
        setWeeklyProcessingDay(s.weekly_processing_day);
        setLastSaved(s.updated_at);
      }
      // If data is null — no row yet — the default state values above are used

      setIsLoading(false);
    }

    fetchSettings();
  }, []);

  // ─── Save settings ────────────────────────────────────────────────────────────
  async function handleSave(e: React.FormEvent) {
    e.preventDefault();

    // Validate cutoff day is between 1 and 31
    if (monthlyCutoffDay < 1 || monthlyCutoffDay > 31) {
      setMessage("Monthly cutoff day must be between 1 and 31.");
      setIsError(true);
      return;
    }

    setIsSaving(true);
    setMessage("");

    const payload = {
      monthly_cutoff_day:   monthlyCutoffDay,
      weekly_processing_day: weeklyProcessingDay,
      updated_at:           new Date().toISOString(),
    };

    let saveError = null;
    let savedAt   = payload.updated_at;

    if (settingsId) {
      // Row already exists — UPDATE it
      const { error } = await supabase
        .from("payroll_settings")
        .update(payload)
        .eq("id", settingsId);
      saveError = error;
    } else {
      // No row yet — INSERT one and store the returned id
      const { data, error } = await supabase
        .from("payroll_settings")
        .insert([payload])
        .select()
        .single();
      saveError = error;
      if (!error && data) {
        setSettingsId((data as PayrollSettings).id);
      }
    }

    if (saveError) {
      setMessage("Error saving settings: " + saveError.message);
      setIsError(true);
    } else {
      setMessage("Settings saved successfully.");
      setIsError(false);
      setLastSaved(savedAt);
    }

    setIsSaving(false);
  }

  // ─── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-stone-50 font-sans">

      {/* ── Top bar ── */}
      <header className="bg-white border-b border-stone-200 px-4 py-4">
        <div className="max-w-lg mx-auto flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-emerald-600 flex items-center justify-center shrink-0">
            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94
                   3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724
                   1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426
                   1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724
                   1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31
                   2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </div>
          <div>
            <h1 className="text-lg font-semibold text-stone-800 tracking-tight leading-tight">
              Payroll Settings
            </h1>
            <p className="text-xs text-stone-400">Configure payroll cycle settings</p>
          </div>
        </div>
      </header>

      <ManagerNav />

      <main className="max-w-lg mx-auto px-4 py-6 space-y-5">

        {/* ── Explanation card ── */}
        <div className="bg-sky-50 border border-sky-100 rounded-2xl px-5 py-4">
          <p className="text-sm font-semibold text-sky-800 mb-1">How payroll cycles work</p>
          <p className="text-sm text-sky-700 leading-relaxed">
            These settings are used by the <strong>Approval</strong> page to automatically
            calculate the current pay period. Monthly staff are grouped by the cutoff day,
            and weekly staff are grouped by their processing day. You can always override
            the dates manually on the Approval page.
          </p>
        </div>

        {/* ── Settings form ── */}
        <section className="bg-white rounded-2xl border border-stone-200 shadow-sm p-6">

          {isLoading ? (
            <div className="space-y-4 animate-pulse">
              <div className="h-4 bg-stone-200 rounded w-40" />
              <div className="h-12 bg-stone-100 rounded-xl" />
              <div className="h-4 bg-stone-200 rounded w-48 mt-4" />
              <div className="h-12 bg-stone-100 rounded-xl" />
            </div>
          ) : (
            <form onSubmit={handleSave} className="space-y-6">

              {/* ── Monthly cutoff day ── */}
              <div>
                <label
                  htmlFor="cutoffDay"
                  className="block text-sm font-semibold text-stone-700 mb-1"
                >
                  Monthly Payroll Cutoff Day
                </label>
                <p className="text-xs text-stone-400 mb-2">
                  The day of the month that ends the monthly pay period.
                  For example, if set to 20, each period runs from the 20th to the 19th of the next month.
                </p>
                <div className="flex items-center gap-3">
                  <input
                    id="cutoffDay"
                    type="number"
                    min={1}
                    max={31}
                    value={monthlyCutoffDay}
                    onChange={(e) => setMonthlyCutoffDay(Number(e.target.value))}
                    disabled={isSaving}
                    className="w-28 rounded-xl border border-stone-300 px-4 py-3 text-base text-stone-800
                               focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent
                               transition disabled:opacity-50"
                  />
                  <span className="text-sm text-stone-500">of each month</span>
                </div>
              </div>

              {/* ── Weekly processing day ── */}
              <div>
                <label
                  htmlFor="processingDay"
                  className="block text-sm font-semibold text-stone-700 mb-1"
                >
                  Weekly Payroll Processing Day
                </label>
                <p className="text-xs text-stone-400 mb-2">
                  The day of the week when weekly payroll is processed.
                  The current pay period is calculated as the 7 days leading up to this day.
                </p>
                <select
                  id="processingDay"
                  value={weeklyProcessingDay}
                  onChange={(e) => setWeeklyProcessingDay(e.target.value)}
                  disabled={isSaving}
                  className="w-full sm:w-48 rounded-xl border border-stone-300 px-4 py-3 text-base text-stone-800
                             focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent
                             transition disabled:opacity-50 bg-white"
                >
                  {["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].map(
                    (day) => (
                      <option key={day} value={day}>{day}</option>
                    )
                  )}
                </select>
              </div>

              {/* ── Last saved timestamp ── */}
              {lastSaved && (
                <p className="text-xs text-stone-400">
                  Last saved: {new Date(lastSaved).toLocaleString()}
                </p>
              )}

              {/* ── Feedback ── */}
              {message && (
                <p className={`text-sm font-medium rounded-xl px-4 py-3 ${
                  isError ? "bg-red-50 text-red-600" : "bg-emerald-50 text-emerald-700"
                }`}>
                  {message}
                </p>
              )}

              {/* ── Save button ── */}
              <div className="flex items-center gap-3">
                <button
                  type="submit"
                  disabled={isSaving}
                  className="bg-emerald-600 hover:bg-emerald-700 active:scale-95 disabled:opacity-60
                             disabled:cursor-not-allowed text-white font-semibold text-sm rounded-xl
                             px-6 py-3 transition-all duration-150 shadow-sm"
                >
                  {isSaving ? "Saving…" : "Save Settings"}
                </button>
                <Link
                  href="/manager/approval"
                  className="text-sm text-stone-400 hover:text-emerald-600 transition-colors"
                >
                  Go to Approval →
                </Link>
              </div>

            </form>
          )}
        </section>

      </main>
    </div>
  );
}
