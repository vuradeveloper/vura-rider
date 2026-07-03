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
import { login, useAuth, type Role } from "@/lib/auth";

export default function Login() {
  const router = useRouter();
  const { refresh } = useAuth();
  const [email, setEmail] = useState("");
  const [pwd, setPwd] = useState("");
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const role: Role = "rider";

  async function submit() {
    setError("");
    setLoading(true);
    try {
      await login(email, pwd, role);
      refresh();
      router.replace("/");
    } catch (err: any) {
      const code = err.code;
      if (code === "auth/invalid-credential" || code === "auth/user-not-found" || code === "auth/wrong-password") {
        setError("Invalid email or password.");
      } else if (code === "auth/invalid-email") {
        setError("Please enter a valid email address.");
      } else if (code === "auth/too-many-requests") {
        setError("Too many attempts. Please try again later.");
      } else {
        setError(err.message || "Login failed. Please try again.");
      }
    }
    setLoading(false);
  }

  return (
    <SafeAreaView className="flex-1 bg-background">
      <View className="px-5 pt-3 pb-2 flex-row items-center gap-3">
        <Link href="/welcome" asChild>
          <TouchableOpacity className="w-9 h-9 rounded-full bg-secondary items-center justify-center">
            <Ionicons name="arrow-back" size={16} color="#2e1e1a" />
          </TouchableOpacity>
        </Link>
        <Text className="text-base font-bold text-foreground">Sign in</Text>
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        className="flex-1 px-5 pt-4 justify-center"
      >
        <View className="bg-surface border border-border rounded-[1.5rem] p-6 pb-8">
          <Text className="text-2xl font-extrabold text-foreground">
            Welcome back
          </Text>
          <Text className="text-sm text-muted-foreground mt-1 mb-5">
            Enter your details to continue.
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

            <View>
              <Text className="text-[11px] font-bold text-muted-foreground ml-1 uppercase">
                Password
              </Text>
              <View className="mt-1 flex-row items-center gap-2 rounded-xl bg-secondary border border-transparent px-4 py-3">
                <Ionicons name="lock-closed" size={16} color="#80716b" />
                <TextInput
                  value={pwd}
                  onChangeText={setPwd}
                  placeholder="••••••••"
                  placeholderTextColor="#80716b"
                  secureTextEntry={!show}
                  className="flex-1 text-sm font-medium text-foreground"
                />
                <TouchableOpacity onPress={() => setShow((s) => !s)}>
                  <Ionicons
                    name={show ? "eye-off" : "eye"}
                    size={16}
                    color="#80716b"
                  />
                </TouchableOpacity>
              </View>
            </View>

            {error ? (
              <Text className="text-xs text-red-500 font-semibold">{error}</Text>
            ) : null}

            <View className="flex-row justify-end mt-1 mb-2">
              <TouchableOpacity>
                <Text className="text-xs font-semibold text-primary">
                  Forgot password?
                </Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              onPress={submit}
              disabled={loading || !email || !pwd}
              className={`w-full rounded-2xl py-4 items-center ${loading || !email || !pwd ? "bg-primary/50" : "bg-primary"}`}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text className="text-sm font-bold text-primary-foreground">
                  Sign in
                </Text>
              )}
            </TouchableOpacity>
          </View>

          <View className="mt-6 flex-row items-center gap-3">
            <View className="h-px flex-1 bg-border" />
            <Text className="text-xs text-muted-foreground">or continue with</Text>
            <View className="h-px flex-1 bg-border" />
          </View>
          <View className="mt-4 flex-row gap-2">
            {["Google", "Apple", "Phone"].map((p) => (
              <TouchableOpacity
                key={p}
                className="flex-1 rounded-xl border border-border py-2.5 items-center"
              >
                <Text className="text-xs font-bold text-foreground">{p}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View className="mt-8 flex-row justify-center">
          <Text className="text-sm text-foreground">New to Vura Ride? </Text>
          <Link href="/signup" asChild>
            <TouchableOpacity>
              <Text className="text-sm font-bold text-primary">
                Create account
              </Text>
            </TouchableOpacity>
          </Link>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
