import type { DamageAnalysis } from "@/lib/vision";

export interface ScanImage {
  id: string;
  angle: string;
  label: string;
  dataUrl: string;
  timestamp: number;
  analysis?: DamageAnalysis;
  analyzing?: boolean;
}

export type ScanType = "routine" | "complaint";

export interface CarScan {
  id: string;
  images: ScanImage[];
  timestamp: number;
  type: ScanType;
  notes: string;
  submitted: boolean;
}

const SCANS_KEY = "vura.car-scans";

function getAll(): CarScan[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(SCANS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveAll(scans: CarScan[]) {
  localStorage.setItem(SCANS_KEY, JSON.stringify(scans));
  window.dispatchEvent(new Event("vura:car-scans"));
}

export function getScans(): CarScan[] {
  return getAll();
}

export function getLatestScan(): CarScan | null {
  const scans = getAll();
  return scans.length > 0 ? scans[scans.length - 1] : null;
}

export function submitScan(scan: CarScan) {
  const scans = getAll();
  scans.push(scan);
  saveAll(scans);
}

export function deleteScan(id: string) {
  const scans = getAll().filter((s) => s.id !== id);
  saveAll(scans);
}

import { useEffect, useState } from "react";

export function useCarScans() {
  const [scans, setScans] = useState<CarScan[]>([]);
  useEffect(() => {
    setScans(getAll());
    const h = () => setScans(getAll());
    window.addEventListener("vura:car-scans", h);
    window.addEventListener("storage", h);
    return () => {
      window.removeEventListener("vura:car-scans", h);
      window.removeEventListener("storage", h);
    };
  }, []);
  return scans;
}

const EXTERIOR_ANGLES = [
  { id: "front", label: "Front", desc: "Stand 2m in front of the car" },
  { id: "rear", label: "Rear", desc: "Stand 2m behind the car" },
  { id: "left", label: "Left Side", desc: "Stand 2m from the left side" },
  { id: "right", label: "Right Side", desc: "Stand 2m from the right side" },
  { id: "hood", label: "Hood / Bonnet", desc: "Top-down view of the hood" },
  { id: "trunk", label: "Trunk / Boot", desc: "Close-up of the trunk area" },
];

const INTERIOR_ANGLES = [
  { id: "dashboard", label: "Dashboard", desc: "Front dashboard & steering wheel" },
  { id: "front-seats", label: "Front Seats", desc: "Driver & passenger seats" },
  { id: "back-seats", label: "Back Seats", desc: "Rear passenger area" },
  { id: "trunk-interior", label: "Trunk Interior", desc: "Inside the trunk/boot" },
];

export type ScanSection = "exterior" | "interior";

export function getAngles(section: ScanSection) {
  return section === "exterior" ? EXTERIOR_ANGLES : INTERIOR_ANGLES;
}
