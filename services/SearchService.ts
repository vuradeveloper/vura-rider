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
  const next: RecentSearch[] = [
    { id: Date.now().toString(), ...search, created_at: new Date().toISOString() },
    ...searches.filter((s) => s.name !== search.name),
  ].slice(0, 20);
  await AsyncStorage.setItem(RECENT_KEY, JSON.stringify(next));
}

export async function clearRecentSearches(): Promise<void> {
  try {
    await apiFetch("/api/searches", { method: "DELETE" });
  } catch {
    // best-effort
  }
  await AsyncStorage.removeItem(RECENT_KEY);
}
