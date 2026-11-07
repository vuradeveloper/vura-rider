// cardSetup - one card-add flow for every screen.
//
// Preferred: Paystack Inline, Paystack's own card modal rendered inside the app.
// It collects the card, handles PIN/OTP and returns without leaving Vura. The
// server creates the reference; /verify stores the card and refunds the R1
// verification charge.
//
// Fallback: the hosted preauthorization page (R5 hold, released immediately)
// when the Inline script cannot load (offline build, blocked script).
import {
  createCardIntent,
  openExternalUrl,
  registerPaystackCard,
  verifyPayment,
} from "./backend";
import { openPaystackInline } from "./paystackInline";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface CardSetupResult {
  ok: boolean;
  cancelled?: boolean;
  message: string;
  reference?: string;
}

async function pollCardSaved(
  reference: string,
  onStatus?: (message: string) => void
): Promise<boolean> {
  const startedAt = Date.now();
  const ABANDON_GRACE_MS = 2 * 60 * 1000;
  const CEILING_MS = 15 * 60 * 1000;
  for (;;) {
    await sleep(2500);
    const v = await verifyPayment(reference).catch(() => null);
    const status = String(v?.status || "");
    if (status === "success" || status === "completed" || status === "refunded" || status === "card_saved") {
      return true;
    }
    if (status === "failed") return false;
    if (status === "abandoned" && Date.now() - startedAt >= ABANDON_GRACE_MS) return false;
    if (Date.now() - startedAt > CEILING_MS) {
      onStatus?.("Still waiting for your bank. The card saves as soon as it approves.");
      return false;
    }
  }
}

export async function startCardSetup(
  onStatus?: (message: string) => void
): Promise<CardSetupResult> {
  let reference = "";

  // 1. Preferred: in-app Paystack modal.
  const intent = await createCardIntent().catch(() => null);
  if (intent?.publicKey && intent.reference && intent.email) {
    onStatus?.("Enter your card details. The R1 verification is refunded automatically.");
    const result = await openPaystackInline({
      publicKey: intent.publicKey,
      email: intent.email,
      amountRands: Number(intent.amountRands || 1),
      reference: intent.reference,
    });
    if (result === "cancelled") {
      return { ok: false, cancelled: true, message: "Card setup cancelled." };
    }
    if (result === "success") {
      reference = intent.reference;
    }
    // "failed" means the Inline script could not load/initialise. Fall through
    // to the hosted page instead of dead-ending the rider.
  }

  // 2. Fallback: hosted Paystack page (preauthorization hold, released at once).
  if (!reference) {
    const reg = await registerPaystackCard().catch(() => null);
    if (!reg?.reference || !reg?.authorizationUrl) {
      return {
        ok: false,
        message: reg?.error || "Could not start card setup. Please try again.",
      };
    }
    onStatus?.("Opening the secure Paystack page...");
    await openExternalUrl(reg.authorizationUrl);
    reference = reg.reference;
  }

  onStatus?.("Confirming your card...");
  const saved = await pollCardSaved(reference, onStatus);
  if (!saved) {
    return {
      ok: false,
      message: "The card was not saved. Please try again or use a different card.",
      reference,
    };
  }
  return { ok: true, message: "Card added.", reference };
}
