import { n as PhoneShell } from "./PhoneShell-BHLURtmB.js";
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { jsx, jsxs } from "react/jsx-runtime";
import { ArrowLeft, BellRing, Check, ChevronRight, KeyRound, ShieldCheck, Users } from "lucide-react";
//#region src/routes/safety.tsx?tsr-split=component
function SafetyPage() {
	const [activeSetting, setActiveSetting] = useState(null);
	return /* @__PURE__ */ jsxs(PhoneShell, {
		hideTabs: true,
		children: [/* @__PURE__ */ jsxs("div", {
			className: "hero-gradient text-primary-foreground px-5 pt-4 pb-8 rounded-b-[2rem] relative",
			children: [
				/* @__PURE__ */ jsx(Link, {
					to: "/account",
					className: "absolute top-4 left-4 grid place-items-center h-9 w-9 rounded-full bg-white/20 hover:bg-white/30 transition",
					children: /* @__PURE__ */ jsx(ArrowLeft, { className: "h-4 w-4" })
				}),
				/* @__PURE__ */ jsxs("div", {
					className: "mt-12 flex items-center gap-3",
					children: [/* @__PURE__ */ jsx(ShieldCheck, { className: "h-8 w-8" }), /* @__PURE__ */ jsx("h1", {
						className: "text-2xl font-extrabold tracking-tight",
						children: "Safety Center"
					})]
				}),
				/* @__PURE__ */ jsx("p", {
					className: "text-sm opacity-85 mt-2",
					children: "Your safety is our priority. Manage your preferences below."
				})
			]
		}), /* @__PURE__ */ jsxs("div", {
			className: "px-5 mt-6 flex-1 flex flex-col pb-6 space-y-4 overflow-y-auto",
			children: [
				/* @__PURE__ */ jsx("h2", {
					className: "text-sm font-extrabold text-foreground mb-1",
					children: "Safety tools"
				}),
				/* @__PURE__ */ jsx("div", {
					className: "rounded-2xl bg-surface border border-border divide-y divide-border overflow-hidden shadow-sm",
					children: [
						{
							id: "contacts",
							icon: Users,
							title: "Trusted Contacts",
							desc: "Share your trip status with family and friends."
						},
						{
							id: "pin",
							icon: KeyRound,
							title: "Verify Your Ride",
							desc: "Use a PIN to make sure you get in the right car."
						},
						{
							id: "check",
							icon: BellRing,
							title: "RideCheck",
							desc: "We'll check on you if your trip goes off route."
						}
					].map((s) => /* @__PURE__ */ jsxs("div", { children: [/* @__PURE__ */ jsxs("div", {
						onClick: () => setActiveSetting(activeSetting === s.id ? null : s.id),
						className: "flex items-center gap-4 p-4 active:bg-secondary/50 transition cursor-pointer",
						children: [
							/* @__PURE__ */ jsx("div", {
								className: "h-10 w-10 rounded-full bg-secondary text-primary grid place-items-center shrink-0",
								children: /* @__PURE__ */ jsx(s.icon, { className: "h-5 w-5" })
							}),
							/* @__PURE__ */ jsxs("div", {
								className: "flex-1 min-w-0",
								children: [/* @__PURE__ */ jsx("p", {
									className: "text-sm font-bold",
									children: s.title
								}), /* @__PURE__ */ jsx("p", {
									className: "text-xs text-muted-foreground mt-0.5 leading-snug",
									children: s.desc
								})]
							}),
							/* @__PURE__ */ jsx(ChevronRight, { className: `h-4 w-4 text-muted-foreground transition-transform ${activeSetting === s.id ? "rotate-90" : ""}` })
						]
					}), activeSetting === s.id && /* @__PURE__ */ jsx("div", {
						className: "px-4 pb-4 animate-in slide-in-from-top-2",
						children: /* @__PURE__ */ jsxs("div", {
							className: "rounded-full bg-secondary border border-transparent transition-colors focus-within:bg-background focus-within:border-primary focus:bg-background focus:border-primary/50 p-4 border border-border",
							children: [/* @__PURE__ */ jsxs("p", {
								className: "text-sm font-bold text-foreground flex justify-between items-center",
								children: ["Feature Enabled ", /* @__PURE__ */ jsx(Check, { className: "h-4 w-4 text-green-600" })]
							}), /* @__PURE__ */ jsx("p", {
								className: "text-xs text-muted-foreground mt-1",
								children: "This feature is actively running to keep you safe."
							})]
						})
					})] }, s.id))
				}),
				/* @__PURE__ */ jsxs("div", {
					className: "rounded-2xl bg-red-50 p-5 mt-4 border border-red-100 flex flex-col items-center text-center",
					children: [
						/* @__PURE__ */ jsx("p", {
							className: "text-sm font-bold text-red-800",
							children: "Need emergency help?"
						}),
						/* @__PURE__ */ jsx("p", {
							className: "text-xs text-red-600 mt-1 mb-4",
							children: "Our emergency response team is available 24/7."
						}),
						/* @__PURE__ */ jsx("button", {
							onClick: () => alert("Connecting to emergency services..."),
							className: "rounded-xl bg-red-600 text-white font-bold text-sm px-6 py-2.5 w-full hover:bg-red-700 transition shadow-sm",
							children: "Call Emergency Services"
						})
					]
				})
			]
		})]
	});
}
//#endregion
export { SafetyPage as component };
