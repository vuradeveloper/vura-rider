import { View } from "react-native";
import { inferCarBodyType, normalizeCarColor, type CarBodyType } from "@/lib/carIcon";

/**
 * Native top-view car icon rendered with plain <View>s (no SVG, no image).
 *
 * The WebView map uses the SVG data URL from lib/carIcon for markers; React
 * Native's <Image> cannot render SVG on Android, so this component draws the
 * exact same geometry — body, windshield, wheels, headlights — using native
 * views so it can live inside a round avatar / any RN layout.
 */
const CAR_BODY: Record<CarBodyType, { body: [number, number, number, number]; glass: [number, number, number, number] }> = {
  sedan: { body: [14, 12, 36, 42], glass: [16, 16, 32, 10] },
  suv: { body: [12, 8, 40, 50], glass: [14, 12, 36, 10] },
  hatchback: { body: [14, 14, 36, 36], glass: [16, 18, 32, 9] },
  van: { body: [10, 6, 44, 54], glass: [12, 10, 40, 8] },
};

const CAR_WHEELS: [number, number, number, number][] = [
  [9, 9, 8, 6],
  [47, 9, 8, 6],
  [9, 49, 8, 6],
  [47, 49, 8, 6],
];

export function CarIcon({
  make,
  model,
  color,
  size = 40,
}: {
  make?: string | null;
  model?: string | null;
  color?: string | null;
  size?: number;
}) {
  const bodyType = inferCarBodyType(make, model);
  const paint = normalizeCarColor(color);
  const s = size / 64; // scale factor from the 64×64 canonical box
  const { body, glass } = CAR_BODY[bodyType];

  const box = (x: number, y: number, w: number, h: number, rx = 2) => ({
    position: "absolute" as const,
    left: x * s,
    top: y * s,
    width: w * s,
    height: h * s,
    borderRadius: rx * s,
  });

  return (
    <View
      style={{
        width: size,
        height: size,
        position: "relative",
      }}
      pointerEvents="none"
      testID="car-icon"
    >
      {/* Wheels (under the body) */}
      {CAR_WHEELS.map(([wx, wy, ww, wh], i) => (
        <View key={`w${i}`} style={{ ...box(wx, wy, ww, wh, 2), backgroundColor: "#1a1a1f" }} />
      ))}
      {/* Body outline (subtle rim so light colours read on any background) */}
      <View
        style={{
          ...box(body[0], body[1], body[2], body[3], 6),
          borderWidth: 1.6 * (size / 64),
          borderColor: "rgba(0,0,0,0.55)",
          backgroundColor: "transparent",
        }}
      />
      {/* Body */}
      <View
        style={{
          ...box(body[0], body[1], body[2], body[3], 6),
          backgroundColor: paint,
        }}
      />
      {/* Windshield */}
      <View
        style={{
          ...box(glass[0], glass[1], glass[2], glass[3], 3),
          backgroundColor: "rgba(10,16,32,0.85)",
        }}
      />
      {/* Headlights */}
      <View
        style={{
          ...box(body[0] + 3, body[1] + 2, body[2] - 6, 3, 1),
          backgroundColor: "#fff8d8",
          opacity: 0.92,
        }}
      />
    </View>
  );
}

export default CarIcon;