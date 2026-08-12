import { useQuery } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import {
  ActivityIndicator,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { formatCurrency } from "@/lib/utils";
import { getAffiliateTransactions } from "@/services/AffiliateService";
import type { AffiliateTransaction } from "@/lib/types";

export default function AffiliateTransactions() {
  const router = useRouter();
  const { data, isLoading } = useQuery({
    queryKey: ["affiliate-transactions"],
    queryFn: getAffiliateTransactions,
  });

  const txns: AffiliateTransaction[] = data?.transactions ?? [];

  function handleBack() {
    if (router.canGoBack()) router.back();
    else router.replace("/");
  }

  return (
    <SafeAreaView className="flex-1 bg-background">
      <View className="bg-primary px-5 pt-4 pb-8 rounded-b-[2rem] relative">
        <TouchableOpacity
          onPress={handleBack}
          className="absolute top-4 left-4 w-9 h-9 rounded-full bg-white/20 items-center justify-center"
        >
          <Ionicons name="arrow-back" size={16} color="#fff" />
        </TouchableOpacity>
        <Text className="mt-12 text-xl font-bold text-white">Earnings history</Text>
        <Text className="text-sm text-white/80 mt-1">
          Every reward and credit used on your account
        </Text>
      </View>

      <ScrollView className="flex-1 px-5 mt-5" showsVerticalScrollIndicator={false}>
        {isLoading ? (
          <View className="rounded-xl bg-surface border border-border p-8 items-center">
            <ActivityIndicator color="#e04e2f" />
          </View>
        ) : txns.length === 0 ? (
          <View className="rounded-xl bg-surface border border-border p-8 items-center">
            <Ionicons name="receipt" size={40} color="#80716b" />
            <Text className="text-sm text-muted-foreground mt-3 text-center">
              No transactions yet.
            </Text>
          </View>
        ) : (
          txns.map((t) => {
            const positive = Number(t.amount) >= 0;
            return (
              <View
                key={t.id}
                className="rounded-xl bg-surface border border-border px-4 py-3 mb-2 flex-row items-center justify-between"
              >
                <View className="flex-row items-center gap-3 flex-1">
                  <View className="w-10 h-10 rounded-full bg-accent items-center justify-center">
                    <Ionicons
                      name={t.type === "credit_used" ? "card" : "gift"}
                      size={16}
                      color="#e04e2f"
                    />
                  </View>
                  <View className="flex-1">
                    <Text className="text-sm font-bold text-foreground capitalize">
                      {t.type === "credit_used" ? "Ride credit" : t.type.replace("_", " ")}
                    </Text>
                    <Text className="text-[10px] text-muted-foreground">
                      {new Date(t.created_at).toLocaleDateString("en-ZA", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </Text>
                    {t.reference ? (
                      <Text className="text-[10px] text-muted-foreground">{t.reference}</Text>
                    ) : null}
                  </View>
                </View>
                <Text
                  className={`text-sm font-extrabold ${
                    positive ? "text-emerald-600" : "text-red-600"
                  }`}
                >
                  {positive ? "+" : ""}
                  {formatCurrency(Number(t.amount))}
                </Text>
              </View>
            );
          })
        )}
      </ScrollView>
    </SafeAreaView>
  );
}