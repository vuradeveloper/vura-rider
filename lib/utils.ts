export function cn(...classes: (string | undefined | false | null)[]) {
  return classes.filter(Boolean).join(" ");
}

export function formatCurrency(amount: number | null | undefined): string {
  const value = typeof amount === "number" && !isNaN(amount) ? amount : 0;
  return `R ${value.toLocaleString("en-ZA", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function formatRideDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (isNaN(date.getTime())) return "";

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.round(
    (startOfToday.getTime() - startOfDate.getTime()) / 86400000
  );

  const time = date.toLocaleTimeString("en-ZA", {
    hour: "numeric",
    minute: "2-digit",
  });

  let label: string;
  if (diffDays === 0) label = "Today";
  else if (diffDays === 1) label = "Yesterday";
  else if (diffDays > 1 && diffDays < 7)
    label = date.toLocaleDateString("en-ZA", { weekday: "short" });
  else label = date.toLocaleDateString("en-ZA", { day: "numeric", month: "short" });

  return `${label} · ${time}`;
}

export function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Mirrors backend base fare (R2 + R1.5/km) with per-tier multipliers.
export function estimateFare(distanceKm: number, multiplier = 1): number {
  const base = 2 + distanceKm * 1.5;
  return Math.round(base * multiplier * 100) / 100;
}

export function estimateEtaMins(distanceKm: number): number {
  // Assume ~30 km/h average city speed, min 2 mins.
  return Math.max(2, Math.round((distanceKm / 30) * 60));
}


