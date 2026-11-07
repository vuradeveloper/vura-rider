// paystackNative - Paystack's current native checkout (paystack-ui SDK).
//
// The SDK's PaymentSheet is a native Android screen: card form, PIN, OTP and
// card-scheme icons. It uses Paystack's new /transaction/charge API.
//
// WHY NOT INLINE: Inline runs checkout.paystack.com in a cross-origin iframe and
// returns 3DS through paystack.com/public/test/cookie-support, which Android
// WebView blocks with ERR_BLOCKED_BY_RESPONSE.
// WHY NOT THE OLD SDK: co.paystack.android:paystack:3.5.0 posts to the legacy
// /checkout/card/charge endpoint, which answers "Invalid Transaction" here.
import { Capacitor, registerPlugin } from '@capacitor/core';

export interface NativeCardCharge {
  publicKey: string;
  accessCode: string;
  reference: string;
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
 * Opens Paystack's native checkout. Resolves "success" once Paystack has
 * completed the charge (the caller still verifies with the server) or
 * "cancelled" if the rider dismissed the sheet.
 */
export async function chargeWithNativeCardForm(
  input: NativeCardCharge
): Promise<'success' | 'cancelled'> {
  const result = await PaystackNative.charge(input);
  return result.status === 'success' ? 'success' : 'cancelled';
}

/**
 * Paystack's initialize response returns
 * https://checkout.paystack.com/<access_code>; the native sheet needs the code.
 */
export function accessCodeFromUrl(url: string): string {
  try {
    const parts = new URL(url).pathname.split('/').filter(Boolean);
    return parts.length > 0 ? parts[parts.length - 1] : '';
  } catch {
    return '';
  }
}
