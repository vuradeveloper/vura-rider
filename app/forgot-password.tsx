import { Link, useRouter } from "expo-router";
import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { resetPassword } from "@/lib/auth";

export default function ForgotPassword() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  async function submit() {
    setError("");
    if (!email) {
      setError("Please enter your email address.");
      return;
    }
    setLoading(true);
    try {
      await resetPassword(email);
      setSent(true);
      Alert.alert("Email sent", "Check your inbox for the password reset link.", [
        { text: "OK", onPress: () => router.back() },
      ]);
    } catch (err: any) {
      const code = err.code;
      if (code === "auth/user-not-found") {
        setError("No account found with this email.");
      } else if (code === "auth/invalid-email") {
        setError("Please enter a valid email address.");
      } else {
        setError(err.message || "Something went wrong. Try again.");
      }
    }
    setLoading(false);
  }

  return (
    <SafeAreaView className="flex-1 bg-background">
      <View className="px-5 pt-3 pb-2 flex-row items-center gap-3">
        <Link href="/login" asChild>
          <TouchableOpacity className="w-9 h-9 rounded-full bg-secondary items-center justify-center">
            <Ionicons name="arrow-back" size={16} color="#2e1e1a" />
          </TouchableOpacity>
        </Link>
        <Text className="text-base font-bold text-foreground">Reset password</Text>
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        className="flex-1 px-5 pt-4 justify-center"
      >
        <View className="bg-surface border border-border rounded-[1.5rem] p-6 pb-8">
          <Text className="text-2xl font-extrabold text-foreground">
            Forgot password?
          </Text>
          <Text className="text-sm text-muted-foreground mt-1 mb-5">
            Enter your email and we'll send you a reset link.
          </Text>

          <View className="gap-y-4">
            <View>
              <Text className="text-[11px] font-bold text-muted-foreground ml-1 uppercase">
                Email
              </Text>
              <View className="mt-1 flex-row items-center gap-2 rounded-xl bg-secondary border border-transparent px-4 py-3">
                <Ionicons name="mail" size={16} color="#80716b" />
                <TextInput
                  value={email}
                  onChangeText={setEmail}
                  placeholder="you@email.com"
                  placeholderTextColor="#80716b"
                  className="flex-1 text-sm font-medium text-foreground"
                  autoCapitalize="none"
                  keyboardType="email-address"
                />
              </View>
            </View>

            {error ? (
              <Text className="text-xs text-red-500 font-semibold">{error}</Text>
            ) : null}

            {sent ? (
              <Text className="text-xs text-emerald-500 font-semibold">
                Reset link sent! Check your email.
              </Text>
            ) : null}

            <TouchableOpacity
              onPress={submit}
              disabled={loading || !email}
              className={`w-full rounded-2xl py-4 items-center ${loading || !email ? "bg-primary/50" : "bg-primary"}`}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text className="text-sm font-bold text-primary-foreground">
                  Send reset link
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
