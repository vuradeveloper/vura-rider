import { useRouter } from "expo-router";
import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  ScrollView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

export default function AddPaymentMethod() {
  const router = useRouter();
  const [cardNumber, setCardNumber] = useState("");
  const [expiry, setExpiry] = useState("");
  const [cvc, setCvc] = useState("");
  const [name, setName] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const validateCard = () => {
    // Simple validation - in real app, use Stripe validation
    const digitsOnly = cardNumber.replace(/\s/g, "");
    if (!digitsOnly || digitsOnly.length < 16) {
      Alert.alert("Invalid card number");
      return false;
    }
    if (!expiry || !expiry.includes("/")) {
      Alert.alert("Invalid expiry date (use MM/YY format)");
      return false;
    }
    if (!cvc || cvc.length < 3) {
      Alert.alert("Invalid CVC");
      return false;
    }
    if (!name) {
      Alert.alert("Please enter name on card");
      return false;
    }
    return true;
  };

  const handleSave = async () => {
    if (!validateCard()) return;
    setIsSaving(true);

    try {
      // In a real app, you would use Stripe SDK here to tokenize the card
      // For now, we'll simulate saving to backend
      await new Promise((resolve) => setTimeout(resolve, 1500));

      // Simulate successful save
      Alert.alert(
        "Success",
        "Card added successfully! You can now select it as your payment method."
      );
      router.back(); // Go back to previous screen
    } catch (error) {
      Alert.alert("Error", "Failed to add card. Please try again.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-background">
      {/* Header */}
      <View className="px-5 pt-4 pb-2 bg-surface border-b border-border">
        <View className="flex-row items-center justify-between">
          <TouchableOpacity
            onPress={() => router.back()}
            className="w-9 h-9 rounded-full bg-secondary items-center justify-center"
          >
            <Ionicons name="arrow-back" size={16} color="#2e1e1a" />
          </TouchableOpacity>
          <Text className="text-lg font-bold text-foreground">
            Add Payment Method
          </Text>
          <View className="w-9 h-9" />
        </View>
      </View>

      {/* Form */}
      <ScrollView className="flex-1 px-5 pt-4">
        <View className="mb-4">
          <Text className="text-sm font-semibold text-foreground mb-1">
            Card Number
          </Text>
          <TextInput
            placeholder="•••• •••• •••• ••••"
            value={cardNumber}
            onChangeText={(text) => {
              // Format as XXXX XXXX XXXX XXXX
              const cleaned = text.replace(/\s/g, "");
              const formatted = cleaned.match(/.{1,4}/g)?.join(" ") || "";
              setCardNumber(formatted);
            }}
            keyboardType="number-pad"
            maxLength={19}
            className="w-full rounded-xl px-3 py-3 text-sm font-medium border border-border"
          />
        </View>

        <View className="mb-4">
          <Text className="text-sm font-semibold text-foreground mb-1">
            Expiry Date (MM/YY)
          </Text>
          <TextInput
            placeholder="MM / YY"
            value={expiry}
            onChangeText={(text) => {
              // Format as MM/YY
              const cleaned = text.replace(/[^0-9]/g, "");
              if (cleaned.length >= 2) {
                setExpiry(
                  `${cleaned.slice(0, 2)}/${cleaned.slice(2, 4)}`
                );
              } else {
                setExpiry(cleaned);
              }
            }}
            keyboardType="number-pad"
            maxLength={5}
            className="w-full rounded-xl px-3 py-3 text-sm font-medium border border-border"
          />
        </View>

        <View className="mb-4">
          <Text className="text-sm font-semibold text-foreground mb-1">
            CVC
          </Text>
          <TextInput
            placeholder="•••"
            value={cvc}
            onChangeText={setCvc}
            keyboardType="number-pad"
            maxLength={3}
            secureTextEntry
            className="w-full rounded-xl px-3 py-3 text-sm font-medium border border-border"
          />
        </View>

        <View className="mb-4">
          <Text className="text-sm font-semibold text-foreground mb-1">
            Name on Card
          </Text>
          <TextInput
            placeholder="John Doe"
            value={name}
            onChangeText={setName}
            className="w-full rounded-xl px-3 py-3 text-sm font-medium border border-border"
          />
        </View>

        {isSaving ? (
          <View className="items-center py-6">
            <ActivityIndicator size="large" color="#e04e2f" />
            <Text className="text-sm text-muted-foreground mt-3">
              Adding card...
            </Text>
          </View>
        ) : (
          <TouchableOpacity
            onPress={handleSave}
            className="w-full rounded-xl bg-primary py-4 items-center"
          >
            <Text className="text-sm font-bold text-primary-foreground">
              Save Card
            </Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}