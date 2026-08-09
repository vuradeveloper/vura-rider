import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { formatCurrency } from "@/lib/utils";
import { inviteToSplit, getSplitStatus } from "@/services/SplitFareService";

export default function FareSplitScreen() {
  const { rideId, fare } = useLocalSearchParams<{ rideId: string; fare?: string }>();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);

  const totalFare = fare ? parseFloat(fare) : 0;
  const splitAmount = totalFare / 2;

  async function handleInvite() {
    if (!email.trim() || !rideId) return;
    setSending(true);
    try {
      await inviteToSplit(rideId, email.trim(), splitAmount);
      Alert.alert("Invite Sent", `Split request sent to ${email.trim()}`, [
        { text: "OK", onPress: () => router.back() },
      ]);
    } catch (err: any) {
      Alert.alert("Error", err.message || "Failed to send split invite");
    } finally {
      setSending(false);
    }
  }

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
          Split Fare
        </Text>
        <Text className="text-sm text-white/80 mt-1">
          Split this ride with a friend
        </Text>
      </View>

      <ScrollView className="flex-1 px-5 mt-6" showsVerticalScrollIndicator={false}>
        <View className="rounded-xl bg-surface border border-border p-4 mb-6">
          <Text className="text-xs font-bold text-muted-foreground uppercase mb-2">
            Ride Total
          </Text>
          <Text className="text-2xl font-extrabold text-foreground">
            {formatCurrency(totalFare)}
          </Text>
          <View className="border-t border-border my-3" />
          <Text className="text-xs font-bold text-muted-foreground uppercase mb-2">
            Each person pays
          </Text>
          <Text className="text-lg font-bold text-foreground">
            {formatCurrency(splitAmount)}
          </Text>
        </View>

        <View className="gap-y-1 mb-6">
          <Text className="text-xs font-bold text-muted-foreground ml-1">
            Friend's email
          </Text>
          <TextInput
            placeholder="Enter their email address"
            placeholderTextColor="#80716b"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            className="w-full rounded-xl border border-border bg-surface px-4 py-3.5 text-sm font-semibold text-foreground"
          />
        </View>

        <TouchableOpacity
          onPress={handleInvite}
          disabled={!email.trim() || sending}
          className={`w-full rounded-xl py-4 items-center ${email.trim() && !sending ? "bg-primary" : "bg-primary/50"}`}
        >
          {sending ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text className="text-sm font-bold text-primary-foreground">
              Send Split Request
            </Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}
