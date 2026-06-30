import { a as useAuth, n as PhoneShell, t as FakeMap } from "./PhoneShell-BHLURtmB.js";
import { useEffect, useState } from "react";
import { Link, Navigate } from "@tanstack/react-router";
import { jsx, jsxs } from "react/jsx-runtime";
import { Bell, Briefcase, Car, Clock, Home as Home$1, Package, Search, UtensilsCrossed } from "lucide-react";
//#region src/routes/index.tsx?tsr-split=component
function Home() {
	const user = useAuth();
	const [ready, setReady] = useState(false);
	useEffect(() => setReady(true), []);
	if (!ready) return null;
	if (!user) return /* @__PURE__ */ jsx(Navigate, { to: "/welcome" });
	if (user.role === "driver") return /* @__PURE__ */ jsx(Navigate, { to: "/driver" });
	return /* @__PURE__ */ jsxs(PhoneShell, { children: [
		/* @__PURE__ */ jsxs("div", {
			className: "hero-gradient text-primary-foreground px-5 pt-4 pb-10 rounded-b-[2rem] relative overflow-hidden",
			children: [
				/* @__PURE__ */ jsx("div", { className: "absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/10" }),
				/* @__PURE__ */ jsx("div", { className: "absolute right-12 top-20 h-24 w-24 rounded-full bg-white/10" }),
				/* @__PURE__ */ jsxs("div", {
					className: "flex items-center justify-between relative",
					children: [/* @__PURE__ */ jsxs("div", { children: [/* @__PURE__ */ jsx("p", {
						className: "text-xs/4 opacity-80",
						children: "Good morning,"
					}), /* @__PURE__ */ jsx("h1", {
						className: "text-2xl font-bold tracking-tight",
						children: user.name
					})] }), /* @__PURE__ */ jsx("button", {
						className: "grid place-items-center h-10 w-10 rounded-full bg-white/15 backdrop-blur",
						children: /* @__PURE__ */ jsx(Bell, { className: "h-5 w-5" })
					})]
				}),
				/* @__PURE__ */ jsxs(Link, {
					to: "/search",
					className: "mt-6 flex items-center gap-3 rounded-2xl bg-surface px-4 py-3.5 text-foreground shadow-float relative",
					children: [
						/* @__PURE__ */ jsx(Search, { className: "h-5 w-5 text-primary" }),
						/* @__PURE__ */ jsx("span", {
							className: "text-sm font-medium text-muted-foreground",
							children: "Where to?"
						}),
						/* @__PURE__ */ jsxs("span", {
							className: "ml-auto flex items-center gap-1.5 rounded-full bg-secondary px-2.5 py-1 text-xs font-semibold",
							children: [/* @__PURE__ */ jsx(Clock, { className: "h-3 w-3" }), " Now"]
						})
					]
				})
			]
		}),
		/* @__PURE__ */ jsx("div", {
			className: "px-5 -mt-4",
			children: /* @__PURE__ */ jsx("div", {
				className: "grid grid-cols-4 gap-3 rounded-2xl bg-surface border border-border shadow-sm p-4",
				children: [
					{
						icon: Car,
						label: "Ride",
						to: "/search"
					},
					{
						icon: UtensilsCrossed,
						label: "Eats",
						to: "/services"
					},
					{
						icon: Package,
						label: "Package",
						to: "/services"
					},
					{
						icon: Briefcase,
						label: "Business",
						to: "/services"
					}
				].map(({ icon: Icon, label, to }) => /* @__PURE__ */ jsxs(Link, {
					to,
					className: "flex flex-col items-center gap-2",
					children: [/* @__PURE__ */ jsx("span", {
						className: "grid place-items-center h-12 w-12 rounded-xl bg-accent text-primary",
						children: /* @__PURE__ */ jsx(Icon, { className: "h-5 w-5" })
					}), /* @__PURE__ */ jsx("span", {
						className: "text-[11px] font-semibold text-foreground",
						children: label
					})]
				}, label))
			})
		}),
		/* @__PURE__ */ jsxs("div", {
			className: "px-5 mt-6",
			children: [/* @__PURE__ */ jsx("h2", {
				className: "text-sm font-bold text-foreground/90 mb-3",
				children: "Saved places"
			}), /* @__PURE__ */ jsx("div", {
				className: "space-y-2",
				children: [{
					icon: Home$1,
					label: "Home",
					sub: "221B Baker St, London"
				}, {
					icon: Briefcase,
					label: "Work",
					sub: "Canary Wharf, London"
				}].map((p) => /* @__PURE__ */ jsxs(Link, {
					to: "/search",
					className: "flex items-center gap-3 rounded-xl bg-surface border border-border px-3.5 py-3 hover:border-primary/40 transition",
					children: [/* @__PURE__ */ jsx("span", {
						className: "grid place-items-center h-10 w-10 rounded-full bg-secondary text-foreground",
						children: /* @__PURE__ */ jsx(p.icon, { className: "h-4 w-4" })
					}), /* @__PURE__ */ jsxs("div", {
						className: "min-w-0",
						children: [/* @__PURE__ */ jsx("p", {
							className: "text-sm font-semibold",
							children: p.label
						}), /* @__PURE__ */ jsx("p", {
							className: "text-xs text-muted-foreground truncate",
							children: p.sub
						})]
					})]
				}, p.label))
			})]
		}),
		/* @__PURE__ */ jsxs("div", {
			className: "mx-5 mt-6 rounded-2xl overflow-hidden border border-border shadow-sm border border-border",
			children: [/* @__PURE__ */ jsx(FakeMap, { height: 180 }), /* @__PURE__ */ jsxs("div", {
				className: "flex items-center justify-between px-4 py-3 bg-surface",
				children: [/* @__PURE__ */ jsxs("div", { children: [/* @__PURE__ */ jsx("p", {
					className: "text-xs text-muted-foreground",
					children: "Nearest driver"
				}), /* @__PURE__ */ jsx("p", {
					className: "text-sm font-bold",
					children: "2 min away"
				})] }), /* @__PURE__ */ jsx(Link, {
					to: "/search",
					className: "rounded-full bg-primary px-4 py-2 text-xs font-bold text-primary-foreground shadow-sm",
					children: "Book now"
				})]
			})]
		}),
		/* @__PURE__ */ jsx("div", { className: "h-6" })
	] });
}
//#endregion
export { Home as component };
