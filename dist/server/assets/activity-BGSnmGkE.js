import { n as PhoneShell } from "./PhoneShell-BHLURtmB.js";
import { jsx, jsxs } from "react/jsx-runtime";
import { Car, ChevronRight, Package, UtensilsCrossed } from "lucide-react";
//#region src/routes/activity.tsx?tsr-split=component
var trips = [
	{
		icon: Car,
		title: "Heathrow Airport",
		date: "Today · 9:14 AM",
		price: "R42.80",
		status: "Completed"
	},
	{
		icon: UtensilsCrossed,
		title: "Dishoom Shoreditch",
		date: "Yesterday · 7:42 PM",
		price: "R28.30",
		status: "Delivered"
	},
	{
		icon: Car,
		title: "Canary Wharf",
		date: "Mon · 8:02 AM",
		price: "R17.50",
		status: "Completed"
	},
	{
		icon: Package,
		title: "Package to Camden",
		date: "Sat · 2:11 PM",
		price: "R9.20",
		status: "Delivered"
	},
	{
		icon: Car,
		title: "British Museum",
		date: "Fri · 11:30 AM",
		price: "R11.10",
		status: "Completed"
	}
];
function Activity() {
	return /* @__PURE__ */ jsxs(PhoneShell, { children: [
		/* @__PURE__ */ jsxs("div", {
			className: "hero-gradient text-primary-foreground px-5 pt-4 pb-8 rounded-b-[2rem]",
			children: [
				/* @__PURE__ */ jsx("h1", {
					className: "text-2xl font-bold tracking-tight",
					children: "Activity"
				}),
				/* @__PURE__ */ jsx("p", {
					className: "text-sm opacity-85 mt-1",
					children: "Your past trips and orders."
				}),
				/* @__PURE__ */ jsx("div", {
					className: "mt-4 grid grid-cols-3 gap-2 rounded-2xl bg-white/15 p-1",
					children: [
						"Past",
						"Upcoming",
						"Drafts"
					].map((t, i) => /* @__PURE__ */ jsx("button", {
						className: `rounded-xl py-2 text-xs font-bold ${i === 0 ? "bg-surface text-primary" : "text-primary-foreground/90"}`,
						children: t
					}, t))
				})
			]
		}),
		/* @__PURE__ */ jsx("div", {
			className: "px-5 mt-5 space-y-2",
			children: trips.map((t, i) => /* @__PURE__ */ jsxs("button", {
				className: "w-full flex items-center gap-3 rounded-2xl bg-surface border border-border p-3.5 text-left hover:border-primary/40 transition",
				children: [
					/* @__PURE__ */ jsx("span", {
						className: "grid place-items-center h-12 w-12 rounded-full bg-secondary border border-transparent transition-colors focus-within:bg-background focus-within:border-primary focus:bg-background focus:border-primary text-foreground",
						children: /* @__PURE__ */ jsx(t.icon, { className: "h-5 w-5" })
					}),
					/* @__PURE__ */ jsxs("div", {
						className: "flex-1 min-w-0",
						children: [/* @__PURE__ */ jsx("p", {
							className: "text-sm font-bold truncate",
							children: t.title
						}), /* @__PURE__ */ jsxs("p", {
							className: "text-xs text-muted-foreground",
							children: [
								t.date,
								" · ",
								t.status
							]
						})]
					}),
					/* @__PURE__ */ jsxs("div", {
						className: "text-right",
						children: [/* @__PURE__ */ jsx("p", {
							className: "text-sm font-extrabold",
							children: t.price
						}), /* @__PURE__ */ jsx(ChevronRight, { className: "h-4 w-4 text-muted-foreground inline" })]
					})
				]
			}, i))
		}),
		/* @__PURE__ */ jsx("div", { className: "h-6" })
	] });
}
//#endregion
export { Activity as component };
