// paystackNative - Paystack's native Android card form.
//
// Inline renders checkout.paystack.com inside a cross-origin iframe. After the
// bank's 3-D Secure step it loads paystack.com/public/test/cookie-support to
// pass the result back, and Android WebView blocks that page with
// ERR_BLOCKED_BY_RESPONSE - leaving the rider on "connecting to your bank"
// forever. The native SDK has no iframe and no cookie bridge, so the card form,
// PIN/OTP and 3DS all run as Android screens inside Vura.
import { Capacitor, registerPlugin } from '@capacitor/core';

export interface NativeCardCharge {
  publicKey: string;
  email: string;
  reference: string;
  amountCents: number;
  currency?: string;
}

interface PaystackNativePlugin {
  charge(options: NativeCardCharge): Promise<{
    status: 'success' | 'cancelled';
    reference?: string;
  }>;
}

const PaystackNative = registerPlugin<PaystackNativePlugin>('PaystackNative');

/** True when the native Paystack card form is available (Android app). */
export function canUseNativeCardForm(): boolean {
  return Capacitor.getPlatform() === 'android';
}

/**
 * Opens Paystack's native card form. Resolves "success" once Paystack has
 * completed the charge (the caller still verifies with the server) or
 * "cancelled" if the rider dismissed the native screens.
 */
export async function chargeWithNativeCardForm(
  input: NativeCardCharge
): Promise<'success' | 'cancelled'> {
  const result = await PaystackNative.charge(input);
  return result.status === 'success' ? 'success' : 'cancelled';
}
