import { lazy, Suspense, useEffect, useState } from "react";

// Dynamically import Leaflet components so it doesn't crash SSR
const AnimatedMapDynamic = lazy(() => import("./AnimatedMapInner"));

export function AnimatedMap({ mode = "idle", height = 320, onComplete, onEnRoute }: { mode?: "idle" | "track", height?: number, onComplete?: () => void, onEnRoute?: () => void }) {
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  if (!isMounted) {
    return <div style={{ height, background: "#f8f9fa", width: "100%" }} />;
  }

  return (
    <Suspense fallback={<div style={{ height, background: "#f8f9fa", width: "100%" }} />}>
      <AnimatedMapDynamic mode={mode} height={height} onComplete={onComplete} onEnRoute={onEnRoute} />
    </Suspense>
  );
}
