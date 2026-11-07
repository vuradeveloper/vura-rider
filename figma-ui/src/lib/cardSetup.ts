// cardSetup - one card-add flow for every screen.
//
// Android: Paystack's current native checkout (paystack-ui PaymentSheet) via
// the PaystackNative plugin. Card entry, PIN and OTP are native Android screens;
// bank 3DS opens Paystack's auth page and returns to the sheet. There is no
// cross-origin iframe and no cookie-support page, which is what broke Inline.
//
// iOS/web: Paystack Inline remains the fallback (no native plugin there yet).
// There is no hosted checkout redirect in either path.
//
// The server creates the reference; /verify stores the card and refunds the R1
// verification charge.
import { createCardIntent, registerPaystackCard, verifyPayment } from "./backend";
import { openPaystackInline } from "./paystackInline";
import {
  accessCodeFromUrl,
  canUseNativeCardForm,
  chargeWithNativeCardForm,
} from "./paystackNative";

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

async function isSavedNow(reference: string): Promise<boolean> {
  const v = await verifyPayment(reference).catch(() => null);
  return isSavedStatus(String(v?.status || ""));
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
  let reference = "";

  if (canUseNativeCardForm()) {
    // 1a. Public key for the Paystack SDK. card-intent already returns the live
    // public key (and validates the signed-in rider).
    const intent = await createCardIntent().catch(() => null);
    if (!intent?.publicKey) {
      return {
        ok: false,
        message:
          intent?.error ||
          "Could not start card setup. Check your internet connection and try again.",
      };
    }

    // 1b. Server initializes the R1 transaction and returns its checkout URL;
    // the last path segment is the access code the native sheet consumes.
    const reg = await registerPaystackCard().catch(() => null);
    if (!reg?.reference || !reg?.authorizationUrl) {
      return {
        ok: false,
        message:
          reg?.error ||
          "Could not start card setup. Please try again.",
      };
    }
    reference = reg.reference;
    const accessCode = accessCodeFromUrl(reg.authorizationUrl);
    if (!accessCode) {
      return {
        ok: false,
        message: "Could not start card setup. Please try again.",
        reference,
      };
    }

    onStatus?.("Enter your card details. The R1 verification is refunded automatically.");
    try {
      const result = await chargeWithNativeCardForm({
        publicKey: intent.publicKey,
        accessCode,
        reference,
      });
      if (result === "cancelled") {
        // The rider may have approved with the bank and then dismissed the
        // sheet before Paystack's callback landed.
        if (await isSavedNow(reference)) {
          return { ok: true, message: "Card added.", reference };
        }
        return { ok: false, cancelled: true, message: "Card setup cancelled." };
      }
    } catch (e: any) {
      if (await isSavedNow(reference)) {
        return { ok: true, message: "Card added.", reference };
      }
      return {
        ok: false,
        message: e?.message || "The card could not be added. Please try again.",
        reference,
      };
    }
  } else {
    // iOS/web: Inline. Android never reaches this branch.
    const intent = await createCardIntent().catch(() => null);
    if (!intent?.publicKey || !intent.reference || !intent.email) {
      return {
        ok: false,
        message:
          intent?.error ||
          "Could not start card setup. Check your internet connection and try again.",
      };
    }
    reference = intent.reference;

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

    if (result === "cancelled" || result === "failed") {
      if (await isSavedNow(reference)) {
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
  }

  // 2. Confirm with the server. This also tokenises the card and requests the
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
