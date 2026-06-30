import { n as PhoneShell } from "./PhoneShell-BHLURtmB.js";
import { Link } from "@tanstack/react-router";
import { jsx, jsxs } from "react/jsx-runtime";
import { ArrowLeft, Hexagon, Map, Navigation, Route } from "lucide-react";
//#region src/routes/architecture.tsx?tsr-split=component
function ArchitecturePage() {
	return /* @__PURE__ */ jsx(PhoneShell, {
		hideTabs: true,
		children: /* @__PURE__ */ jsxs("div", {
			className: "bg-[#111111] min-h-full text-white font-sans overflow-y-auto pb-10",
			children: [/* @__PURE__ */ jsxs("div", {
				className: "sticky top-0 z-10 bg-[#111111]/80 backdrop-blur-md px-5 pt-4 pb-4 border-b border-white/10 flex items-center gap-3",
				children: [/* @__PURE__ */ jsx(Link, {
					to: "/account",
					className: "grid place-items-center h-9 w-9 rounded-full bg-white/10 hover:bg-white/20 transition",
					children: /* @__PURE__ */ jsx(ArrowLeft, { className: "h-4 w-4" })
				}), /* @__PURE__ */ jsx("h1", {
					className: "text-lg font-bold",
					children: "System Architecture"
				})]
			}), /* @__PURE__ */ jsxs("div", {
				className: "px-5 pt-6 space-y-12",
				children: [
					/* @__PURE__ */ jsxs("section", { children: [
						/* @__PURE__ */ jsx("h2", {
							className: "text-center text-sm font-bold text-white/90 mb-6",
							children: "Part 1 — Finding nearby drivers (geospatial search)"
						}),
						/* @__PURE__ */ jsx("div", {
							className: "flex justify-center mb-6 opacity-80",
							children: /* @__PURE__ */ jsxs("div", {
								className: "relative h-24 w-32",
								children: [
									/* @__PURE__ */ jsx(Hexagon, {
										className: "absolute top-0 left-1/2 -translate-x-1/2 h-12 w-12 text-[#f59e0b] fill-[#f59e0b]/10",
										strokeWidth: 1
									}),
									/* @__PURE__ */ jsx(Hexagon, {
										className: "absolute top-6 left-2 h-12 w-12 text-[#3b82f6] fill-transparent",
										strokeWidth: 1
									}),
									/* @__PURE__ */ jsx(Hexagon, {
										className: "absolute top-6 right-2 h-12 w-12 text-[#3b82f6] fill-transparent",
										strokeWidth: 1
									}),
									/* @__PURE__ */ jsx(Hexagon, {
										className: "absolute top-12 left-1/2 -translate-x-1/2 h-12 w-12 text-[#3b82f6] fill-transparent",
										strokeWidth: 1
									}),
									/* @__PURE__ */ jsx("div", {
										className: "absolute top-4 left-1/2 -translate-x-1/2 text-[8px] font-bold text-[#f59e0b]",
										children: "Rider"
									})
								]
							})
						}),
						/* @__PURE__ */ jsxs("div", {
							className: "space-y-4",
							children: [
								/* @__PURE__ */ jsxs("div", {
									className: "flex gap-2",
									children: [
										/* @__PURE__ */ jsxs("div", {
											className: "flex-1 bg-[#854d0e] border border-[#a16207] rounded-xl p-3 text-center shadow-lg",
											children: [/* @__PURE__ */ jsx("h3", {
												className: "text-xs font-bold text-white",
												children: "1. GPS collection"
											}), /* @__PURE__ */ jsx("p", {
												className: "text-[9px] text-white/70",
												children: "Raw GPS from driver app"
											})]
										}),
										/* @__PURE__ */ jsx("div", {
											className: "flex items-center justify-center opacity-50",
											children: /* @__PURE__ */ jsx(ArrowRight, {})
										}),
										/* @__PURE__ */ jsxs("div", {
											className: "flex-1 bg-[#1e3a8a] border border-[#2563eb] rounded-xl p-3 text-center shadow-lg",
											children: [/* @__PURE__ */ jsx("h3", {
												className: "text-xs font-bold text-white",
												children: "2. Kalman filter"
											}), /* @__PURE__ */ jsx("p", {
												className: "text-[9px] text-white/70",
												children: "Smooth noisy GPS signal"
											})]
										}),
										/* @__PURE__ */ jsx("div", {
											className: "flex items-center justify-center opacity-50",
											children: /* @__PURE__ */ jsx(ArrowRight, {})
										}),
										/* @__PURE__ */ jsxs("div", {
											className: "flex-1 bg-[#14532d] border border-[#16a34a] rounded-xl p-3 text-center shadow-lg",
											children: [/* @__PURE__ */ jsx("h3", {
												className: "text-xs font-bold text-white",
												children: "3. Map matching"
											}), /* @__PURE__ */ jsx("p", {
												className: "text-[9px] text-white/70",
												children: "Snap to nearest road"
											})]
										})
									]
								}),
								/* @__PURE__ */ jsxs("div", {
									className: "flex justify-center gap-12 py-1 opacity-50",
									children: [/* @__PURE__ */ jsx(ArrowDown, {}), /* @__PURE__ */ jsx(ArrowDown, {})]
								}),
								/* @__PURE__ */ jsxs("div", {
									className: "flex gap-4",
									children: [
										/* @__PURE__ */ jsxs("div", {
											className: "flex-1 bg-[#4c1d95] border border-[#7c3aed] rounded-xl p-3 text-center shadow-lg",
											children: [/* @__PURE__ */ jsx("h3", {
												className: "text-xs font-bold text-white",
												children: "4. H3 hexagonal index"
											}), /* @__PURE__ */ jsx("p", {
												className: "text-[9px] text-white/70",
												children: "Convert coords to 64-bit ID"
											})]
										}),
										/* @__PURE__ */ jsx("div", {
											className: "flex items-center justify-center opacity-50",
											children: /* @__PURE__ */ jsx(ArrowRight, {})
										}),
										/* @__PURE__ */ jsxs("div", {
											className: "flex-1 bg-[#4c1d95] border border-[#7c3aed] rounded-xl p-3 text-center shadow-lg",
											children: [/* @__PURE__ */ jsx("h3", {
												className: "text-xs font-bold text-white",
												children: "5. kRing search"
											}), /* @__PURE__ */ jsx("p", {
												className: "text-[9px] text-white/70",
												children: "Expand to neighbor hexes"
											})]
										})
									]
								}),
								/* @__PURE__ */ jsxs("div", {
									className: "flex justify-center gap-12 py-1 opacity-50",
									children: [/* @__PURE__ */ jsx(ArrowDown, {}), /* @__PURE__ */ jsx(ArrowDown, {})]
								}),
								/* @__PURE__ */ jsxs("div", {
									className: "flex gap-4",
									children: [/* @__PURE__ */ jsxs("div", {
										className: "flex-1 bg-[#7c2d12] border border-[#ea580c] rounded-xl p-3 text-center shadow-lg",
										children: [/* @__PURE__ */ jsx("h3", {
											className: "text-xs font-bold text-white",
											children: "6. Score candidates"
										}), /* @__PURE__ */ jsx("p", {
											className: "text-[9px] text-white/70",
											children: "ETA + rating + acceptance"
										})]
									}), /* @__PURE__ */ jsxs("div", {
										className: "flex-1 bg-[#27272a] border border-[#52525b] rounded-xl p-3 text-center shadow-lg",
										children: [/* @__PURE__ */ jsx("h3", {
											className: "text-xs font-bold text-white",
											children: "Storage layer"
										}), /* @__PURE__ */ jsx("p", {
											className: "text-[9px] text-white/70",
											children: "Redis cache + Cassandra"
										})]
									})]
								}),
								/* @__PURE__ */ jsx("div", {
									className: "flex justify-center py-1 opacity-50",
									children: /* @__PURE__ */ jsx(ArrowDown, {})
								}),
								/* @__PURE__ */ jsxs("div", {
									className: "mx-8 bg-[#15803d] border border-[#22c55e] rounded-xl p-3 text-center shadow-lg",
									children: [/* @__PURE__ */ jsx("h3", {
										className: "text-xs font-bold text-white",
										children: "7. Send ride offer"
									}), /* @__PURE__ */ jsx("p", {
										className: "text-[9px] text-white/70",
										children: "Top driver first — 15s timeout"
									})]
								})
							]
						})
					] }),
					/* @__PURE__ */ jsx("hr", { className: "border-white/10" }),
					/* @__PURE__ */ jsxs("section", { children: [
						/* @__PURE__ */ jsx("h2", {
							className: "text-center text-sm font-bold text-white/90 mb-6",
							children: "Part 2 — Routing to a destination (shortest path)"
						}),
						/* @__PURE__ */ jsxs("div", {
							className: "relative h-20 mb-6 flex justify-between items-center px-4 opacity-80",
							children: [
								/* @__PURE__ */ jsx("div", { className: "h-4 w-4 rounded-full bg-[#22c55e] z-10" }),
								/* @__PURE__ */ jsx("div", { className: "absolute top-1/2 left-6 right-6 h-0.5 bg-[#f59e0b] -translate-y-1/2 z-0" }),
								/* @__PURE__ */ jsx("div", { className: "absolute top-1/4 left-[30%] h-0.5 w-[40%] bg-white/20 rotate-12 z-0" }),
								/* @__PURE__ */ jsx("div", { className: "absolute top-3/4 left-[30%] h-0.5 w-[40%] bg-white/20 -rotate-12 z-0" }),
								/* @__PURE__ */ jsx("div", { className: "h-4 w-4 rounded-full bg-white/30 z-10" }),
								/* @__PURE__ */ jsx("div", { className: "h-4 w-4 rounded-full bg-[#ea580c] z-10" })
							]
						}),
						/* @__PURE__ */ jsxs("div", {
							className: "flex flex-col gap-3",
							children: [
								/* @__PURE__ */ jsxs("div", {
									className: "bg-[#1e3a8a] border border-[#3b82f6] rounded-xl p-4 shadow-lg flex items-center gap-3",
									children: [/* @__PURE__ */ jsx(Route, { className: "h-5 w-5 text-blue-300 shrink-0" }), /* @__PURE__ */ jsxs("div", { children: [/* @__PURE__ */ jsx("h3", {
										className: "text-sm font-bold text-white",
										children: "Dijkstra's algorithm"
									}), /* @__PURE__ */ jsx("p", {
										className: "text-[10px] text-white/70",
										children: "Explores all paths • 100% accurate"
									})] })]
								}),
								/* @__PURE__ */ jsx("div", {
									className: "flex justify-center opacity-50",
									children: /* @__PURE__ */ jsx(ArrowDown, {})
								}),
								/* @__PURE__ */ jsxs("div", {
									className: "bg-[#0f766e] border border-[#14b8a6] rounded-xl p-4 shadow-lg flex items-center gap-3",
									children: [/* @__PURE__ */ jsx(Navigation, { className: "h-5 w-5 text-teal-300 shrink-0" }), /* @__PURE__ */ jsxs("div", { children: [/* @__PURE__ */ jsx("h3", {
										className: "text-sm font-bold text-white",
										children: "A* (A-star)"
									}), /* @__PURE__ */ jsx("p", {
										className: "text-[10px] text-white/70",
										children: "Uses heuristic estimate • Faster than Dijkstra"
									})] })]
								}),
								/* @__PURE__ */ jsx("div", {
									className: "flex justify-center opacity-50",
									children: /* @__PURE__ */ jsx(ArrowDown, {})
								}),
								/* @__PURE__ */ jsxs("div", {
									className: "bg-[#4c1d95] border border-[#8b5cf6] rounded-xl p-4 shadow-lg flex items-center gap-3",
									children: [/* @__PURE__ */ jsx(Map, { className: "h-5 w-5 text-purple-300 shrink-0" }), /* @__PURE__ */ jsxs("div", { children: [/* @__PURE__ */ jsx("h3", {
										className: "text-sm font-bold text-white",
										children: "Graph partitioning"
									}), /* @__PURE__ */ jsx("p", {
										className: "text-[10px] text-white/70",
										children: "Pre-compute sub-regions • Scales to millions"
									})] })]
								})
							]
						}),
						/* @__PURE__ */ jsx("p", {
							className: "text-center text-[9px] text-white/50 mt-6 font-medium",
							children: "Road = weighted graph: intersections = nodes, streets = edges with real-time traffic cost"
						})
					] })
				]
			})]
		})
	});
}
function ArrowRight() {
	return /* @__PURE__ */ jsx("svg", {
		width: "12",
		height: "12",
		viewBox: "0 0 24 24",
		fill: "none",
		stroke: "currentColor",
		strokeWidth: "2",
		strokeLinecap: "round",
		strokeLinejoin: "round",
		children: /* @__PURE__ */ jsx("path", { d: "M5 12h14M12 5l7 7-7 7" })
	});
}
function ArrowDown() {
	return /* @__PURE__ */ jsx("svg", {
		width: "12",
		height: "12",
		viewBox: "0 0 24 24",
		fill: "none",
		stroke: "currentColor",
		strokeWidth: "2",
		strokeLinecap: "round",
		strokeLinejoin: "round",
		children: /* @__PURE__ */ jsx("path", { d: "M12 5v14M19 12l-7 7-7-7" })
	});
}
//#endregion
export { ArchitecturePage as component };
