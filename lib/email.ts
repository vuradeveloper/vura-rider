import { getApiUrl } from "@/lib/config";

export async function sendVerificationEmail(payload: { email: string; code: string }) {
  try {
    const res = await fetch(getApiUrl("/api/email/send-verification"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    return data.success
      ? { success: true as const }
      : { success: false as const, error: data.error || "Failed to send email" };
  } catch (err: any) {
    return { success: false as const, error: err?.message || "Network error" };
  }
}
