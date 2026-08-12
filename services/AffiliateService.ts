import { apiFetch } from "@/lib/api";
import type { AffiliateSummary, AffiliateTransaction, Referral } from "@/lib/types";

export const registerAffiliateFlag = "vura.affiliate.registered";

export const registerAffiliate = async () =>
  apiFetch<{ affiliate: AffiliateSummary }>("/api/affiliates/register", {
    method: "POST",
  });

export const getAffiliateSummary = async () =>
  apiFetch<{ affiliate: AffiliateSummary | null }>("/api/affiliates/me");

export const getAffiliateReferrals = async () =>
  apiFetch<{ referrals: Referral[] }>("/api/affiliates/me/referrals");

export const getAffiliateTransactions = async () =>
  apiFetch<{ transactions: AffiliateTransaction[] }>("/api/affiliates/me/transactions");

export const claimReferralCode = async (code: string) =>
  apiFetch<{ success: boolean; alreadyReferred?: boolean }>("/api/affiliates/claim", {
    method: "POST",
    body: JSON.stringify({ code }),
  });