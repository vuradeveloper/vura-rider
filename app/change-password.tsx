import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { changePassword } from "@/lib/auth";

export default function ChangePasswordScreen() {
  const router = useRouter();
  const [current, setCurrent] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    if (!current || !newPwd || !confirm) {
      Alert.alert("Error", "Please fill in all fields.");
      return;
    }
    if (newPwd !== confirm) {
      Alert.alert("Error", "New passwords do not match.");
      return;
    }
    if (newPwd.length < 6) {
      Alert.alert("Error", "New password must be at least 6 characters.");
      return;
    }

    setSubmitting(true);
    try {
      await changePassword(current, newPwd);
      Alert.alert("Success", "Your password has been changed.", [
        { text: "OK", onPress: () => router.back() },
      ]);
    } catch (err: any) {
      const code = err.code;
      if (code === "auth/wrong-password" || code === "auth/invalid-credential") {
        Alert.alert("Incorrect password", "Current password is wrong.");
      } else if (code === "auth/too-many-requests") {
        Alert.alert("Too many attempts", "Please try again later.");
      } else if (code === "auth/weak-password") {
        Alert.alert("Weak password", "New password must be at least 6 characters.");
      } else {
        Alert.alert("Error", err.message || "Failed to change password.");
      }
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
          Change Password
        </Text>
        <Text className="text-sm text-white/80 mt-1">
          Update your account password
        </Text>
      </View>

      <View className="flex-1 px-5 mt-8 gap-y-4">
        <View className="gap-y-1">
          <Text className="text-xs font-bold text-muted-foreground ml-1">
            Current Password
          </Text>
          <TextInput
            value={current}
            onChangeText={setCurrent}
            secureTextEntry
            placeholder="Enter current password"
            placeholderTextColor="#80716b"
            className="w-full rounded-xl border border-border bg-surface px-4 py-3.5 text-sm font-semibold text-foreground"
          />
        </View>

        <View className="gap-y-1">
          <Text className="text-xs font-bold text-muted-foreground ml-1">
            New Password
          </Text>
          <TextInput
            value={newPwd}
            onChangeText={setNewPwd}
            secureTextEntry
            placeholder="Enter new password"
            placeholderTextColor="#80716b"
            className="w-full rounded-xl border border-border bg-surface px-4 py-3.5 text-sm font-semibold text-foreground"
          />
        </View>

        <View className="gap-y-1">
          <Text className="text-xs font-bold text-muted-foreground ml-1">
            Confirm New Password
          </Text>
          <TextInput
            value={confirm}
            onChangeText={setConfirm}
            secureTextEntry
            placeholder="Confirm new password"
            placeholderTextColor="#80716b"
            className="w-full rounded-xl border border-border bg-surface px-4 py-3.5 text-sm font-semibold text-foreground"
          />
        </View>

        <TouchableOpacity
          onPress={handleSubmit}
          disabled={submitting}
          className="mt-4 w-full flex-row items-center justify-center gap-2 rounded-xl bg-primary py-4"
        >
          {submitting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <Ionicons name="lock-closed" size={16} color="#fff" />
              <Text className="text-sm font-bold text-primary-foreground">
                Update Password
              </Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}
