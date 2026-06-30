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
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Picker } from "@react-native-picker/picker";
import { setUser, useAuth, type Role } from "@/lib/auth";
import { countries } from "@/lib/countries";

export default function Signup() {
  const router = useRouter();
  const { refresh } = useAuth();
  const role: Role = "rider";
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [countryCode, setCountryCode] = useState("+44");
  const [phone, setPhone] = useState("");
  const [pwd, setPwd] = useState("");

  const [sendingEmail, setSendingEmail] = useState(false);
  const [generatedCode, setGeneratedCode] = useState("");
  const [otp, setOtp] = useState("");
  const [otpError, setOtpError] = useState("");

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [dob, setDob] = useState("");
  const [idNumber, setIdNumber] = useState("");

  function submitDetails() {
    setStep(2);
  }

  async function triggerEmailSend() {
    setSendingEmail(true);
    setOtpError("");
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    setGeneratedCode(code);
    // In production, use the /api/users/sync backend endpoint
    setSendingEmail(false);
    setStep(3);
  }

  function submitOtp() {
    if (otp === generatedCode) {
      setStep(4);
    } else {
      setOtpError("Invalid verification code. Please try again.");
    }
  }

  async function submitPersonalInfo() {
    await setUser({
      name: `${firstName} ${lastName}`,
      email,
      phone: `${countryCode} ${phone}`,
      role,
      idNumber,
    });
    refresh();
    router.replace("/");
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
        {[1, 2, 3, 4].map((s) => (
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
                      secureTextEntry
                      className="mt-1 w-full rounded-xl bg-secondary px-3 py-3 text-sm font-medium text-foreground"
                    />
                  </View>

                  <TouchableOpacity
                    onPress={submitDetails}
                    className="mt-6 w-full rounded-2xl bg-primary py-4 items-center"
                  >
                    <Text className="text-sm font-bold text-primary-foreground">
                      Continue
                    </Text>
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
            <View className="px-5 pt-4 pb-6 flex-1 justify-center">
              <View className="bg-surface border border-border rounded-[1.5rem] p-6 pb-8 items-center">
                <Ionicons
                  name="shield-checkmark"
                  size={48}
                  color="#e04e2f"
                />
                <Text className="text-2xl font-extrabold text-foreground mt-4">
                  Security Check
                </Text>
                <Text className="text-sm text-muted-foreground mt-1 mb-8 text-center">
                  Verify you are not a robot to receive your email code.
                </Text>
                <TouchableOpacity
                  onPress={triggerEmailSend}
                  disabled={sendingEmail}
                  className="w-full rounded-2xl bg-primary py-4 items-center"
                >
                  <Text className="text-sm font-bold text-primary-foreground">
                    {sendingEmail ? "Sending..." : "I'm not a robot"}
                  </Text>
                </TouchableOpacity>
                {sendingEmail && (
                  <Text className="mt-4 text-sm text-muted-foreground">
                    Sending verification email...
                  </Text>
                )}
              </View>
            </View>
          )}

          {step === 3 && (
            <View className="px-5 pt-4 pb-6 flex-1 justify-center">
              <View className="bg-surface border border-border rounded-[1.5rem] p-6 pb-8">
                <Text className="text-2xl font-extrabold text-foreground">
                  Verify your email
                </Text>
                <Text className="text-sm text-muted-foreground mt-1 mb-5">
                  We sent a verification code to{" "}
                  <Text className="font-bold text-foreground">{email}</Text>
                </Text>

                <View className="gap-y-4">
                  <View>
                    <Text className="text-[11px] font-bold text-muted-foreground ml-1 uppercase">
                      Verification Code
                    </Text>
                    <TextInput
                      value={otp}
                      onChangeText={(t) => {
                        setOtp(t.replace(/\D/g, ""));
                        setOtpError("");
                      }}
                      maxLength={6}
                      placeholder="123456"
                      keyboardType="number-pad"
                      className="mt-1 w-full rounded-xl bg-secondary px-3 py-4 text-center text-2xl font-extrabold text-foreground"
                    />
                  </View>

                  {otpError ? (
                    <Text className="text-xs text-red-500 font-semibold text-center">
                      {otpError}
                    </Text>
                  ) : null}

                  <TouchableOpacity
                    onPress={submitOtp}
                    disabled={otp.length < 4}
                    className={`mt-6 w-full rounded-2xl py-4 items-center ${otp.length < 4 ? "bg-primary/50" : "bg-primary"}`}
                  >
                    <Text className="text-sm font-bold text-primary-foreground">
                      Create account
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>

              <TouchableOpacity onPress={() => setStep(1)} className="mt-8">
                <Text className="text-center text-sm font-bold text-primary">
                  Go back
                </Text>
              </TouchableOpacity>
            </View>
          )}

          {step === 4 && (
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
                      className="mt-1 w-full rounded-xl bg-secondary px-3 py-3 text-sm font-medium text-foreground"
                    />
                    <Text className="text-[10px] text-muted-foreground mt-1 ml-1">
                      Your ID number is used for identity verification purposes.
                    </Text>
                  </View>

                  <TouchableOpacity
                    onPress={submitPersonalInfo}
                    className="mt-6 w-full rounded-2xl bg-primary py-4 items-center"
                  >
                    <Text className="text-sm font-bold text-primary-foreground">
                      Create account
                    </Text>
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
