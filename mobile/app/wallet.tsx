import { Link } from "expo-router";
import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Modal,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/lib/auth";

type PaymentMethod = {
  id: string;
  type: "card" | "cash";
  last4?: string;
  expiry?: string;
  isDefault?: boolean;
};

export default function WalletPage() {
  const { user } = useAuth();
  const isDriver = user?.role === "driver";

  const [methods, setMethods] = useState<PaymentMethod[]>([
    { id: "1", type: "card", last4: "4242", expiry: "09/28" },
    { id: "2", type: "cash", isDefault: true },
  ]);

  const [isAdding, setIsAdding] = useState(false);
  const [newCardNumber, setNewCardNumber] = useState("");
  const [newCardExpiry, setNewCardExpiry] = useState("");

  const [isCashingOut, setIsCashingOut] = useState(false);
  const [savedBanks, setSavedBanks] = useState<
    { id: string; bankName: string; accountNumber: string }[]
  >([]);
  const [isAddingBank, setIsAddingBank] = useState(false);
  const [bankName, setBankName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");

  const addCard = () => {
    if (newCardNumber.length >= 4) {
      setMethods([
        ...methods,
        {
          id: Date.now().toString(),
          type: "card",
          last4: newCardNumber.slice(-4),
          expiry: newCardExpiry || "12/30",
        },
      ]);
      setIsAdding(false);
      setNewCardNumber("");
      setNewCardExpiry("");
    }
  };

  const removeMethod = (id: string) => {
    setMethods(methods.filter((m) => m.id !== id));
  };

  const handleCashoutNew = () => {
    if (bankName && accountNumber) {
      const newBank = {
        id: Date.now().toString(),
        bankName,
        accountNumber,
      };
      setSavedBanks([...savedBanks, newBank]);
      Alert.alert(
        "Success",
        `R 1,240.50 successfully withdrawn to ${bankName} account ending in ${accountNumber.slice(-4)}!`
      );
      setIsCashingOut(false);
      setIsAddingBank(false);
      setBankName("");
      setAccountNumber("");
    }
  };

  const handleCashoutSaved = (bank: { bankName: string; accountNumber: string }) => {
    Alert.alert(
      "Success",
      `R 1,240.50 successfully withdrawn to ${bank.bankName} account ending in ${bank.accountNumber.slice(-4)}!`
    );
    setIsCashingOut(false);
  };

  return (
    <SafeAreaView className="flex-1 bg-background">
      <View className="bg-primary px-5 pt-4 pb-8 rounded-b-[2rem] relative">
        <Link href="/account" asChild>
          <TouchableOpacity className="absolute top-4 left-4 w-9 h-9 rounded-full bg-white/20 items-center justify-center">
            <Ionicons name="arrow-back" size={16} color="#fff" />
          </TouchableOpacity>
        </Link>
        <Text className="mt-12 text-2xl font-extrabold text-white">
          {isDriver ? "Earnings & Wallet" : "Wallet"}
        </Text>
      </View>

      <ScrollView className="flex-1 px-5 -mt-4" showsVerticalScrollIndicator={false}>
        <View className="rounded-2xl bg-surface border border-border p-5">
          <Text className="text-xs font-bold text-muted-foreground uppercase mb-1">
            {isDriver ? "Available to cash out" : "Vura Cash"}
          </Text>
          <Text className="text-3xl font-extrabold text-foreground">
            {isDriver ? "R 1,240.50" : "R 24.10"}
          </Text>
          <View className="mt-4 flex-row gap-2">
            <TouchableOpacity
              onPress={() => {
                if (isDriver) setIsCashingOut(true);
              }}
              className="flex-1 flex-row items-center justify-center gap-2 rounded-full bg-secondary py-2.5"
            >
              <Ionicons
                name={isDriver ? "cash" : "add"}
                size={16}
                color="#2e1e1a"
              />
              <Text className="text-sm font-bold text-foreground">
                {isDriver ? "Cash out" : "Add funds"}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity className="flex-1 flex-row items-center justify-center gap-2 rounded-full bg-secondary py-2.5">
              <Ionicons name="time" size={16} color="#2e1e1a" />
              <Text className="text-sm font-bold text-foreground">Activity</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View className="mt-6">
          <Text className="text-sm font-extrabold text-foreground mb-3">
            Payment methods
          </Text>
          <View className="rounded-2xl bg-surface border border-border overflow-hidden">
            {methods.map((m) => (
              <View
                key={m.id}
                className="flex-row items-center gap-3 p-4 border-b border-border"
              >
                <View
                  className={`w-10 h-10 rounded-full items-center justify-center ${m.type === "card" ? "bg-blue-100" : "bg-green-100"}`}
                >
                  <Ionicons
                    name={m.type === "card" ? "card" : "cash"}
                    size={20}
                    color={m.type === "card" ? "#2563eb" : "#16a34a"}
                  />
                </View>
                <View className="flex-1">
                  <Text className="text-sm font-bold text-foreground">
                    {m.type === "card" ? `•••• ${m.last4}` : "Cash"}
                  </Text>
                  <Text className="text-xs text-muted-foreground">
                    {m.type === "card" ? `Expires ${m.expiry}` : "Default for rides"}
                  </Text>
                </View>
                {m.type === "card" && (
                  <TouchableOpacity
                    onPress={() => removeMethod(m.id)}
                    className="w-8 h-8 rounded-full bg-red-50 items-center justify-center"
                  >
                    <Ionicons name="trash" size={16} color="#dc2626" />
                  </TouchableOpacity>
                )}
              </View>
            ))}
          </View>
          <TouchableOpacity
            onPress={() => setIsAdding(true)}
            className="mt-3 w-full flex-row items-center justify-center gap-2 rounded-xl bg-secondary py-3.5"
          >
            <Ionicons name="add" size={16} color="#e04e2f" />
            <Text className="text-sm font-bold text-primary">
              Add payment method
            </Text>
          </TouchableOpacity>
        </View>
        <View className="h-6" />
      </ScrollView>

      {/* Add Card Modal */}
      <Modal
        visible={isAdding}
        animationType="slide"
        transparent
        onRequestClose={() => setIsAdding(false)}
      >
        <TouchableOpacity
          className="flex-1 bg-black/50 justify-end"
          activeOpacity={1}
          onPress={() => setIsAdding(false)}
        >
          <View className="bg-surface rounded-t-[2rem] p-5">
            <View className="flex-row justify-between items-center mb-4">
              <Text className="text-lg font-bold text-foreground">Add Card</Text>
              <TouchableOpacity
                onPress={() => setIsAdding(false)}
                className="w-8 h-8 rounded-full bg-secondary items-center justify-center"
              >
                <Ionicons name="close" size={16} color="#2e1e1a" />
              </TouchableOpacity>
            </View>
            <View className="gap-y-4">
              <TextInput
                placeholder="Card Number (min 4 digits)"
                placeholderTextColor="#80716b"
                value={newCardNumber}
                onChangeText={setNewCardNumber}
                keyboardType="numeric"
                className="w-full rounded-xl border border-border bg-secondary px-4 py-3.5 text-sm font-semibold text-foreground"
              />
              <View className="flex-row gap-4">
                <TextInput
                  placeholder="Expiry (MM/YY)"
                  placeholderTextColor="#80716b"
                  value={newCardExpiry}
                  onChangeText={setNewCardExpiry}
                  className="flex-1 rounded-xl border border-border bg-secondary px-4 py-3.5 text-sm font-semibold text-foreground"
                />
                <TextInput
                  placeholder="CVV (3 digits)"
                  placeholderTextColor="#80716b"
                  maxLength={3}
                  keyboardType="numeric"
                  secureTextEntry
                  className="flex-1 rounded-xl border border-border bg-secondary px-4 py-3.5 text-sm font-semibold text-foreground"
                />
              </View>
              <TouchableOpacity
                onPress={addCard}
                className="w-full rounded-xl bg-primary py-4 items-center"
              >
                <Text className="text-sm font-bold text-primary-foreground">
                  Save Card
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Cash Out Modal */}
      <Modal
        visible={isCashingOut}
        animationType="slide"
        transparent
        onRequestClose={() => setIsCashingOut(false)}
      >
        <TouchableOpacity
          className="flex-1 bg-black/50 justify-end"
          activeOpacity={1}
          onPress={() => setIsCashingOut(false)}
        >
          <View className="bg-surface rounded-t-[2rem] p-5">
            <View className="flex-row justify-between items-center mb-4">
              <Text className="text-lg font-bold text-foreground">
                Cash Out Earnings
              </Text>
              <TouchableOpacity
                onPress={() => setIsCashingOut(false)}
                className="w-8 h-8 rounded-full bg-secondary items-center justify-center"
              >
                <Ionicons name="close" size={16} color="#2e1e1a" />
              </TouchableOpacity>
            </View>
            {savedBanks.length > 0 && !isAddingBank ? (
              <View className="gap-y-3">
                <Text className="text-xs font-bold text-muted-foreground uppercase mb-2">
                  Saved Accounts
                </Text>
                {savedBanks.map((bank) => (
                  <TouchableOpacity
                    key={bank.id}
                    onPress={() => handleCashoutSaved(bank)}
                    className="w-full flex-row items-center justify-between rounded-xl border border-border bg-surface px-4 py-3.5"
                  >
                    <View>
                      <Text className="text-sm font-bold text-foreground">
                        {bank.bankName}
                      </Text>
                      <Text className="text-xs text-muted-foreground">
                        •••• {bank.accountNumber.slice(-4)}
                      </Text>
                    </View>
                    <Ionicons
                      name="chevron-forward"
                      size={16}
                      color="#80716b"
                    />
                  </TouchableOpacity>
                ))}
                <TouchableOpacity
                  onPress={() => setIsAddingBank(true)}
                  className="mt-2 w-full flex-row items-center justify-center gap-2 rounded-xl bg-secondary py-3.5"
                >
                  <Ionicons name="add" size={16} color="#e04e2f" />
                  <Text className="text-sm font-bold text-primary">
                    Add new bank account
                  </Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View className="gap-y-4">
                {savedBanks.length > 0 && (
                  <TouchableOpacity
                    onPress={() => setIsAddingBank(false)}
                    className="flex-row items-center gap-1"
                  >
                    <Ionicons name="arrow-back" size={12} color="#80716b" />
                    <Text className="text-xs font-bold text-muted-foreground">
                      Back to saved accounts
                    </Text>
                  </TouchableOpacity>
                )}
                <View className="gap-y-1">
                  <Text className="text-xs font-bold text-muted-foreground ml-1">
                    Bank Name
                  </Text>
                  <TextInput
                    placeholder="Bank Name"
                    placeholderTextColor="#80716b"
                    value={bankName}
                    onChangeText={setBankName}
                    className="w-full rounded-xl border border-border bg-secondary px-4 py-3.5 text-sm font-semibold text-foreground"
                  />
                </View>
                <View className="gap-y-1">
                  <Text className="text-xs font-bold text-muted-foreground ml-1">
                    Account Number
                  </Text>
                  <TextInput
                    placeholder="Enter your account number"
                    placeholderTextColor="#80716b"
                    value={accountNumber}
                    onChangeText={setAccountNumber}
                    keyboardType="numeric"
                    className="w-full rounded-xl border border-border bg-secondary px-4 py-3.5 text-sm font-semibold text-foreground"
                  />
                </View>
                <TouchableOpacity
                  onPress={handleCashoutNew}
                  className="w-full rounded-xl bg-primary py-4 items-center mt-2"
                >
                  <Text className="text-sm font-bold text-primary-foreground">
                    Withdraw R 1,240.50
                  </Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
}
