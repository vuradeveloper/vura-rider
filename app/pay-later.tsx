import { useRouter } from "expo-router";
import { useCallback, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import { formatCurrency } from "@/lib/utils";
import { getRideHistory } from "@/services/RideService";
import {
  getPayLaterStatus,
  enrollPayLater,
  refreshPayLater,
  payLaterRide,
  simulatePayLaterRide,
  runPayLaterCollection,
} from "@/services/PayLaterService";

const MOCK_ENROLL = {
  accountHolder: "Test Rider",
  bankCode: "470010",
  accountNumber: "1234567890",
};

export default function PayLaterScreen() {
  const router = useRouter();
  const [status, setStatus] = useState<any>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, h] = await Promise.all([
        getPayLaterStatus(),
        getRideHistory(1, 20),
      ]);
      setStatus(s);
      setHistory(h.rides || []);
    } catch (e: any) {
      setResult(`Load error: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const run = async (label: string, fn: () => Promise<any>) => {
    setBusy(true);
    setResult(null);
    try {
      const res = await fn();
      setResult(`${label}\n${JSON.stringify(res, null, 2)}`);
    } catch (e: any) {
      setResult(`${label}\nERROR: ${e.message}`);
      Alert.alert(label, e.message);
    } finally {
      setBusy(false);
      load();
    }
  };

  const account = status?.enrolled ? status.account : null;
  const openRides = (status?.rides || []).filter(
    (r: any) => r.payment_status === "pending"
  );
  const completedUnpaid = history.filter(
    (r) =>
      r.status === "completed" &&
      r.payment_method !== "pay_later" &&
      r.payment_status !== "paid"
  );

  return (
    <SafeAreaView className="flex-1 bg-background">
      <View className="bg-primary px-5 pt-4 pb-8 rounded-b-[2rem] relative">
        <TouchableOpacity
          onPress={() => router.back()}
          className="absolute top-4 left-4 w-9 h-9 rounded-full bg-white/20 items-center justify-center"
        >
          <Ionicons name="arrow-back" size={16} color="#fff" />
        </TouchableOpacity>
        <Text className="mt-12 text-2xl font-extrabold text-white">
          Pay Later
        </Text>
        <Text className="text-sm text-white/80 mt-1">
          Dev test harness · mock mode
        </Text>
      </View>

      <ScrollView
        className="flex-1 px-5 mt-6"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 60 }}
      >
        {loading && (
          <ActivityIndicator size="large" color="#e04e2f" style={{ marginTop: 40 }} />
        )}

        {!loading && !status?.enrolled && (
          <View className="rounded-2xl bg-surface border border-border p-5 items-center">
            <Ionicons name="time-outline" size={36} color="#e04e2f" />
            <Text className="text-base font-bold text-foreground mt-3">
              Not enrolled yet
            </Text>
            <Text className="text-xs text-muted-foreground text-center mt-1">
              Enroll to create the account (mock mandate + R1 card hold).
            </Text>
            <TouchableOpacity
              disabled={busy}
              onPress={() => run("Enroll", () => enrollPayLater(MOCK_ENROLL))}
              className="mt-4 rounded-full bg-primary px-6 py-3"
            >
              <Text className="text-sm font-bold text-primary-foreground">
                {busy ? "Working…" : "Enroll (mock)"}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {!loading && status?.enrolled && account && (
          <>
            <View className="rounded-2xl bg-surface border border-border p-4">
              <View className="flex-row justify-between items-center">
                <Text className="text-xs font-bold text-muted-foreground uppercase">
                  Account · {account.status}
                </Text>
                <View className="rounded-full bg-primary/10 px-2 py-0.5">
                  <Text className="text-[10px] font-bold text-primary uppercase">
                    {status.mode}
                  </Text>
                </View>
              </View>
              <View className="mt-3 flex-row gap-3">
                <View className="flex-1 rounded-xl bg-secondary p-3">
                  <Text className="text-[10px] uppercase font-bold text-muted-foreground">
                    Limit
                  </Text>
                  <Text className="text-lg font-extrabold text-foreground">
                    {formatCurrency(account.credit_limit)}
                  </Text>
                </View>
                <View className="flex-1 rounded-xl bg-secondary p-3">
                  <Text className="text-[10px] uppercase font-bold text-muted-foreground">
                    Outstanding
                  </Text>
                  <Text className="text-lg font-extrabold text-foreground">
                    {formatCurrency(account.outstanding)}
                  </Text>
                </View>
                <View className="flex-1 rounded-xl bg-emerald-50 border border-emerald-200 p-3">
                  <Text className="text-[10px] uppercase font-bold text-emerald-700">
                    Available
                  </Text>
                  <Text className="text-lg font-extrabold text-emerald-700">
                    {formatCurrency(account.available)}
                  </Text>
                </View>
              </View>
              <Text className="text-[11px] text-muted-foreground mt-3">
                Completed rides: {status.completed_rides} · Mandate:{" "}
                {account.mandate_token ? "active" : "none"} · Bank:{" "}
                {account.account_number_masked || "—"}
              </Text>
            </View>

            <View className="mt-4 flex-row gap-2">
              <TouchableOpacity
                disabled={busy}
                onPress={() => run("Refresh limit", refreshPayLater)}
                className="flex-1 items-center rounded-full bg-secondary py-3"
              >
                <Text className="text-xs font-bold text-foreground">Refresh limit</Text>
              </TouchableOpacity>
              <TouchableOpacity
                disabled={busy}
                onPress={() => run("Run month-end collect", runPayLaterCollection)}
                className="flex-1 items-center rounded-full bg-secondary py-3"
              >
                <Text className="text-xs font-bold text-foreground">Run collect</Text>
              </TouchableOpacity>
            </View>

            {openRides.length > 0 && (
              <View className="mt-5">
                <Text className="text-sm font-bold text-foreground mb-2">
                  Open Pay Later rides ({openRides.length})
                </Text>
                {openRides.map((r: any) => (
                  <View
                    key={r.id}
                    className="flex-row items-center justify-between rounded-xl border border-border bg-surface p-3.5 mb-2"
                  >
                    <View className="flex-1">
                      <Text className="text-xs font-bold text-foreground">
                        {formatCurrency(r.fare)}
                      </Text>
                      <Text className="text-[10px] text-muted-foreground">
                        Due {r.due_at ? new Date(r.due_at).toLocaleDateString("en-ZA") : "—"}
                      </Text>
                    </View>
                    <TouchableOpacity
                      disabled={busy}
                      onPress={() => run("Pay now", () => payLaterRide(r.id))}
                      className="rounded-full bg-primary px-4 py-2"
                    >
                      <Text className="text-xs font-bold text-primary-foreground">
                        Pay now
                      </Text>
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}

            <View className="mt-5">
              <Text className="text-sm font-bold text-foreground mb-2">
                Simulate a ride (dev)
              </Text>
              <Text className="text-[11px] text-muted-foreground mb-2">
                Pick a completed ride to mark as Pay Later — sets pending + due
                at month-end and adds the fare to outstanding.
              </Text>
              {completedUnpaid.length === 0 && (
                <Text className="text-xs text-muted-foreground">
                  No completed unpaid rides found. Complete a ride in the app
                  first (track.tsx auto-completes a trip).
                </Text>
              )}
              {completedUnpaid.map((r) => (
                <View
                  key={r.id}
                  className="flex-row items-center justify-between rounded-xl border border-border bg-surface p-3.5 mb-2"
                >
                  <View className="flex-1">
                    <Text className="text-xs font-bold text-foreground">
                      {formatCurrency(r.fare)}
                    </Text>
                    <Text className="text-[10px] text-muted-foreground" numberOfLines={1}>
                      {r.pickup_address} → {r.destination_address}
                    </Text>
                  </View>
                  <TouchableOpacity
                    disabled={busy}
                    onPress={() =>
                      run("Simulate", () => simulatePayLaterRide(r.id))
                    }
                    className="rounded-full bg-secondary border border-border px-4 py-2"
                  >
                    <Text className="text-xs font-bold text-foreground">
                      Mark pay-later
                    </Text>
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          </>
        )}

        {result && (
          <View className="mt-5 rounded-xl bg-foreground p-4">
            <Text className="text-[11px] font-bold text-background mb-1">
              Last result
            </Text>
            <Text className="text-[11px] text-background/80 font-mono">
              {result}
            </Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
