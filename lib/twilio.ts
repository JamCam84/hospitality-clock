import twilio from "twilio";

// ─── Twilio client ────────────────────────────────────────────────────────────

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID!,
  process.env.TWILIO_AUTH_TOKEN!
);

// ─── Custom error class ───────────────────────────────────────────────────────
// Carries the full Twilio error payload so callers can surface code + moreInfo
// without losing them in a generic Error re-throw.

export class TwilioSendError extends Error {
  readonly twilioCode:     number | undefined;
  readonly twilioMoreInfo: string | undefined;
  readonly twilioStatus:   number | undefined;

  constructor(
    message: string,
    opts?: { code?: number; moreInfo?: string; status?: number }
  ) {
    super(message);
    this.name            = "TwilioSendError";
    this.twilioCode      = opts?.code;
    this.twilioMoreInfo  = opts?.moreInfo;
    this.twilioStatus    = opts?.status;
  }
}

// ─── Phone normalisation ──────────────────────────────────────────────────────

/**
 * Normalises a phone number to E.164 (+27xxxxxxxxx) format.
 *
 * Accepts:
 *   "0821234567"     → "+27821234567"   (SA local)
 *   "27821234567"    → "+27821234567"   (missing leading +)
 *   "+27821234567"   → "+27821234567"   (already correct, unchanged)
 *
 * Throws a descriptive error if the result looks invalid.
 */
export function normalisePhone(raw: string): string {
  console.log("[twilio:normalisePhone] raw input:", raw);

  // Strip spaces, dashes, parentheses, and the + sign (re-added at the end)
  let n = raw.replace(/[\s\-()+]/g, "");
  console.log("[twilio:normalisePhone] after stripping formatting:", n);

  // Must be digits only at this point
  if (!/^\d+$/.test(n)) {
    throw new Error(
      `Phone "${raw}" contains invalid characters after stripping formatting. ` +
      `Got: "${n}"`
    );
  }

  // SA local format: 0821234567 → 27821234567
  if (n.startsWith("0")) {
    n = "27" + n.slice(1);
    console.log("[twilio:normalisePhone] converted SA local 0xx → 27xx:", n);
  }

  // Prepend + to get E.164: 27821234567 → +27821234567
  const e164 = "+" + n;

  // Sanity check: E.164 after the + should be 7–15 digits
  if (n.length < 7 || n.length > 15) {
    throw new Error(
      `Phone "${raw}" normalised to "${e164}" which is invalid ` +
      `(expected 7–15 digits after +, got ${n.length}).`
    );
  }

  console.log("[twilio:normalisePhone] final E.164:", e164);
  return e164;
}

// ─── Send function ────────────────────────────────────────────────────────────

/**
 * sendWhatsAppMessage
 *
 * Sends a WhatsApp message via Twilio.
 *
 * @param to      Recipient phone — any SA format. Normalised to E.164 before sending.
 * @param message The text body to send.
 * @returns       The Twilio message SID on success.
 * @throws        TwilioSendError with .twilioCode and .twilioMoreInfo on failure.
 */
export async function sendWhatsAppMessage(
  to: string,
  message: string
): Promise<string> {

  // ── Validate env vars ──────────────────────────────────────────────────────
  const from = process.env.TWILIO_WHATSAPP_FROM;
  console.log("[twilio:send] TWILIO_WHATSAPP_FROM:", from ?? "(not set)");

  if (!from) {
    throw new TwilioSendError(
      "TWILIO_WHATSAPP_FROM is not set. Add it to your .env.local and restart the server."
    );
  }

  if (!process.env.TWILIO_ACCOUNT_SID) {
    throw new TwilioSendError("TWILIO_ACCOUNT_SID is not set.");
  }

  if (!process.env.TWILIO_AUTH_TOKEN) {
    throw new TwilioSendError("TWILIO_AUTH_TOKEN is not set.");
  }

  // ── Normalise phone number ─────────────────────────────────────────────────
  const normalised = normalisePhone(to);         // throws if invalid
  const toWhatsApp = `whatsapp:${normalised}`;

  // ── Log full outgoing payload ──────────────────────────────────────────────
  console.log("[twilio:send] ─── Outgoing message ───────────────────");
  console.log("[twilio:send]   from:   ", from);
  console.log("[twilio:send]   to:     ", toWhatsApp);
  console.log("[twilio:send]   body:   ", message);
  console.log("[twilio:send] ────────────────────────────────────────");

  // ── Call Twilio ────────────────────────────────────────────────────────────
  try {
    const result = await client.messages.create({
      from,
      to:   toWhatsApp,
      body: message,
    });

    console.log("[twilio:send] ✅ Success!");
    console.log("[twilio:send]   SID:    ", result.sid);
    console.log("[twilio:send]   status: ", result.status);

    return result.sid;

  } catch (err: unknown) {
    // Log the raw Twilio error object in full before transforming it
    console.error("[twilio:send] ❌ Twilio API call failed:");
    console.error("[twilio:send]   raw error:", err);

    // Twilio errors have .code, .message, .moreInfo, .status
    if (err && typeof err === "object" && "code" in err) {
      const t = err as {
        code:      number;
        message:   string;
        moreInfo?: string;
        status?:   number;
      };

      console.error("[twilio:send]   code:     ", t.code);
      console.error("[twilio:send]   message:  ", t.message);
      console.error("[twilio:send]   moreInfo: ", t.moreInfo ?? "(none)");
      console.error("[twilio:send]   status:   ", t.status ?? "(none)");

      throw new TwilioSendError(t.message, {
        code:     t.code,
        moreInfo: t.moreInfo,
        status:   t.status,
      });
    }

    // Unknown error shape — wrap it
    const msg = err instanceof Error ? err.message : String(err);
    throw new TwilioSendError(`Unexpected error: ${msg}`);
  }
}
