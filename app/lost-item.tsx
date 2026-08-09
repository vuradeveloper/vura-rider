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
import { reportLostItem } from "@/services/DisputeService";

export default function LostItemScreen() {
  const router = useRouter();
  const { rideId } = useLocalSearchParams<{ rideId: string }>();
  const [itemName, setItemName] = useState("");
  const [itemDescription, setItemDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    if (!rideId || !itemName.trim()) {
      Alert.alert("Error", "Please describe the item you lost");
      return;
    }
    setSubmitting(true);
    try {
      await reportLostItem({
        rideId,
        itemName: itemName.trim(),
        itemDescription: itemDescription.trim(),
      });
      Alert.alert(
        "Reported",
        "We've notified the driver about your lost item. Check your activity for updates.",
        [{ text: "OK", onPress: () => router.back() }]
      );
    } catch (err: any) {
      Alert.alert("Error", err.message || "Failed to report lost item");
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
          Lost an Item?
        </Text>
        <Text className="text-sm text-white/80 mt-1">
          We'll help you get it back
        </Text>
      </View>

      <ScrollView className="flex-1 px-5 mt-6" showsVerticalScrollIndicator={false}>
        <View className="rounded-xl bg-amber-50 border border-amber-200 p-4 mb-6">
          <View className="flex-row items-start gap-2">
            <Ionicons name="information-circle" size={18} color="#d97706" />
            <Text className="text-xs text-amber-800 flex-1">
              Lost items are reported to the driver. If found, they'll contact
              you through the app. You can also check your ride receipt for
              driver details.
            </Text>
          </View>
        </View>

        <View className="gap-y-1 mb-4">
          <Text className="text-xs font-bold text-muted-foreground ml-1">
            Item name *
          </Text>
          <TextInput
            placeholder="e.g. Phone, Wallet, Backpack"
            placeholderTextColor="#80716b"
            value={itemName}
            onChangeText={setItemName}
            className="w-full rounded-xl border border-border bg-surface px-4 py-3.5 text-sm font-semibold text-foreground"
          />
        </View>

        <View className="gap-y-1 mb-6">
          <Text className="text-xs font-bold text-muted-foreground ml-1">
            Description
          </Text>
          <TextInput
            placeholder="Color, brand, where you think you left it..."
            placeholderTextColor="#80716b"
            multiline
            numberOfLines={4}
            value={itemDescription}
            onChangeText={setItemDescription}
            className="w-full rounded-xl border border-border bg-surface px-4 py-3.5 text-sm font-semibold text-foreground h-24"
            textAlignVertical="top"
          />
        </View>

        <TouchableOpacity
          onPress={handleSubmit}
          disabled={!itemName.trim() || submitting}
          className={`w-full rounded-xl py-4 items-center mb-6 ${itemName.trim() && !submitting ? "bg-primary" : "bg-primary/50"}`}
        >
          {submitting ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text className="text-sm font-bold text-primary-foreground">
              Report Lost Item
            </Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}
