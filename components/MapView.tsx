import { forwardRef, useImperativeHandle, useRef } from "react";
import { Dimensions, Platform } from "react-native";
import type { Camera, Region } from "react-native-maps";
import RNMapView, {
  PROVIDER_GOOGLE,
  Marker as RNMarker,
  Polyline as RNPolyline,
} from "react-native-maps";

type MapViewProps = {
  children?: React.ReactNode;
  style?: any;
  initialRegion?: Region;
};

export type MapViewHandle = {
  animateToRegion: (region: Region, duration?: number) => void;
  followCar: (lat: number, lng: number, bearing?: number, zoom?: number) => void;
  unfollow: () => void;
  getCamera: () => Promise<Camera>;
  setCamera: (camera: Partial<Camera>) => void;
  coordinateForPoint: (
    point: { x: number; y: number }
  ) => Promise<{ latitude: number; longitude: number }>;
};

// Standard web-mercator meters-per-pixel formula (256px tiles), same math
// the Leaflet version relies on implicitly — keeps the "look ahead" distance
// consistent in real-world meters regardless of zoom level.
function metersPerPixel(lat: number, zoom: number) {
  return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, zoom);
}

// Great-circle destination point given a start coord, bearing, and distance.
function destinationPoint(
  lat: number,
  lng: number,
  bearingDeg: number,
  distanceMeters: number
) {
  const R = 6371000;
  const brng = (bearingDeg * Math.PI) / 180;
  const lat1 = (lat * Math.PI) / 180;
  const lng1 = (lng * Math.PI) / 180;
  const dR = distanceMeters / R;

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(dR) + Math.cos(lat1) * Math.sin(dR) * Math.cos(brng)
  );
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(brng) * Math.sin(dR) * Math.cos(lat1),
      Math.cos(dR) - Math.sin(lat1) * Math.sin(lat2)
    );

  return { latitude: (lat2 * 180) / Math.PI, longitude: (lng2 * 180) / Math.PI };
}

const MapView = forwardRef<MapViewHandle, MapViewProps & Record<string, any>>(
  ({ children, style, initialRegion, ...props }, ref) => {
    const mapRef = useRef<RNMapView>(null);
    const containerHeightRef = useRef<number>(Dimensions.get("window").height);
    const smoothBearingRef = useRef(0);

    useImperativeHandle(ref, () => ({
      animateToRegion(region: Region, duration = 300) {
        mapRef.current?.animateToRegion(region, duration);
      },

      followCar(lat: number, lng: number, bearing = 0, zoom = 17) {
        // Same framing as the web/Leaflet version: the car sits lower on
        // screen (~71% down) so more road ahead is visible, and the whole
        // map rotates so the direction of travel points "up" — turn-by-turn
        // nav style. Unlike the Leaflet/CSS-rotation trick, react-native-maps
        // rotates the camera itself via `heading`, and that rotation pivots
        // around the screen's true center — so we shift the *geographic*
        // center ahead of the car (in the direction of travel) by the same
        // fractional distance, which leaves the car sitting below center.
        let diff = bearing - smoothBearingRef.current;
        if (diff > 180) diff -= 360;
        if (diff < -180) diff += 360;
        smoothBearingRef.current += diff;

        const offsetFraction = 0.7111 - 0.5; // 0.2111, matches the web version's constant
        const mpp = metersPerPixel(lat, zoom);
        const offsetMeters = containerHeightRef.current * offsetFraction * mpp;
        const center = destinationPoint(lat, lng, bearing, offsetMeters);

        mapRef.current?.animateCamera(
          { center, heading: bearing, zoom },
          { duration: 300 }
        );
      },

      unfollow() {
        smoothBearingRef.current = 0;
        mapRef.current?.animateCamera({ heading: 0 }, { duration: 300 });
      },

      getCamera() {
        return mapRef.current?.getCamera() ?? Promise.reject(new Error("Map not ready"));
      },

      setCamera(camera: Partial<Camera>) {
        mapRef.current?.setCamera(camera as Camera);
      },

      coordinateForPoint(point: { x: number; y: number }) {
        return (
          mapRef.current?.coordinateForPoint(point) ??
          Promise.reject(new Error("Map not ready"))
        );
      },
    }));

    return (
      <RNMapView
        ref={mapRef}
        style={style}
        initialRegion={initialRegion}
        // Force Google Maps on Android (this is actually the default there
        // anyway). On iOS, leaving this undefined uses Apple's native
        // MapKit for free — forcing PROVIDER_GOOGLE on iOS additionally
        // requires linking Google's iOS Maps SDK natively, which is extra
        // setup you likely don't want unless you specifically need Google
        // tiles/styling on iOS too.
        provider={Platform.OS === "android" ? PROVIDER_GOOGLE : undefined}
        onLayout={(e) => {
          containerHeightRef.current = e.nativeEvent.layout.height;
        }}
        {...props}
      >
        {children}
      </RNMapView>
    );
  }
);

MapView.displayName = "MapView";

export { MapView as default, RNMarker as Marker, RNPolyline as Polyline };
