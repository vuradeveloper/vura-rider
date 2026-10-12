import { Asset } from "expo-asset";
import { File } from "expo-file-system";
import {
  Children,
  forwardRef,
  isValidElement,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState
} from "react";
import { Text, View } from "react-native";
import { WebView } from "react-native-webview";
import { getMapHtml } from "@/lib/mapHtml";
import { MIN_WEBVIEW_CHROME_MAJOR } from "@/lib/webviewCompat";

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

type MapViewProps = {
  children?: React.ReactNode;
  style?: any;
  initialRegion?: Region;
  onRegionChange?: (region: Region) => void;
  onRegionChangeComplete?: (region: Region) => void;
};


async function resolveImageUri(image: any): Promise<string> {
  if (typeof image === "string") return image;
  if (image && typeof image === "object" && image.uri) return image.uri;
  if (typeof image === "number") {
    try {
      const asset = Asset.fromModule(image);
      await asset.downloadAsync();
      const uri = asset.localUri || asset.uri;
      if (uri) {
        const file = new File(uri);
        const b64 = await file.base64();
        const ext = (file.extension || "png").toLowerCase().replace(".", "");
        const mime =
          ext === "jpg" || ext === "jpeg" ? "image/jpeg" : "image/png";
        return `data:${mime};base64,${b64}`;
      }
    } catch (e) {
      // fall through to empty string
    }
  }
  return "";
}

const MapView = forwardRef<MapViewHandle, MapViewProps>(
  ({ children, style, initialRegion, onRegionChange, onRegionChangeComplete }, ref) => {
    const webRef = useRef<WebView>(null);
    const readyRef = useRef(false);
    const pendingRef = useRef<Map<number, (value: any) => void>>(new Map());
    const reqCounterRef = useRef(0);
    const markersRef = useRef<any[]>([]);
    const initialKeyRef = useRef<string>("");
    const [html, setHtml] = useState<string | null>(null);
    // Old-WebView notice (RC4 Huawei fix): set when the map page's first-script
    // guard detects a Chrome major below the floor — overlays native guidance
    // instead of leaving a broken map. See lib/webviewCompat.ts.
    const [oldWebView, setOldWebView] = useState<string | null>(null);

    // Leaflet is bundled inside the APK and inlined here — no unpkg CDN
    // dependency at runtime, so maps start instantly offline.
    useEffect(() => {
      setHtml(getMapHtml());
    }, []);

    // Convert children <Marker>/<Polyline> into plain JSON for the page.
    const { markers, polylines } = useMemo(() => {
      const m: any[] = [];
      const p: any[] = [];
      Children.forEach(children, (child) => {
        if (!isValidElement(child)) return;
        const cp = child.props as any;
        if (cp && cp.coordinate) {
          const img = cp.image;
          const t = cp.title || "";
          const icon = img
            ? "car"
            : cp.pinColor === "#22c55e"
              ? "pickup"
              : cp.pinColor === "#ef4444"
                ? "dropoff"
                : cp.pinColor === "#1a1a1a"
                  ? "entrance"
                  : cp.pinColor === "#059669"
                    ? "entrance-sel"
                    : t.toLowerCase() === "your location"
                      ? "you"
                      : t.toLowerCase() === "nearby driver"
                        ? "car"
                        : "";
          m.push({
            lat: cp.coordinate.latitude,
            lng: cp.coordinate.longitude,
            title: t,
            icon,
            angle: cp.rotation || 0,
            img: img || "",
            onPress: cp.onPress || null,
          });
        } else if (cp && cp.coordinates) {
          p.push({
            coords: cp.coordinates.map((c: any) => [c.latitude, c.longitude]),
            color: cp.strokeColor || "#3b82f6",
            weight: cp.strokeWidth || 4,
          });
        }
      });
      return { markers: m, polylines: p };
    }, [children]);

    // Send data to the page whenever markers/polylines change. Marker images
    // are resolved ONCE per unique asset and sent as a separate `images` map —
    // embedding the full base64 on every marker could overflow Android's
    // injectJavaScript limit (which is why CarLocator.png never showed).
    useEffect(() => {
      if (!readyRef.current) return;
      let cancelled = false;
      (async () => {
        const uniqueImgs = Array.from(
          new Set(markers.map((mk) => mk.img).filter(Boolean))
        ) as any[];
        // Resolve each unique image ONCE and reference it by a short id, so the
        // injected payload stays small (a full base64 data URL repeated per
        // marker would overflow Android's injectJavaScript limit and the icon
        // would silently fall back to the plain SVG).
        const images: Record<string, string> = {};
        const imgToId: Record<string, string> = {};
        let counter = 0;
        for (const img of uniqueImgs) {
          const id = "img" + counter++;
          imgToId[String(img)] = id;
          try {
            images[id] = await resolveImageUri(img);
          } catch {
            images[id] = "";
          }
        }
        if (cancelled) return;
        const resolved = markers.map((mk) => ({
          lat: mk.lat,
          lng: mk.lng,
          title: mk.title,
          icon: mk.icon,
          angle: mk.angle || 0,
          onPress: mk.onPress || null,
          imgKey: mk.img ? imgToId[String(mk.img)] || "" : "",
        }));
        markersRef.current = resolved;
        webRef.current?.injectJavaScript(
          `window.__vuraMap.setData(${JSON.stringify({ markers: resolved, polylines, images })}); true;`
        );
      })();
      return () => {
        cancelled = true;
      };
    }, [markers, polylines]);

    // Bootstrap the map once the page is mounted.
    const initialKey = initialRegion
      ? `${initialRegion.latitude},${initialRegion.longitude}`
      : "";

    // Recenter when the initial region center changes after mount (e.g. when
    // coordinates finish loading asynchronously) â€” same behavior as the web
    // version's setView effect.
    useEffect(() => {
      if (!readyRef.current || !initialRegion) return;
      if (initialKeyRef.current === initialKey) return;
      initialKeyRef.current = initialKey;
      webRef.current?.injectJavaScript(
        `window.__vuraMap.animateToRegion(${JSON.stringify(initialRegion)}, 400); true;`
      );
    }, [initialKey, initialRegion]);

    const onMessage = useCallback(
      (e: any) => {
        let data: any;
        try {
          data = JSON.parse(e.nativeEvent.data);
        } catch {
          return;
        }
        switch (data.type) {
          case "log":
            // Diagnostics from the map page (leaflet load failures, JS errors)
            console.log("[MapWebView]", data.message);
            break;
          case "webview-too-old":
            // The page guard detected an engine below the Chrome/70 floor —
            // show the native update notice (the page paints its own copy too).
            setOldWebView(String(data.version || "unknown"));
            break;
          case "mounted":
            if (initialRegion) {
              initialKeyRef.current = initialKey;
              webRef.current?.injectJavaScript(
                `window.__vuraMap.init(${JSON.stringify(initialRegion)}); true;`
              );
            }
            break;
          case "ready":
            readyRef.current = true;
            break;
          case "regionChange":
            onRegionChange?.(data);
            break;
          case "regionChangeComplete":
            onRegionChangeComplete?.(data);
            break;
          case "markerPress":
            markersRef.current[data.index]?.onPress?.();
            break;
          case "getCamera":
            pendingRef.current.get(data.requestId)?.(data.camera);
            pendingRef.current.delete(data.requestId);
            break;
          case "coordinateForPoint":
            pendingRef.current.get(data.requestId)?.(data.coordinate);
            pendingRef.current.delete(data.requestId);
            break;
        }
      },
      [initialRegion, onRegionChange, onRegionChangeComplete]
    );

    useImperativeHandle(ref, () => ({
      animateToRegion(region: Region, duration = 300) {
        webRef.current?.injectJavaScript(
          `window.__vuraMap.animateToRegion(${JSON.stringify(region)}, ${duration}); true;`
        );
      },
      followCar(lat: number, lng: number, bearing = 0, zoom = 17) {
        webRef.current?.injectJavaScript(
          `window.__vuraMap.followCar(${lat}, ${lng}, ${bearing}, ${zoom}); true;`
        );
      },
      unfollow() {
        webRef.current?.injectJavaScript(`window.__vuraMap.unfollow(); true;`);
      },
      getCamera(): Promise<Camera> {
        return new Promise((resolve) => {
          const id = ++reqCounterRef.current;
          pendingRef.current.set(id, resolve);
          webRef.current?.injectJavaScript(
            `window.__vuraMap.getCamera(${id}); true;`
          );
        });
      },
      setCamera(camera: Partial<Camera>) {
        webRef.current?.injectJavaScript(
          `window.__vuraMap.setCamera(${JSON.stringify(camera)}); true;`
        );
      },
      coordinateForPoint(point: { x: number; y: number }) {
        return new Promise((resolve) => {
          const id = ++reqCounterRef.current;
          pendingRef.current.set(id, resolve);
          webRef.current?.injectJavaScript(
            `window.__vuraMap.coordinateForPoint(${id}, ${point.x}, ${point.y}); true;`
          );
        });
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
            onMessage={onMessage}
            style={{ flex: 1 }}
            setSupportMultipleWindows={false}
            overScrollMode="never"
          />
        ) : (
          <View style={{ flex: 1, backgroundColor: "#f8f9fa" }} />
        )}
        {oldWebView ? (
          <View
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: "#ffffff",
              alignItems: "center",
              justifyContent: "center",
              padding: 32,
              zIndex: 10,
            }}
          >
            <Text
              style={{
                fontSize: 20,
                fontWeight: "700",
                color: "#1a1a1a",
                textAlign: "center",
                marginBottom: 12,
              }}
            >
              Please update Android System WebView
            </Text>
            <Text style={{ fontSize: 14, color: "#4a4a4a", textAlign: "center", lineHeight: 20 }}>
              {`The map needs Android System WebView (or Chrome) version ${MIN_WEBVIEW_CHROME_MAJOR} or newer. This device reports version ${oldWebView}. Update it from the Play Store, Huawei AppGallery or a system update, then reopen Vura.`}
            </Text>
          </View>
        ) : null}
      </View>
    );
  }
);

MapView.displayName = "MapView";

export default MapView;
