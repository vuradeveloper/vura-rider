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
import { getAffiliateReferrals } from "@/services/AffiliateService";
import type { Referral, ReferralStatus } from "@/lib/types";

const STATUS_STYLE: Record<ReferralStatus, { label: string; cls: string; dot: string }> = {
  pending: { label: "Pending", cls: "bg-amber-50 border-amber-200", dot: "bg-amber-500" },
  settled: { label: "Settled", cls: "bg-emerald-50 border-emerald-200", dot: "bg-emerald-500" },
  disqualified: { label: "Disqualified", cls: "bg-red-50 border-red-200", dot: "bg-red-500" },
  lapsed: { label: "Expired", cls: "bg-secondary border-border", dot: "bg-muted-foreground" },
};

export default function AffiliateReferrals() {
  const router = useRouter();
  const { data, isLoading } = useQuery({
    queryKey: ["affiliate-referrals"],
    queryFn: getAffiliateReferrals,
  });

  const referrals: Referral[] = data?.referrals ?? [];

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
        <Text className="mt-12 text-xl font-bold text-white">My referrals</Text>
        <Text className="text-sm text-white/80 mt-1">
          People who joined with your code
        </Text>
      </View>

      <ScrollView className="flex-1 px-5 mt-5" showsVerticalScrollIndicator={false}>
        {isLoading ? (
          <View className="rounded-xl bg-surface border border-border p-8 items-center">
            <ActivityIndicator color="#e04e2f" />
          </View>
        ) : referrals.length === 0 ? (
          <View className="rounded-xl bg-surface border border-border p-8 items-center">
            <Ionicons name="people" size={40} color="#80716b" />
            <Text className="text-sm text-muted-foreground mt-3 text-center">
              No invites yet. Share your code from the Invite & earn screen to start.
            </Text>
          </View>
        ) : (
          referrals.map((r) => {
            const st = STATUS_STYLE[r.status];
            return (
              <View
                key={r.id}
                className="rounded-xl bg-surface border border-border px-4 py-3 mb-2"
              >
                <View className="flex-row items-center gap-3">
                  <View className="h-10 w-10 rounded-full bg-accent items-center justify-center">
                    <Text className="text-sm font-bold text-primary">
                      {(r.referred_name || "?").charAt(0).toUpperCase()}
                    </Text>
                  </View>
                  <View className="flex-1">
                    <Text className="text-sm font-bold text-foreground">
                      {r.referred_name || "Vura rider"}
                    </Text>
                    <Text className="text-[10px] text-muted-foreground">
                      {new Date(r.created_at).toLocaleDateString("en-ZA", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                    </Text>
                  </View>
                  <View className={`flex-row items-center gap-1.5 rounded-full border px-2.5 py-1 ${st.cls}`}>
                    <View className={`w-1.5 h-1.5 rounded-full ${st.dot}`} />
                    <Text className="text-[10px] font-bold text-foreground">{st.label}</Text>
                  </View>
                </View>
                {Number(r.rewarded_amount) > 0 && (
                  <View className="mt-2.5 border-t border-border pt-2 flex-row justify-between">
                    <Text className="text-xs text-muted-foreground">Rewarded</Text>
                    <Text className="text-xs font-bold text-emerald-600">
                      {formatCurrency(Number(r.rewarded_amount))}
                    </Text>
                  </View>
                )}
              </View>
            );
          })
        )}
      </ScrollView>
    </SafeAreaView>
  );
}