import { Link, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import { useAuth, setUser } from "@/lib/auth";

export default function SettingsPage() {
  const { user, refresh } = useAuth();
  const router = useRouter();

  const [name, setName] = useState(user?.name || "");
  const [email, setEmail] = useState(user?.email || "");
  const [phone, setPhone] = useState(user?.phone || "");
  const [idNumber, setIdNumber] = useState(user?.idNumber || "");
  const [docName, setDocName] = useState(
    (user?.role === "driver" ? user?.licenseDocumentName : user?.idDocumentName) || ""
  );

  useEffect(() => {
    if (user) {
      setName(user.name || "");
      setEmail(user.email || "");
      setPhone(user.phone || "");
      setIdNumber(user.idNumber || "");
      setDocName(
        (user.role === "driver" ? user.licenseDocumentName : user.idDocumentName) || ""
      );
    }
  }, [user]);

  if (!user) return null;

  const isDriver = user.role === "driver";
  let progress = 0;
  if (idNumber) progress += 50;
  if (docName) progress += 50;
  const isVerified = progress === 100;

  async function handleSave() {
    await setUser({
      ...user!,
      name,
      email,
      phone,
      idNumber,
      ...(isDriver ? { licenseDocumentName: docName } : { idDocumentName: docName }),
    });
    refresh();
    router.back();
  }

  async function handleFilePick() {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ["image/*", "application/pdf"],
      });
      if (!result.canceled && result.assets.length > 0) {
        setDocName(result.assets[0].name);
      }
    } catch {}
  }

  return (
    <SafeAreaView className="flex-1 bg-background">
      <View className="bg-primary px-5 pt-4 pb-8 rounded-b-[2rem] relative">
        <Link href="/account" asChild>
          <TouchableOpacity className="absolute top-4 left-4 w-9 h-9 rounded-full bg-white/20 items-center justify-center">
            <Ionicons name="arrow-back" size={16} color="#fff" />
          </TouchableOpacity>
        </Link>
        <Text className="mt-12 text-2xl font-extrabold text-white">Settings</Text>
        <Text className="text-sm text-white/80 mt-1">Update your personal details</Text>
      </View>

      <ScrollView className="flex-1 px-5 mt-6" showsVerticalScrollIndicator={false}>
        {/* Verification progress */}
        <View className="gap-y-2 mb-4">
          <View className="flex-row items-center justify-between">
            <View className="flex-row items-center gap-2">
              <Ionicons
                name="checkmark-circle"
                size={20}
                color={isVerified ? "#10b981" : "#80716b"}
              />
              <Text
                className={`text-sm font-bold ${isVerified ? "text-emerald-500" : "text-muted-foreground"}`}
              >
                {isVerified ? "Verified Account" : "Verification in progress"}
              </Text>
            </View>
            <Text className="text-xs font-semibold text-muted-foreground">
              {progress}%
            </Text>
          </View>
          <View className="h-2.5 w-full rounded-full bg-secondary overflow-hidden">
            <View
              className={`h-full rounded-full ${isVerified ? "bg-emerald-500" : "bg-muted-foreground"}`}
              style={{ width: `${progress}%` }}
            />
          </View>
        </View>

        <View className="gap-y-4">
          <View className="gap-y-1">
            <Text className="text-xs font-bold text-muted-foreground ml-1">
              Full Name
            </Text>
            <TextInput
              value={name}
              onChangeText={setName}
              className="w-full rounded-xl border border-border bg-surface px-4 py-3.5 text-sm font-semibold text-foreground"
            />
          </View>

          <View className="gap-y-1">
            <Text className="text-xs font-bold text-muted-foreground ml-1">
              Email Address
            </Text>
            <TextInput
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              className="w-full rounded-xl border border-border bg-surface px-4 py-3.5 text-sm font-semibold text-foreground"
            />
          </View>

          <View className="gap-y-1">
            <Text className="text-xs font-bold text-muted-foreground ml-1">
              Phone Number
            </Text>
            <TextInput
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
              className="w-full rounded-xl border border-border bg-surface px-4 py-3.5 text-sm font-semibold text-foreground"
            />
          </View>

          <View className="gap-y-1">
            <Text className="text-xs font-bold text-muted-foreground ml-1">ID Number</Text>
            <TextInput
              value={idNumber}
              onChangeText={setIdNumber}
              placeholder="Enter your ID Number"
              placeholderTextColor="#80716b"
              className="w-full rounded-xl border border-border bg-surface px-4 py-3.5 text-sm font-semibold text-foreground"
            />
          </View>

          <View className="gap-y-1 mt-2">
            <Text className="text-xs font-bold text-muted-foreground ml-1">
              {isDriver ? "Driver's License Document" : "ID Document"}
            </Text>
            <TouchableOpacity
              onPress={handleFilePick}
              className="w-full border-2 border-dashed border-border rounded-xl p-6 items-center justify-center gap-2 bg-surface"
            >
              {docName ? (
                <>
                  <Ionicons name="document-text" size={24} color="#e04e2f" />
                  <Text className="text-sm font-bold text-primary" numberOfLines={1}>
                    {docName}
                  </Text>
                </>
              ) : (
                <>
                  <Ionicons name="cloud-upload" size={24} color="#80716b" />
                  <Text className="text-sm font-semibold text-muted-foreground text-center">
                    Tap to upload {isDriver ? "Driver's License" : "ID Document"}
                  </Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </View>

        <TouchableOpacity
          onPress={handleSave}
          className="mt-8 mb-6 w-full flex-row items-center justify-center gap-2 rounded-xl bg-primary py-4"
        >
          <Ionicons name="save" size={16} color="#fff" />
          <Text className="text-sm font-bold text-primary-foreground">
            Save Changes
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}
