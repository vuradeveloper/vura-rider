const PAYSTACK_BASE = 'https://api.paystack.co';

interface PaystackResponse<T = any> {
  status: boolean;
  message: string;
  data: T;
}

async function paystackRequest<T = any>(
  method: string,
  endpoint: string,
  body: Record<string, any> | null = null
): Promise<T> {
  const paystackSecret = process.env.PAYSTACK_SECRET_KEY;
  if (!paystackSecret) {
    throw new Error('PAYSTACK_SECRET_KEY is not configured');
  }

  const res = await fetch(`${PAYSTACK_BASE}${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${paystackSecret}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : null,
  });

  const data = (await res.json().catch(() => null)) as PaystackResponse<T> | null;
  if (!res.ok || !data?.status) {
    throw new Error(data?.message || 'Paystack request failed');
  }

  return data.data;
}

export const calculateFare = (amountRands: number) => {
  const commissionPercent = amountRands * 0.25;
  const commission = Math.min(commissionPercent, 5); // 25% capped at R5
  const rideRequestFee = amountRands * 0.04; // 4% passed to rider
  const driverEarns = amountRands - commission;
  const riderTotal = amountRands + rideRequestFee;
  return { commission, rideRequestFee, driverEarns, riderTotal };
};

export interface InitializePaymentResult {
  authorization_url: string;
  access_code: string;
  reference: string;
}

export interface VerifyPaymentResult {
  status: string;
  reference: string;
  metadata: { rideId: string; userId: string };
  authorization?: {
    authorization_code: string;
    card_type: string;
    last4: string;
    bank: string;
    reusable: boolean;
  };
}

export interface TransferRecipientResult {
  recipient_code: string;
}

export interface SubaccountResult {
  subaccount_code: string;
}

export const initializePayment = async ({
  email,
  amountRands,
  rideId,
  userId,
}: {
  email: string;
  amountRands: number;
  rideId: string;
  userId: string;
}): Promise<InitializePaymentResult> => {
  const payload: Record<string, any> = {
    email,
    amount: Math.round(amountRands * 100),
    currency: 'ZAR',
    reference: `vura_ride_${rideId}_${Date.now()}`,
    metadata: { rideId, userId },
  };

  if (process.env.APP_URL) {
    payload.callback_url = `${process.env.APP_URL.replace(/\/+$/, '')}/api/payments/verify`;
  }

  return paystackRequest('POST', '/transaction/initialize', payload);
};

export const verifyPayment = async (reference: string): Promise<VerifyPaymentResult> => {
  return paystackRequest('GET', `/transaction/verify/${reference}`);
};

export const chargeCard = async ({
  authorizationCode,
  email,
  amountRands,
  rideId,
}: {
  authorizationCode: string;
  email: string;
  amountRands: number;
  rideId: string;
}): Promise<{ status: string; reference: string }> => {
  return paystackRequest('POST', '/transaction/charge_authorization', {
    authorization_code: authorizationCode,
    email,
    amount: Math.round(amountRands * 100),
    currency: 'ZAR',
    reference: `vura_ride_${rideId}_${Date.now()}`,
    metadata: { rideId },
  });
};

export const createDriverSubaccount = async ({
  driverName,
  bankCode,
  accountNumber,
  email,
}: {
  driverName: string;
  bankCode: string;
  accountNumber: string;
  email: string;
}): Promise<SubaccountResult> => {
  return paystackRequest('POST', '/subaccount', {
    business_name: driverName,
    bank_code: bankCode,
    account_number: accountNumber,
    percentage_charge: 25,
    primary_contact_email: email,
    description: `Vura Driver - ${driverName}`,
  });
};

export const createTransferRecipient = async ({
  driverName,
  accountNumber,
  bankCode,
}: {
  driverName: string;
  accountNumber: string;
  bankCode: string;
}): Promise<TransferRecipientResult> => {
  return paystackRequest('POST', '/transferrecipient', {
    type: 'nuban',
    name: driverName,
    account_number: accountNumber,
    bank_code: bankCode,
    currency: 'ZAR',
  });
};

export const transferToDriver = async ({
  amountRands,
  driverName,
  recipientCode,
  rideIds,
}: {
  amountRands: number;
  driverName: string;
  recipientCode: string;
  rideIds: string[];
}): Promise<{ reference: string }> => {
  return paystackRequest('POST', '/transfer', {
    source: 'balance',
    amount: Math.round(amountRands * 100),
    currency: 'ZAR',
    recipient: recipientCode,
    reason: `Vura weekly earnings - ${driverName}`,
    reference: `vura_payout_${Date.now()}`,
    metadata: { rideIds, type: 'weekly_payout' },
  });
};

export const getSupportedBanks = async (): Promise<
  { name: string; code: string }[]
> => {
  return paystackRequest('GET', '/bank?currency=ZAR&country=south africa');
};

export const verifyBankAccount = async (
  accountNumber: string,
  bankCode: string
): Promise<{ account_name: string; account_number: string }> => {
  const params = new URLSearchParams({
    account_number: accountNumber,
    bank_code: bankCode,
  });

  return paystackRequest(
    'GET',
    `/bank/resolve?${params.toString()}`
  );
};

export const checkBalance = async (): Promise<
  { currency: string; balance: number }[]
> => {
  return paystackRequest('GET', '/balance');
};
