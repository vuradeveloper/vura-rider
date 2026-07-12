const fallbackApiBase =
  process.env.NODE_ENV === "production" ? "" : "http://localhost:3000";

const apiBase = process.env.EXPO_PUBLIC_API_URL || fallbackApiBase;

export function getApiBaseUrl(): string {
  if (!apiBase) {
    throw new Error("EXPO_PUBLIC_API_URL is required");
  }

  if (process.env.NODE_ENV === "production" && !apiBase.startsWith("https://")) {
    throw new Error("EXPO_PUBLIC_API_URL must use HTTPS in production");
  }

  return apiBase.replace(/\/+$/, "");
}

export function getApiUrl(path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${getApiBaseUrl()}${normalizedPath}`;
}
