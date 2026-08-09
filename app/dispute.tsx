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
import { useRouter, useLocalSearchParams } from "expo-router";
import { submitDispute } from "@/services/DisputeService";

const disputeTypes = [
  { id: "cancellation_fee", label: "Cancellation fee", icon: "close-circle" as const },
  { id: "refund", label: "Refund request", icon: "cash" as const },
  { id: "rating", label: "Rating issue", icon: "star" as const },
  { id: "lost_item", label: "Lost item", icon: "search" as const },
  { id: "other", label: "Other", icon: "ellipsis-horizontal" as const },
];

export default function DisputeScreen() {
  const router = useRouter();
  const { rideId } = useLocalSearchParams<{ rideId: string }>();
  const [type, setType] = useState("refund");
  const [reason, setReason] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    if (!rideId || !description.trim()) {
      Alert.alert("Error", "Please provide a description");
      return;
    }
    setSubmitting(true);
    try {
      await submitDispute({
        rideId,
        type,
        reason: reason || type,
        description,
      });
      Alert.alert("Submitted", "Your dispute has been logged. We'll review it shortly.", [
        { text: "OK", onPress: () => router.back() },
      ]);
    } catch (err: any) {
      Alert.alert("Error", err.message || "Failed to submit dispute");
    } finally {
      setSubmitting(false);
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
          Report an Issue
        </Text>
        <Text className="text-sm text-white/80 mt-1">
          We're here to help resolve any problems
        </Text>
      </View>

      <ScrollView className="flex-1 px-5 mt-6" showsVerticalScrollIndicator={false}>
        <Text className="text-xs font-bold text-muted-foreground uppercase mb-3">
          Issue type
        </Text>
        <View className="flex-row flex-wrap gap-2 mb-6">
          {disputeTypes.map((t) => {
            const active = type === t.id;
            return (
              <TouchableOpacity
                key={t.id}
                onPress={() => setType(t.id)}
                className={`flex-row items-center gap-1.5 rounded-full px-4 py-2.5 ${active ? "bg-primary" : "bg-secondary border border-border"}`}
              >
                <Ionicons
                  name={t.icon}
                  size={14}
                  color={active ? "#fff" : "#80716b"}
                />
                <Text
                  className={`text-xs font-bold ${active ? "text-primary-foreground" : "text-foreground"}`}
                >
                  {t.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <View className="gap-y-1 mb-4">
          <Text className="text-xs font-bold text-muted-foreground ml-1">
            Reason (optional)
          </Text>
          <TextInput
            placeholder="Brief reason"
            placeholderTextColor="#80716b"
            value={reason}
            onChangeText={setReason}
            className="w-full rounded-xl border border-border bg-surface px-4 py-3.5 text-sm font-semibold text-foreground"
          />
        </View>

        <View className="gap-y-1 mb-6">
          <Text className="text-xs font-bold text-muted-foreground ml-1">
            Description *
          </Text>
          <TextInput
            placeholder="Describe what happened in detail..."
            placeholderTextColor="#80716b"
            multiline
            numberOfLines={5}
            value={description}
            onChangeText={setDescription}
            className="w-full rounded-xl border border-border bg-surface px-4 py-3.5 text-sm font-semibold text-foreground h-32"
            textAlignVertical="top"
          />
        </View>

        <TouchableOpacity
          onPress={handleSubmit}
          disabled={!description.trim() || submitting}
          className={`w-full rounded-xl py-4 items-center mb-6 ${description.trim() && !submitting ? "bg-primary" : "bg-primary/50"}`}
        >
          {submitting ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text className="text-sm font-bold text-primary-foreground">
              Submit Report
            </Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}
