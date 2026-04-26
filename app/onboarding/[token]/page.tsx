"use client";

/**
 * app/onboarding/[token]/page.tsx
 *
 * Public employee onboarding form — sent to employees via WhatsApp link.
 * No login required. Submissions are stored in the `employee_onboarding`
 * Supabase table with status = "pending" for manager review.
 *
 * ─── SQL to create the table ─────────────────────────────────────────────────
 *
 *  CREATE TABLE IF NOT EXISTS employee_onboarding (
 *    id               uuid DEFAULT gen_random_uuid() PRIMARY KEY,
 *    token            text,
 *    first_name       text,
 *    last_name        text,
 *    id_number        text,
 *    date_of_birth    date,
 *    phone_number     text,
 *    email            text,
 *    role             text,
 *    branch           text,
 *    pay_frequency    text,
 *    pay_basis        text,
 *    bank_name        text,
 *    account_number   text,
 *    account_type     text,
 *    branch_code      text,
 *    status           text DEFAULT 'pending',
 *    submitted_at     timestamptz DEFAULT now()
 *  );
 *
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { use, useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";

// ─── Option lists ─────────────────────────────────────────────────────────────

const ROLES = [
  "Waiter / Waitress",
  "Bartender",
  "Barista",
  "Chef",
  "Sous Chef",
  "Kitchen Staff",
  "Manager",
  "Supervisor",
  "Host / Hostess",
  "Cashier",
  "Security",
  "Cleaner",
  "Driver",
  "General Worker",
  "Other",
];

const BANKS = [
  "Absa",
  "African Bank",
  "Bidvest Bank",
  "Capitec",
  "Discovery Bank",
  "FNB (First National Bank)",
  "Mercantile Bank",
  "Nedbank",
  "Old Mutual",
  "Standard Bank",
  "TymeBank",
  "Other",
];

// ─── Shared styles ────────────────────────────────────────────────────────────

// Large, comfortable inputs for mobile
const inputCls =
  "w-full rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3.5 text-base " +
  "text-gray-800 placeholder:text-gray-400 " +
  "focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent " +
  "transition-all duration-150";

const labelCls = "block text-sm font-semibold text-gray-700 mb-1.5";

// ─── Types ────────────────────────────────────────────────────────────────────

type FormData = {
  // Personal
  first_name:    string;
  last_name:     string;
  id_number:     string;
  date_of_birth: string;
  phone_number:  string;
  email:         string;
  // Employment
  role:          string;
  branch:        string;
  pay_frequency: string;
  pay_basis:     string;
  // Banking
  bank_name:     string;
  account_number: string;
  account_type:  string;
  branch_code:   string;
};

const EMPTY_FORM: FormData = {
  first_name:    "",
  last_name:     "",
  id_number:     "",
  date_of_birth: "",
  phone_number:  "",
  email:         "",
  role:          "",
  branch:        "",
  pay_frequency: "",
  pay_basis:     "",
  bank_name:     "",
  account_number: "",
  account_type:  "",
  branch_code:   "",
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function OnboardingPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  // Unwrap the dynamic route param — required in Next.js 16 client components
  const { token } = use(params);

  // ── Form state ───────────────────────────────────────────────────────────────
  const [form,        setForm]        = useState<FormData>(EMPTY_FORM);
  const [branches,    setBranches]    = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted,   setSubmitted]   = useState(false);
  const [submitError, setSubmitError] = useState("");

  // ── Load distinct branches from Supabase ─────────────────────────────────────
  // Falls back gracefully — if the query fails, the branch field becomes a
  // free-text input instead of a dropdown.
  useEffect(() => {
    async function loadBranches() {
      const { data } = await supabase
        .from("staff")
        .select("branch")
        .not("branch", "is", null);

      if (data) {
        // Deduplicate branch values
        const unique = Array.from(
          new Set(data.map((r) => r.branch as string).filter(Boolean))
        ).sort();
        setBranches(unique);
      }
    }
    loadBranches();
  }, []);

  // ── Field change handler ─────────────────────────────────────────────────────
  function handleChange(
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>
  ) {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  }

  // ── Submit ───────────────────────────────────────────────────────────────────
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError("");

    // Basic validation — first and last name are the only hard requirements
    if (!form.first_name.trim()) {
      setSubmitError("Please enter your first name.");
      return;
    }
    if (!form.last_name.trim()) {
      setSubmitError("Please enter your last name.");
      return;
    }

    setIsSubmitting(true);

    const { error } = await supabase.from("employee_onboarding").insert({
      token,
      first_name:    form.first_name.trim(),
      last_name:     form.last_name.trim(),
      id_number:     form.id_number.trim()     || null,
      date_of_birth: form.date_of_birth        || null,
      phone_number:  form.phone_number.trim()  || null,
      email:         form.email.trim()         || null,
      role:          form.role                 || null,
      branch:        form.branch.trim()        || null,
      pay_frequency: form.pay_frequency        || null,
      pay_basis:     form.pay_basis            || null,
      bank_name:     form.bank_name            || null,
      account_number: form.account_number.trim() || null,
      account_type:  form.account_type         || null,
      branch_code:   form.branch_code.trim()   || null,
      status:        "pending",
    });

    setIsSubmitting(false);

    if (error) {
      setSubmitError(
        "Something went wrong saving your details. Please try again or contact your manager."
      );
      return;
    }

    setSubmitted(true);
    // Scroll to top so success message is visible
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // ─── Success screen ───────────────────────────────────────────────────────────

  if (submitted) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-green-50 to-gray-50
                      flex items-center justify-center px-5 py-16">
        <div className="w-full max-w-sm text-center space-y-5">
          {/* Big checkmark */}
          <div className="mx-auto w-20 h-20 rounded-full bg-green-100 flex items-center
                          justify-center shadow-sm">
            <svg className="w-10 h-10 text-green-600" fill="none" stroke="currentColor"
              strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>

          <div>
            <h1 className="text-2xl font-bold text-gray-800 mb-2">
              All done!
            </h1>
            <p className="text-gray-500 leading-relaxed">
              Thank you, your details have been submitted.
            </p>
            <p className="text-gray-400 text-sm mt-3">
              Your manager will review your information and be in touch soon.
            </p>
          </div>

          {/* Subtle branding */}
          <p className="text-xs text-gray-300 pt-4">
            Powered by Hospitality Clock
          </p>
        </div>
      </div>
    );
  }

  // ─── Form screen ──────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-50 font-sans">

      {/* ── Top banner ── */}
      <div className="bg-gradient-to-r from-green-500 to-emerald-400 rounded-b-3xl px-5 pt-10 pb-10">
        <div className="max-w-lg mx-auto">
          {/* Logo mark */}
          <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center
                          justify-center mb-4">
            <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor"
              strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-white leading-tight">
            Welcome aboard 👋
          </h1>
          <p className="text-white/80 mt-2 text-sm leading-relaxed">
            Please fill in your details below so we can get you set up. It only
            takes a few minutes.
          </p>
        </div>
      </div>

      {/* ── Form ── */}
      <div className="max-w-lg mx-auto px-5 py-8">
        <form onSubmit={handleSubmit} className="space-y-6" noValidate>

          {/* ══ SECTION 1: PERSONAL DETAILS ══════════════════════════════════ */}
          <FormSection
            icon="👤"
            title="Personal Details"
            description="Your basic personal information."
          >
            {/* First name */}
            <Field label="First Name" required>
              <input
                type="text"
                name="first_name"
                value={form.first_name}
                onChange={handleChange}
                placeholder="e.g. Jane"
                autoComplete="given-name"
                className={inputCls}
                required
              />
            </Field>

            {/* Last name */}
            <Field label="Last Name" required>
              <input
                type="text"
                name="last_name"
                value={form.last_name}
                onChange={handleChange}
                placeholder="e.g. Smith"
                autoComplete="family-name"
                className={inputCls}
                required
              />
            </Field>

            {/* ID number */}
            <Field label="ID Number">
              <input
                type="text"
                name="id_number"
                value={form.id_number}
                onChange={handleChange}
                placeholder="Your national ID number"
                inputMode="numeric"
                className={inputCls}
              />
            </Field>

            {/* Date of birth */}
            <Field label="Date of Birth">
              <input
                type="date"
                name="date_of_birth"
                value={form.date_of_birth}
                onChange={handleChange}
                className={inputCls}
              />
            </Field>

            {/* Phone */}
            <Field label="Phone Number">
              <input
                type="tel"
                name="phone_number"
                value={form.phone_number}
                onChange={handleChange}
                placeholder="e.g. 082 123 4567"
                autoComplete="tel"
                inputMode="tel"
                className={inputCls}
              />
            </Field>

            {/* Email */}
            <Field label="Email Address">
              <input
                type="email"
                name="email"
                value={form.email}
                onChange={handleChange}
                placeholder="e.g. jane@example.com"
                autoComplete="email"
                inputMode="email"
                className={inputCls}
              />
            </Field>
          </FormSection>

          {/* ══ SECTION 2: EMPLOYMENT DETAILS ════════════════════════════════ */}
          <FormSection
            icon="💼"
            title="Employment Details"
            description="Tell us about your role."
          >
            {/* Role */}
            <Field label="Role / Position">
              <select
                name="role"
                value={form.role}
                onChange={handleChange}
                className={inputCls}
              >
                <option value="">— Select your role —</option>
                {ROLES.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </Field>

            {/* Branch — dropdown if loaded, text input if no branches found */}
            <Field label="Branch / Location">
              {branches.length > 0 ? (
                <select
                  name="branch"
                  value={form.branch}
                  onChange={handleChange}
                  className={inputCls}
                >
                  <option value="">— Select your branch —</option>
                  {branches.map((b) => (
                    <option key={b} value={b}>{b}</option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  name="branch"
                  value={form.branch}
                  onChange={handleChange}
                  placeholder="e.g. Cape Town Main"
                  className={inputCls}
                />
              )}
            </Field>

            {/* Pay frequency */}
            <Field label="Pay Frequency">
              <select
                name="pay_frequency"
                value={form.pay_frequency}
                onChange={handleChange}
                className={inputCls}
              >
                <option value="">— Select pay frequency —</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
              </select>
            </Field>

            {/* Pay basis */}
            <Field label="Pay Basis">
              <select
                name="pay_basis"
                value={form.pay_basis}
                onChange={handleChange}
                className={inputCls}
              >
                <option value="">— Select pay basis —</option>
                <option value="hourly">Hourly</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly (salary)</option>
              </select>
            </Field>
          </FormSection>

          {/* ══ SECTION 3: BANKING DETAILS ═══════════════════════════════════ */}
          <FormSection
            icon="🏦"
            title="Banking Details"
            description="We need this to process your pay. Your information is kept private."
          >
            {/* Bank name */}
            <Field label="Bank Name">
              <select
                name="bank_name"
                value={form.bank_name}
                onChange={handleChange}
                className={inputCls}
              >
                <option value="">— Select your bank —</option>
                {BANKS.map((b) => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </select>
            </Field>

            {/* Account number */}
            <Field label="Account Number">
              <input
                type="text"
                name="account_number"
                value={form.account_number}
                onChange={handleChange}
                placeholder="Your bank account number"
                inputMode="numeric"
                className={inputCls}
              />
            </Field>

            {/* Account type */}
            <Field label="Account Type">
              <select
                name="account_type"
                value={form.account_type}
                onChange={handleChange}
                className={inputCls}
              >
                <option value="">— Select account type —</option>
                <option value="savings">Savings</option>
                <option value="cheque">Cheque / Current</option>
              </select>
            </Field>

            {/* Branch code */}
            <Field label="Branch Code">
              <input
                type="text"
                name="branch_code"
                value={form.branch_code}
                onChange={handleChange}
                placeholder="e.g. 250655"
                inputMode="numeric"
                className={inputCls}
              />
              <p className="text-xs text-gray-400 mt-1.5">
                Find this on your bank card or in your banking app.
              </p>
            </Field>
          </FormSection>

          {/* ── Error message ── */}
          {submitError && (
            <div className="rounded-2xl bg-red-50 border border-red-200 px-4 py-4">
              <p className="text-sm text-red-600 font-medium">{submitError}</p>
            </div>
          )}

          {/* ── Privacy note ── */}
          <p className="text-xs text-gray-400 text-center leading-relaxed px-2">
            🔒 Your information is stored securely and will only be used by your
            employer for payroll and HR purposes.
          </p>

          {/* ── Submit button ── */}
          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full bg-green-500 hover:bg-green-600 active:scale-[0.98]
                       disabled:opacity-60 disabled:cursor-not-allowed text-white font-bold
                       text-base rounded-2xl px-6 py-4 transition-all duration-150
                       shadow-md shadow-green-200"
          >
            {isSubmitting ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10"
                    stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor"
                    d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4l-3 3 3 3h-4a8 8 0 01-8-8z" />
                </svg>
                Submitting…
              </span>
            ) : (
              "Submit My Details"
            )}
          </button>

          {/* Subtle footer */}
          <p className="text-center text-xs text-gray-300 pb-4">
            Powered by Hospitality Clock
          </p>

        </form>
      </div>
    </div>
  );
}

// ─── Small reusable layout components ────────────────────────────────────────

/**
 * FormSection
 * Wraps a group of related fields with a card header.
 */
function FormSection({
  icon,
  title,
  description,
  children,
}: {
  icon: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      {/* Section header */}
      <div className="px-5 pt-5 pb-4 border-b border-gray-50">
        <div className="flex items-center gap-3">
          <span className="text-2xl" aria-hidden="true">{icon}</span>
          <div>
            <h2 className="text-base font-bold text-gray-800 leading-tight">{title}</h2>
            <p className="text-xs text-gray-400 mt-0.5">{description}</p>
          </div>
        </div>
      </div>

      {/* Fields */}
      <div className="px-5 py-5 space-y-5">
        {children}
      </div>
    </div>
  );
}

/**
 * Field
 * Wraps a label and input with consistent spacing.
 * Pass `required` to show a red asterisk on the label.
 */
function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className={labelCls}>
        {label}
        {required && (
          <span className="text-red-500 ml-1" aria-label="required">*</span>
        )}
      </label>
      {children}
    </div>
  );
}
