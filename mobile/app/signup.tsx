import { Link, useRouter } from "expo-router";
import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Picker } from "@react-native-picker/picker";
import { register, useAuth, type Role } from "@/lib/auth";
import { countries } from "@/lib/countries";

export default function Signup() {
  const router = useRouter();
  const { refresh } = useAuth();
  const role: Role = "rider";
  const [step, setStep] = useState<1 | 2>(1);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [countryCode, setCountryCode] = useState("+27");
  const [phone, setPhone] = useState("");
  const [pwd, setPwd] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [dob, setDob] = useState("");
  const [idNumber, setIdNumber] = useState("");

  async function submitStep1() {
    setError("");
    if (!name || !email || !pwd) {
      setError("Please fill in all required fields.");
      return;
    }
    if (pwd.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    setLoading(true);
    try {
      await register(email, pwd, role, {
        full_name: name,
        phone: phone ? `${countryCode} ${phone}` : undefined,
      });
      refresh();
      router.replace("/");
    } catch (err: any) {
      const code = err.code;
      if (code === "auth/email-already-in-use") {
        setError("This email is already registered. Please sign in instead.");
      } else if (code === "auth/invalid-email") {
        setError("Please enter a valid email address.");
      } else if (code === "auth/weak-password") {
        setError("Password is too weak. Use at least 6 characters.");
      } else {
        setError(err.message || "Signup failed. Please try again.");
      }
    }
    setLoading(false);
  }

  async function submitPersonalInfo() {
    setError("");
    setLoading(true);
    try {
      // The Firebase account is already created in step 1,
      // update the stored user with personal info
      const { setUser } = await import("@/lib/auth");
      await setUser({
        uid: "",
        name: `${firstName} ${lastName}`,
        email,
        phone: `${countryCode} ${phone}`,
        role,
        idNumber,
      });
      refresh();
      router.replace("/");
    } catch (err: any) {
      setError(err.message || "Failed to save details.");
    }
    setLoading(false);
  }

  return (
    <SafeAreaView className="flex-1 bg-background">
      <View className="px-5 pt-3 pb-3 flex-row items-center justify-between border-b border-border">
        <TouchableOpacity
          onPress={() => {
            if (step > 1) setStep((s) => (s - 1) as any);
            else router.back();
          }}
          className="w-9 h-9 rounded-full bg-secondary items-center justify-center"
        >
          <Ionicons name="arrow-back" size={16} color="#2e1e1a" />
        </TouchableOpacity>
        <Text className="text-sm font-bold text-foreground">Create account</Text>
        <View className="w-9 h-9" />
      </View>

      <View className="flex-row gap-2 px-5 py-2">
        {[1, 2].map((s) => (
          <View
            key={s}
            className={`h-1 flex-1 rounded-full ${step >= s ? "bg-primary" : "bg-secondary"}`}
          />
        ))}
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        className="flex-1"
      >
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ flexGrow: 1 }}
          keyboardShouldPersistTaps="handled"
        >
          {step === 1 && (
            <View className="px-5 pt-4 pb-6 flex-1 justify-center">
              <View className="bg-surface border border-border rounded-[1.5rem] p-6 pb-8">
                <Text className="text-2xl font-extrabold text-foreground">
                  Your details
                </Text>
                <Text className="text-sm text-muted-foreground mt-1 mb-5">
                  Signing up as{" "}
                  <Text className="font-bold text-primary capitalize">{role}</Text>
                </Text>

                <View className="gap-y-4">
                  <View>
                    <Text className="text-[11px] font-bold text-muted-foreground ml-1 uppercase">
                      Full name
                    </Text>
                    <TextInput
                      value={name}
                      onChangeText={setName}
                      placeholder="Sagar Dash"
                      placeholderTextColor="#80716b"
                      className="mt-1 w-full rounded-xl bg-secondary px-3 py-3 text-sm font-medium text-foreground"
                    />
                  </View>
                  <View>
                    <Text className="text-[11px] font-bold text-muted-foreground ml-1 uppercase">
                      Email
                    </Text>
                    <TextInput
                      value={email}
                      onChangeText={setEmail}
                      placeholder="you@email.com"
                      placeholderTextColor="#80716b"
                      keyboardType="email-address"
                      autoCapitalize="none"
                      className="mt-1 w-full rounded-xl bg-secondary px-3 py-3 text-sm font-medium text-foreground"
                    />
                  </View>
                  <View>
                    <Text className="text-[11px] font-bold text-muted-foreground ml-1 uppercase">
                      Phone
                    </Text>
                    <View className="mt-1 flex-row gap-2">
                      <View className="w-20 rounded-lg bg-secondary">
                        <Picker
                          selectedValue={countryCode}
                          onValueChange={setCountryCode}
                          style={{ height: 44 }}
                        >
                          {countries
                            .sort((a, b) => a.name.localeCompare(b.name))
                            .map((c) => (
                              <Picker.Item
                                key={c.code}
                                label={`${c.flag} ${c.dial_code}`}
                                value={c.dial_code}
                              />
                            ))}
                        </Picker>
                      </View>
                      <TextInput
                        value={phone}
                        onChangeText={setPhone}
                        placeholder="7700 900123"
                        placeholderTextColor="#80716b"
                        keyboardType="phone-pad"
                        className="flex-1 rounded-xl bg-secondary px-3 py-3 text-sm font-medium text-foreground"
                      />
                    </View>
                  </View>
                  <View>
                    <Text className="text-[11px] font-bold text-muted-foreground ml-1 uppercase">
                      Password
                    </Text>
                    <TextInput
                      value={pwd}
                      onChangeText={setPwd}
                      placeholder="••••••••"
                      placeholderTextColor="#80716b"
                      secureTextEntry
                      className="mt-1 w-full rounded-xl bg-secondary px-3 py-3 text-sm font-medium text-foreground"
                    />
                  </View>

                  {error ? (
                    <Text className="text-xs text-red-500 font-semibold">{error}</Text>
                  ) : null}

                  <TouchableOpacity
                    onPress={submitStep1}
                    disabled={loading}
                    className={`mt-6 w-full rounded-2xl py-4 items-center ${loading ? "bg-primary/50" : "bg-primary"}`}
                  >
                    {loading ? (
                      <ActivityIndicator color="#fff" />
                    ) : (
                      <Text className="text-sm font-bold text-primary-foreground">
                        Create account
                      </Text>
                    )}
                  </TouchableOpacity>
                </View>
              </View>

              <View className="mt-8 flex-row justify-center">
                <Text className="text-sm text-foreground">
                  Already have one?{" "}
                </Text>
                <Link href="/login" asChild>
                  <TouchableOpacity>
                    <Text className="text-sm font-bold text-primary">
                      Sign in
                    </Text>
                  </TouchableOpacity>
                </Link>
              </View>
            </View>
          )}

          {step === 2 && (
            <View className="px-5 pt-4 pb-6">
              <View className="bg-surface border border-border rounded-[1.5rem] p-6 pb-8 gap-y-5">
                <View>
                  <Text className="text-xl font-extrabold text-foreground">
                    Personal information
                  </Text>
                  <Text className="text-xs text-muted-foreground mt-1">
                    Only your first name and vehicle details are visible to clients during the booking.
                  </Text>
                </View>

                <View className="gap-y-4">
                  <View>
                    <Text className="text-[11px] font-bold text-muted-foreground ml-1 uppercase">
                      First name *
                    </Text>
                    <TextInput
                      value={firstName}
                      onChangeText={setFirstName}
                      placeholder="First name"
                      placeholderTextColor="#80716b"
                      className="mt-1 w-full rounded-xl bg-secondary px-3 py-3 text-sm font-medium text-foreground"
                    />
                  </View>
                  <View>
                    <Text className="text-[11px] font-bold text-muted-foreground ml-1 uppercase">
                      Last name *
                    </Text>
                    <TextInput
                      value={lastName}
                      onChangeText={setLastName}
                      placeholder="Last name"
                      placeholderTextColor="#80716b"
                      className="mt-1 w-full rounded-xl bg-secondary px-3 py-3 text-sm font-medium text-foreground"
                    />
                  </View>
                  <View>
                    <Text className="text-[11px] font-bold text-muted-foreground ml-1 uppercase">
                      Date of Birth *
                    </Text>
                    <TextInput
                      value={dob}
                      onChangeText={setDob}
                      placeholder="YYYY-MM-DD"
                      placeholderTextColor="#80716b"
                      className="mt-1 w-full rounded-xl bg-secondary px-3 py-3 text-sm font-medium text-foreground"
                    />
                  </View>
                  <View>
                    <Text className="text-[11px] font-bold text-muted-foreground ml-1 uppercase">
                      ID Number or Passport Number *
                    </Text>
                    <TextInput
                      value={idNumber}
                      onChangeText={setIdNumber}
                      placeholder="Enter your ID or passport number"
                      placeholderTextColor="#80716b"
                      className="mt-1 w-full rounded-xl bg-secondary px-3 py-3 text-sm font-medium text-foreground"
                    />
                    <Text className="text-[10px] text-muted-foreground mt-1 ml-1">
                      Your ID number is used for identity verification purposes.
                    </Text>
                  </View>

                  {error ? (
                    <Text className="text-xs text-red-500 font-semibold">{error}</Text>
                  ) : null}

                  <TouchableOpacity
                    onPress={submitPersonalInfo}
                    disabled={loading}
                    className={`mt-6 w-full rounded-2xl py-4 items-center ${loading ? "bg-primary/50" : "bg-primary"}`}
                  >
                    {loading ? (
                      <ActivityIndicator color="#fff" />
                    ) : (
                      <Text className="text-sm font-bold text-primary-foreground">
                        Complete setup
                      </Text>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
