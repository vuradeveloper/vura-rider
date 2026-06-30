import { n as PhoneShell } from "./PhoneShell-BHLURtmB.js";
import { Link } from "@tanstack/react-router";
import { jsx, jsxs } from "react/jsx-runtime";
import { Bike, Briefcase, Calendar, Car, Package, Plane, Truck, UtensilsCrossed } from "lucide-react";
//#region src/routes/services.tsx?tsr-split=component
var services = [
	{
		icon: Car,
		label: "Ride",
		desc: "Get a car in minutes"
	},
	{
		icon: Calendar,
		label: "Reserve",
		desc: "Plan ahead, save time"
	},
	{
		icon: UtensilsCrossed,
		label: "Eats",
		desc: "Food delivered fast"
	},
	{
		icon: Package,
		label: "Package",
		desc: "Send across town"
	},
	{
		icon: Plane,
		label: "Airport",
		desc: "Curbside pickup"
	},
	{
		icon: Bike,
		label: "Bike",
		desc: "Cheaper short trips"
	},
	{
		icon: Truck,
		label: "Moving",
		desc: "Help with big loads"
	},
	{
		icon: Briefcase,
		label: "Business",
		desc: "For your team"
	}
];
function Services() {
	return /* @__PURE__ */ jsxs(PhoneShell, { children: [
		/* @__PURE__ */ jsxs("div", {
			className: "hero-gradient text-primary-foreground px-5 pt-4 pb-8 rounded-b-[2rem]",
			children: [/* @__PURE__ */ jsx("h1", {
				className: "text-2xl font-bold tracking-tight",
				children: "Services"
			}), /* @__PURE__ */ jsx("p", {
				className: "text-sm opacity-85 mt-1",
				children: "Everything Vura can do for you."
			})]
		}),
		/* @__PURE__ */ jsxs("div", {
			className: "px-5 mt-5",
			children: [/* @__PURE__ */ jsx("div", {
				className: "grid grid-cols-2 gap-3",
				children: services.map((s) => /* @__PURE__ */ jsxs(Link, {
					to: "/search",
					className: "rounded-md border border-border bg-surface p-4 border border-border shadow-sm hover:border-primary/40 transition",
					children: [
						/* @__PURE__ */ jsx("span", {
							className: "grid place-items-center h-11 w-11 rounded-xl bg-accent text-primary",
							children: /* @__PURE__ */ jsx(s.icon, { className: "h-5 w-5" })
						}),
						/* @__PURE__ */ jsx("p", {
							className: "mt-3 text-sm font-bold",
							children: s.label
						}),
						/* @__PURE__ */ jsx("p", {
							className: "text-xs text-muted-foreground",
							children: s.desc
						})
					]
				}, s.label))
			}), /* @__PURE__ */ jsxs("div", {
				className: "mt-6 rounded-2xl hero-gradient text-primary-foreground p-5 shadow-float",
				children: [
					/* @__PURE__ */ jsx("p", {
						className: "text-xs font-bold uppercase tracking-wider opacity-80",
						children: "Vura One"
					}),
					/* @__PURE__ */ jsx("h3", {
						className: "text-lg font-bold mt-1",
						children: "Save 10% on every ride"
					}),
					/* @__PURE__ */ jsx("p", {
						className: "text-xs opacity-85 mt-1",
						children: "Membership perks across rides & eats."
					}),
					/* @__PURE__ */ jsx("button", {
						className: "mt-3 rounded-full bg-surface text-primary px-4 py-2 text-xs font-bold",
						children: "Try free for 30 days"
					})
				]
			})]
		}),
		/* @__PURE__ */ jsx("div", { className: "h-6" })
	] });
}
//#endregion
export { Services as component };
