import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import * as Linking from "expo-linking";
import { useRouter } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  Share,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { formatCurrency } from "@/lib/utils";
import {
  getAffiliateSummary,
  getAffiliateTransactions,
  registerAffiliate,
} from "@/services/AffiliateService";
import type { AffiliateSummary, AffiliateTransaction } from "@/lib/types";

export default function AffiliateDashboard() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [registering, setRegistering] = useState(false);

  const summaryQuery = useQuery({
    queryKey: ["affiliate-me"],
    queryFn: getAffiliateSummary,
  });

  const txnQuery = useQuery({
    queryKey: ["affiliate-transactions"],
    queryFn: getAffiliateTransactions,
    enabled: !!summaryQuery.data?.affiliate,
  });

  const affiliate: AffiliateSummary | null = summaryQuery.data?.affiliate ?? null;
  const transactions: AffiliateTransaction[] = txnQuery.data?.transactions ?? [];
  const loading = summaryQuery.isLoading;

  const registerMutation = useMutation({
    mutationFn: registerAffiliate,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["affiliate-me"] });
    },
    onError: (e: any) => Alert.alert("Error", e.message || "Could not join the program"),
  });

  const shareLink = (code: string) => Linking.createURL(`r/${code}`);

  async function handleShare(code: string) {
    const url = shareLink(code);
    try {
      await Share.share({
        message: `Come ride with me! Use my code ${code} and we both earn. Download Vura: ${url}`,
      });
    } catch {}
  }

  function handleCopy(code: string) {
    Share.share({ message: `My Vura referral code: ${code}` }).catch(() => undefined);
  }

  function handleBack() {
    if (router.canGoBack()) router.back();
    else router.replace("/");
  }

  async function joinProgram() {
    if (registering) return;
    setRegistering(true);
    try {
      await registerMutation.mutateAsync();
    } finally {
      setRegistering(false);
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-background">
      <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
        <View className="bg-primary px-5 pt-4 pb-10 rounded-b-[2rem] relative overflow-hidden">
          <View className="absolute -right-10 -bottom-12 h-44 w-44 rounded-full bg-white/10" />
          <TouchableOpacity
            onPress={handleBack}
            className="absolute top-4 left-4 w-9 h-9 rounded-full bg-white/20 items-center justify-center"
          >
            <Ionicons name="arrow-back" size={16} color="#fff" />
          </TouchableOpacity>
          <Text className="mt-12 text-xl font-bold text-white">Invite & earn</Text>
          <Text className="text-sm text-white/80 mt-1">
            Share your code — earn R5 per friend's first ride.
          </Text>
        </View>

        <View className="px-5 -mt-6">
          {loading ? (
            <View className="rounded-2xl bg-surface border border-border p-8 items-center">
              <ActivityIndicator color="#e04e2f" />
            </View>
          ) : !affiliate ? (
            <View className="rounded-2xl bg-surface border border-border p-6 items-center -mt-2">
              <View className="h-16 w-16 rounded-full bg-accent items-center justify-center mb-3">
                <Ionicons name="gift" size={28} color="#e04e2f" />
              </View>
              <Text className="text-lg font-extrabold text-foreground text-center">
                Start earning R5 per friend
              </Text>
              <Text className="text-xs text-muted-foreground text-center mt-1 mb-5 px-4">
                Refer a friend — when they take their first ride, you earn R5 as ride credit.
              </Text>
              <TouchableOpacity
                onPress={joinProgram}
                disabled={registering}
                className="w-full rounded-xl bg-primary py-4 items-center"
              >
                {registering ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text className="text-sm font-bold text-primary-foreground">
                    Join the program
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          ) : (
            <>
              <View className="rounded-2xl bg-surface border border-border p-5">
                <Text className="text-[11px] uppercase font-bold text-muted-foreground">
                  Your earnings
                </Text>
                <Text className="mt-1 text-3xl font-extrabold text-foreground">
                  {formatCurrency(affiliate.balance)}
                </Text>
                <Text className="text-xs text-muted-foreground mt-1">
                  Total earned: {formatCurrency(affiliate.total_earned)}
                </Text>
                <Text className="text-xs text-emerald-700 mt-1.5 font-semibold">
                  This is ride credit you can use on trips.
                </Text>

                <View className="mt-4 flex-row items-center justify-between rounded-xl bg-secondary px-4 py-3">
                  <Text className="text-sm font-bold text-foreground">
                    {affiliate.referral_code}
                  </Text>
                  <View className="flex-row gap-2">
                    <TouchableOpacity
                      onPress={() => handleCopy(affiliate.referral_code)}
                      className="rounded-full bg-surface border border-border px-3 py-1.5 flex-row items-center gap-1"
                    >
                      <Ionicons name="copy" size={12} color="#e04e2f" />
                      <Text className="text-[10px] font-bold text-foreground">Copy</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => handleShare(affiliate.referral_code)}
                      className="rounded-full bg-primary px-3 py-1.5 flex-row items-center gap-1"
                    >
                      <Ionicons name="share" size={12} color="#fff" />
                      <Text className="text-[10px] font-bold text-white">Share</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>

              <View className="mt-4 flex-row gap-3">
                {[
                  { value: affiliate.settled_referrals, label: "Friends joined" },
                  { value: affiliate.pending_referrals, label: "Pending" },
                  { value: affiliate.total_referrals, label: "Total invites" },
                ].map((s) => (
                  <View
                    key={s.label}
                    className="flex-1 rounded-2xl bg-surface border border-border p-4 items-center"
                  >
                    <Text className="text-lg font-extrabold text-foreground">{s.value}</Text>
                    <Text className="text-[10px] text-muted-foreground uppercase text-center font-semibold mt-0.5">
                      {s.label}
                    </Text>
                  </View>
                ))}
              </View>

              <View className="mt-4 flex-row gap-3">
                <TouchableOpacity
                  onPress={() => router.push("/affiliate/referrals")}
                  className="flex-1 flex-row items-center justify-center gap-2 rounded-xl border border-border bg-surface py-3.5"
                >
                  <Ionicons name="people" size={16} color="#e04e2f" />
                  <Text className="text-xs font-bold text-foreground">My referrals</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => router.push("/affiliate/transactions")}
                  className="flex-1 flex-row items-center justify-center gap-2 rounded-xl border border-border bg-surface py-3.5"
                >
                  <Ionicons name="receipt" size={16} color="#e04e2f" />
                  <Text className="text-xs font-bold text-foreground">Transactions</Text>
                </TouchableOpacity>
              </View>

              <View className="mt-4 rounded-xl bg-emerald-50 border border-emerald-200 p-4">
                <View className="flex-row items-start gap-3">
                  <View className="w-9 h-9 rounded-full bg-emerald-100 items-center justify-center">
                    <Ionicons name="card" size={16} color="#16a34a" />
                  </View>
                  <View className="flex-1">
                    <Text className="text-xs font-bold text-emerald-800">
                      Use your balance on rides
                    </Text>
                    <Text className="text-[11px] text-emerald-700 mt-0.5 leading-4">
                      Choose "Affiliate credit" when booking — your balance must cover the full
                      fare.
                    </Text>
                  </View>
                </View>
              </View>

              <View className="mt-6">
                <View className="flex-row items-center justify-between mb-3">
                  <Text className="text-sm font-extrabold text-foreground">Recent earnings</Text>
                  <TouchableOpacity onPress={() => router.push("/affiliate/transactions")}>
                    <Text className="text-xs font-bold text-primary">View all</Text>
                  </TouchableOpacity>
                </View>
                {txnQuery.isLoading ? (
                  <View className="rounded-xl bg-surface border border-border p-6 items-center">
                    <ActivityIndicator size="small" color="#e04e2f" />
                  </View>
                ) : transactions.length === 0 ? (
                  <View className="rounded-xl bg-surface border border-border p-6 items-center">
                    <Ionicons name="receipt" size={28} color="#80716b" />
                    <Text className="text-xs text-muted-foreground mt-2 text-center">
                      No earnings yet — share your code to get started.
                    </Text>
                  </View>
                ) : (
                  transactions.slice(0, 5).map((t) => (
                    <View
                      key={t.id}
                      className="rounded-xl bg-surface border border-border px-4 py-3 mb-2 flex-row items-center justify-between"
                    >
                      <View className="flex-row items-center gap-3 flex-1">
                        <View className="w-8 h-8 rounded-full bg-accent items-center justify-center">
                          <Ionicons
                            name={t.type === "credit_used" ? "card" : "gift"}
                            size={14}
                            color="#e04e2f"
                          />
                        </View>
                        <View className="flex-1">
                          <Text className="text-xs font-bold text-foreground capitalize">
                            {t.type === "credit_used" ? "Ride credit" : t.type.replace("_", " ")}
                          </Text>
                          <Text className="text-[10px] text-muted-foreground">
                            {new Date(t.created_at).toLocaleDateString("en-ZA", {
                              day: "numeric",
                              month: "short",
                            })}
                          </Text>
                        </View>
                      </View>
                      <Text
                        className={`text-sm font-extrabold ${
                          Number(t.amount) >= 0 ? "text-emerald-600" : "text-red-600"
                        }`}
                      >
                        {Number(t.amount) >= 0 ? "+" : ""}
                        {formatCurrency(Number(t.amount))}
                      </Text>
                    </View>
                  ))
                )}
              </View>
            </>
          )}
        </View>
        <View className="h-8" />
      </ScrollView>
    </SafeAreaView>
  );
}