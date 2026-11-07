// cardSetup - one card-add flow for every screen.
//
// Android: Paystack's NATIVE card form (lib/paystackNative.ts -> PaystackNative
// plugin). It is fully inside the app: card entry, PIN/OTP and the bank's
// 3-D Secure page are native Android screens. There is no iframe and no cookie
// bridge, which is what broke Inline after authentication.
//
// iOS/web: Paystack Inline remains the fallback (no native plugin there yet).
// There is no hosted checkout redirect in either path.
//
// The server creates the reference; /verify stores the card and refunds the R1
// verification charge.
import { createCardIntent, verifyPayment } from "./backend";
import { openPaystackInline } from "./paystackInline";
import { canUseNativeCardForm, chargeWithNativeCardForm } from "./paystackNative";

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

  // 2. Open the card form. On Android this is Paystack's native SDK screen; on
  // iOS/web it is Inline. Either way the rider stays inside Vura.
  onStatus?.("Enter your card details. The R1 verification is refunded automatically.");

  let result: "success" | "cancelled" | "failed";
  if (canUseNativeCardForm()) {
    try {
      result = await chargeWithNativeCardForm({
        publicKey: intent.publicKey,
        email: intent.email,
        reference,
        amountCents: Math.round(Number(intent.amountRands || 1) * 100),
        currency: "ZAR",
      });
    } catch (e: any) {
      // Paystack may have completed the charge before the native screen
      // reported an error. Trust the server before showing a failure.
      const alreadySaved = await verifyPayment(reference)
        .then((v) => isSavedStatus(String(v?.status || "")))
        .catch(() => false);
      if (alreadySaved) {
        return { ok: true, message: "Card added.", reference };
      }
      return {
        ok: false,
        message: e?.message || "The card could not be added. Please try again.",
        reference,
      };
    }
  } else {
    result = await openPaystackInline({
      publicKey: intent.publicKey,
      email: intent.email,
      amountRands: Number(intent.amountRands || 1),
      reference,
      checkSaved: async () => {
        const v = await verifyPayment(reference).catch(() => null);
        return isSavedStatus(String(v?.status || ""));
      },
    });
  }

  if (result === "cancelled" || result === "failed") {
    // The rider may have finished bank authentication and then dismissed the
    // modal (or the modal timed out) before Paystack's callback fired. A single
    // server check here turns that into success instead of losing a saved card.
    const alreadySaved = await verifyPayment(reference)
      .then((v) => isSavedStatus(String(v?.status || "")))
      .catch(() => false);
    if (alreadySaved) {
      return { ok: true, message: "Card added.", reference };
    }
    return result === "cancelled"
      ? { ok: false, cancelled: true, message: "Card setup cancelled." }
      : {
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
