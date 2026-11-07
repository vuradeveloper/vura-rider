// cardSetup - one card-add flow for every screen.
//
// Paystack Inline ONLY. It is Paystack's own card modal rendered inside the app:
// the rider never leaves Vura, so there is no browser tab to come back from and
// no stale checkout page left behind. The server creates the reference; /verify
// stores the card and refunds the R1 verification charge.
//
// There is deliberately NO hosted-page fallback. Sending the rider to
// checkout.paystack.com and back was the thing that made card setup feel broken
// (the web page kept waiting for the issuer while the app showed its own stale
// modal). If Inline cannot load we report an error and let them retry in-app.
import { createCardIntent, verifyPayment } from "./backend";
import { openPaystackInline } from "./paystackInline";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** True when the server already has the card (and has started the R1 refund). */
function isSavedStatus(status: string): boolean {
  return (
    status === "success" ||
    status === "completed" ||
    status === "refunded" ||
    status === "card_saved"
  );
}

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
    if (isSavedStatus(status)) {
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
  // 1. Ask the server for a reference and the live Paystack public key.
  const intent = await createCardIntent().catch(() => null);
  if (!intent?.publicKey || !intent.reference || !intent.email) {
    return {
      ok: false,
      message:
        intent?.error ||
        "Could not start card setup. Check your internet connection and try again.",
    };
  }

  const reference = intent.reference;

  // 2. Paystack's card form, inside the app. `checkSaved` is the safety net:
  // some bank 3DS pages return to the app without firing Paystack's callback,
  // which used to leave the modal on "waiting for your card issuer" forever.
  // Polling the server closes the modal the moment the card is really saved.
  onStatus?.("Enter your card details. The R1 verification is refunded automatically.");
  const result = await openPaystackInline({
    publicKey: intent.publicKey,
    email: intent.email,
    amountRands: Number(intent.amountRands || 1),
    reference,
    checkSaved: async () => {
      const v = await verifyPayment(reference).catch(() => null);
      return isSavedStatus(String(v?.status || ""));
    },
  });

  if (result === "cancelled") {
    return { ok: false, cancelled: true, message: "Card setup cancelled." };
  }
  if (result === "failed") {
    return {
      ok: false,
      message:
        "Could not open the secure card form. Check your internet connection and try again.",
      reference,
    };
  }

  // 3. Confirm with the server. This also tokenises the card and requests the
  // R1 refund if the webhook has not landed yet.
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
