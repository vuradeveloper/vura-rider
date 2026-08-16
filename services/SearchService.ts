import AsyncStorage from "@react-native-async-storage/async-storage";
import { apiFetch } from "@/lib/api";
import type { RecentSearch } from "@/lib/types";

const RECENT_KEY = "vura.searches.recent";

export async function getRecentSearches(): Promise<RecentSearch[]> {
  try {
    const data = await apiFetch<{ searches: RecentSearch[] }>("/api/searches");
    await AsyncStorage.setItem(RECENT_KEY, JSON.stringify(data.searches));
    return data.searches;
  } catch {
    const local = await AsyncStorage.getItem(RECENT_KEY);
    return local ? JSON.parse(local) : [];
  }
}

export async function saveSearch(search: {
  name: string;
  addr: string;
  lat: number;
  lng: number;
}): Promise<void> {
  const payload = {
    name: search.name,
    address: search.addr,
    lat: search.lat,
    lng: search.lng,
  };

  try {
    await apiFetch("/api/searches", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  } catch {
    // backend sync is best-effort
  }

  const local = await AsyncStorage.getItem(RECENT_KEY);
  const searches: RecentSearch[] = local ? JSON.parse(local) : [];
  const entry: RecentSearch = {
    id: Date.now().toString(),
    name: String(search.name || "").slice(0, 120),
    addr: String(search.addr || "").slice(0, 180),
    lat: search.lat,
    lng: search.lng,
    created_at: new Date().toISOString(),
  };
  const next: RecentSearch[] = [
    entry,
    ...searches.filter((s) => s.name !== entry.name),
  ].slice(0, 10);

  // The map tile cache can fill storage (web localStorage especially). Never
  // let a quota error crash the app — shrink the list, then give up silently.
  try {
    await AsyncStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    try {
      await AsyncStorage.setItem(RECENT_KEY, JSON.stringify(next.slice(0, 5)));
    } catch {
      try {
        await AsyncStorage.removeItem(RECENT_KEY);
      } catch {
        // ignore
      }
    }
  }
}

export async function clearRecentSearches(): Promise<void> {
  try {
    await apiFetch("/api/searches", { method: "DELETE" });
  } catch {
    // best-effort
  }
  await AsyncStorage.removeItem(RECENT_KEY);
}
