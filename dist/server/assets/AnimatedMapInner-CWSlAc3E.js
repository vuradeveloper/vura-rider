import { useEffect, useRef, useState } from "react";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import * as h3 from "h3-js";
//#region src/components/AnimatedMapInner.tsx
var carIconFixed = L.divIcon({
	html: `<img class="vura-car-img" src="/CarLocator.png" style="width: 100%; height: 100%; transition: transform 0.3s linear; transform-origin: center center;" />`,
	className: "car-marker-container border-0 bg-transparent",
	iconSize: [48, 48],
	iconAnchor: [24, 24]
});
var userIcon = L.divIcon({
	html: `<div class="relative grid place-items-center"><div class="h-4 w-4 bg-primary rounded-full z-10 border-2 border-white shadow-md"></div><div class="h-10 w-10 bg-primary/20 rounded-full absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 animate-[pulse_2s_infinite]"></div></div>`,
	className: "bg-transparent border-0",
	iconSize: [40, 40],
	iconAnchor: [20, 20]
});
function getBearing(startLat, startLng, destLat, destLng) {
	const startLatRad = startLat * Math.PI / 180;
	const startLngRad = startLng * Math.PI / 180;
	const destLatRad = destLat * Math.PI / 180;
	const destLngRad = destLng * Math.PI / 180;
	const y = Math.sin(destLngRad - startLngRad) * Math.cos(destLatRad);
	const x = Math.cos(startLatRad) * Math.sin(destLatRad) - Math.sin(startLatRad) * Math.cos(destLatRad) * Math.cos(destLngRad - startLngRad);
	return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}
function MapController({ center }) {
	const map = useMap();
	useEffect(() => {
		map.setView(center, map.getZoom(), { animate: false });
	}, [center, map]);
	return null;
}
function densifyRoute(route, segmentLengthMeters = 30) {
	if (route.length < 2) return route;
	const rad = Math.PI / 180;
	const R = 6371e3;
	const distance = (p1, p2) => {
		const dLat = (p2[0] - p1[0]) * rad;
		const dLon = (p2[1] - p1[1]) * rad;
		const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(p1[0] * rad) * Math.cos(p2[0] * rad) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
		return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
	};
	const newRoute = [route[0]];
	for (let i = 0; i < route.length - 1; i++) {
		const p1 = route[i];
		const p2 = route[i + 1];
		const dist = distance(p1, p2);
		const steps = Math.max(1, Math.floor(dist / segmentLengthMeters));
		for (let j = 1; j <= steps; j++) {
			const lat = p1[0] + (p2[0] - p1[0]) * (j / steps);
			const lon = p1[1] + (p2[1] - p1[1]) * (j / steps);
			newRoute.push([lat, lon]);
		}
	}
	return newRoute;
}
async function fetchRoute(start, end) {
	try {
		const data = await (await fetch(`https://router.project-osrm.org/route/v1/driving/${start[1]},${start[0]};${end[1]},${end[0]}?geometries=geojson&overview=full`)).json();
		if (data.routes && data.routes[0]) return densifyRoute(data.routes[0].geometry.coordinates.map((c) => [c[1], c[0]]), 30);
	} catch (e) {
		console.error(e);
	}
	return [];
}
function playPing8Times() {
	try {
		const ctx = new (window.AudioContext || window.webkitAudioContext)();
		const playNote = (freq, start) => {
			const osc = ctx.createOscillator();
			const gain = ctx.createGain();
			osc.connect(gain);
			gain.connect(ctx.destination);
			osc.type = "sine";
			osc.frequency.value = freq;
			gain.gain.setValueAtTime(.2, ctx.currentTime + start);
			gain.gain.exponentialRampToValueAtTime(.01, ctx.currentTime + start + .4);
			osc.start(ctx.currentTime + start);
			osc.stop(ctx.currentTime + start + .4);
		};
		for (let i = 0; i < 8; i++) {
			const offset = i * 1;
			playNote(659.25, offset);
			playNote(880, offset + .2);
		}
	} catch (e) {}
}
function AnimatedMapInner({ mode = "idle", height = 320, onComplete }) {
	const [userLocation, setUserLocation] = useState([-26.2041, 28.0473]);
	const [route, setRoute] = useState([]);
	const [carPos, setCarPos] = useState([-26.2041, 28.0473]);
	const [idleCars, setIdleCars] = useState([]);
	const [address, setAddress] = useState("Locating...");
	const [trackStep, setTrackStep] = useState(0);
	useEffect(() => {
		if (navigator.geolocation) navigator.geolocation.getCurrentPosition((pos) => setUserLocation([pos.coords.latitude, pos.coords.longitude]), (err) => console.error("Error fetching location", err));
	}, []);
	useEffect(() => {
		fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${userLocation[0]}&lon=${userLocation[1]}`).then((r) => r.json()).then((d) => {
			if (d && d.display_name) setAddress(d.display_name.split(",").slice(0, 3).join(", "));
			else setAddress("Unknown Location");
		}).catch(() => setAddress("Unknown Location"));
	}, [userLocation]);
	useEffect(() => {
		if (mode !== "idle") return;
		let isMounted = true;
		const initIdleCars = async () => {
			const newCars = [];
			for (let i = 0; i < 4; i++) {
				const startLat = userLocation[0] + (Math.random() - .5) * .015;
				const startLon = userLocation[1] + (Math.random() - .5) * .015;
				const endLat = startLat + (Math.random() - .5) * .02;
				const endLon = startLon + (Math.random() - .5) * .02;
				const path = await fetchRoute([startLat, startLon], [endLat, endLon]);
				newCars.push({
					id: i,
					pos: [startLat, startLon],
					route: path,
					step: 0
				});
			}
			if (isMounted) setIdleCars(newCars);
		};
		initIdleCars();
		return () => {
			isMounted = false;
		};
	}, [userLocation, mode]);
	useEffect(() => {
		if (mode !== "idle" || idleCars.length === 0) return;
		const interval = setInterval(() => {
			setIdleCars((cars) => cars.map((car) => {
				if (car.route.length > 0 && car.step < car.route.length - 1) return {
					...car,
					step: car.step + 1,
					pos: car.route[car.step + 1]
				};
				return car;
			}));
		}, 2e3);
		return () => clearInterval(interval);
	}, [idleCars.length, mode]);
	const [trackStage, setTrackStage] = useState("idle");
	useEffect(() => {
		if (mode !== "track") return;
		let pLocation = userLocation;
		try {
			const p = JSON.parse(localStorage.getItem("vura.ride.pickup") || "null");
			if (p && p.length === 2) pLocation = p;
		} catch (e) {}
		console.log("Initializing Smart Driver Matching Algorithm...");
		const riderHex = h3.latLngToCell(pLocation[0], pLocation[1], 8);
		console.log("Rider mapped to H3 Hexagon:", riderHex);
		const searchArea = h3.gridDisk(riderHex, 5);
		console.log(`Expanded kRing search to ${searchArea.length} neighboring hexes.`);
		const nearbyDrivers = Array.from({ length: 150 }).map((_, i) => ({
			id: i,
			lat: pLocation[0] + (Math.random() - .5) * .1,
			lon: pLocation[1] + (Math.random() - .5) * .1,
			rating: 4.5 + Math.random() * .5
		})).filter((d) => searchArea.includes(h3.latLngToCell(d.lat, d.lon, 8)));
		console.log(`Found ${nearbyDrivers.length} drivers within the kRing search area.`);
		let bestDriver = null;
		let bestScore = -Infinity;
		nearbyDrivers.forEach((d) => {
			const driverHex = h3.latLngToCell(d.lat, d.lon, 8);
			const hexDistance = h3.gridDistance(riderHex, driverHex);
			const score = d.rating * 10 - hexDistance * 2;
			if (score > bestScore) {
				bestScore = score;
				bestDriver = d;
			}
		});
		let startPos = [pLocation[0] + .015, pLocation[1] + .015];
		if (bestDriver) {
			console.log(`Driver ${bestDriver.id} won the bid with score ${bestScore.toFixed(2)}!`);
			startPos = [bestDriver.lat, bestDriver.lon];
		} else console.log("No drivers inside kRing. Falling back to default spawn...");
		setCarPos(startPos);
		fetchRoute(startPos, pLocation).then((path) => {
			if (path.length > 0) {
				setRoute(path);
				setTrackStep(0);
				setTrackStage("approaching");
			}
		});
	}, [mode]);
	const carMarkerRef = useRef(null);
	useEffect(() => {
		if (mode !== "track" || route.length === 0 || trackStage !== "approaching" && trackStage !== "en_route") return;
		let step = 0;
		setTrackStep(0);
		const interval = setInterval(() => {
			if (step < route.length - 1) {
				const currentP = route[step];
				const nextP = route[step + 1];
				const newBearing = getBearing(currentP[0], currentP[1], nextP[0], nextP[1]);
				if (carMarkerRef.current) {
					const el = carMarkerRef.current.getElement();
					if (el) {
						const img = el.querySelector(".vura-car-img");
						if (img) img.style.transform = `rotate(${newBearing + 90}deg)`;
					}
				}
				setCarPos(nextP);
				step++;
				setTrackStep(step);
			} else {
				clearInterval(interval);
				if (trackStage === "approaching") {
					playPing8Times();
					setTrackStage("arrived");
					setRoute([]);
					setTimeout(() => {
						let pLocation = userLocation;
						try {
							const p = JSON.parse(localStorage.getItem("vura.ride.pickup") || "null");
							if (p && p.length === 2) pLocation = p;
						} catch (e) {}
						let dLocation = userLocation;
						try {
							const d = JSON.parse(localStorage.getItem("vura.ride.dropoff") || "null");
							if (d && d.length === 2) dLocation = d;
						} catch (e) {}
						fetchRoute(pLocation, dLocation).then((path) => {
							if (path.length > 0) {
								setRoute(path);
								setTrackStep(0);
								setTrackStage("en_route");
							}
						});
					}, 4500);
				} else if (trackStage === "en_route") {
					setTrackStage("completed");
					setRoute([]);
					if (onComplete) onComplete();
				}
			}
		}, 300);
		return () => clearInterval(interval);
	}, [
		route,
		trackStage,
		mode,
		onComplete
	]);
	if (typeof window === "undefined") return /* @__PURE__ */ jsx("div", { style: {
		height,
		background: "#f8f9fa"
	} });
	const remainingRoute = route.length > 0 ? route.slice(trackStep) : [];
	return /* @__PURE__ */ jsxs("div", {
		className: "relative w-full overflow-hidden z-0",
		style: { height },
		children: [/* @__PURE__ */ jsxs(MapContainer, {
			center: userLocation,
			zoom: 15,
			style: {
				height: "100%",
				width: "100%"
			},
			zoomControl: false,
			attributionControl: false,
			children: [
				/* @__PURE__ */ jsx(TileLayer, { url: "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png" }),
				/* @__PURE__ */ jsx(MapController, { center: userLocation }),
				/* @__PURE__ */ jsx(Marker, {
					position: userLocation,
					icon: userIcon,
					children: /* @__PURE__ */ jsxs(Popup, {
						className: "font-sans",
						children: [
							/* @__PURE__ */ jsx("strong", {
								className: "text-sm font-bold text-foreground",
								children: "Your Location"
							}),
							/* @__PURE__ */ jsx("br", {}),
							/* @__PURE__ */ jsx("span", {
								className: "text-xs text-muted-foreground",
								children: address
							})
						]
					})
				}),
				mode === "idle" && idleCars.map((car) => /* @__PURE__ */ jsx(Marker, {
					position: car.pos,
					icon: carIconFixed
				}, car.id)),
				mode === "track" && /* @__PURE__ */ jsxs(Fragment, { children: [remainingRoute.length > 1 && /* @__PURE__ */ jsx(Polyline, {
					positions: remainingRoute,
					pathOptions: {
						color: "#3b82f6",
						weight: 4,
						opacity: .8
					}
				}), /* @__PURE__ */ jsx(Marker, {
					position: carPos,
					icon: carIconFixed,
					ref: carMarkerRef
				})] })
			]
		}), /* @__PURE__ */ jsx("style", { dangerouslySetInnerHTML: { __html: `
        .leaflet-container { background: #f8f9fa; z-index: 10; }
        .leaflet-marker-icon { transition: transform 0.3s linear; } 
        @keyframes pulse {
          0% { box-shadow: 0 0 0 0 rgba(59, 130, 246, 0.7); }
          70% { box-shadow: 0 0 0 10px rgba(59, 130, 246, 0); }
          100% { box-shadow: 0 0 0 0 rgba(59, 130, 246, 0); }
        }
      ` } })]
	});
}
//#endregion
export { AnimatedMapInner as default };
