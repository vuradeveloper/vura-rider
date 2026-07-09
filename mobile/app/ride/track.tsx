import { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Modal,
  Alert,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useQueryClient } from "@tanstack/react-query";
import { getSocket, disconnectSocket } from "@/lib/socket";
import { getActiveRide, getRide, submitRating } from "@/services/RideService";
import { payForRide, payWithCash } from "@/services/PaymentService";
import { formatCurrency } from "@/lib/utils";
import type { RideStatus } from "@/lib/types";

type Driver = {
  name: string;
  vehicle: string | null;
  license_plate: string | null;
  rating: number | null;
};

const STATUS_LABEL: Record<RideStatus, string> = {
  searching: "Finding your driver…",
  accepted: "Driver is on the way",
  driver_arrived: "Your driver has arrived",
  in_progress: "Trip in progress",
  completed: "Trip completed",
  cancelled: "Trip cancelled",
};

export default function Track() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { rideId: rideIdParam } = useLocalSearchParams<{ rideId?: string }>();

  const [rideId, setRideId] = useState<string | null>(rideIdParam ?? null);
  const [status, setStatus] = useState<RideStatus>("searching");
  const [driver, setDriver] = useState<Driver | null>(null);
  const [fare, setFare] = useState<number | null>(null);
  const [pickupAddr, setPickupAddr] = useState("Pickup");
  const [dropoffAddr, setDropoffAddr] = useState("Destination");
  const [error, setError] = useState<string | null>(null);

  const [showCancel, setShowCancel] = useState(false);
  const [showRating, setShowRating] = useState(false);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const rideIdRef = useRef<string | null>(rideIdParam ?? null);
  const isHistory = !!rideIdParam;

  const cancelOptions = [
    "Driver is taking too long",
    "Driver asked me to cancel",
    "I accidentally requested",
    "Wait time was too long",
    "Driver isn't moving",
    "My pickup location is wrong",
  ];

  // ── Load addresses (live request) or existing ride (history/resume) ──
  useEffect(() => {
    (async () => {
      const [pa, da] = await Promise.all([
        AsyncStorage.getItem("vura.ride.pickup.address"),
        AsyncStorage.getItem("vura.ride.dropoff.address"),
      ]);
      if (pa) setPickupAddr(pa);
      if (da) setDropoffAddr(da);
    })();
  }, []);

  // ── History mode: just load the ride details, no socket ──
  useEffect(() => {
    if (!isHistory || !rideIdParam) return;
    (async () => {
      try {
        const { ride } = await getRide(rideIdParam);
        setStatus(ride.status);
        setFare(ride.fare);
        setPickupAddr(ride.pickup_address);
        setDropoffAddr(ride.destination_address);
        if (ride.driver_name) {
          setDriver({
            name: ride.driver_name,
            vehicle:
              [ride.vehicle_color, ride.vehicle_make, ride.vehicle_model]
                .filter(Boolean)
                .join(" ") || null,
            license_plate: ride.driver_license_plate,
            rating: null,
          });
        }
      } catch (e: any) {
        setError(e.message || "Could not load ride");
      }
    })();
  }, [isHistory, rideIdParam]);

  // ── Live mode: connect socket + request a ride ──
  useEffect(() => {
    if (isHistory) return;
    let socket: Awaited<ReturnType<typeof getSocket>> | null = null;
    let active = true;

    (async () => {
      try {
        socket = await getSocket();
        if (!active || !socket) return;

        socket.on("connect_error", (err: Error) =>
          setError(err.message || "Connection failed")
        );

        socket.emit("passenger:connect");

        socket.on("ride:requested:ack", (data: any) => {
          if (data.success) {
            setRideId(data.rideId);
            rideIdRef.current = data.rideId;
          } else {
            setError(data.reason || "Could not request ride");
          }
        });

        socket.on("ride:no:drivers", () =>
          setError("No drivers available nearby right now.")
        );
        socket.on("ride:expired", () =>
          setError("No drivers accepted your request. Please try again.")
        );

        socket.on("ride:accepted", (data: any) => {
          setStatus("accepted");
          setDriver({
            name: data.driver?.name ?? "Driver",
            vehicle: data.driver?.vehicle ?? null,
            license_plate: data.driver?.license_plate ?? null,
            rating: data.driver?.rating ?? null,
          });
        });

        socket.on("ride:driver:arrived", () => setStatus("driver_arrived"));
        socket.on("ride:started", () => setStatus("in_progress"));

        socket.on("ride:completed", (data: any) => {
          setStatus("completed");
          setFare(data.riderTotal ?? data.fare ?? null);
          handleCompleted(data.riderTotal ?? data.fare ?? null);
        });

        socket.on("ride:cancelled", (data: any) => {
          setStatus("cancelled");
          setError(data.reason || "Ride cancelled");
        });

        // Fire the request
        const [p, d] = await Promise.all([
          AsyncStorage.getItem("vura.ride.pickup"),
          AsyncStorage.getItem("vura.ride.dropoff"),
        ]);
        const [pa, da] = await Promise.all([
          AsyncStorage.getItem("vura.ride.pickup.address"),
          AsyncStorage.getItem("vura.ride.dropoff.address"),
        ]);
        const pickup = JSON.parse(p || "null");
        const dropoff = JSON.parse(d || "null");

        if (!pickup || !dropoff) {
          // Maybe we already had an active ride — restore it
          const { ride } = await getActiveRide();
          if (ride) {
            setRideId(ride.id);
            rideIdRef.current = ride.id;
            setStatus(ride.status);
            if (ride.driver_name) {
              setDriver({
                name: ride.driver_name,
                vehicle:
                  [ride.vehicle_color, ride.vehicle_make, ride.vehicle_model]
                    .filter(Boolean)
                    .join(" ") || null,
                license_plate: ride.driver_license_plate,
                rating: null,
              });
            }
          } else {
            setError("Missing pickup/destination. Please search again.");
          }
          return;
        }

        socket.emit("passenger:ride:request", {
          pickupAddress: pa || "Pickup",
          pickupLat: pickup[0],
          pickupLng: pickup[1],
          destinationAddress: da || "Destination",
          destinationLat: dropoff[0],
          destinationLng: dropoff[1],
        });
      } catch (e: any) {
        setError(e.message || "Could not connect");
      }
    })();

    return () => {
      active = false;
      if (socket) {
        socket.off("ride:requested:ack");
        socket.off("ride:no:drivers");
        socket.off("ride:expired");
        socket.off("ride:accepted");
        socket.off("ride:driver:arrived");
        socket.off("ride:started");
        socket.off("ride:completed");
        socket.off("ride:cancelled");
        socket.off("connect_error");
      }
    };
  }, [isHistory]);

  async function handleCompleted(total: number | null) {
    queryClient.invalidateQueries({ queryKey: ["ride-history"] });
    const id = rideIdRef.current;
    const method = await AsyncStorage.getItem("vura.ride.payment");
    if (id) {
      try {
        if (method === "card") {
          const res = await payForRide(id);
          if (!res.success) {
            Alert.alert(
              "Payment",
              res.error || "Card payment could not be completed."
            );
          }
        } else {
          await payWithCash(id);
        }
      } catch (e: any) {
        Alert.alert("Payment", e.message || "Payment failed");
      }
    }
    setShowRating(true);
  }

  async function doCancel(reason: string) {
    setShowCancel(false);
    try {
      const socket = await getSocket();
      socket.emit("passenger:ride:cancel", {
        rideId: rideIdRef.current,
        reason,
      });
    } catch {
      // ignore
    }
    queryClient.invalidateQueries({ queryKey: ["ride-history"] });
    router.replace("/");
  }

  async function doSubmitRating() {
    const id = rideIdRef.current;
    if (!id || rating === 0) return;
    setSubmitting(true);
    try {
      await submitRating(id, rating, comment || undefined);
    } catch {
      // rating is best-effort
    } finally {
      setSubmitting(false);
      disconnectSocket();
      router.replace("/");
    }
  }

  const canCancel = status === "searching" || status === "accepted";
  const driverInitials = driver?.name
    ? driver.name
        .split(" ")
        .map((p) => p[0])
        .join("")
        .slice(0, 2)
        .toUpperCase()
    : "";

  return (
    <SafeAreaView className="flex-1 bg-background">
      {/* Map placeholder */}
      <View className="relative h-[420px] bg-secondary items-center justify-center">
        <Ionicons name="map" size={64} color="#80716b" />
        <Text className="text-xs text-muted-foreground mt-2">Live tracking</Text>

        <TouchableOpacity
          onPress={() => router.replace("/")}
          className="absolute top-3 right-4 w-9 h-9 rounded-full bg-surface border border-border items-center justify-center"
        >
          <Ionicons name="close" size={16} color="#2e1e1a" />
        </TouchableOpacity>

        <View className="absolute top-3 left-1/2 -translate-x-1/2 rounded-full bg-foreground px-4 py-1.5">
          <Text className="text-xs font-bold text-background">
            {error ? "…" : STATUS_LABEL[status]}
          </Text>
        </View>

        {(status === "accepted" ||
          status === "driver_arrived" ||
          status === "in_progress") && (
          <View className="absolute top-14 left-1/2 -translate-x-1/2 rounded-full bg-green-100 border border-green-200 px-3 py-1 flex-row items-center gap-1">
            <Ionicons name="shield-checkmark" size={12} color="#166534" />
            <Text className="text-[10px] font-bold text-green-800">
              Smart Safety Active
            </Text>
          </View>
        )}
      </View>

      <View className="-mt-6 rounded-t-3xl bg-surface px-5 pt-5 pb-4 flex-1">
        <View className="mx-auto h-1.5 w-12 rounded-full bg-border mb-4" />

        <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
          {error && (
            <View className="rounded-xl bg-red-50 border border-red-200 p-4 mb-4">
              <Text className="text-sm font-semibold text-red-700">{error}</Text>
              <TouchableOpacity
                onPress={() => router.replace("/search")}
                className="mt-3 rounded-full bg-red-600 px-4 py-2.5 self-start"
              >
                <Text className="text-xs font-bold text-white">Try again</Text>
              </TouchableOpacity>
            </View>
          )}

          {!error && status === "searching" && (
            <View className="items-center py-6">
              <ActivityIndicator size="large" color="#e04e2f" />
              <Text className="text-sm text-muted-foreground mt-3">
                Finding a nearby driver…
              </Text>
            </View>
          )}

          {driver && (
            <View className="flex-row items-center gap-3">
              <View className="h-14 w-14 rounded-full bg-primary items-center justify-center">
                <Text className="text-lg font-bold text-white">
                  {driverInitials}
                </Text>
              </View>
              <View className="flex-1">
                <View className="flex-row items-center gap-1">
                  <Text className="font-bold text-foreground">
                    {driver.name}
                  </Text>
                  {driver.rating != null && driver.rating > 0 && (
                    <View className="flex-row items-center gap-0.5 ml-1">
                      <Ionicons name="star" size={12} color="#e04e2f" />
                      <Text className="text-xs font-semibold text-foreground">
                        {driver.rating.toFixed(2)}
                      </Text>
                    </View>
                  )}
                </View>
                <Text className="text-xs text-muted-foreground">
                  {driver.vehicle || "Vehicle"}
                </Text>
              </View>
              {driver.license_plate && (
                <View className="items-end">
                  <Text className="text-lg font-extrabold text-foreground">
                    {driver.license_plate}
                  </Text>
                  <Text className="text-[10px] uppercase text-muted-foreground">
                    Plate
                  </Text>
                </View>
              )}
            </View>
          )}

          {driver && (
            <View className="mt-4 flex-row gap-2">
              <TouchableOpacity className="flex-1 items-center gap-1 rounded-full bg-secondary py-3">
                <Ionicons name="call" size={16} color="#e04e2f" />
                <Text className="text-xs font-semibold text-foreground">
                  Call
                </Text>
              </TouchableOpacity>
              <TouchableOpacity className="flex-1 items-center gap-1 rounded-full bg-secondary py-3">
                <Ionicons name="chatbubble" size={16} color="#e04e2f" />
                <Text className="text-xs font-semibold text-foreground">
                  Chat
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                className="flex-1 items-center gap-1 rounded-full bg-secondary py-3"
                onPress={() => Alert.alert("Ride link copied!")}
              >
                <Ionicons name="share" size={16} color="#e04e2f" />
                <Text className="text-xs font-semibold text-foreground">
                  Share
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                className="flex-1 items-center gap-1 rounded-xl bg-red-50 border border-red-200 py-3"
                onPress={() =>
                  Alert.alert("SOS", "Dispatching emergency services.")
                }
              >
                <Ionicons name="warning" size={16} color="#dc2626" />
                <Text className="text-xs font-bold text-red-700">SOS</Text>
              </TouchableOpacity>
            </View>
          )}

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
                <Text
                  className="font-medium text-foreground text-sm"
                  numberOfLines={1}
                >
                  {pickupAddr}
                </Text>
                <Text
                  className="font-medium text-foreground text-sm"
                  numberOfLines={1}
                >
                  {dropoffAddr}
                </Text>
              </View>
              {fare != null && (
                <Text className="text-sm font-extrabold text-foreground">
                  {formatCurrency(fare)}
                </Text>
              )}
            </View>
          </View>

          {!isHistory && (
            <TouchableOpacity
              onPress={() => canCancel && setShowCancel(true)}
              disabled={!canCancel}
              className={`mt-6 rounded-xl py-3.5 items-center w-full ${canCancel ? "bg-secondary" : "bg-muted"}`}
            >
              <Text
                className={`text-sm font-bold ${canCancel ? "text-foreground" : "text-muted-foreground"}`}
              >
                {canCancel ? "Cancel trip" : STATUS_LABEL[status]}
              </Text>
            </TouchableOpacity>
          )}
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
          <TouchableOpacity activeOpacity={1} className="bg-surface rounded-t-[2rem] p-5">
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
                  onPress={() => doCancel(opt)}
                  className="w-full px-4 py-3.5 rounded-full border border-border bg-surface"
                >
                  <Text className="text-sm font-semibold text-foreground">
                    {opt}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* Rating Modal */}
      <Modal
        visible={showRating}
        animationType="slide"
        transparent
        onRequestClose={() => setShowRating(false)}
      >
        <View className="flex-1 bg-black/50 justify-end">
          <View className="bg-surface rounded-t-[2rem] p-6">
            <Text className="text-xl font-extrabold text-foreground text-center mb-1">
              Rate your driver
            </Text>
            <Text className="text-sm text-muted-foreground text-center mb-6">
              How was your trip{driver ? ` with ${driver.name}` : ""}?
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
              value={comment}
              onChangeText={setComment}
              className="w-full rounded-xl border border-border bg-secondary px-4 py-3.5 text-sm font-semibold text-foreground h-24 mb-6"
              textAlignVertical="top"
            />

            <TouchableOpacity
              disabled={rating === 0 || submitting}
              onPress={doSubmitRating}
              className={`w-full rounded-xl py-4 items-center ${rating === 0 ? "bg-primary/50" : "bg-primary"}`}
            >
              {submitting ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text className="text-sm font-bold text-primary-foreground">
                  Submit Rating
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
