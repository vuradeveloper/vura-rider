import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Modal,
  Alert,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Link, useRouter } from "expo-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { formatCurrency } from "@/lib/utils";
import { getSavedCards, removeCard } from "@/services/PaymentService";
import {
  getBanks,
  verifyBankAccount,
  saveBankingDetails,
  getPendingEarnings,
} from "@/services/DriverPaymentService";
import type { SavedCard, PendingEarnings } from "@/lib/types";

type Bank = { name: string; code: string };

export default function WalletPage() {
  const { user } = useAuth();
  const isDriver = user?.role === "driver";
  const queryClient = useQueryClient();
  const router = useRouter();

  const cardsQuery = useQuery<SavedCard[]>({
    queryKey: ["saved-cards"],
    queryFn: getSavedCards,
    enabled: !isDriver,
  });

  const pendingQuery = useQuery<PendingEarnings>({
    queryKey: ["pending-earnings"],
    queryFn: getPendingEarnings,
    enabled: isDriver,
  });

  const removeCardMutation = useMutation({
    mutationFn: (id: string) => removeCard(id),
    onSuccess: (_, cardId) => {
      queryClient.setQueryData(["saved-cards"], (old: SavedCard[] | undefined) => {
        return old ? old.filter((c) => c.id !== cardId) : [];
      });
      queryClient.invalidateQueries({ queryKey: ["saved-cards"] });
    },
    onError: (e: any) =>
      Alert.alert("Error", e.message || "Failed to remove card"),
  });

  const [isCashingOut, setIsCashingOut] = useState(false);
  const [addingCard, setAddingCard] = useState(false);
  const [bankQuery, setBankQuery] = useState("");
  const [selectedBank, setSelectedBank] = useState<Bank | null>(null);
  const [accountNumber, setAccountNumber] = useState("");
  const [verifiedName, setVerifiedName] = useState<string | null>(null);

  const banksQuery = useQuery<Bank[]>({
    queryKey: ["banks"],
    queryFn: getBanks,
    enabled: isCashingOut,
  });

  const verifyMutation = useMutation({
    mutationFn: () => verifyBankAccount(accountNumber, selectedBank!.code),
    onSuccess: (res: any) => setVerifiedName(res.accountName),
    onError: () =>
      Alert.alert(
        "Verification failed",
        "Could not verify account. Check the details and try again."
      ),
  });

  const saveMutation = useMutation({
    mutationFn: () =>
      saveBankingDetails({
        accountNumber,
        bankCode: selectedBank!.code,
        bankName: selectedBank!.name,
      }),
    onSuccess: () => {
      Alert.alert(
        "Payout account saved",
        "Your earnings will be paid out to this account on the next payout cycle."
      );
      resetCashout();
    },
    onError: (e: any) =>
      Alert.alert("Error", e.message || "Failed to save banking details"),
  });

  function resetCashout() {
    setIsCashingOut(false);
    setSelectedBank(null);
    setAccountNumber("");
    setVerifiedName(null);
    setBankQuery("");
  }

  const cards = cardsQuery.data ?? [];
  const pending = pendingQuery.data;
  const availableAmount = pending && typeof pending.total_earnings === 'number'
  ? pending.total_earnings
  : 0;

  const filteredBanks = (banksQuery.data ?? []).filter((b) =>
    b.name.toLowerCase().includes(bankQuery.toLowerCase())
  );

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
            {isDriver ? "Available to cash out" : "Saved cards"}
          </Text>
          {isDriver ? (
            pendingQuery.isLoading ? (
              <ActivityIndicator size="small" color="#e04e2f" style={{ marginTop: 8 }} />
            ) : (
              <>
                <Text className="text-3xl font-extrabold text-foreground">
                  {formatCurrency(availableAmount)}
                </Text>
                <Text className="text-xs text-muted-foreground mt-1">
                  {pending?.total_rides ?? 0} completed{" "}
                  {(pending?.total_rides ?? 0) === 1 ? "ride" : "rides"} pending
                  payout
                </Text>
              </>
            )
          ) : (
            <Text className="text-3xl font-extrabold text-foreground">
              {cardsQuery.isLoading ? "…" : cards.length}
            </Text>
          )}
          <View className="mt-4 flex-row gap-2">
            <TouchableOpacity
              onPress={() => {
                if (isDriver) setIsCashingOut(true);
              }}
              disabled={isDriver && availableAmount <= 0}
              className={`flex-1 flex-row items-center justify-center gap-2 rounded-full bg-secondary py-2.5 ${isDriver && availableAmount <= 0 ? "opacity-50" : ""}`}
            >
              <Ionicons
                name={isDriver ? "cash" : "card"}
                size={16}
                color="#2e1e1a"
              />
              <Text className="text-sm font-bold text-foreground">
                {isDriver ? "Cash out" : "Cards"}
              </Text>
            </TouchableOpacity>
            <Link href="/activity" asChild>
              <TouchableOpacity className="flex-1 flex-row items-center justify-center gap-2 rounded-full bg-secondary py-2.5">
                <Ionicons name="time" size={16} color="#2e1e1a" />
                <Text className="text-sm font-bold text-foreground">Activity</Text>
              </TouchableOpacity>
            </Link>
          </View>
        </View>

        <View className="mt-6">
          <Text className="text-sm font-extrabold text-foreground mb-3">
            Payment methods
          </Text>
          <View className="rounded-2xl bg-surface border border-border overflow-hidden">
            {cardsQuery.isLoading && (
              <View className="p-4">
                <ActivityIndicator size="small" color="#e04e2f" />
              </View>
            )}
            {cards.map((m) => (
              <View
                key={m.id}
                className="flex-row items-center gap-3 p-4 border-b border-border"
              >
                <View className="w-10 h-10 rounded-full items-center justify-center bg-blue-100">
                  <Ionicons name="card" size={20} color="#2563eb" />
                </View>
                <View className="flex-1">
                  <Text className="text-sm font-bold text-foreground">
                    •••• {m.last4}
                  </Text>
                  <Text className="text-xs text-muted-foreground">
                    {m.bank || m.card_type || "Card"}
                    {m.is_default ? " · Default" : ""}
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={() => {
                    const handleRemove = () => {
                      removeCardMutation.mutate(m.id);
                    };
                    if (typeof window !== "undefined" && window.confirm) {
                      if (window.confirm("Remove this saved card?")) {
                        handleRemove();
                      }
                    } else {
                      Alert.alert("Remove card", "Remove this saved card?", [
                        { text: "Cancel", style: "cancel" },
                        {
                          text: "Remove",
                          style: "destructive",
                          onPress: handleRemove,
                        },
                      ]);
                    }
                  }}
                  className="w-8 h-8 rounded-full bg-red-50 items-center justify-center"
                >
                  <Ionicons name="trash" size={16} color="#dc2626" />
                </TouchableOpacity>
              </View>
            ))}
            <View className="flex-row items-center gap-3 p-4">
              <View className="w-10 h-10 rounded-full items-center justify-center bg-green-100">
                <Ionicons name="cash" size={20} color="#16a34a" />
              </View>
              <View className="flex-1">
                <Text className="text-sm font-bold text-foreground">Cash</Text>
                <Text className="text-xs text-muted-foreground">
                  Pay driver in cash
                </Text>
              </View>
            </View>
          </View>
          <TouchableOpacity
            onPress={() => router.push("/add-payment-method")}
            disabled={addingCard}
            className="mt-3 flex-row items-center justify-center gap-2 rounded-xl border border-dashed border-border py-3"
          >
            {addingCard ? (
              <ActivityIndicator size="small" color="#e04e2f" />
            ) : (
              <>
                <Ionicons name="add-circle" size={18} color="#e04e2f" />
                <Text className="text-sm font-bold text-primary">
                  Add Payment Method
                </Text>
              </>
            )}
          </TouchableOpacity>
        </View>
        <View className="h-6" />
      </ScrollView>

      {/* Cash Out Modal */}
      <Modal
        visible={isCashingOut}
        animationType="slide"
        transparent
        onRequestClose={resetCashout}
      >
        <TouchableOpacity
          className="flex-1 bg-black/50 justify-end"
          activeOpacity={1}
          onPress={resetCashout}
        >
          <TouchableOpacity activeOpacity={1} className="bg-surface rounded-t-[2rem] p-5">
            <View className="flex-row justify-between items-center mb-4">
              <Text className="text-lg font-bold text-foreground">
                Cash Out Earnings
              </Text>
              <TouchableOpacity
                onPress={resetCashout}
                className="w-8 h-8 rounded-full bg-secondary items-center justify-center"
              >
                <Ionicons name="close" size={16} color="#2e1e1a" />
              </TouchableOpacity>
            </View>

            <Text className="text-xs text-muted-foreground mb-4">
              Payout amount: {formatCurrency(availableAmount)}
            </Text>

            {!selectedBank ? (
              <View>
                <TextInput
                  placeholder="Search your bank"
                  placeholderTextColor="#80716b"
                  value={bankQuery}
                  onChangeText={setBankQuery}
                  className="w-full rounded-xl border border-border bg-secondary px-4 py-3.5 text-sm font-semibold text-foreground mb-3"
                />
                {banksQuery.isLoading ? (
                  <ActivityIndicator size="small" color="#e04e2f" style={{ marginVertical: 24 }} />
                ) : (
                  <ScrollView className="max-h-64">
                    {filteredBanks.map((b) => (
                      <TouchableOpacity
                        key={b.code}
                        onPress={() => setSelectedBank(b)}
                        className="w-full px-4 py-3.5 rounded-xl border border-border bg-surface mb-2"
                      >
                        <Text className="text-sm font-semibold text-foreground">
                          {b.name}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                )}
              </View>
            ) : (
              <View className="gap-y-4">
                <TouchableOpacity
                  onPress={() => {
                    setSelectedBank(null);
                    setVerifiedName(null);
                  }}
                  className="flex-row items-center gap-1"
                >
                  <Ionicons name="arrow-back" size={12} color="#80716b" />
                  <Text className="text-xs font-bold text-muted-foreground">
                    {selectedBank.name}
                  </Text>
                </TouchableOpacity>

                <View className="gap-y-1">
                  <Text className="text-xs font-bold text-muted-foreground ml-1">
                    Account Number
                  </Text>
                  <TextInput
                    placeholder="Enter your account number"
                    placeholderTextColor="#80716b"
                    value={accountNumber}
                    onChangeText={(t) => {
                      setAccountNumber(t);
                      setVerifiedName(null);
                    }}
                    keyboardType="numeric"
                    className="w-full rounded-xl border border-border bg-secondary px-4 py-3.5 text-sm font-semibold text-foreground"
                  />
                </View>

                {verifiedName && (
                  <View className="flex-row items-center gap-2 rounded-xl bg-emerald-50 px-4 py-3">
                    <Ionicons name="checkmark-circle" size={16} color="#10b981" />
                    <Text className="text-sm font-bold text-emerald-700">
                      {verifiedName}
                    </Text>
                  </View>
                )}

                {!verifiedName ? (
                  <TouchableOpacity
                    disabled={accountNumber.length < 6 || verifyMutation.isPending}
                    onPress={() => verifyMutation.mutate()}
                    className={`w-full rounded-xl bg-secondary py-4 items-center ${accountNumber.length < 6 ? "opacity-50" : ""}`}
                  >
                    {verifyMutation.isPending ? (
                      <ActivityIndicator size="small" color="#2e1e1a" />
                    ) : (
                      <Text className="text-sm font-bold text-foreground">
                        Verify account
                      </Text>
                    )}
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity
                    disabled={saveMutation.isPending}
                    onPress={() => saveMutation.mutate()}
                    className="w-full rounded-xl bg-primary py-4 items-center"
                  >
                    {saveMutation.isPending ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <Text className="text-sm font-bold text-primary-foreground">
                        Save & request payout
                      </Text>
                    )}
                  </TouchableOpacity>
                )}
              </View>
            )}
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
}
