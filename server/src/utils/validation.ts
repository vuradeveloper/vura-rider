import { validate as validateUuid } from "uuid";

export function asTrimmedString(
  value: unknown,
  options: { maxLength?: number } = {}
): string | null {
  if (typeof value !== "string") return null;

  const trimmed = value.trim();
  if (!trimmed) return null;
  if (options.maxLength && trimmed.length > options.maxLength) return null;

  return trimmed;
}

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && validateUuid(value);
}

export function parsePositiveInteger(
  value: unknown,
  fallback: number,
  max: number
): number {
  const parsed =
    typeof value === "number" ? value : parseInt(String(value ?? ""), 10);

  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

export function parseFiniteNumber(value: unknown): number | null {
  const parsed =
    typeof value === "number" ? value : parseFloat(String(value ?? ""));

  return Number.isFinite(parsed) ? parsed : null;
}

export function isLatitude(value: number): boolean {
  return value >= -90 && value <= 90;
}

export function isLongitude(value: number): boolean {
  return value >= -180 && value <= 180;
}

export function isAccountNumber(value: string): boolean {
  return /^\d{5,20}$/.test(value);
}

export function isBankCode(value: string): boolean {
  return /^[A-Za-z0-9_-]{2,20}$/.test(value);
}
