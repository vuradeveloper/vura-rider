import { disconnectSocket, getSocket, getConnectedSocket } from "@/lib/socket";
import { fetchRoute } from "@/lib/route";
import type { RideStatus, Waypoint } from "@/lib/types";
import { formatCurrency } from "@/lib/utils";
import { apiFetch } from "@/lib/api";
import { payWithCash, payWithAffiliate, initiatePaystackPayment } from "@/services/PaymentService";
import PaymentWebView from "@/components/PaymentWebView";
import { getActiveRide, getRide, submitRating } from "@/services/RideService";
import { submitTip, getTipSuggestions } from "@/services/TipService";
import { shareTrip } from "@/services/SafetyService";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useQueryClient } from "@tanstack/react-query";
import {
  useFocusEffect,
  useLocalSearchParams,
  useRouter,
} from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAppStore } from "@/lib/store";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  ScrollView,
  Share,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

// ⚠️ Adjust these two imports to match where they actually live in your project.
import MapView, { Marker, Polyline } from "@/components/MapView";
import { CAR_LOCATOR_DATA_URL } from "@/lib/carIcon";
const CAR_LOCATOR_IMG = CAR_LOCATOR_DATA_URL;

type Driver = {
  name: string;
  vehicle: string | null;
  license_plate: string | null;
  rating: number | null;
};

type DriverLoc = { lat: number; lng: number; bearing: number };

type NearbyCar = { id: string; lat: number; lng: number; angle: number };

const STATUS_LABEL: Record<RideStatus, string> = {
  searching: "Finding your driver…",
  accepted: "Driver is on the way",
  driver_arrived: "Your driver has arrived",
  in_progress: "Trip in progress",
  completed: "Trip completed",
  cancelled: "Trip cancelled",
};

function computeBearing(
  from: { latitude: number; longitude: number },
  to: { latitude: number; longitude: number }
) {
  const lat1 = (from.latitude * Math.PI) / 180;
  const lat2 = (to.latitude * Math.PI) / 180;
  const dLng = ((to.longitude - from.longitude) * Math.PI) / 180;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  const brng = (Math.atan2(y, x) * 180) / Math.PI;
  return (brng + 360) % 360;
}

function densifyRoute(route: { latitude: number; longitude: number }[], segM = 12) {
  if (route.length < 2) return route;
  const R = 6371e3, rad = Math.PI / 180;
  const dist = (a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) => {
    const dLat = (b.latitude - a.latitude) * rad, dLon = (b.longitude - a.longitude) * rad;
    const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  };
  const out = [route[0]];
  for (let i = 0; i < route.length - 1; i++) {
    const a = route[i], b = route[i + 1];
    const steps = Math.max(1, Math.floor(dist(a, b) / segM));
    for (let j = 1; j <= steps; j++) {
      out.push({ latitude: a.latitude + (b.latitude - a.latitude) * (j / steps), longitude: a.longitude + (b.longitude - a.longitude) * (j / steps) });
    }
  }
  return out;
}

function getSpeedForProgress(pct: number) {
  if (pct < 0.25) return 35;
  if (pct >= 0.25 && pct < 0.55) return 45;
  if (pct >= 0.55 && pct < 0.8) return 60;
  return 35;
}

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
  const [pickupCoord, setPickupCoord] = useState<[number, number] | null>(null);
  const [dropoffCoord, setDropoffCoord] = useState<[number, number] | null>(null);
  const [driverLoc, setDriverLoc] = useState<DriverLoc | null>(null);
  const [myCarLoc, setMyCarLoc] = useState<{ lat: number; lng: number; bearing: number } | null>(null);
  const [nearbyCars, setNearbyCars] = useState<NearbyCar[]>([]);

  const [routeCoords, setRouteCoords] = useState<{ latitude: number; longitude: number }[]>([]);
  const [denseRoute, setDenseRoute] = useState<{ latitude: number; longitude: number }[]>([]);
  const [staticRoute, setStaticRoute] = useState<{ latitude: number; longitude: number }[]>([]);
  const [carBearing, setCarBearing] = useState(0);
  const [showCancel, setShowCancel] = useState(false);
  const [waypoints, setWaypoints] = useState<Waypoint[]>([]);
  const [showRating, setShowRating] = useState(false);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [showCallModal, setShowCallModal] = useState(false);
  const [showEtaShareModal, setShowEtaShareModal] = useState(false);
  const [sharingEta, setSharingEta] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [tipAmount, setTipAmount] = useState<number | null>(null);
  const [customTip, setCustomTip] = useState("");

  const rideIdRef = useRef<string | null>(rideIdParam ?? null);
  const statusRef = useRef<RideStatus>("searching");
  const [tierName, setTierName] = useState("VuraGo");
  const mapRef = useRef<any>(null);
  const isHistory = !!rideIdParam;
  const demoRanRef = useRef(false);
  const prevPickupRef = useRef<[number, number] | null>(null);

  // Paystack payment before the ride is booked. With a saved card the server
  // charges it synchronously (charge_authorization); with no saved card it
  // returns a hosted-checkout URL we open in the WebView.
  const [paystackVisible, setPaystackVisible] = useState(false);
  const [paystackUrl, setPaystackUrl] = useState("");
  const paystackRef = useRef<string | null>(null);
  // Payment gate: no driver search may begin until the card payment (if any)
  // has been confirmed by the server. Set true for cash/affiliate/mock.
  const paymentConfirmedRef = useRef(false);

  // Cancellation for the demo simulation. Deliberately refs (not locals) and
  // set by a dedicated unmount-only effect so that re-renders caused by
  // pickup/dropoff/waypoint state updates — which re-run the demo effect and
  // fire its cleanup — do NOT cancel an in-flight simulation.
  const demoCancelledRef = useRef(false);
  const demoAnimIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Prevents chargeCardOnPickup from firing more than once per ride, even if
  // both the demo simulation AND a real socket event trigger it.
  const chargeFiredRef = useRef(false);

  // Live state for the demo simulation, stored in refs so a pickup update can
  // re-route the car mid-leg without restarting the whole simulation.
  const pickupCoordRef = useRef<[number, number] | null>(pickupCoord);
  const driverLocRef = useRef<DriverLoc | null>(null);
  const demoPhaseRef = useRef<"searching" | "to_pickup" | "arrived" | "to_dest">("searching");
  const demoRouteRef = useRef<{ latitude: number; longitude: number }[]>([]);
  const demoStepRef = useRef(0);
  const demoOnDoneRef = useRef<(() => void) | null>(null);

  // Flips true the instant a *real* socket driver-location event arrives.
  const hasRealDriverLocRef = useRef(false);
  const animRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stepRef = useRef(0);

  useEffect(() => {
    statusRef.current = status;
    if (status === "completed" || status === "cancelled") {
      mapRef.current?.unfollow();
    }
  }, [status]);

  useEffect(() => {
    if (mapRef.current?.followCar && driverLoc) {
      mapRef.current.followCar(driverLoc.lat, driverLoc.lng, carBearing, 17);
    }
  }, [driverLoc, carBearing]);

  const cancelOptions = [
    "Driver is taking too long",
    "Driver asked me to cancel",
    "I accidentally requested",
    "Wait time was too long",
    "Driver isn't moving",
    "My pickup location is wrong",
  ];

  // ── Load addresses + coordinates (live request) ──
  useEffect(() => {
    (async () => {
      const [pa, da, p, d, wp, tier] = await Promise.all([
        AsyncStorage.getItem("vura.ride.pickup.address"),
        AsyncStorage.getItem("vura.ride.dropoff.address"),
        AsyncStorage.getItem("vura.ride.pickup"),
        AsyncStorage.getItem("vura.ride.dropoff"),
        AsyncStorage.getItem("vura.ride.waypoints"),
        AsyncStorage.getItem("vura.ride.tier"),
      ]);
      if (pa) setPickupAddr(pa);
      if (da) setDropoffAddr(da);
      try {
        if (p) setPickupCoord(JSON.parse(p));
        if (d) setDropoffCoord(JSON.parse(d));
        if (wp) setWaypoints(JSON.parse(wp));
      } catch {}
      if (tier) {
        if (tier === "go") setTierName("VuraGo");
        else if (tier === "x") setTierName("VuraX");
        else if (tier === "electric") setTierName("Electric");
        else if (tier === "lux") setTierName("VuraLux");
      }
    })();
  }, []);

  // Draw the green route line (pickup → stops → destination) straight away so
  // the path is visible while the app is still searching for a driver — same
  // line as shown on the options screen.
  useEffect(() => {
    if (!pickupCoord || !dropoffCoord) return;
    let active = true;
    (async () => {
      const route = await fetchRoute(pickupCoord, dropoffCoord, waypoints);
      if (active) setStaticRoute(route);
    })();
    return () => {
      active = false;
    };
  }, [pickupCoord, dropoffCoord, waypoints]);

  // Re-read pickup from storage when returning to the screen (e.g. after the
  // rider updates the pickup location on the map picker).
  useFocusEffect(
    useCallback(() => {
      (async () => {
        const [pa, p, wp] = await Promise.all([
          AsyncStorage.getItem("vura.ride.pickup.address"),
          AsyncStorage.getItem("vura.ride.pickup"),
          AsyncStorage.getItem("vura.ride.waypoints"),
        ]);
        if (pa) setPickupAddr(pa);
        try {
          const parsed = p ? JSON.parse(p) : null;
          if (parsed && Array.isArray(parsed) && parsed.length === 2) {
            setPickupCoord([Number(parsed[0]), Number(parsed[1])]);
          }
        } catch {}
        try {
          if (wp) setWaypoints(JSON.parse(wp));
        } catch {}
      })();
    }, [])
  );

  // While waiting for a driver, gently drift a few nearby cars around the
  // pickup so the map doesn't look dead during the "searching" phase.
  useEffect(() => {
    if (isHistory || !pickupCoord) return;
    const [baseLat, baseLng] = pickupCoord;
    setNearbyCars(
      [0, 1, 2].map((i) => ({
        id: `car-${i}`,
        lat: baseLat + (Math.random() - 0.5) * 0.01,
        lng: baseLng + (Math.random() - 0.5) * 0.01,
        angle: Math.random() * 360,
      }))
    );
    const interval = setInterval(() => {
      setNearbyCars((prev) =>
        prev.map((c) => {
          const angle = (c.angle + (Math.random() - 0.5) * 4 + 360) % 360;
          const rad = (angle * Math.PI) / 180;
          const step = 0.00004;
          return {
            ...c,
            lat: c.lat + Math.cos(rad) * step,
            lng: c.lng + Math.sin(rad) * step,
            angle,
          };
        })
      );
    }, 100);
    return () => clearInterval(interval);
  }, [isHistory, pickupCoord]);

  // Re-center the map on the pickup whenever it changes (before the trip starts).
  useEffect(() => {
    if (isHistory) return;
    const prev = prevPickupRef.current;
    prevPickupRef.current = pickupCoord;
    if (
      prev &&
      pickupCoord &&
      (prev[0] !== pickupCoord[0] || prev[1] !== pickupCoord[1]) &&
      !driverLoc
    ) {
      mapRef.current?.animateToRegion({
        latitude: pickupCoord[0],
        longitude: pickupCoord[1],
        latitudeDelta: 0.02,
        longitudeDelta: 0.02,
      }, 400);
    }
  }, [pickupCoord, driverLoc, isHistory]);

  // Keep a live ref of the car's position so pickup updates can re-route it
  // mid-leg using its current location (not a stale captured one).
  useEffect(() => {
    driverLocRef.current = driverLoc;
  }, [driverLoc]);

  // Rider car converges toward the driver car simultaneously: as the driver
  // moves along its route to the pickup, the rider's own car marker glides
  // toward the driver so both vehicles approach each other at the same time,
  // each keeping its own rotation/heading.
  useEffect(() => {
    if (!driverLoc) return;
    if (status !== "accepted" && status !== "driver_arrived" && status !== "in_progress") return;
    setMyCarLoc((prev) => {
      const from = prev
        ? { lat: prev.lat, lng: prev.lng }
        : pickupCoord
          ? { lat: pickupCoord[0], lng: pickupCoord[1] }
          : null;
      if (!from) return prev;
      // Move a fixed fraction of the remaining distance each driver tick so
      // both cars converge instead of one teleporting to the other.
      const t = 0.08;
      const lat = from.lat + (driverLoc.lat - from.lat) * t;
      const lng = from.lng + (driverLoc.lng - from.lng) * t;
      return { lat, lng, bearing: computeBearing({ latitude: from.lat, longitude: from.lng }, { latitude: driverLoc.lat, longitude: driverLoc.lng }) || 0 };
    });
  }, [driverLoc, status, pickupCoord]);

  // Keep a live ref of the pickup so the demo uses the latest one even if it
  // changes during the 45s "searching" phase.
  useEffect(() => {
    pickupCoordRef.current = pickupCoord;
  }, [pickupCoord]);

  // Starts (or re-starts) the car glide along the given points. Safe to call
  // repeatedly — it clears the previous interval, so a pickup update can
  // re-target the car without stopping the simulation.
  const startDemoAnimation = (points: { latitude: number; longitude: number }[], startStep = 0) => {
    if (points.length < 2) return;
    demoRouteRef.current = points;
    demoStepRef.current = startStep;
    const idx = Math.min(startStep, points.length - 1);
    const startBearing = computeBearing(points[idx], points[Math.min(idx + 1, points.length - 1)] || points[idx]);
    setDenseRoute(points);
    setRouteCoords(points);
    setDriverLoc({
      lat: points[idx].latitude,
      lng: points[idx].longitude,
      bearing: Number.isFinite(startBearing) ? startBearing : 0,
    });
    driverLocRef.current = { lat: points[idx].latitude, lng: points[idx].longitude, bearing: Number.isFinite(startBearing) ? startBearing : 0 };
    if (demoAnimIntervalRef.current) clearInterval(demoAnimIntervalRef.current);
    demoAnimIntervalRef.current = setInterval(() => {
    const route = demoRouteRef.current;
    const step = demoStepRef.current;
    // Skip past any duplicate/zero-length points so the car never stalls on a
    // single spot — find the next point that is actually different.
    let next = step;
    while (next < route.length - 1 && route[next].latitude === route[next + 1].latitude && route[next].longitude === route[next + 1].longitude) {
      next++;
    }
    if (next < route.length - 1) {
      const cur = route[next];
      const nxt = route[next + 1];
      const bearing = computeBearing(cur, nxt);
      setCarBearing(Number.isFinite(bearing) ? bearing : 0);
      setDriverLoc({ lat: nxt.latitude, lng: nxt.longitude, bearing: Number.isFinite(bearing) ? bearing : 0 });
      driverLocRef.current = { lat: nxt.latitude, lng: nxt.longitude, bearing: Number.isFinite(bearing) ? bearing : 0 };
      demoStepRef.current = next + 1;
    } else {
        if (demoAnimIntervalRef.current) {
          clearInterval(demoAnimIntervalRef.current);
          demoAnimIntervalRef.current = null;
        }
        const done = demoOnDoneRef.current;
        demoOnDoneRef.current = null;
        if (done) done();
      }
    }, 250);
  };

  // ── DEMO ONLY: simulate a driver car until a real backend is wired up ──
  useEffect(() => {
    if (isHistory || !pickupCoord) return;
    // Never re-run once started — pickup updates should re-route the car, not
    // restart the whole simulation.
    if (demoRanRef.current) return;
    demoRanRef.current = true;

    const updateDbStatus = async (newStatus: RideStatus) => {
      const id = rideIdRef.current;
      if (id) {
        try {
          await apiFetch(`/api/rides/${id}/status`, {
            method: "PATCH",
            body: JSON.stringify({ status: newStatus }),
          });
        } catch (e) {
          console.error("Failed to update status in DB:", e);
        }
      }
    };

    (async () => {
      // 0. Payment gate: NEVER start looking for a driver until the card
      // payment (if any) has been confirmed. The socket effect below does the
      // payment and flips paymentConfirmedRef on success; the demo simulation
      // (used when no real backend driver matching exists) must not show a
      // driver before that happens.
      while (!paymentConfirmedRef.current) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        if (demoCancelledRef.current) return;
      }
      if (demoCancelledRef.current) return;

      // If returning to a ride that was minimized, resume it exactly where the
      // car was (position + route progress) so motion continues like Uber/Bolt.
      const saved = useAppStore.getState().savedDemoRide;
      if (saved?.route && saved.route.length > 1) {
        useAppStore.getState().setRideMinimized(false);
        useAppStore.getState().setSavedDemoRide(null);
        setStatus(saved.status as any);
        if (saved.driver_name) {
          setDriver({
            name: saved.driver_name,
            vehicle: [saved.vehicle_color, saved.vehicle_make, saved.vehicle_model].filter(Boolean).join(" ") || null,
            license_plate: saved.driver_license_plate ?? null,
            rating: null,
          });
        }
        if (saved.driverLoc) {
          setCarBearing(saved.driverLoc.bearing);
          setDriverLoc(saved.driverLoc);
          driverLocRef.current = saved.driverLoc;
        }
        // Resume the car from the saved route + step, continuing its motion.
        demoRouteRef.current = saved.route;
        demoStepRef.current = saved.step;
        demoPhaseRef.current = (saved.phase as any) || "to_pickup";
        setDenseRoute(saved.route);
        setRouteCoords(saved.route);
        startDemoAnimation(saved.route, saved.step);
        // Set up the phase continuation so the car doesn't stop at the end of
        // the saved route — it continues to the next phase (to_dest, completed).
        const phase = saved.phase || "to_pickup";
        if (phase === "to_pickup" || phase === "to_dest") {
          demoOnDoneRef.current = async () => {
            if (demoCancelledRef.current) return;
            if (demoPhaseRef.current === "to_pickup") {
              demoPhaseRef.current = "arrived";
              setStatus("driver_arrived");
              await updateDbStatus("driver_arrived");
              await new Promise((resolve) => setTimeout(resolve, 20000));
              if (demoCancelledRef.current) return;
              setStatus("in_progress");
              await updateDbStatus("in_progress");
              // Fetch route to destination
              const [baseLat, baseLng] = pickupCoordRef.current ?? pickupCoord;
              const [endLat, endLng] = dropoffCoord ?? [baseLat + (Math.random() - 0.5) * 0.04, baseLng + (Math.random() - 0.5) * 0.04];
              const routeToDest = await fetchRoute([baseLat, baseLng], [endLat, endLng], waypoints);
              if (demoCancelledRef.current) return;
              const denseDest = densifyRoute(
                routeToDest.length > 1 ? routeToDest : [[baseLat, baseLng], [endLat, endLng]].map((c) => ({ latitude: c[0], longitude: c[1] })),
                60
              );
              demoPhaseRef.current = "to_dest";
              await new Promise<void>((resolve) => {
                demoOnDoneRef.current = resolve;
                startDemoAnimation(denseDest);
              });
              if (demoCancelledRef.current) return;
              // Arrived at destination
              setStatus("completed");
              await updateDbStatus("completed");
              await new Promise((resolve) => setTimeout(resolve, 8000));
              if (demoCancelledRef.current) return;
              // The trip is done — clear the minimized ride so the banner never lingers.
              useAppStore.getState().resetRideState();
              setShowRating(true);
            } else if (demoPhaseRef.current === "to_dest") {
              setStatus("completed");
              await updateDbStatus("completed");
              await new Promise((resolve) => setTimeout(resolve, 8000));
              if (demoCancelledRef.current) return;
              // The trip is done — clear the minimized ride so the banner never lingers.
              useAppStore.getState().resetRideState();
              setShowRating(true);
            }
          };
        }
        return;
      }

      // 1. Initial State: Searching (~15s so the rider can edit/pickup/stops)
      // If a real socket is connected, wait for the driver to accept via the
      // socket (ride:accepted). If no socket, fall back to the demo simulation
      // auto-accept after 15s.
      setStatus("searching");
      // Mark the ride active in the store so the floating "Go Back To Ride"
      // banner shows on every screen, even during the demo simulation.
      useAppStore.getState().setActiveRide({
        id: "demo",
        status: "searching",
      } as any);
      setDenseRoute([]);
      setRouteCoords([]);
      setDriver(null);
      setDriverLoc(null);
      driverLocRef.current = null;
      setMyCarLoc(null);
      demoPhaseRef.current = "searching";

      // Wait for the socket to become available (it may still be connecting or
      // reconnecting after a token refresh). Never show a fake driver — keep
      // searching until a real driver accepts.
      let connectedSocket = getConnectedSocket();
      const socketDeadline = Date.now() + 45000;
      while (!connectedSocket && Date.now() < socketDeadline && !demoCancelledRef.current) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        connectedSocket = getConnectedSocket();
      }
      if (demoCancelledRef.current) return;

      if (connectedSocket) {
        // Wait up to 60s for the real ride:accepted event, then proceed with
        // the demo simulation (route fetching, animation).
        const accepted = await new Promise<boolean>((resolve) => {
          const timer = setTimeout(() => resolve(false), 60000);
          connectedSocket.once("ride:accepted", () => {
            clearTimeout(timer);
            resolve(true);
          });
        });
        if (!accepted || demoCancelledRef.current) return;
        // Driver info was already set by the socket handler — skip the fake
        // driver setup below and go straight to route fetching.
      } else {
        // No socket could connect — keep searching. The socket effect will
        // emit a ride request and eventually land a real driver when the
        // connection is restored.
        while (!demoCancelledRef.current) {
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
        return;
      }


      const [baseLat, baseLng] = pickupCoordRef.current ?? pickupCoord;
      const [endLat, endLng] = dropoffCoord ?? [
        baseLat + (Math.random() - 0.5) * 0.04,
        baseLng + (Math.random() - 0.5) * 0.04,
      ];

      // Simulate a starting position for the driver (~2-3km away) and show the
      // car immediately so the rider sees it moving right away.
      const startLat = baseLat + (Math.random() - 0.5) * 0.04;
      const startLng = baseLng + (Math.random() - 0.5) * 0.04;
      setDriverLoc({ lat: startLat, lng: startLng, bearing: 0 });

      // Fetch route from driver start to pickup (no waypoints for pickup leg)
      const routeToPickup = await fetchRoute([startLat, startLng], [baseLat, baseLng]);
      if (demoCancelledRef.current) return;

      const densePickup = densifyRoute(
        routeToPickup.length > 1
          ? routeToPickup
          : [[startLat, startLng], [baseLat, baseLng]].map((c) => ({
              latitude: c[0],
              longitude: c[1],
            })),
        60
      );

      // 3. Glide to pickup — this leg is re-routable when the rider changes
      // the pickup mid-trip (see the pickup-change effect below).
      demoPhaseRef.current = "to_pickup";
      await new Promise<void>((resolve) => {
        demoOnDoneRef.current = resolve;
        startDemoAnimation(densePickup);
      });
      if (demoCancelledRef.current) return;

      // 4. Arrived at pickup: Wait 20s, then start trip ("in_progress")
      demoPhaseRef.current = "arrived";
      setStatus("driver_arrived");
      await updateDbStatus("driver_arrived");
      useAppStore.getState().setActiveRide({
        id: "demo",
        status: "driver_arrived",
        driver_name: "Sipho Khumalo",
        driver_license_plate: "VURA 123 GP",
        vehicle_make: "Toyota",
        vehicle_model: "Corolla",
        vehicle_color: "White",
      } as any);
      await new Promise((resolve) => setTimeout(resolve, 20000));
      if (demoCancelledRef.current) return;

      setStatus("in_progress");
      await updateDbStatus("in_progress");
      useAppStore.getState().setActiveRide({
        id: "demo",
        status: "in_progress",
        driver_name: "Sipho Khumalo",
        driver_license_plate: "VURA 123 GP",
        vehicle_make: "Toyota",
        vehicle_model: "Corolla",
        vehicle_color: "White",
      } as any);

      // Fetch route from pickup to destination, passing all stop waypoints
      const routeToDest = await fetchRoute([baseLat, baseLng], [endLat, endLng], waypoints);
      if (demoCancelledRef.current) return;

      const denseDest = densifyRoute(
        routeToDest.length > 1
          ? routeToDest
          : [[baseLat, baseLng], [endLat, endLng]].map((c) => ({
              latitude: c[0],
              longitude: c[1],
            })),
        60
      );

      // 5. Glide to destination
      demoPhaseRef.current = "to_dest";
      await new Promise<void>((resolve) => {
        demoOnDoneRef.current = resolve;
        startDemoAnimation(denseDest);
      });
      if (demoCancelledRef.current) return;

      // 6. Arrived at destination: Status "completed"
      setStatus("completed");
      await updateDbStatus("completed");
      await new Promise((resolve) => setTimeout(resolve, 8000));
      if (demoCancelledRef.current) return;

      // The trip is done — clear the minimized ride so the banner never lingers.
      useAppStore.getState().resetRideState();

      // Show rating/receipt modal
      setShowRating(true);
    })();
  }, [isHistory, pickupCoord, dropoffCoord, waypoints]);

  // When the rider updates the pickup while the car is still en route to it,
  // re-route the car from its current position to the NEW pickup so it keeps
  // moving and the green line + pickup marker reflect the new location.
  useEffect(() => {
    if (isHistory) return;
    if (demoPhaseRef.current !== "to_pickup") return;
    if (!pickupCoord) return;
    const cur = driverLocRef.current;
    if (!cur) return;
    (async () => {
      if (demoCancelledRef.current) return;
      const route = await fetchRoute([cur.lat, cur.lng], [pickupCoord[0], pickupCoord[1]]);
      if (demoCancelledRef.current || demoPhaseRef.current !== "to_pickup") return;
      const dense = densifyRoute(
        route.length > 1
          ? route
          : [[cur.lat, cur.lng], [pickupCoord[0], pickupCoord[1]]].map((c) => ({
              latitude: c[0],
              longitude: c[1],
            })),
        60
      );
      startDemoAnimation(dense);
    })();
  }, [isHistory, pickupCoord]);

  // Cancels the demo simulation ONLY on unmount. Kept separate from the demo
  // effect so its cleanup doesn't fire on every pickup/dropoff/waypoint re-set
  // (which was cancelling the simulation and leaving the screen stuck on
  // "Contacting nearby drivers..." forever).
  useEffect(() => {
    return () => {
      demoCancelledRef.current = true;
      if (demoAnimIntervalRef.current) {
        clearInterval(demoAnimIntervalRef.current);
        demoAnimIntervalRef.current = null;
      }
    };
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
        // ⚠️ Assumes your ride object carries lat/lng alongside the address
        // fields — rename these if your API uses different keys.
        if (ride.pickup_lat != null && ride.pickup_lng != null) {
          setPickupCoord([ride.pickup_lat, ride.pickup_lng]);
        }
        if (ride.destination_lat != null && ride.destination_lng != null) {
          setDropoffCoord([ride.destination_lat, ride.destination_lng]);
        }
        if (ride.driver_name) {
          setDriver({
            name: ride.driver_name,
            vehicle:
              [ride.vehicle_color, ride.vehicle_make, ride.vehicle_model]
                .filter(Boolean)
                .join(" ") || null,
            license_plate: ride.driver_license_plate,
            rating: ride.rating_score ?? null,
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

        socket.on("connect_error", () => {
          // Transport hiccup (e.g. websocket upgrade blocked) — socket.io keeps
          // retrying with the polling fallback, so don't flash a scary banner.
          console.warn("[Track] Socket connect_error (retrying)");
        });

        socket.emit("passenger:connect");

        socket.on("ride:requested:ack", (data) => {
          if (data.success) {
            setRideId(data.rideId ?? null);
            rideIdRef.current = data.rideId ?? null;
            paymentConfirmedRef.current = true;
            // Immediately mark the ride active in the store so the floating
            // "Go Back To Ride" banner shows even while searching.
            useAppStore.getState().setActiveRide({
              id: data.rideId || "",
              status: "searching",
            } as any);
          } else {
            setError(data.message || data.reason || "Could not request ride");
          }
        });

        socket.on("ride:no:drivers", () =>
          setError("No drivers available nearby right now.")
        );
        socket.on("ride:expired", () =>
          setError("No drivers accepted your request. Please try again.")
        );

        socket.on("ride:accepted", (data) => {
          setStatus("accepted");
          if (data.id) {
            setRideId(data.id);
            rideIdRef.current = data.id;
          }
          // A driver has been found. The card charge already happened once at
          // booking (see server "passenger:ride:request") — never charge again.
          const driverData = {
            name: data.driver_name || data.driver?.name || "Unknown Driver",
            vehicle:
              data.driver?.vehicle ||
              [data.vehicle_color, data.vehicle_make, data.vehicle_model]
                .filter(Boolean)
                .join(" ") ||
              null,
            license_plate: data.driver_license_plate || data.driver?.license_plate || null,
            rating: data.driver?.rating ?? null,
          };
          setDriver(driverData);

          // Update Zustand store
          useAppStore.getState().setActiveRide({
            id: data.id || "",
            status: "accepted",
            driver_name: driverData.name,
            driver_phone: null,
            vehicle_make: data.vehicle_make || null,
            vehicle_model: data.vehicle_model || null,
            vehicle_color: data.vehicle_color || null,
            driver_license_plate: driverData.license_plate,
            driver_lat: null,
            driver_lng: null,
            driver_heading: null,
          } as any);
        });

        socket.on("ride:driver:arrived", () => {
          setStatus("driver_arrived");
          const active = useAppStore.getState().activeRide;
          if (active) {
            useAppStore.getState().setActiveRide({ ...active, status: "driver_arrived" });
          }
        });

        socket.on("ride:started", () => {
          setStatus("in_progress");
          const active = useAppStore.getState().activeRide;
          if (active) {
            useAppStore.getState().setActiveRide({ ...active, status: "in_progress" });
          }
        });

        // ⚠️ Assumed event name/shape for live driver location updates —
        // rename to match whatever your driver app actually emits.
        socket.on("ride:driver:location", (data) => {
          if (data?.lat != null && data?.lng != null) {
            hasRealDriverLocRef.current = true;
            const bearing = data.bearing ?? data.heading ?? 0;
            setCarBearing(bearing);
            setDriverLoc({ lat: data.lat, lng: data.lng, bearing });

            // Sync location to Zustand store
            const active = useAppStore.getState().activeRide;
            if (active) {
              useAppStore.getState().setActiveRide({
                ...active,
                driver_lat: data.lat,
                driver_lng: data.lng,
                driver_heading: bearing,
              });
            }
          }
        });

        socket.on("ride:completed", (data) => {
          setStatus("completed");
          setFare(data.riderTotal ?? data.fare ?? null);
          handleCompleted(data.riderTotal ?? data.fare ?? null);

          // Clear active ride in Zustand store
          useAppStore.getState().resetRideState();
        });

        socket.on("ride:cancelled", (data) => {
          setStatus("cancelled");
          setError(data.reason || "Ride cancelled");

          // Clear active ride in Zustand store
          useAppStore.getState().resetRideState();
        });

        socket.on("ride:refunded", (data) => {
          // Rider cancelled before pickup — the card pre-auth was refunded.
          Alert.alert(
            "Payment refunded",
            data?.note || "Your card payment has been refunded.",
            [{ text: "OK" }]
          );
        });

        socket.on("ride:pickup:updated", (data) => {
          setPickupAddr(data.address);
          if (data.lat != null && data.lng != null) {
            setPickupCoord([data.lat, data.lng]);
          }
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
            if (ride.pickup_lat != null && ride.pickup_lng != null) {
              setPickupCoord([ride.pickup_lat, ride.pickup_lng]);
            }
            if (ride.destination_lat != null && ride.destination_lng != null) {
              setDropoffCoord([ride.destination_lat, ride.destination_lng]);
            }
            if (ride.driver_name) {
              setDriver({
                name: ride.driver_name,
                vehicle:
                  [ride.vehicle_color, ride.vehicle_make, ride.vehicle_model]
                    .filter(Boolean)
                    .join(" ") || null,
                license_plate: ride.driver_license_plate,
                rating: ride.rating_score ?? null,
              });
            }
          } else {
            setError("Missing pickup/destination. Please search again.");
          }
          return;
        }

        // ── Card payment: charge happens later, when the driver arrives at
        // pickup. The ride books immediately with the payment method "card",
        // and initiatePaystackPayment(fare, rideId) is called on
        // ride:driver:arrived. No charge is taken at booking time.
        const paymentMethodRef = await AsyncStorage.getItem("vura.ride.payment");
        const fareStr = await AsyncStorage.getItem("vura.ride.fare");
        const fare = parseFloat(fareStr || "0.2") || 0.2;

        const fireRequest = (paymentReference?: string) => {
          socket!.emit("passenger:ride:request", {
            pickupAddress: pa || "Pickup",
            pickupLat: pickup[0],
            pickupLng: pickup[1],
            destinationAddress: da || "Destination",
            destinationLat: dropoff[0],
            destinationLng: dropoff[1],
            waypoints: waypoints.map((w) => ({
              address: w.address,
              lat: w.lat,
              lng: w.lng,
            })),
            paymentMethod: paymentMethodRef || undefined,
            paymentReference,
            fare,
          });
        };

        if (paymentMethodRef === "card") {
          // The card is charged once, at booking, by the server. This ride only
          // proceeds (finds a driver) after the server confirms the card charge.
          // Skip re-firing the ride request if returning to a minimized ride.
          if (!useAppStore.getState().rideMinimized) fireRequest();
        } else {
          paymentConfirmedRef.current = true;
          if (!useAppStore.getState().rideMinimized) fireRequest();
        }
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
        socket.off("ride:driver:location");
        socket.off("ride:completed");
        socket.off("ride:cancelled");
        socket.off("ride:refunded");
        socket.off("ride:pickup:updated");
        socket.off("connect_error");
      }
    };
  }, [isHistory]);

  async function handleCompleted(total: number | null) {
    // Fully reset the ride + minimize state so the "Go Back To Ride" banner
    // disappears immediately when the trip completes.
    useAppStore.getState().resetRideState();
    queryClient.invalidateQueries({ queryKey: ["ride-history"] });
    const id = rideIdRef.current;
    const method = await AsyncStorage.getItem("vura.ride.payment");
    if (id) {
      try {
        if (method === "card") {
          // Card was already charged (pre-auth) at booking — nothing more to do.
        } else if (method === "affiliate") {
          const res = await payWithAffiliate(id);
          if (!res.success) {
            Alert.alert(
              "Payment",
              res.error || "Affiliate credit could not be applied."
            );
          } else {
            queryClient.invalidateQueries({ queryKey: ["affiliate-me"] });
            queryClient.invalidateQueries({ queryKey: ["affiliate-transactions"] });
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

  async function removeStop(i: number) {
    const next = waypoints.filter((_, idx) => idx !== i);
    setWaypoints(next);
    await AsyncStorage.setItem("vura.ride.waypoints", JSON.stringify(next));
  }

  /** Charge the rider's saved card when the driver arrives at pickup.
   *  Called from the ride:driver:arrived socket handler. */
  const chargeCardOnPickup = async () => {
    // Never charge twice for the same ride — the demo simulation and the real
    // socket event can both call this. The flag also persists to AsyncStorage
    // so minimizing/returning to the ride doesn't cause a double charge.
    if (chargeFiredRef.current) return;
    const pm = await AsyncStorage.getItem("vura.ride.payment");
    if (pm !== "card") return;
    const rideId = rideIdRef.current;
    if (rideId) {
      const charged = await AsyncStorage.getItem(`vura.ride.charged.${rideId}`);
      if (charged === "1") {
        chargeFiredRef.current = true;
        return;
      }
    }
    chargeFiredRef.current = true;
    const fareStr = await AsyncStorage.getItem("vura.ride.fare");
    const fare = parseFloat(fareStr || "0.2") || 0.2;
    try {
      const result = await initiatePaystackPayment(fare, rideId ?? undefined);
      if (result.mock || result.status === "success") {
        if (rideId) {
          await AsyncStorage.setItem(`vura.ride.charged.${rideId}`, "1");
        }
        Alert.alert("Payment", `R${fare.toFixed(2)} charged from your saved card.`);
        return;
      }
      if (result.status === "failed") {
        Alert.alert("Payment", result.message || "Card payment was declined.");
        return;
      }
      if (result.authorizationUrl) {
        paystackRef.current = result.reference;
        setPaystackUrl(result.authorizationUrl);
        setPaystackVisible(true);
      }
    } catch (e: any) {
      Alert.alert("Payment", e.message || "Could not process card payment.");
    }
  };

  async function doCancel(reason: string) {
    setShowCancel(false);
    try {
      const socket = await getSocket();
      if (rideIdRef.current) {
        socket.emit("passenger:ride:cancel", {
          rideId: rideIdRef.current,
          reason,
        });
      }
    } catch {
      // ignore
    }
    // Fully reset the ride + minimize state so the "Go Back To Ride" banner
    // never lingers after the rider cancels.
    useAppStore.getState().resetRideState();
    queryClient.invalidateQueries({ queryKey: ["ride-history"] });
    router.replace("/");
  }

  async function doSubmitRating() {
    const id = rideIdRef.current;
    if (!id || rating === 0) return;

    // Navigate immediately — rating/tip are best-effort and must never block
    // the user from leaving the screen (slow DB round-trips used to keep this
    // modal spinning for ages).
    const score = rating;
    const commentText = comment.trim() || undefined;
    const tip = tipAmount;
    setSubmitting(false);
    disconnectSocket();
    router.replace(`/ride/receipt?rideId=${id}`);

    if (tip != null && tip > 0) submitTip(id, tip).catch(() => {});
    submitRating(id, score, commentText).catch(() => {});
  }

  const canCancel = status === "searching" || status === "accepted";
  const canEditPickup =
    !isHistory &&
    ["searching", "accepted", "driver_arrived"].includes(status);
  const tipSuggestions = getTipSuggestions(fare && fare > 0 ? fare : 50);
  const driverInitials = driver?.name
    ? driver.name
      .split(" ")
      .map((p) => p[0])
      .join("")
      .slice(0, 2)
      .toUpperCase()
    : "";

  return (
    <View className="flex-1 bg-background">
      {/* Fullscreen Map */}
      <View className="absolute inset-0">
        {pickupCoord || dropoffCoord ? (
        <MapView
          ref={mapRef}
          style={{ flex: 1 }}
          initialRegion={
            pickupCoord
              ? {
                latitude: pickupCoord[0],
                longitude: pickupCoord[1],
                latitudeDelta: 0.02,
                longitudeDelta: 0.02,
              }
              : dropoffCoord
                ? {
                  latitude: dropoffCoord[0],
                  longitude: dropoffCoord[1],
                  latitudeDelta: 0.02,
                  longitudeDelta: 0.02,
                }
                : undefined
          }
        >
          {pickupCoord && (
            <Marker
              coordinate={{ latitude: pickupCoord[0], longitude: pickupCoord[1] }}
              pinColor="#22c55e"
              title="Pickup"
            />
          )}
          {status === "searching" && nearbyCars.map((car) => (
            <Marker
              key={car.id}
              coordinate={{ latitude: car.lat, longitude: car.lng }}
              image={CAR_LOCATOR_IMG}
              rotation={(car.angle + 90) % 360}
              title="Nearby driver"
            />
          ))}
          {waypoints.map((wp, i) => (
            <Marker
              key={`stop-${i}`}
              coordinate={{ latitude: wp.lat, longitude: wp.lng }}
              pinColor="#e04e2f"
              title={`Stop ${i + 1}`}
            />
          ))}
          {dropoffCoord && (
            <Marker
              coordinate={{ latitude: dropoffCoord[0], longitude: dropoffCoord[1] }}
              pinColor="#ef4444"
              title="Dropoff"
            />
          )}
          {driverLoc && (
            <Marker
              coordinate={{ latitude: driverLoc.lat, longitude: driverLoc.lng }}
              image={CAR_LOCATOR_IMG}
              rotation={(driverLoc.bearing + 90) % 360}
              title="Driver"
            />
          )}
          {myCarLoc && (
            <Marker
              coordinate={{ latitude: myCarLoc.lat, longitude: myCarLoc.lng }}
              image={CAR_LOCATOR_IMG}
              rotation={(myCarLoc.bearing + 90) % 360}
              title="You"
            />
          )}
          {staticRoute.length > 1 && (
            <>
              <Polyline
                coordinates={staticRoute}
                strokeColor="#000000"
                strokeWidth={7}
              />
              <Polyline
                coordinates={staticRoute}
                strokeColor="#22c55e"
                strokeWidth={4}
              />
            </>
          )}
          {denseRoute.length > 1 && (
            <Polyline
              coordinates={denseRoute}
              strokeColor="#000000"
              strokeWidth={7}
            />
          )}
          {denseRoute.length > 1 && (
            <Polyline
              coordinates={denseRoute}
              strokeColor="#22c55e"
              strokeWidth={4}
            />
          )}
        </MapView>
        ) : (
          <View className="flex-1 items-center justify-center bg-background">
            <ActivityIndicator size="small" color="#e04e2f" />
          </View>
        )}
      </View>

      {/* Floating Header Actions */}
      <TouchableOpacity
        onPress={() => {
          // Leaving via the X minimizes the ride — the floating "Go Back To
          // Ride" banner then shows on every screen until the ride ends.
          // Save the exact simulation state so returning resumes right where
          // the car was, continuing its motion (like Uber/Bolt).
          const loc = driverLocRef.current;
          useAppStore.getState().setSavedDemoRide({
            status,
            driver_name: driver?.name ?? null,
            driver_license_plate: driver?.license_plate ?? null,
            vehicle_make: driver?.vehicle?.includes("Toyota") ? "Toyota" : null,
            vehicle_model: driver?.vehicle?.includes("Corolla") ? "Corolla" : null,
            vehicle_color: driver?.vehicle?.includes("White") ? "White" : null,
            driverLoc: loc ? { lat: loc.lat, lng: loc.lng, bearing: carBearing } : null,
            route: demoRouteRef.current,
            step: demoStepRef.current,
            phase: demoPhaseRef.current,
          });
          useAppStore.getState().setRideMinimized(true);
          router.replace("/");
        }}
        className="absolute top-12 right-5 w-9 h-9 rounded-full bg-surface border border-border items-center justify-center z-10 shadow-md"
      >
        <Ionicons name="close" size={16} color="#2e1e1a" />
      </TouchableOpacity>

      <View className="absolute top-12 left-1/2 -translate-x-1/2 rounded-full bg-foreground px-4 py-1.5 z-10 shadow-md">
        <Text className="text-xs font-bold text-background text-center">
          {error ? "…" : STATUS_LABEL[status]}
        </Text>
      </View>

      {(status === "accepted" ||
        status === "driver_arrived" ||
        status === "in_progress") && (
          <View className="absolute top-24 left-1/2 -translate-x-1/2 rounded-full bg-green-100 border border-green-200 px-3 py-1 flex-row items-center gap-1 z-10 shadow-sm">
            <Ionicons name="shield-checkmark" size={12} color="#166534" />
            <Text className="text-[10px] font-bold text-green-800">
              Smart Safety Active
            </Text>
          </View>
        )}

      {/* Floating Bottom sheet (Driver details and active settings) */}
      <View className="absolute bottom-0 left-0 right-0 max-h-[46%] bg-surface rounded-t-[2.5rem] shadow-2xl px-5 pt-5 pb-8 z-10 border-t border-border">
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
            <View className="items-center py-8">
              {/* Radar pulsing simulation */}
              <View className="relative w-24 h-24 items-center justify-center bg-primary/10 rounded-full mb-6">
                <View className="absolute w-20 h-20 bg-primary/20 rounded-full animate-ping" />
                <View className="absolute w-16 h-16 bg-primary/30 rounded-full animate-pulse" />
                <Ionicons name="car-sport" size={40} color="#e04e2f" />
              </View>
              <Text className="text-lg font-bold text-foreground text-center">
                Contacting nearby drivers...
              </Text>
              <Text className="text-sm text-muted-foreground text-center mt-2 px-6">
                Requesting {tierName}. We are matching you with the closest driver.
              </Text>
              <ActivityIndicator size="small" color="#e04e2f" className="mt-5" />
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
            <View className="mt-4 flex-row flex-wrap gap-2">
              <TouchableOpacity
                className="flex-1 items-center gap-1 rounded-full bg-secondary py-3 min-w-[70px]"
                onPress={() => setShowCallModal(true)}
              >
                <Ionicons name="call" size={16} color="#e04e2f" />
                <Text className="text-xs font-semibold text-foreground">
                  Call
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                className="flex-1 items-center gap-1 rounded-full bg-secondary py-3 min-w-[70px]"
                onPress={() => {
                  if (rideId) {
                    router.push(`/ride/chat?rideId=${rideId}&driverName=${encodeURIComponent(driver?.name || "")}&driverVehicle=${encodeURIComponent(driver?.vehicle || "")}&driverPlate=${encodeURIComponent(driver?.license_plate || "")}`);
                  }
                }}
              >
                <Ionicons name="chatbubble" size={16} color="#e04e2f" />
                <Text className="text-xs font-semibold text-foreground">
                  Chat
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                className="flex-1 items-center gap-1 rounded-full bg-secondary py-3 min-w-[70px]"
                onPress={() => {
                  const id = rideIdRef.current;
                  if (!id) return;
                  setShowEtaShareModal(true);
                }}
              >
                <Ionicons name="share" size={16} color="#e04e2f" />
                <Text className="text-xs font-semibold text-foreground">
                  Share
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                className="flex-1 items-center gap-1 rounded-xl bg-red-50 border border-red-200 py-3 min-w-[70px]"
                onPress={() => Alert.alert("SOS", "Dispatching emergency services.")}
              >
                <Ionicons name="warning" size={16} color="#dc2626" />
                <Text className="text-xs font-bold text-red-700">SOS</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Trip details */}
          <View className="mt-4 rounded-xl border border-border p-3.5">
            <Text className="text-[11px] uppercase font-bold text-muted-foreground">
              Trip{waypoints.length > 0 ? ` (${waypoints.length + 1} stops)` : ""}
            </Text>
            <View className="mt-2 flex-row items-start gap-3">
              <View className="items-center pt-1.5">
                <View className="w-2.5 h-2.5 rounded-full bg-foreground" />
                <View className="w-px h-6 border-l-2 border-dashed border-muted-foreground/40" />
                {waypoints.map((_, i) => (
                  <View key={i} className="items-center">
                    <View className="w-2.5 h-2.5 rounded-full bg-amber-500" />
                    <View className="w-px h-6 border-l-2 border-dashed border-muted-foreground/40" />
                  </View>
                ))}
                <View className="w-2.5 h-2.5 rounded-md bg-primary" />
              </View>
              <View className="flex-1 gap-y-3">
                <TouchableOpacity
                  onPress={() => {
                    if (!canEditPickup) return;
                    router.push({
                      pathname: "/ride/map-picker",
                      params: {
                        type: "pickup",
                        update: "1",
                        rideId: rideIdRef.current || "",
                      },
                    });
                  }}
                  className="flex-row items-center gap-1.5"
                >
                  <Text
                    className={`font-medium text-sm ${
                      canEditPickup ? "text-emerald-700" : "text-foreground"
                    }`}
                    numberOfLines={1}
                  >
                    {pickupAddr}
                  </Text>
                  {canEditPickup && (
                    <Ionicons name="pencil" size={12} color="#16a34a" />
                  )}
                </TouchableOpacity>
                {waypoints.map((wp, i) => (
                  <View key={i} className="flex-row items-center gap-1.5">
                    <Text
                      className="font-medium text-primary text-sm flex-1"
                      numberOfLines={1}
                    >
                      {wp.address} (Stop {i + 1})
                    </Text>
                    {canEditPickup && (
                      <TouchableOpacity
                        onPress={() => removeStop(i)}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      >
                        <Ionicons name="close-circle" size={16} color="#dc2626" />
                      </TouchableOpacity>
                    )}
                  </View>
                ))}
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

          {canEditPickup && (
              <View className="mt-4 flex-row gap-2">
                <TouchableOpacity
                  onPress={() =>
                    router.push({
                      pathname: "/ride/map-picker",
                      params: {
                        type: "pickup",
                        update: "1",
                        rideId: rideIdRef.current || "",
                      },
                    })
                  }
                  className="flex-1 flex-row items-center justify-center gap-2 rounded-xl border border-border bg-surface py-3.5"
                >
                  <Ionicons name="location" size={16} color="#2e1e1a" />
                  <Text className="text-xs font-bold text-foreground">
                    Update pickup
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() =>
                    router.push({
                      pathname: "/ride/map-picker",
                      params: {
                        type: "stop",
                        update: "1",
                        rideId: rideIdRef.current || "",
                      },
                    })
                  }
                  className="flex-1 flex-row items-center justify-center gap-2 rounded-xl border border-border bg-surface py-3.5"
                >
                  <Ionicons name="add" size={16} color="#2e1e1a" />
                  <Text className="text-xs font-bold text-foreground">
                    Add a stop
                  </Text>
                </TouchableOpacity>
              </View>
            )}

          {!isHistory && canCancel && (
            <TouchableOpacity
              onPress={() => setShowCancel(true)}
              className="mt-6 rounded-xl py-3.5 items-center w-full bg-secondary"
            >
              <Text className="text-sm font-bold text-foreground">
                Cancel trip
              </Text>
            </TouchableOpacity>
          )}

          {(status === "completed" || status === "cancelled") && rideIdRef.current && (
            <TouchableOpacity
              onPress={() => router.push(`/ride/receipt?rideId=${rideIdRef.current}`)}
              className="mt-3 w-full flex-row items-center justify-center gap-2 rounded-xl border border-border bg-surface py-3.5"
            >
              <Ionicons name="receipt" size={16} color="#e04e2f" />
              <Text className="text-sm font-bold text-foreground">
                View Receipt
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
            <Text className="text-xs text-muted-foreground text-center mt-2 leading-relaxed">
              If your payment was taken for this ride, it will be refunded to the same
              account you paid with.
            </Text>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* VoIP Call Modal */}
      <Modal
        visible={showCallModal}
        animationType="slide"
        transparent
        onRequestClose={() => setShowCallModal(false)}
      >
        <TouchableOpacity
          className="flex-1 bg-black/50 justify-end"
          activeOpacity={1}
          onPress={() => setShowCallModal(false)}
        >
          <TouchableOpacity activeOpacity={1} className="bg-surface rounded-t-[2rem] p-5">
            <View className="flex-row justify-between items-center mb-4">
              <Text className="text-lg font-bold text-foreground">
                Call {driver?.name || "Driver"}
              </Text>
              <TouchableOpacity
                onPress={() => setShowCallModal(false)}
                className="w-8 h-8 rounded-full bg-secondary items-center justify-center"
              >
                <Ionicons name="close" size={16} color="#2e1e1a" />
              </TouchableOpacity>
            </View>
            <Text className="text-xs text-muted-foreground mb-4">
              Your real phone number is masked. The driver will see a temporary number.
            </Text>
            <View className="flex-row gap-3">
              <TouchableOpacity
                onPress={() => {
                  setShowCallModal(false);
                  Alert.alert("Starting call", "Connecting via VoIP...");
                }}
                className="flex-1 items-center gap-2 rounded-xl bg-primary py-4"
              >
                <Ionicons name="call" size={20} color="#fff" />
                <Text className="text-sm font-bold text-primary-foreground">
                  Call via App
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => {
                  setShowCallModal(false);
                  Alert.alert(
                    "Driver Contact",
                    "For emergency calls, the driver's masked number will be used."
                  );
                }}
                className="flex-1 items-center gap-2 rounded-xl bg-secondary border border-border py-4"
              >
                <Ionicons name="shield" size={20} color="#2e1e1a" />
                <Text className="text-sm font-bold text-foreground">
                  Masked Call
                </Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* ETA Share Modal */}
      <Modal
        visible={showEtaShareModal}
        animationType="slide"
        transparent
        onRequestClose={() => setShowEtaShareModal(false)}
      >
        <TouchableOpacity
          className="flex-1 bg-black/50 justify-end"
          activeOpacity={1}
          onPress={() => setShowEtaShareModal(false)}
        >
          <TouchableOpacity activeOpacity={1} className="bg-surface rounded-t-[2rem] p-5">
            <View className="flex-row justify-between items-center mb-4">
              <Text className="text-lg font-bold text-foreground">
                Share Trip Status
              </Text>
              <TouchableOpacity
                onPress={() => setShowEtaShareModal(false)}
                className="w-8 h-8 rounded-full bg-secondary items-center justify-center"
              >
                <Ionicons name="close" size={16} color="#2e1e1a" />
              </TouchableOpacity>
            </View>

            {!shareUrl ? (
              <>
                <Text className="text-xs text-muted-foreground mb-4">
                  Share your live location and ETA with trusted contacts so they
                  can follow your trip in real time.
                </Text>
                <TouchableOpacity
                  onPress={async () => {
                    const id = rideIdRef.current;
                    if (!id) return;
                    setSharingEta(true);
                    try {
                      const result = await shareTrip(id);
                      setShareUrl(result.shareUrl);
                      useAppStore.getState().setTripSharing(true, result.shareToken);
                      await Share.share({
                        message: `I'm on a Vura ride! Track my trip live: ${result.shareUrl}`,
                      });
                    } catch (err: any) {
                      Alert.alert("Error", err.message || "Could not share trip");
                    } finally {
                      setSharingEta(false);
                    }
                  }}
                  disabled={sharingEta}
                  className="w-full rounded-xl bg-primary py-4 items-center mb-3"
                >
                  {sharingEta ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text className="text-sm font-bold text-primary-foreground">
                      Generate Share Link
                    </Text>
                  )}
                </TouchableOpacity>
              </>
            ) : (
              <>
                <View className="rounded-xl bg-emerald-50 border border-emerald-200 p-4 mb-4">
                  <View className="flex-row items-center gap-2 mb-1">
                    <Ionicons name="checkmark-circle" size={18} color="#16a34a" />
                    <Text className="text-sm font-bold text-emerald-700">
                      Sharing Active
                    </Text>
                  </View>
                  <Text className="text-xs text-emerald-600">
                    Your trusted contacts can now follow your trip live.
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={async () => {
                    await Share.share({ message: `Track my Vura ride: ${shareUrl}` });
                  }}
                  className="w-full rounded-xl bg-secondary py-4 items-center mb-3"
                >
                  <Text className="text-sm font-bold text-foreground">
                    Share Link Again
                  </Text>
                </TouchableOpacity>
              </>
            )}
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

            <View className="mb-6">
              <Text className="text-sm font-bold text-foreground mb-1">
                Add a tip (optional)
              </Text>
              <Text className="text-xs text-muted-foreground mb-3">
                Thank your driver — this goes directly to them.
              </Text>
              <View className="flex-row flex-wrap gap-2">
                {tipSuggestions.map((opt) => {
                  const selected = tipAmount === opt.amount;
                  return (
                    <TouchableOpacity
                      key={`${opt.label}-${opt.amount}`}
                      onPress={() => setTipAmount(selected ? null : opt.amount)}
                      className={`flex-1 items-center rounded-xl border py-2.5 min-w-[70px] ${
                        selected
                          ? "bg-emerald-50 border-emerald-500"
                          : "bg-secondary border-border"
                      }`}
                    >
                      <Text
                        className={`text-[10px] font-bold ${
                          selected ? "text-emerald-700" : "text-muted-foreground"
                        }`}
                      >
                        {opt.label}
                      </Text>
                      <Text
                        className={`text-sm font-extrabold ${
                          selected ? "text-emerald-700" : "text-foreground"
                        }`}
                      >
                        {formatCurrency(opt.amount)}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <View className="flex-row gap-2 mt-3">
                <View className="flex-1 rounded-xl bg-secondary px-5 py-0">
                  <Text className="text-base font-bold text-foreground self-center py-2.5">
                    R
                  </Text>
                </View>
                <TextInput
                  placeholder="Custom amount"
                  placeholderTextColor="#80716b"
                  value={customTip}
                  onChangeText={(t) => {
                    setCustomTip(t);
                    const amt = parseFloat(t);
                    setTipAmount(amt > 0 ? amt : null);
                  }}
                  keyboardType="numeric"
                  className="flex-1 rounded-xl border border-border bg-secondary px-4 py-2.5 text-sm font-semibold text-foreground"
                />
              </View>
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

      {/* Paystack hosted checkout — only when the rider has no saved card */}
      <PaymentWebView
        visible={paystackVisible}
        authorizationUrl={paystackUrl}
        savedCard={false}
        reference={paystackRef.current ?? undefined}
        onClose={() => {
          setPaystackVisible(false);
        }}
        onDone={({ success }) => {
          setPaystackVisible(false);
          if (!success) {
            Alert.alert("Payment", "Card payment was declined. No charge was made.");
          }
        }}
      />
    </View>
  );
}