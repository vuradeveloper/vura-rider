import { apiFetch } from "@/lib/api";

export const getBanks = async () => apiFetch<any>("/api/payments/banks");

export const verifyBankAccount = async (accountNumber: string, bankCode: string) => {
  return apiFetch<any>("/api/payments/banks/verify", {
    method: "POST",
    body: JSON.stringify({ accountNumber, bankCode }),
  });
};

export const saveBankingDetails = async ({
  accountNumber,
  bankCode,
  bankName,
}: {
  accountNumber: string;
  bankCode: string;
  bankName: string;
}) => {
  return apiFetch<any>("/api/payments/driver/banking", {
    method: "POST",
    body: JSON.stringify({ accountNumber, bankCode, bankName }),
  });
};

export const getPendingEarnings = async () =>
  apiFetch<any>("/api/payments/driver/earnings/pending");
