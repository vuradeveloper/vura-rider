import { Link, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
  Image,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { useAuth, setUser, deleteAccount } from "@/lib/auth";
import { updateProfile, uploadProfilePhoto } from "@/services/UserService";

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
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletePwd, setDeletePwd] = useState("");
  const [showDeleteInput, setShowDeleteInput] = useState(false);
  const [deleting, setDeleting] = useState(false);

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
    setSaving(true);
    try {
      let photoURL = user?.photoURL;
      if (photoUri) {
        const result = await uploadProfilePhoto(photoUri);
        photoURL = result.photoURL;
      }

      await updateProfile({
        full_name: name,
        email,
        phone,
        id_number: idNumber,
      });

      await setUser({
        ...user!,
        name,
        email,
        phone,
        photoURL,
        idNumber,
        ...(isDriver ? { licenseDocumentName: docName } : { idDocumentName: docName }),
      });
      refresh();
      router.push("/account");
    } catch (err: any) {
      Alert.alert("Error", err.message || "Failed to save changes.");
    } finally {
      setSaving(false);
    }
  }

  async function handlePickPhoto() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("Permission needed", "Allow access to your photo library to set a profile picture.");
      return;
    }
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });
      if (!result.canceled && result.assets.length > 0) {
        setPhotoUri(result.assets[0].uri);
      }
    } catch {}
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
          {/* Profile Picture */}
          <TouchableOpacity
            onPress={handlePickPhoto}
            className="items-center py-2"
          >
            <View className="relative">
              {photoUri || user?.photoURL ? (
                <Image
                  source={{ uri: photoUri || user?.photoURL || "" }}
                  className="h-20 w-20 rounded-full"
                />
              ) : (
                <View className="h-20 w-20 rounded-full bg-secondary items-center justify-center border border-border">
                  <Ionicons name="person" size={32} color="#80716b" />
                </View>
              )}
              <View className="absolute -bottom-1 -right-1 h-7 w-7 rounded-full bg-primary items-center justify-center border-2 border-surface">
                <Ionicons name="camera" size={12} color="#fff" />
              </View>
            </View>
            <Text className="text-xs font-semibold text-primary mt-2">
              Change Profile Photo
            </Text>
          </TouchableOpacity>

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
          disabled={saving}
          className={`mt-8 w-full flex-row items-center justify-center gap-2 rounded-xl bg-primary py-4 ${saving ? "opacity-60" : ""}`}
        >
          {saving ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <Ionicons name="save" size={16} color="#fff" />
              <Text className="text-sm font-bold text-primary-foreground">
                Save Changes
              </Text>
            </>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => router.push("/change-password")}
          className="mt-4 w-full flex-row items-center justify-center gap-2 rounded-xl border border-border bg-surface py-4"
        >
          <Ionicons name="lock-closed" size={16} color="#e04e2f" />
          <Text className="text-sm font-bold text-foreground">
            Change Password
          </Text>
        </TouchableOpacity>

        <View className="mt-10 mb-8 border-t border-border pt-6">
          <Text className="text-sm font-extrabold text-red-500 mb-1">Danger zone</Text>
          <Text className="text-xs text-muted-foreground mb-4">
            Permanently delete your account and all data.
          </Text>

          {!showDeleteInput ? (
            <TouchableOpacity
              onPress={() => {
                Alert.alert(
                  "Delete account?",
                  "This will permanently remove your account and all associated data. This cannot be undone.",
                  [
                    { text: "Cancel", style: "cancel" },
                    { text: "Continue", style: "destructive", onPress: () => setShowDeleteInput(true) },
                  ]
                );
              }}
              className="flex-row items-center justify-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 py-4"
            >
              <Ionicons name="trash" size={16} color="#ef4444" />
              <Text className="text-sm font-bold text-red-500">Delete account</Text>
            </TouchableOpacity>
          ) : (
            <View className="gap-y-3">
              <Text className="text-xs font-semibold text-red-500">
                Enter your password to confirm deletion:
              </Text>
              <TextInput
                value={deletePwd}
                onChangeText={setDeletePwd}
                placeholder="Enter password"
                placeholderTextColor="#80716b"
                secureTextEntry
                className="w-full rounded-xl border border-red-500/30 bg-surface px-4 py-3.5 text-sm font-semibold text-foreground"
              />
              <View className="flex-row gap-3">
                <TouchableOpacity
                  onPress={() => {
                    setShowDeleteInput(false);
                    setDeletePwd("");
                  }}
                  disabled={deleting}
                  className="flex-1 items-center rounded-xl border border-border py-4"
                >
                  <Text className="text-sm font-bold text-foreground">Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={async () => {
                    if (!deletePwd) return;
                    setDeleting(true);
                    try {
                      await deleteAccount(deletePwd);
                      setShowDeleteInput(false);
                      setDeletePwd("");
                      Alert.alert("Account deleted", "Your account has been permanently removed.");
                      router.replace("/welcome");
                    } catch (err: any) {
                      const code = err.code;
                      if (code === "auth/wrong-password" || code === "auth/invalid-credential") {
                        Alert.alert("Incorrect password", "Please try again.");
                      } else if (code === "auth/too-many-requests") {
                        Alert.alert("Too many attempts", "Please try again later.");
                      } else {
                        Alert.alert("Error", err.message || "Failed to delete account.");
                      }
                      setDeleting(false);
                    }
                  }}
                  disabled={deleting || !deletePwd}
                  className={`flex-1 flex-row items-center justify-center gap-2 rounded-xl bg-red-500 py-4 ${deleting || !deletePwd ? "opacity-50" : ""}`}
                >
                  {deleting ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <>
                      <Ionicons name="trash" size={16} color="#fff" />
                      <Text className="text-sm font-bold text-white">Delete</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
