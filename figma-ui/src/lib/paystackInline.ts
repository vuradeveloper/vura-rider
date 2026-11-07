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
}): Promise<InlineResult> {
  const loaded = await loadPaystackInline();
  const PaystackPop = (window as any).PaystackPop;
  if (!loaded || !PaystackPop?.setup) return "failed";

  return new Promise<InlineResult>((resolve) => {
    let settled = false;
    let handler: any = null;
    const finish = (result: InlineResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    // Paystack Inline should answer in seconds. In a WebView whose third-party
    // cookies are blocked it can sit on its cookie-support page forever; after
    // this timeout the shared card flow falls back to the hosted page instead
    // of leaving the rider on "connecting to your bank" indefinitely.
    const timer = setTimeout(() => {
      try { handler?.close?.(); } catch { /* modal already gone */ }
      finish("failed");
    }, 25_000);

    try {
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
    } catch {
      finish("failed");
    }
  });
}
