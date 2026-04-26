"use client";

/**
 * app/manager/onboarding-links/page.tsx
 *
 * Manage employee onboarding links.
 *
 * ─── What this page does ─────────────────────────────────────────────────────
 * 1. GENERATE  – Create a unique token-based onboarding link for a new hire.
 *    The link is sent to the employee via WhatsApp and opens the public form
 *    at /onboarding/[token]. No employee record is created yet — the form
 *    data arrives in the `employee_onboarding` table with status = "pending".
 *
 * 2. REVIEW    – See all pending onboarding submissions so the manager can
 *    review and manually add approved employees to the `staff` table.
 *
 * ─── Required SQL ─────────────────────────────────────────────────────────────
 *  (The employee_onboarding table is created by app/onboarding/[token]/page.tsx)
 *
 *  Optionally add an index on token for fast lookups:
 *    CREATE INDEX IF NOT EXISTS idx_employee_onboarding_token
 *    ON employee_onboarding (token);
 */

import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import ManagerNav from "@/components/ManagerNav";
import { PageHeader, SectionCard, StatusBadge } from "@/components/ui";

// ─── Types ────────────────────────────────────────────────────────────────────

type OnboardingSubmission = {
  id: string;
  token: string;
  first_name: string | null;
  last_name:  string | null;
  phone_number: string | null;
  email: string | null;
  role:  string | null;
  branch: string | null;
  status: string | null;
  submitted_at: string | null;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getOrigin(): string {
  if (typeof window === "undefined") return "";
  return window.location.origin;
}

/** Generate a short random token (16 hex chars). */
function generateToken(): string {
  const arr = new Uint8Array(8);
  crypto.getRandomValues(arr);
  return Array.from(arr).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function onboardingLink(baseUrl: string, token: string): string {
  return `${baseUrl.replace(/\/$/, "")}/onboarding/${token}`;
}

function whatsappMessage(firstName: string, link: string): string {
  return `Hi ${firstName || "there"}, please use this link to complete your onboarding form: ${link}`;
}

function friendlyDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString([], {
    day: "numeric", month: "short", year: "numeric",
  });
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function OnboardingLinksPage() {

  const [baseUrl, setBaseUrl] = useState("");
  const [submissions, setSubmissions] = useState<OnboardingSubmission[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  // ── New link generator form ───────────────────────────────────────────────────
  const [newToken, setNewToken] = useState<string>("");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // ─── Load submissions ──────────────────────────────────────────────────────────
  const loadSubmissions = useCallback(async () => {
    setIsLoading(true);
    setLoadError("");
    const { data, error } = await supabase
      .from("employee_onboarding")
      .select("id, token, first_name, last_name, phone_number, email, role, branch, status, submitted_at")
      .order("submitted_at", { ascending: false })
      .limit(50);

    if (error) {
      setLoadError("Could not load submissions. Please try again.");
    } else {
      setSubmissions((data ?? []) as OnboardingSubmission[]);
    }
    setIsLoading(false);
  }, []);

  useEffect(() => {
    setBaseUrl(getOrigin());
    loadSubmissions();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Generate a new link ────────────────────────────────────────────────────────
  function handleGenerate() {
    setNewToken(generateToken());
  }

  // ── Copy to clipboard ─────────────────────────────────────────────────────────
  async function copyToClipboard(text: string, id: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      // Fallback for older browsers
      const el = document.createElement("textarea");
      el.value = text;
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    }
  }

  // ── WhatsApp deeplink ──────────────────────────────────────────────────────────
  function openWhatsApp(name: string, link: string) {
    const msg = encodeURIComponent(whatsappMessage(name, link));
    window.open(`https://wa.me/?text=${msg}`, "_blank", "noopener");
  }

  // ── Status badge variant ───────────────────────────────────────────────────────
  function statusVariant(status: string | null) {
    if (status === "approved") return "approved" as const;
    if (status === "pending")  return "unapproved" as const;
    return "neutral" as const;
  }

  // ─── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-50 font-sans">

      <PageHeader
        title="Onboarding Links"
        subtitle="Generate and share personalised onboarding forms"
      />

      <ManagerNav />

      <main className="max-w-3xl mx-auto px-4 py-6 space-y-6">

        {/* ── A. Generate New Link ── */}
        <SectionCard
          header={
            <div>
              <h2 className="text-sm font-semibold text-gray-800">Generate New Onboarding Link</h2>
              <p className="text-xs text-gray-400 mt-0.5">
                Create a unique link to send to a new hire via WhatsApp.
                No employee record is created until you review and approve their submission.
              </p>
            </div>
          }
        >
          <div className="p-5 space-y-4">
            {/* Base URL override */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                App URL
                <span className="text-gray-400 font-normal ml-1 text-xs">(used to build the link)</span>
              </label>
              <input
                type="text"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://your-app-url.com"
                className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3
                           text-sm text-gray-800 placeholder:text-gray-400
                           focus:outline-none focus:ring-2 focus:ring-green-500
                           focus:border-transparent transition"
              />
              <p className="text-xs text-gray-400 mt-1">
                If staff access the app via your network IP (e.g. http://192.168.1.5:3000),
                enter that address here so the link works on their device.
              </p>
            </div>

            {/* Generate button */}
            <button
              onClick={handleGenerate}
              className="flex items-center gap-2 bg-green-500 hover:bg-green-600
                         active:scale-95 text-white font-semibold text-sm rounded-xl
                         px-5 py-3 transition-all duration-150 shadow-sm"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              Generate New Link
            </button>

            {/* Generated link display */}
            {newToken && (
              <div className="rounded-2xl border border-green-100 bg-green-50 p-4 space-y-3">
                <p className="text-xs font-semibold text-green-700 uppercase tracking-wider">
                  New Onboarding Link
                </p>

                <div className="flex items-center gap-2">
                  <code className="flex-1 text-xs bg-white border border-green-200 rounded-xl
                                   px-3 py-2.5 text-gray-700 break-all font-mono">
                    {onboardingLink(baseUrl, newToken)}
                  </code>
                  <button
                    onClick={() => copyToClipboard(onboardingLink(baseUrl, newToken), "new")}
                    className="shrink-0 flex items-center gap-1 text-xs font-semibold
                               text-green-700 hover:text-green-800 hover:bg-green-100
                               border border-green-200 rounded-xl px-3 py-2.5 transition-all"
                  >
                    {copiedId === "new" ? "✓ Copied" : "Copy"}
                  </button>
                </div>

                <button
                  onClick={() => openWhatsApp("", onboardingLink(baseUrl, newToken))}
                  className="flex items-center gap-2 w-full justify-center bg-[#25D366]
                             hover:bg-[#20b857] active:scale-95 text-white font-semibold
                             text-sm rounded-xl px-5 py-3 transition-all duration-150"
                >
                  {/* WhatsApp icon */}
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
                  </svg>
                  Send via WhatsApp
                </button>

                <p className="text-[11px] text-green-600 text-center">
                  Token: <code className="font-mono">{newToken}</code>
                </p>
              </div>
            )}
          </div>
        </SectionCard>

        {/* ── B. Pending Submissions ── */}
        <SectionCard
          header={
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-800">Submitted Applications</h2>
              <button
                onClick={loadSubmissions}
                disabled={isLoading}
                className="flex items-center gap-1.5 text-xs font-semibold text-gray-500
                           hover:text-green-700 hover:bg-green-50 border border-gray-200
                           hover:border-green-200 rounded-xl px-3 py-1.5 transition-all"
              >
                <svg
                  className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`}
                  fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round"
                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0
                       0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Refresh
              </button>
            </div>
          }
        >
          {/* Load error */}
          {loadError && (
            <div className="px-5 py-4">
              <p className="text-sm text-red-600 bg-red-50 rounded-xl px-4 py-3">
                {loadError}
              </p>
            </div>
          )}

          {/* Loading skeleton */}
          {isLoading && (
            <div className="divide-y divide-gray-50 animate-pulse">
              {[1, 2, 3].map((n) => (
                <div key={n} className="px-5 py-4 flex items-center gap-4">
                  <div className="w-9 h-9 rounded-full bg-gray-200 shrink-0" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 bg-gray-200 rounded w-32" />
                    <div className="h-3 bg-gray-100 rounded w-48" />
                  </div>
                  <div className="h-5 bg-gray-100 rounded-full w-20" />
                </div>
              ))}
            </div>
          )}

          {/* Empty state */}
          {!isLoading && submissions.length === 0 && !loadError && (
            <div className="px-5 py-12 text-center">
              <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center
                              justify-center mx-auto mb-3 text-gray-300">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round"
                    d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414
                       5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <p className="text-sm text-gray-400">No submissions yet.</p>
              <p className="text-xs text-gray-300 mt-1">
                Generate a link above and send it to a new hire.
              </p>
            </div>
          )}

          {/* Submissions list */}
          {!isLoading && submissions.length > 0 && (
            <div className="divide-y divide-gray-50">
              {submissions.map((sub) => {
                const name = [sub.first_name, sub.last_name].filter(Boolean).join(" ") || "Unknown";
                const link = onboardingLink(baseUrl, sub.token);
                const initial = name.charAt(0).toUpperCase();

                return (
                  <div key={sub.id} className="px-5 py-4 flex items-start gap-3">
                    {/* Avatar */}
                    <div className="w-9 h-9 rounded-full bg-green-100 text-green-700 flex items-center
                                    justify-center text-sm font-bold shrink-0 mt-0.5">
                      {initial}
                    </div>

                    {/* Details */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold text-gray-800">{name}</p>
                        <StatusBadge
                          variant={statusVariant(sub.status)}
                          label={sub.status ?? "pending"}
                        />
                      </div>

                      <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1 text-xs text-gray-400">
                        {sub.role   && <span>{sub.role}</span>}
                        {sub.branch && <span>{sub.branch}</span>}
                        {sub.phone_number && <span>{sub.phone_number}</span>}
                        <span>Submitted {friendlyDate(sub.submitted_at)}</span>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="shrink-0 flex flex-col gap-1.5 items-end">
                      <button
                        onClick={() => copyToClipboard(link, sub.id)}
                        className="flex items-center gap-1 text-xs font-semibold text-gray-500
                                   hover:text-green-700 hover:bg-green-50 border border-gray-200
                                   hover:border-green-200 rounded-xl px-2.5 py-1.5 transition-all"
                      >
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round"
                            d="M13.828 10.172a4 4 0 010 5.656l-3 3a4 4 0 01-5.656-5.656l1.5-1.5
                               m4.5-4.5l3-3a4 4 0 015.656 5.656l-1.5 1.5" />
                        </svg>
                        {copiedId === sub.id ? "✓ Copied" : "Copy Link"}
                      </button>

                      <button
                        onClick={() => openWhatsApp(sub.first_name ?? "", link)}
                        className="flex items-center gap-1 text-xs font-semibold text-[#25D366]
                                   hover:bg-green-50 border border-green-100 hover:border-green-200
                                   rounded-xl px-2.5 py-1.5 transition-all"
                      >
                        <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
                        </svg>
                        WhatsApp
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </SectionCard>

      </main>
    </div>
  );
}
