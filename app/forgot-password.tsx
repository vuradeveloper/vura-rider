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
    } catch (err: any) {
      if (err.code === "auth/invalid-email") {
        setError("Please enter a valid email address.");
      } else {
        setError("Something went wrong. Check your connection and try again.");
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
        {!sent ? (
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
        ) : (
          <View className="bg-surface border border-border rounded-[1.5rem] p-6 pb-8 items-center">
            <View className="w-16 h-16 rounded-full bg-emerald-100 items-center justify-center mb-4">
              <Ionicons name="checkmark-circle" size={32} color="#10b981" />
            </View>
            <Text className="text-xl font-extrabold text-foreground text-center">
              Check your inbox
            </Text>
            <Text className="text-sm text-muted-foreground mt-2 text-center leading-5">
              If an account exists with{"\n"}
              <Text className="font-bold text-foreground">{email}</Text>
              {", we've sent a password reset link."}
            </Text>
            <TouchableOpacity
              onPress={() => router.back()}
              className="mt-8 w-full rounded-2xl bg-primary py-4 items-center"
            >
              <Text className="text-sm font-bold text-primary-foreground">
                Back to sign in
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {!sent && (
          <View className="mt-8 flex-row justify-center">
            <Text className="text-sm text-foreground">Remember your password? </Text>
            <Link href="/login" asChild>
              <TouchableOpacity>
                <Text className="text-sm font-bold text-primary">Sign in</Text>
              </TouchableOpacity>
            </Link>
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
