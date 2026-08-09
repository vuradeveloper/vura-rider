import { Link, useRouter } from "expo-router";
import { useState, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
  Modal,
  Switch,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useAppStore } from "@/lib/store";
import { getSocket, getConnectedSocket } from "@/lib/socket";
import {
  getEmergencyContacts,
  saveEmergencyContact,
  deleteEmergencyContact,
  triggerSOS,
  shareTrip,
  stopSharingTrip,
} from "@/services/SafetyService";
import type { EmergencyContact } from "@/lib/types";

export default function SafetyPage() {
  const router = useRouter();
  const [activeSetting, setActiveSetting] = useState<string | null>(null);
  const [contacts, setContacts] = useState<EmergencyContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddContact, setShowAddContact] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newRelationship, setNewRelationship] = useState("");
  const [savingContact, setSavingContact] = useState(false);
  const [sosSending, setSosSending] = useState(false);

  const activeRide = useAppStore((s) => s.activeRide);
  const isSharingTrip = useAppStore((s) => s.isSharingTrip);

  useEffect(() => {
    loadContacts();
  }, []);

  async function loadContacts() {
    setLoading(true);
    try {
      const { contacts: data } = await getEmergencyContacts();
      setContacts(data);
    } catch {
      // use defaults
    } finally {
      setLoading(false);
    }
  }

  async function handleAddContact() {
    if (!newName.trim() || !newPhone.trim()) {
      Alert.alert("Error", "Name and phone are required");
      return;
    }
    setSavingContact(true);
    try {
      await saveEmergencyContact({
        name: newName.trim(),
        phone: newPhone.trim(),
        relationship: newRelationship.trim() || "Other",
      });
      await loadContacts();
      setShowAddContact(false);
      setNewName("");
      setNewPhone("");
      setNewRelationship("");
      Alert.alert("Saved", "Emergency contact added successfully.");
    } catch (err: any) {
      Alert.alert("Error", err.message || "Could not save contact");
    } finally {
      setSavingContact(false);
    }
  }

  async function handleDeleteContact(id: string) {
    Alert.alert("Remove contact", "Are you sure?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: async () => {
          try {
            await deleteEmergencyContact(id);
            setContacts((prev) => prev.filter((c) => c.id !== id));
          } catch {
            Alert.alert("Error", "Could not remove contact");
          }
        },
      },
    ]);
  }

  async function handleSOS() {
    if (!activeRide?.id) {
      Alert.alert("No active ride", "SOS is only available during an active ride.");
      return;
    }
    Alert.alert(
      "Emergency SOS",
      "This will alert emergency services and share your real-time location with your trusted contacts. Continue?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Send SOS",
          style: "destructive",
          onPress: async () => {
            setSosSending(true);
            try {
              await triggerSOS(activeRide.id);
              const socket = getConnectedSocket();
              if (socket) {
                socket.emit("safety:sos", { rideId: activeRide.id });
              }
              Alert.alert(
                "SOS Sent",
                "Emergency services have been notified. Your trusted contacts have been alerted with your location."
              );
            } catch (err: any) {
              Alert.alert("Error", err.message || "Could not send SOS");
            } finally {
              setSosSending(false);
            }
          },
        },
      ]
    );
  }

  async function handleShareTrip() {
    if (!activeRide?.id) {
      Alert.alert("No active ride", "You can only share a trip during an active ride.");
      return;
    }
    try {
      const result = await shareTrip(activeRide.id);
      useAppStore.getState().setTripSharing(true, result.shareToken);
      Alert.alert(
        "Trip Sharing Active",
        `Share this link with your trusted contacts: ${result.shareUrl}`
      );
    } catch (err: any) {
      Alert.alert("Error", err.message || "Could not share trip");
    }
  }

  async function handleStopSharing() {
    if (!activeRide?.id) return;
    try {
      await stopSharingTrip(activeRide.id);
      useAppStore.getState().setTripSharing(false, null);
      Alert.alert("Sharing Stopped", "Your trip is no longer being shared.");
    } catch {
      // best-effort
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-background">
      <View className="bg-primary px-5 pt-4 pb-8 rounded-b-[2rem] relative">
        <Link href="/account" asChild>
          <TouchableOpacity className="absolute top-4 left-4 w-9 h-9 rounded-full bg-white/20 items-center justify-center">
            <Ionicons name="arrow-back" size={16} color="#fff" />
          </TouchableOpacity>
        </Link>
        <View className="mt-12 flex-row items-center gap-3">
          <Ionicons name="shield-checkmark" size={32} color="#fff" />
          <Text className="text-2xl font-extrabold text-white">
            Safety Center
          </Text>
        </View>
        <Text className="text-sm text-white/80 mt-2">
          Your safety is our priority. Manage your preferences below.
        </Text>
      </View>

      <ScrollView className="flex-1 px-5 mt-6" showsVerticalScrollIndicator={false}>
        {/* SOS Emergency Button */}
        <TouchableOpacity
          onPress={handleSOS}
          disabled={sosSending || !activeRide}
          className={`rounded-2xl p-5 mb-4 items-center ${activeRide ? "bg-red-600" : "bg-red-300"}`}
        >
          {sosSending ? (
            <ActivityIndicator size="large" color="#fff" />
          ) : (
            <>
              <Ionicons name="warning" size={36} color="#fff" />
              <Text className="text-lg font-extrabold text-white mt-2">
                Emergency SOS
              </Text>
              <Text className="text-xs text-white/80 mt-1 text-center">
                {activeRide
                  ? "Tap to alert emergency services"
                  : "Only available during an active ride"}
              </Text>
            </>
          )}
        </TouchableOpacity>

        {/* Trip Sharing */}
        {activeRide && (
          <View className="rounded-2xl bg-surface border border-border p-4 mb-4">
            <View className="flex-row items-center justify-between mb-3">
              <View className="flex-row items-center gap-2">
                <Ionicons name="share" size={18} color="#e04e2f" />
                <Text className="text-sm font-bold text-foreground">
                  Share Trip Status
                </Text>
              </View>
            </View>
            {isSharingTrip ? (
              <View>
                <View className="flex-row items-center gap-2 rounded-xl bg-emerald-50 px-4 py-3 mb-3">
                  <Ionicons name="checkmark-circle" size={16} color="#16a34a" />
                  <Text className="text-sm font-semibold text-emerald-700">
                    Sharing active
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={handleStopSharing}
                  className="w-full rounded-xl bg-secondary py-3 items-center"
                >
                  <Text className="text-sm font-bold text-foreground">
                    Stop Sharing
                  </Text>
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity
                onPress={handleShareTrip}
                className="w-full rounded-xl bg-primary py-3 items-center"
              >
                <Text className="text-sm font-bold text-primary-foreground">
                  Share My Trip
                </Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* Safety tools accordion */}
        <Text className="text-sm font-extrabold text-foreground mb-3">
          Safety tools
        </Text>
        <View className="rounded-2xl bg-surface border border-border overflow-hidden mb-4">
          <View className="border-b border-border">
            <TouchableOpacity
              onPress={() =>
                setActiveSetting(activeSetting === "contacts" ? null : "contacts")
              }
              className="flex-row items-center gap-4 p-4"
            >
              <View className="w-10 h-10 rounded-full bg-secondary items-center justify-center">
                <Ionicons name="people" size={20} color="#e04e2f" />
              </View>
              <View className="flex-1">
                <Text className="text-sm font-bold text-foreground">
                  Trusted Contacts
                </Text>
                <Text className="text-xs text-muted-foreground mt-0.5">
                  {contacts.length
                    ? `${contacts.length} contact${contacts.length > 1 ? "s" : ""} added`
                    : "Share your trip status with family and friends"}
                </Text>
              </View>
              <Ionicons
                name="chevron-forward"
                size={16}
                color="#80716b"
                style={{
                  transform: [
                    { rotate: activeSetting === "contacts" ? "90deg" : "0deg" },
                  ],
                }}
              />
            </TouchableOpacity>
            {activeSetting === "contacts" && (
              <View className="px-4 pb-4 gap-y-2">
                {loading ? (
                  <ActivityIndicator size="small" color="#e04e2f" />
                ) : contacts.length === 0 ? (
                  <Text className="text-xs text-muted-foreground text-center py-4">
                    No emergency contacts yet. Add someone who can follow your trips.
                  </Text>
                ) : (
                  contacts.map((c) => (
                    <View
                      key={c.id}
                      className="flex-row items-center justify-between rounded-xl bg-secondary px-4 py-3"
                    >
                      <View className="flex-1">
                        <Text className="text-sm font-bold text-foreground">
                          {c.name}
                        </Text>
                        <Text className="text-xs text-muted-foreground">
                          {c.phone} · {c.relationship}
                        </Text>
                      </View>
                      <TouchableOpacity
                        onPress={() => handleDeleteContact(c.id)}
                        className="w-8 h-8 rounded-full bg-red-100 items-center justify-center"
                      >
                        <Ionicons name="trash" size={14} color="#dc2626" />
                      </TouchableOpacity>
                    </View>
                  ))
                )}
                <TouchableOpacity
                  onPress={() => setShowAddContact(true)}
                  className="flex-row items-center justify-center gap-2 rounded-xl border border-dashed border-border py-3"
                >
                  <Ionicons name="add-circle" size={16} color="#e04e2f" />
                  <Text className="text-sm font-bold text-primary">
                    Add Contact
                  </Text>
                </TouchableOpacity>
              </View>
            )}
          </View>

          <View className="border-b border-border">
            <TouchableOpacity
              onPress={() =>
                setActiveSetting(activeSetting === "pin" ? null : "pin")
              }
              className="flex-row items-center gap-4 p-4"
            >
              <View className="w-10 h-10 rounded-full bg-secondary items-center justify-center">
                <Ionicons name="key" size={20} color="#e04e2f" />
              </View>
              <View className="flex-1">
                <Text className="text-sm font-bold text-foreground">
                  Verify Your Ride
                </Text>
                <Text className="text-xs text-muted-foreground mt-0.5">
                  Use a PIN to make sure you get in the right car
                </Text>
              </View>
              <Ionicons
                name="chevron-forward"
                size={16}
                color="#80716b"
                style={{
                  transform: [
                    { rotate: activeSetting === "pin" ? "90deg" : "0deg" },
                  ],
                }}
              />
            </TouchableOpacity>
            {activeSetting === "pin" && (
              <View className="px-4 pb-4">
                <View className="rounded-xl bg-secondary border border-border p-4">
                  <View className="flex-row justify-between items-center">
                    <Text className="text-sm font-bold text-foreground">
                      Ride PIN Protection
                    </Text>
                    <View className="w-5 h-5 rounded-md bg-primary items-center justify-center">
                      <Ionicons name="checkmark" size={14} color="#fff" />
                    </View>
                  </View>
                  <Text className="text-xs text-muted-foreground mt-1">
                    Your driver will need to provide a PIN before you enter the
                    vehicle. This ensures you get in the correct ride.
                  </Text>
                </View>
              </View>
            )}
          </View>

          <View>
            <TouchableOpacity
              onPress={() =>
                setActiveSetting(activeSetting === "check" ? null : "check")
              }
              className="flex-row items-center gap-4 p-4"
            >
              <View className="w-10 h-10 rounded-full bg-secondary items-center justify-center">
                <Ionicons name="alarm" size={20} color="#e04e2f" />
              </View>
              <View className="flex-1">
                <Text className="text-sm font-bold text-foreground">
                  RideCheck
                </Text>
                <Text className="text-xs text-muted-foreground mt-0.5">
                  We'll check on you if your trip goes off route or stops
                  unexpectedly
                </Text>
              </View>
              <Ionicons
                name="chevron-forward"
                size={16}
                color="#80716b"
                style={{
                  transform: [
                    { rotate: activeSetting === "check" ? "90deg" : "0deg" },
                  ],
                }}
              />
            </TouchableOpacity>
            {activeSetting === "check" && (
              <View className="px-4 pb-4">
                <View className="rounded-xl bg-secondary border border-border p-4">
                  <Text className="text-sm font-bold text-foreground mb-1">
                    How RideCheck works
                  </Text>
                  <Text className="text-xs text-muted-foreground">
                    RideCheck uses your phone's sensors and location to detect
                    unexpected events like long pauses, route deviations, or
                    crashes. If detected, we'll send you a notification to check
                    if everything is okay. If you don't respond, we'll alert
                    emergency services.
                  </Text>
                </View>
              </View>
            )}
          </View>
        </View>

        {/* Emergency info */}
        <View className="rounded-2xl bg-red-50 p-5 border border-red-100 items-center mb-6">
          <Text className="text-sm font-bold text-red-800">
            Need immediate help?
          </Text>
          <Text className="text-xs text-red-600 mt-1 mb-4 text-center">
            Our emergency response team is available 24/7. Tap SOS or call
            emergency services directly.
          </Text>
          <TouchableOpacity
            onPress={() => Alert.alert("Connecting to emergency services...")}
            className="w-full rounded-xl bg-red-600 py-3 items-center mb-2"
          >
            <Text className="text-sm font-bold text-white">
              Call Emergency Services
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => router.push("/help")}
            className="w-full rounded-xl bg-white border border-red-200 py-3 items-center"
          >
            <Text className="text-sm font-bold text-red-700">
              Contact Support
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* Add Contact Modal */}
      <Modal
        visible={showAddContact}
        animationType="slide"
        transparent
        onRequestClose={() => setShowAddContact(false)}
      >
        <TouchableOpacity
          className="flex-1 bg-black/50 justify-end"
          activeOpacity={1}
          onPress={() => setShowAddContact(false)}
        >
          <TouchableOpacity
            activeOpacity={1}
            className="bg-surface rounded-t-[2rem] p-5"
          >
            <Text className="text-lg font-bold text-foreground mb-4">
              Add Emergency Contact
            </Text>

            <View className="gap-y-3 mb-4">
              <View className="gap-y-1">
                <Text className="text-xs font-bold text-muted-foreground ml-1">
                  Full Name
                </Text>
                <TextInput
                  placeholder="e.g. John Doe"
                  placeholderTextColor="#80716b"
                  value={newName}
                  onChangeText={setNewName}
                  className="w-full rounded-xl border border-border bg-surface px-4 py-3 text-sm font-semibold text-foreground"
                />
              </View>
              <View className="gap-y-1">
                <Text className="text-xs font-bold text-muted-foreground ml-1">
                  Phone Number
                </Text>
                <TextInput
                  placeholder="e.g. +27 82 123 4567"
                  placeholderTextColor="#80716b"
                  value={newPhone}
                  onChangeText={setNewPhone}
                  keyboardType="phone-pad"
                  className="w-full rounded-xl border border-border bg-surface px-4 py-3 text-sm font-semibold text-foreground"
                />
              </View>
              <View className="gap-y-1">
                <Text className="text-xs font-bold text-muted-foreground ml-1">
                  Relationship
                </Text>
                <TextInput
                  placeholder="e.g. Spouse, Parent, Friend"
                  placeholderTextColor="#80716b"
                  value={newRelationship}
                  onChangeText={setNewRelationship}
                  className="w-full rounded-xl border border-border bg-surface px-4 py-3 text-sm font-semibold text-foreground"
                />
              </View>
            </View>

            <View className="flex-row gap-3">
              <TouchableOpacity
                onPress={() => setShowAddContact(false)}
                className="flex-1 py-3.5 border border-border rounded-xl items-center"
              >
                <Text className="text-xs font-bold text-foreground">
                  Cancel
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleAddContact}
                disabled={!newName.trim() || !newPhone.trim() || savingContact}
                className={`flex-1 py-3.5 rounded-xl items-center ${!newName.trim() || !newPhone.trim() ? "bg-primary/50" : "bg-primary"}`}
              >
                {savingContact ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text className="text-xs font-bold text-primary-foreground">
                    Save
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
}
