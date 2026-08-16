// iVerve payment adapter (Pay Later spike).
//
// Runs in mock mode by default so it is safe to develop against without real
// banking credentials. Set PAYMENTS_MODE=live to require a real integration —
// until sandbox credentials exist, live mode simply throws so nothing can be
// accidentally charged for real.

export type PaymentsMode = "mock" | "live";

export function paymentsMode(): PaymentsMode {
  return process.env.PAYMENTS_MODE === "live" ? "live" : "mock";
}

function randomId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function requireMock(): void {
  if (paymentsMode() !== "mock") {
    throw new Error(
      "iVerve live mode is not configured yet. Set PAYMENTS_MODE=mock or add sandbox credentials."
    );
  }
}

export interface MandateInput {
  accountHolder: string;
  bankCode: string;
  accountNumber: string;
}

export interface MandateResult {
  mandateToken: string;
  bankVerified: boolean;
}

// Create a debit-order mandate for month-end collection.
export async function createMandate(input: MandateInput): Promise<MandateResult> {
  requireMock();
  return { mandateToken: randomId("mock-mandate"), bankVerified: true };
}

export interface CardHoldResult {
  verified: boolean;
  holdReference: string;
}

// R1 authorization-only hold on a card. Confirms the card is live and can be
// charged later. The hold is voided/refunded by the provider.
export async function validateCardHold(cardToken: string): Promise<CardHoldResult> {
  requireMock();
  return { verified: true, holdReference: randomId("mock-hold") };
}

export interface CollectResult {
  success: boolean;
  reference?: string;
  error?: string;
}

// Attempt to collect from a stored mandate.
// PAYMENTS_MOCK_FAIL_COLLECT=1 forces failures so the overdue/freeze path can
// be exercised during development.
export async function collectMandate(
  mandateToken: string,
  amount: number,
  reference: string
): Promise<CollectResult> {
  requireMock();
  if (process.env.PAYMENTS_MOCK_FAIL_COLLECT === "1") {
    return { success: false, error: "Mock collection failed (insufficient funds)" };
  }
  return { success: true, reference: randomId("mock-collect") };
}
