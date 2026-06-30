import { n as PhoneShell } from "./PhoneShell-BHLURtmB.js";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { jsx, jsxs } from "react/jsx-runtime";
import { ArrowLeft, Circle, Clock, MapPin, Star } from "lucide-react";
//#region src/routes/search.tsx?tsr-split=component
function Search() {
	const nav = useNavigate();
	const [activeInput, setActiveInput] = useState("dropoff");
	const [pickup, setPickup] = useState("Locating...");
	const [dropoff, setDropoff] = useState("");
	const [results, setResults] = useState([]);
	const [userCountry, setUserCountry] = useState("");
	useEffect(() => {
		if (navigator.geolocation) navigator.geolocation.getCurrentPosition((pos) => {
			localStorage.setItem("vura.ride.pickup", JSON.stringify([pos.coords.latitude, pos.coords.longitude]));
			fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${pos.coords.latitude}&lon=${pos.coords.longitude}&addressdetails=1`).then((r) => r.json()).then((d) => {
				if (d && d.address && d.address.country_code) setUserCountry(d.address.country_code);
				if (d && d.display_name) setPickup(d.display_name.split(",").slice(0, 2).join(", "));
				else setPickup("Current location");
			}).catch(() => setPickup("Current location"));
		}, () => setPickup("Current location"));
		else setPickup("Current location");
	}, []);
	useEffect(() => {
		const q = activeInput === "pickup" ? pickup : dropoff;
		if (q === "Locating..." || q === "Current location" || q.length < 3) {
			setResults([]);
			return;
		}
		const timer = setTimeout(() => {
			let locBias = "";
			try {
				const p = JSON.parse(localStorage.getItem("vura.ride.pickup") || "null");
				if (p && p.length === 2) locBias = `&lat=${p[0]}&lon=${p[1]}`;
			} catch (e) {}
			fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=6${locBias}`).then((r) => r.json()).then((data) => {
				if (data.features) setResults(data.features.map((f) => ({
					name: f.properties.name || f.properties.street || f.properties.city,
					addr: [
						f.properties.street,
						f.properties.district,
						f.properties.city,
						f.properties.state,
						f.properties.country
					].filter(Boolean).join(", "),
					lat: f.geometry.coordinates[1],
					lon: f.geometry.coordinates[0]
				})));
			});
		}, 600);
		return () => clearTimeout(timer);
	}, [
		pickup,
		dropoff,
		activeInput,
		userCountry
	]);
	const [entranceModal, setEntranceModal] = useState(null);
	const [realEntrances, setRealEntrances] = useState([]);
	const [fetchingEntrances, setFetchingEntrances] = useState(false);
	const handleSelect = (s) => {
		if (/mall|shopping|centre|center|square|plaza/i.test(s.name) || /mall|shopping/i.test(s.addr)) {
			setEntranceModal({
				s,
				type: activeInput
			});
			setFetchingEntrances(true);
			setRealEntrances([]);
			const query = `[out:json];(node(around:200,${s.lat},${s.lon})["entrance"];node(around:200,${s.lat},${s.lon})["highway"="bus_stop"];node(around:200,${s.lat},${s.lon})["amenity"="parking_entrance"];);out;`;
			fetch(`https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`).then((res) => res.json()).then((data) => {
				if (data.elements && data.elements.length > 0) {
					const entrances = data.elements.map((e, i) => {
						if (e.tags?.name) return e.tags.name;
						if (e.tags?.ref) return `Entrance ${e.tags.ref}`;
						if (e.tags?.entrance === "main") return "Main Entrance";
						if (e.tags?.amenity === "parking_entrance") return "Parking Drop-off";
						if (e.tags?.highway === "bus_stop") return "Transit Drop-off Zone";
						return `Gate / Entrance ${i + 1}`;
					});
					setRealEntrances(Array.from(new Set(entrances)).slice(0, 6));
				} else setRealEntrances([
					"Main Entrance",
					"Secondary Entrance",
					"Parking Drop-off"
				]);
			}).catch(() => {
				setRealEntrances([
					"Main Entrance",
					"Secondary Entrance",
					"Parking Drop-off"
				]);
			}).finally(() => {
				setFetchingEntrances(false);
			});
			return;
		}
		proceedWithSelection(s, s.name);
	};
	const proceedWithSelection = (s, displayName) => {
		if (activeInput === "pickup" || entranceModal && entranceModal.type === "pickup") {
			setPickup(displayName);
			localStorage.setItem("vura.ride.pickup", JSON.stringify([s.lat, s.lon]));
			setActiveInput("dropoff");
			setEntranceModal(null);
		} else {
			setDropoff(displayName);
			localStorage.setItem("vura.ride.dropoff", JSON.stringify([s.lat, s.lon]));
			setEntranceModal(null);
			nav({ to: "/ride/options" });
		}
	};
	const displayResults = results.length > 0 ? results : [
		{
			name: "Heathrow Airport",
			addr: "Terminal 5, London TW6",
			lat: 51.47,
			lon: -.4543
		},
		{
			name: "Mall of Africa",
			addr: "Waterfall City, Midrand",
			lat: -26.0152,
			lon: 28.1065
		},
		{
			name: "British Museum",
			addr: "Great Russell St, London",
			lat: 51.5194,
			lon: -.127
		},
		{
			name: "King's Cross Station",
			addr: "Euston Rd, London N1C",
			lat: 51.532,
			lon: -.124
		}
	];
	return /* @__PURE__ */ jsxs(PhoneShell, {
		hideTabs: true,
		children: [
			/* @__PURE__ */ jsxs("div", {
				className: "px-5 pt-3 pb-4 bg-surface border-b border-border",
				children: [/* @__PURE__ */ jsxs("div", {
					className: "flex items-center gap-3 mb-4",
					children: [/* @__PURE__ */ jsx(Link, {
						to: "/",
						className: "grid place-items-center h-9 w-9 rounded-full bg-secondary",
						children: /* @__PURE__ */ jsx(ArrowLeft, { className: "h-4 w-4" })
					}), /* @__PURE__ */ jsx("h1", {
						className: "text-base font-bold",
						children: "Plan your ride"
					})]
				}), /* @__PURE__ */ jsxs("div", {
					className: "flex gap-3",
					children: [/* @__PURE__ */ jsxs("div", {
						className: "flex flex-col items-center pt-3",
						children: [
							/* @__PURE__ */ jsx(Circle, { className: "h-3 w-3 fill-foreground text-foreground" }),
							/* @__PURE__ */ jsx("div", { className: "w-px flex-1 my-1 border-l-2 border-dashed border-muted-foreground/40" }),
							/* @__PURE__ */ jsx(MapPin, { className: "h-4 w-4 text-primary" })
						]
					}), /* @__PURE__ */ jsxs("div", {
						className: "flex-1 space-y-2",
						children: [/* @__PURE__ */ jsx("input", {
							value: pickup,
							onFocus: () => setActiveInput("pickup"),
							onChange: (e) => setPickup(e.target.value),
							className: `w-full rounded-xl px-3 py-3 text-sm font-medium outline-none transition ${activeInput === "pickup" ? "bg-accent border border-primary/30 ring-2 ring-primary/40" : "bg-secondary border border-transparent"}`
						}), /* @__PURE__ */ jsx("input", {
							autoFocus: true,
							placeholder: "Where to?",
							value: dropoff,
							onFocus: () => setActiveInput("dropoff"),
							onChange: (e) => setDropoff(e.target.value),
							className: `w-full rounded-xl px-3 py-3 text-sm font-medium outline-none transition ${activeInput === "dropoff" ? "bg-accent border border-primary/30 ring-2 ring-primary/40" : "bg-secondary border border-transparent"}`
						})]
					})]
				})]
			}),
			/* @__PURE__ */ jsxs("div", {
				className: "flex-1 px-5 py-4 overflow-y-auto",
				children: [/* @__PURE__ */ jsx("p", {
					className: "text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2",
					children: results.length > 0 ? "Search Results" : "Suggestions"
				}), /* @__PURE__ */ jsx("div", {
					className: "divide-y divide-border",
					children: displayResults.map((s, i) => /* @__PURE__ */ jsxs("button", {
						onClick: () => handleSelect(s),
						className: "w-full flex items-center gap-3 py-3 text-left",
						children: [/* @__PURE__ */ jsx("span", {
							className: "grid place-items-center shrink-0 h-10 w-10 rounded-full bg-secondary",
							children: results.length > 0 ? /* @__PURE__ */ jsx(MapPin, { className: "h-4 w-4 text-primary" }) : i === 0 ? /* @__PURE__ */ jsx(Star, { className: "h-4 w-4 text-primary" }) : /* @__PURE__ */ jsx(Clock, { className: "h-4 w-4 text-muted-foreground" })
						}), /* @__PURE__ */ jsxs("div", {
							className: "min-w-0 flex-1",
							children: [/* @__PURE__ */ jsx("p", {
								className: "text-sm font-semibold truncate",
								children: s.name
							}), /* @__PURE__ */ jsx("p", {
								className: "text-xs text-muted-foreground truncate",
								children: s.addr
							})]
						})]
					}, i))
				})]
			}),
			entranceModal && /* @__PURE__ */ jsx("div", {
				className: "absolute inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-end",
				children: /* @__PURE__ */ jsxs("div", {
					className: "w-full bg-surface rounded-t-[2rem] p-5 shadow-float animate-in slide-in-from-bottom max-h-[80vh] flex flex-col",
					children: [
						/* @__PURE__ */ jsx("h3", {
							className: "text-lg font-bold",
							children: "Choose an entrance"
						}),
						/* @__PURE__ */ jsxs("p", {
							className: "text-sm text-muted-foreground mb-4 mt-1",
							children: [
								"Select the most convenient point for ",
								entranceModal.s.name,
								"."
							]
						}),
						fetchingEntrances ? /* @__PURE__ */ jsxs("div", {
							className: "py-8 flex flex-col items-center justify-center space-y-3",
							children: [/* @__PURE__ */ jsx("div", { className: "h-6 w-6 rounded-full border-2 border-primary border-t-transparent animate-spin" }), /* @__PURE__ */ jsx("p", {
								className: "text-xs font-semibold text-muted-foreground animate-pulse",
								children: "Scanning map for drop-off zones..."
							})]
						}) : /* @__PURE__ */ jsx("div", {
							className: "space-y-2 overflow-y-auto pb-4",
							children: realEntrances.map((ent, i) => /* @__PURE__ */ jsxs("button", {
								onClick: () => proceedWithSelection(entranceModal.s, `${entranceModal.s.name} (${ent})`),
								className: "w-full text-left px-4 py-3.5 rounded-full border border-border bg-surface hover:bg-secondary/50 transition text-sm font-semibold flex items-center justify-between",
								children: [ent, /* @__PURE__ */ jsx(MapPin, { className: "h-4 w-4 text-muted-foreground" })]
							}, i))
						}),
						/* @__PURE__ */ jsx("button", {
							onClick: () => setEntranceModal(null),
							className: "mt-2 w-full py-3.5 rounded-full bg-secondary border border-transparent transition-colors focus-within:bg-background focus-within:border-primary focus:bg-background focus:border-primary text-sm font-bold hover:bg-secondary/80 transition",
							children: "Cancel"
						})
					]
				})
			})
		]
	});
}
//#endregion
export { Search as component };
