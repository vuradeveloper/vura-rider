import { forwardRef, useImperativeHandle, useRef } from "react";
import RNMapView, { Marker as RNMarker, PROVIDER_GOOGLE } from "react-native-maps";
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
    const mapRef = useRef<RNMapView>(null);

    useImperativeHandle(ref, () => ({
      followCar(lat: number, lng: number, bearing: number, zoom: number) {
        mapRef.current?.animateCamera({
          center: { latitude: lat, longitude: lng },
          heading: bearing,
          zoom,
        });
      },
      follow() {},
      unfollow() {},
    }));

    return (
      <RNMapView
        ref={mapRef}
        style={style}
        initialRegion={initialRegion}
        provider={PROVIDER_GOOGLE}
      >
        {children}
      </RNMapView>
    );
  }
);

MapView.displayName = "MapView";

export { MapView as default, RNMarker as Marker };
