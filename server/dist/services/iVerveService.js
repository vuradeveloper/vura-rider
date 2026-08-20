"use strict";
// iVerve payment adapter (Pay Later spike).
//
// Runs in mock mode by default so it is safe to develop against without real
// banking credentials. Set PAYMENTS_MODE=live to require a real integration —
// until sandbox credentials exist, live mode simply throws so nothing can be
// accidentally charged for real.
Object.defineProperty(exports, "__esModule", { value: true });
exports.paymentsMode = paymentsMode;
exports.createMandate = createMandate;
exports.validateCardHold = validateCardHold;
exports.collectMandate = collectMandate;
function paymentsMode() {
    return process.env.PAYMENTS_MODE === "live" ? "live" : "mock";
}
function randomId(prefix) {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
function requireMock() {
    if (paymentsMode() !== "mock") {
        throw new Error("iVerve live mode is not configured yet. Set PAYMENTS_MODE=mock or add sandbox credentials.");
    }
}
// Create a debit-order mandate for month-end collection.
async function createMandate(input) {
    requireMock();
    return { mandateToken: randomId("mock-mandate"), bankVerified: true };
}
// R1 authorization-only hold on a card. Confirms the card is live and can be
// charged later. The hold is voided/refunded by the provider.
async function validateCardHold(cardToken) {
    requireMock();
    return { verified: true, holdReference: randomId("mock-hold") };
}
// Attempt to collect from a stored mandate.
// PAYMENTS_MOCK_FAIL_COLLECT=1 forces failures so the overdue/freeze path can
// be exercised during development.
async function collectMandate(mandateToken, amount, reference) {
    requireMock();
    if (process.env.PAYMENTS_MOCK_FAIL_COLLECT === "1") {
        return { success: false, error: "Mock collection failed (insufficient funds)" };
    }
    return { success: true, reference: randomId("mock-collect") };
}
//# sourceMappingURL=iVerveService.js.map