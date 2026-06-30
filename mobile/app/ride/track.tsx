import { useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Modal,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

export default function Track() {
  const router = useRouter();
  const [showCancel, setShowCancel] = useState(false);
  const [isCompleted, setIsCompleted] = useState(false);
  const [isEnRoute, setIsEnRoute] = useState(false);
  const [rating, setRating] = useState(0);

  // Simulate trip progression
  useState(() => {
    const t1 = setTimeout(() => setIsEnRoute(true), 6000);
    const t2 = setTimeout(() => setIsCompleted(true), 14000);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  });

  const cancelOptions = [
    "Driver is taking too long",
    "Driver asked me to cancel",
    "I accidentally requested",
    "Wait time was too long",
    "Driver isn't moving",
    "My pickup location is wrong",
  ];

  return (
    <SafeAreaView className="flex-1 bg-background">
      {/* Map placeholder */}
      <View className="relative h-[420px] bg-secondary items-center justify-center">
        <Ionicons name="map" size={64} color="#80716b" />
        <Text className="text-xs text-muted-foreground mt-2">Live tracking</Text>

        <TouchableOpacity
          onPress={() => router.push("/")}
          className="absolute top-3 right-4 w-9 h-9 rounded-full bg-surface border border-border items-center justify-center"
        >
          <Ionicons name="close" size={16} color="#2e1e1a" />
        </TouchableOpacity>

        <View className="absolute top-3 left-1/2 -translate-x-1/2 rounded-full bg-foreground px-4 py-1.5">
          <Text className="text-xs font-bold text-background">
            Arriving in 3 min
          </Text>
        </View>

        <View className="absolute top-14 left-1/2 -translate-x-1/2 rounded-full bg-green-100 border border-green-200 px-3 py-1 flex-row items-center gap-1">
          <Ionicons name="shield-checkmark" size={12} color="#166534" />
          <Text className="text-[10px] font-bold text-green-800">
            Smart Safety Active
          </Text>
        </View>
      </View>

      <View className="-mt-6 rounded-t-3xl bg-surface px-5 pt-5 pb-4 flex-1">
        <View className="mx-auto h-1.5 w-12 rounded-full bg-border mb-4" />

        <ScrollView
          className="flex-1"
          showsVerticalScrollIndicator={false}
        >
          {/* Driver info */}
          <View className="flex-row items-center gap-3">
            <View className="h-14 w-14 rounded-full bg-primary items-center justify-center">
              <Text className="text-lg font-bold text-white">MR</Text>
            </View>
            <View className="flex-1">
              <View className="flex-row items-center gap-1">
                <Text className="font-bold text-foreground">Marcus R.</Text>
                <View className="flex-row items-center gap-0.5 ml-1">
                  <Ionicons name="star" size={12} color="#e04e2f" />
                  <Text className="text-xs font-semibold text-foreground">
                    4.96
                  </Text>
                </View>
              </View>
              <Text className="text-xs text-muted-foreground">
                Toyota Prius · Silver
              </Text>
            </View>
            <View className="items-end">
              <Text className="text-lg font-extrabold text-foreground">
                LX24 PQR
              </Text>
              <Text className="text-[10px] uppercase text-muted-foreground">
                Plate
              </Text>
            </View>
          </View>

          {/* Action buttons */}
          <View className="mt-4 flex-row gap-2">
            <TouchableOpacity className="flex-1 items-center gap-1 rounded-full bg-secondary py-3">
              <Ionicons name="call" size={16} color="#e04e2f" />
              <Text className="text-xs font-semibold text-foreground">Call</Text>
            </TouchableOpacity>
            <TouchableOpacity className="flex-1 items-center gap-1 rounded-full bg-secondary py-3">
              <Ionicons name="chatbubble" size={16} color="#e04e2f" />
              <Text className="text-xs font-semibold text-foreground">Chat</Text>
            </TouchableOpacity>
            <TouchableOpacity
              className="flex-1 items-center gap-1 rounded-full bg-secondary py-3"
              onPress={() => Alert.alert("Ride link copied!")}
            >
              <Ionicons name="share" size={16} color="#e04e2f" />
              <Text className="text-xs font-semibold text-foreground">Share</Text>
            </TouchableOpacity>
            <TouchableOpacity
              className="flex-1 items-center gap-1 rounded-xl bg-red-50 border border-red-200 py-3"
              onPress={() => Alert.alert("SOS", "Dispatching emergency services.")}
            >
              <Ionicons name="warning" size={16} color="#dc2626" />
              <Text className="text-xs font-bold text-red-700">SOS</Text>
            </TouchableOpacity>
          </View>

          {/* Trip details */}
          <View className="mt-4 rounded-xl border border-border p-3.5">
            <Text className="text-[11px] uppercase font-bold text-muted-foreground">
              Trip
            </Text>
            <View className="mt-2 flex-row items-start gap-3">
              <View className="items-center pt-1.5">
                <View className="w-2.5 h-2.5 rounded-full bg-foreground" />
                <View className="w-px h-6 border-l-2 border-dashed border-muted-foreground/40" />
                <View className="w-2.5 h-2.5 rounded-md bg-primary" />
              </View>
              <View className="flex-1 gap-y-3">
                <Text className="font-medium text-foreground text-sm">
                  Current location
                </Text>
                <Text className="font-medium text-foreground text-sm">
                  Shoreditch High St, London
                </Text>
              </View>
              <Text className="text-sm font-extrabold text-foreground">
                R15.90
              </Text>
            </View>
          </View>

          <TouchableOpacity
            onPress={() => !isEnRoute && setShowCancel(true)}
            disabled={isEnRoute}
            className={`mt-6 rounded-xl py-3.5 items-center w-full ${isEnRoute ? "bg-muted" : "bg-secondary"}`}
          >
            <Text
              className={`text-sm font-bold ${isEnRoute ? "text-muted-foreground" : "text-foreground"}`}
            >
              {isEnRoute ? "Trip in progress" : "Cancel trip"}
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </View>

      {/* Cancel Modal */}
      <Modal
        visible={showCancel}
        animationType="slide"
        transparent
        onRequestClose={() => setShowCancel(false)}
      >
        <TouchableOpacity
          className="flex-1 bg-black/50 justify-end"
          activeOpacity={1}
          onPress={() => setShowCancel(false)}
        >
          <View className="bg-surface rounded-t-[2rem] p-5">
            <View className="flex-row justify-between items-center mb-4">
              <Text className="text-lg font-bold text-foreground">
                Why are you cancelling?
              </Text>
              <TouchableOpacity
                onPress={() => setShowCancel(false)}
                className="w-8 h-8 rounded-full bg-secondary items-center justify-center"
              >
                <Ionicons name="close" size={16} color="#2e1e1a" />
              </TouchableOpacity>
            </View>
            <View className="gap-y-2 mb-4">
              {cancelOptions.map((opt, i) => (
                <TouchableOpacity
                  key={i}
                  onPress={() => {
                    setShowCancel(false);
                    router.push("/");
                  }}
                  className="w-full px-4 py-3.5 rounded-full border border-border bg-surface"
                >
                  <Text className="text-sm font-semibold text-foreground">
                    {opt}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Rating Modal */}
      <Modal
        visible={isCompleted}
        animationType="slide"
        transparent
        onRequestClose={() => setIsCompleted(false)}
      >
        <View className="flex-1 bg-black/50 justify-end">
          <View className="bg-surface rounded-t-[2rem] p-6">
            <Text className="text-xl font-extrabold text-foreground text-center mb-1">
              Rate your driver
            </Text>
            <Text className="text-sm text-muted-foreground text-center mb-6">
              How was your trip with Marcus R.?
            </Text>

            <View className="flex-row justify-center gap-2 mb-6">
              {[1, 2, 3, 4, 5].map((star) => (
                <TouchableOpacity key={star} onPress={() => setRating(star)}>
                  <Ionicons
                    name="star"
                    size={40}
                    color={rating >= star ? "#e04e2f" : "#ebe3de"}
                  />
                </TouchableOpacity>
              ))}
            </View>

            <TextInput
              placeholder="Add a comment (optional)"
              placeholderTextColor="#80716b"
              multiline
              numberOfLines={3}
              className="w-full rounded-xl border border-border bg-secondary px-4 py-3.5 text-sm font-semibold text-foreground h-24 mb-6"
              textAlignVertical="top"
            />

            <TouchableOpacity
              disabled={rating === 0}
              onPress={() => router.push("/")}
              className={`w-full rounded-xl py-4 items-center ${rating === 0 ? "bg-primary/50" : "bg-primary"}`}
            >
              <Text className="text-sm font-bold text-primary-foreground">
                Submit Rating
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
