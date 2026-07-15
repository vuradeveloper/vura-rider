import { forwardRef, useImperativeHandle, useRef } from "react";
import { View, Text } from "react-native";
import type { Region } from "react-native-maps";

type MapViewProps = {
  children?: React.ReactNode;
  style?: any;
  initialRegion?: Region;
};

export type MapViewHandle = {
  followCar: (lat: number, lng: number, bearing: number, zoom: number) => void;
  follow: () => void;
  unfollow: () => void;
};

const MapView = forwardRef<MapViewHandle, MapViewProps>(
  ({ children, style, initialRegion }, ref) => {
    useImperativeHandle(ref, () => ({
      followCar() {},
      follow() {},
      unfollow() {},
    }));

    return (
      <View style={[{ flex: 1, backgroundColor: "#e8e4e0", alignItems: "center", justifyContent: "center" }, style]}>
        <Text style={{ color: "#80716b", fontSize: 14 }}>Map not available on web</Text>
      </View>
    );
  }
);

MapView.displayName = "MapView";

type MarkerProps = {
  coordinate: { latitude: number; longitude: number };
  pinColor?: string;
  title?: string;
  image?: any;
  rotation?: number;
};

const Marker = (_props: MarkerProps) => null;

export { MapView as default, Marker };
