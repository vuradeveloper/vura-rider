import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { View } from "react-native";
import { WebView } from "react-native-webview";
import { getMapHtml } from "@/lib/mapHtml";

export function Marker(_props: any) {
  return null;
}

export function Polyline(_props: any) {
  return null;
}

export const PROVIDER_GOOGLE = "google"; // kept for API parity only

type Region = {
  latitude: number;
  longitude: number;
  latitudeDelta?: number;
  longitudeDelta?: number;
};

type Camera = {
  center?: { latitude: number; longitude: number };
  zoom?: number;
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

const MapView = forwardRef<MapViewHandle, any>(({ style, initialRegion }, ref) => {
  const webRef = useRef<WebView>(null);
  const [html, setHtml] = useState<string | null>(null);

  // Leaflet is bundled locally and inlined into the page — no unpkg CDN
  // dependency at runtime.
  useEffect(() => {
    setHtml(getMapHtml());
  }, []);

  useImperativeHandle(ref, () => ({
    animateToRegion(region: Region, _duration = 300) {
      webRef.current?.injectJavaScript(
        `window.__vuraMap.init(${JSON.stringify(region)}); true;`
      );
    },
    followCar(_lat: number, _lng: number, _bearing = 0, _zoom = 17) {},
    unfollow() {},
    getCamera(): Promise<Camera> {
      return Promise.resolve({});
    },
    setCamera(_camera: Partial<Camera>) {},
    coordinateForPoint(_point: { x: number; y: number }) {
      return Promise.resolve({ latitude: 0, longitude: 0 });
    },
  }));

  return (
    <View style={[{ flex: 1 }, style]}>
      {html ? (
        <WebView
          ref={webRef}
          originWhitelist={["*"]}
          source={{ html }}
          javaScriptEnabled
          domStorageEnabled
          onMessage={(e: any) => {
            try {
              const data = JSON.parse(e.nativeEvent.data);
              if (data.type === "mounted" && initialRegion) {
                webRef.current?.injectJavaScript(
                  `window.__vuraMap.init(${JSON.stringify(initialRegion)}); true;`
                );
              }
            } catch {}
          }}
          style={{ flex: 1 }}
          overScrollMode="never"
        />
      ) : (
        <View style={{ flex: 1, backgroundColor: "#f8f9fa" }} />
      )}
    </View>
  );
});

MapView.displayName = "MapView";

export default MapView;
