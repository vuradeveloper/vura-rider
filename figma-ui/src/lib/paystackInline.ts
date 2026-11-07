// paystackInline - Paystack's own card modal, inside the Vura app.
//
// The hosted checkout page cannot be framed (x-frame-options), and opening it in
// the OS browser is what made riders feel they had left the app. Paystack Inline
// is their official embedded checkout: the same card form, PIN/OTP handling and
// PCI scope, rendered as a modal over our WebView. Card data never touches Vura.

const SCRIPT_URL = "https://js.paystack.co/v1/inline.js";

let loadPromise: Promise<boolean> | null = null;

export function loadPaystackInline(): Promise<boolean> {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return Promise.resolve(false);
  }
  if ((window as any).PaystackPop) return Promise.resolve(true);
  if (loadPromise) return loadPromise;

  loadPromise = new Promise<boolean>((resolve) => {
    const existing = document.querySelector(`script[src="${SCRIPT_URL}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve(Boolean((window as any).PaystackPop)));
      existing.addEventListener("error", () => resolve(false));
      return;
    }
    const script = document.createElement("script");
    script.src = SCRIPT_URL;
    script.async = true;
    script.onload = () => resolve(Boolean((window as any).PaystackPop));
    script.onerror = () => resolve(false);
    document.head.appendChild(script);
  });
  return loadPromise;
}

export type InlineResult = "success" | "cancelled" | "failed";

export async function openPaystackInline(input: {
  publicKey: string;
  email: string;
  amountRands: number;
  reference: string;
  /**
   * Server-side truth check. Bank 3DS sometimes returns the rider to the app
   * without firing Paystack's callback, leaving its "waiting for your card
   * issuer" modal on screen. Polling the server lets us close the modal as soon
   * as the card is actually saved, regardless of the callback.
   */
  checkSaved?: () => Promise<boolean>;
}): Promise<InlineResult> {
  const loaded = await loadPaystackInline();
  const PaystackPop = (window as any).PaystackPop;
  if (!loaded || !PaystackPop?.setup) return "failed";

  return new Promise<InlineResult>((resolve) => {
    let settled = false;
    let handler: any = null;
    let poll: ReturnType<typeof setInterval> | null = null;

    // Paystack's modal is two iframes appended to <body>. Its own close() hides
    // them but can leave them in the DOM (and can throw when 3DS has moved the
    // modal into its "waiting for issuer" state). Removing them as well is what
    // stops a stale "Waiting for response from your card issuer" overlay from
    // sitting on top of the app after the card is already saved.
    const teardown = () => {
      const h = handler;
      try { h?.close?.(); } catch { /* modal already closed */ }
      setTimeout(() => {
        try { h?.background?.remove?.(); } catch { /* not attached */ }
        try { h?.iframe?.remove?.(); } catch { /* not attached */ }
      }, 350);
    };

    const finish = (result: InlineResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (poll) clearInterval(poll);
      teardown();
      resolve(result);
    };
    // This is a LOAD/HANG guard, not a card-entry timer. A rider can easily
    // spend a minute typing a card number and another minute in bank OTP, so a
    // short timeout used to close the modal mid-entry. Five minutes is only for
    // a modal that never becomes usable; normal success/cancel resolves much
    // earlier.
    const timer = setTimeout(() => finish("failed"), 5 * 60_000);

    try {
      // Clear any overlay left behind by an earlier attempt before opening.
      document
        .querySelectorAll('iframe[name^="paystack-checkout"]')
        .forEach((el) => el.remove());

      handler = PaystackPop.setup({
        key: input.publicKey,
        email: input.email,
        amount: Math.round(input.amountRands * 100),
        currency: "ZAR",
        ref: input.reference,
        callback: () => finish("success"),
        onClose: () => finish("cancelled"),
      });
      handler.openIframe();

      if (input.checkSaved) {
        poll = setInterval(async () => {
          if (settled) return;
          const saved = await input.checkSaved!().catch(() => false);
          if (saved) finish("success");
        }, 2500);
      }
    } catch {
      finish("failed");
    }
  });
}
