import { NextRequest, NextResponse } from "next/server";
import { sendWhatsAppMessage, normalisePhone, TwilioSendError } from "@/lib/twilio";

/**
 * POST /api/send-whatsapp
 *
 * Body:    { phoneNumber: string, message: string }
 *
 * Success  200: { success: true,  step: "sent",       sid: string }
 * Failure  400: { success: false, step: string,       error: string }
 * Failure  500: { success: false, step: "twilio_send", error: string,
 *                 twilioCode?: number, twilioMoreInfo?: string }
 */
export async function POST(req: NextRequest) {

  console.log("[api/send-whatsapp] ═══ Request received ═══════════════════════");

  // ── Step 1: Parse body ────────────────────────────────────────────────────
  let body: { phoneNumber?: unknown; message?: unknown };
  try {
    body = await req.json();
    console.log("[api/send-whatsapp] Step 1 ✅ Body parsed:", JSON.stringify(body));
  } catch {
    console.error("[api/send-whatsapp] Step 1 ❌ Failed to parse JSON body");
    return NextResponse.json(
      { success: false, step: "parse_body", error: "Invalid JSON body." },
      { status: 400 }
    );
  }

  const { phoneNumber, message } = body;

  // ── Step 2: Validate phoneNumber ──────────────────────────────────────────
  console.log("[api/send-whatsapp] Step 2 — Validating phoneNumber:", phoneNumber);

  if (!phoneNumber || typeof phoneNumber !== "string" || !phoneNumber.trim()) {
    console.error("[api/send-whatsapp] Step 2 ❌ phoneNumber missing or empty");
    return NextResponse.json(
      { success: false, step: "validate_phone", error: "phoneNumber is required." },
      { status: 400 }
    );
  }

  // ── Step 3: Validate message ──────────────────────────────────────────────
  console.log("[api/send-whatsapp] Step 3 — Validating message");

  if (!message || typeof message !== "string" || !message.trim()) {
    console.error("[api/send-whatsapp] Step 3 ❌ message missing or empty");
    return NextResponse.json(
      { success: false, step: "validate_message", error: "message is required." },
      { status: 400 }
    );
  }

  // ── Step 4: Normalise phone number ────────────────────────────────────────
  console.log("[api/send-whatsapp] Step 4 — Normalising phone number:", phoneNumber.trim());

  let normalisedPhone: string;
  try {
    normalisedPhone = normalisePhone(phoneNumber.trim());
    console.log("[api/send-whatsapp] Step 4 ✅ Normalised:", normalisedPhone);
  } catch (err: unknown) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error("[api/send-whatsapp] Step 4 ❌ Phone normalisation failed:", detail);
    return NextResponse.json(
      { success: false, step: "normalise_phone", error: detail },
      { status: 400 }
    );
  }

  // ── Step 5: Log the Twilio from number ───────────────────────────────────
  const twilioFrom = process.env.TWILIO_WHATSAPP_FROM;
  console.log("[api/send-whatsapp] Step 5 — Twilio from number:", twilioFrom ?? "(NOT SET)");
  console.log("[api/send-whatsapp]           Twilio to number:  ", `whatsapp:${normalisedPhone}`);
  console.log("[api/send-whatsapp]           Message preview:   ", (message as string).slice(0, 100));

  // ── Step 6: Send via Twilio ───────────────────────────────────────────────
  console.log("[api/send-whatsapp] Step 6 — Calling Twilio…");

  try {
    const sid = await sendWhatsAppMessage(
      (phoneNumber as string).trim(),
      (message    as string).trim()
    );

    console.log("[api/send-whatsapp] Step 6 ✅ Message sent! SID:", sid);
    console.log("[api/send-whatsapp] ═══════════════════════════════════════════════");

    return NextResponse.json({ success: true, step: "sent", sid });

  } catch (err: unknown) {
    console.error("[api/send-whatsapp] Step 6 ❌ Twilio send failed:");
    console.error("[api/send-whatsapp]   error:", err);

    // If it's our custom TwilioSendError we have structured data to return
    if (err instanceof TwilioSendError) {
      console.error("[api/send-whatsapp]   twilioCode:    ", err.twilioCode    ?? "(none)");
      console.error("[api/send-whatsapp]   twilioMoreInfo:", err.twilioMoreInfo ?? "(none)");
      console.error("[api/send-whatsapp]   twilioStatus:  ", err.twilioStatus   ?? "(none)");

      return NextResponse.json(
        {
          success:       false,
          step:          "twilio_send",
          error:         err.message,
          twilioCode:    err.twilioCode    ?? null,
          twilioMoreInfo: err.twilioMoreInfo ?? null,
        },
        { status: 500 }
      );
    }

    // Unknown error
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { success: false, step: "twilio_send", error: msg },
      { status: 500 }
    );
  }
}
