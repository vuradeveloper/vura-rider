import { n as PhoneShell, t as FakeMap } from "./PhoneShell-BHLURtmB.js";
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { jsx, jsxs } from "react/jsx-runtime";
import { ArrowLeft, Banknote, CreditCard, Crown, Tag, Users, X, Zap } from "lucide-react";
//#region src/routes/ride.options.tsx?tsr-split=component
var rides = [
	{
		id: "go",
		name: "VuraGo",
		desc: "Affordable, everyday rides",
		eta: "3 min",
		price: "R12.40",
		icon: Users
	},
	{
		id: "x",
		name: "VuraX",
		desc: "Faster pickups, comfy cars",
		eta: "4 min",
		price: "R15.90",
		icon: Zap,
		badge: "Popular"
	},
	{
		id: "lux",
		name: "VuraLux",
		desc: "Premium cars, top-rated drivers",
		eta: "6 min",
		price: "R24.50",
		icon: Crown
	}
];
var paymentOptions = [
	{
		type: "card",
		last4: "4242"
	},
	{
		type: "card",
		last4: "1234"
	},
	{ type: "cash" }
];
function RideOptions() {
	const [selected, setSelected] = useState("x");
	const [showPayment, setShowPayment] = useState(false);
	const [paymentMethod, setPaymentMethod] = useState(paymentOptions[0]);
	return /* @__PURE__ */ jsxs(PhoneShell, {
		hideTabs: true,
		children: [
			/* @__PURE__ */ jsxs("div", {
				className: "relative",
				children: [/* @__PURE__ */ jsx(FakeMap, { height: 260 }), /* @__PURE__ */ jsx(Link, {
					to: "/search",
					className: "absolute top-3 left-4 grid place-items-center h-9 w-9 rounded-full bg-surface border border-border shadow-sm",
					children: /* @__PURE__ */ jsx(ArrowLeft, { className: "h-4 w-4" })
				})]
			}),
			/* @__PURE__ */ jsxs("div", {
				className: "-mt-5 rounded-t-3xl bg-surface px-5 pt-5 pb-4 shadow-float flex-1 flex flex-col",
				children: [
					/* @__PURE__ */ jsx("div", { className: "mx-auto h-1.5 w-12 rounded-full bg-border mb-4" }),
					/* @__PURE__ */ jsx("h2", {
						className: "text-lg font-bold mb-1",
						children: "Choose a ride"
					}),
					/* @__PURE__ */ jsx("p", {
						className: "text-xs text-muted-foreground mb-3",
						children: "Recommended for your trip"
					}),
					/* @__PURE__ */ jsx("div", {
						className: "space-y-2 flex-1",
						children: rides.map((r) => {
							const Icon = r.icon;
							const active = selected === r.id;
							return /* @__PURE__ */ jsxs("button", {
								onClick: () => setSelected(r.id),
								className: `w-full flex items-center gap-3 rounded-2xl border px-3.5 py-3 text-left transition ${active ? "border-primary bg-accent shadow-sm" : "border-border bg-surface"}`,
								children: [
									/* @__PURE__ */ jsx("span", {
										className: `grid place-items-center h-12 w-12 rounded-xl ${active ? "bg-primary text-primary-foreground" : "bg-secondary text-foreground"}`,
										children: /* @__PURE__ */ jsx(Icon, { className: "h-5 w-5" })
									}),
									/* @__PURE__ */ jsxs("div", {
										className: "flex-1 min-w-0",
										children: [/* @__PURE__ */ jsxs("div", {
											className: "flex items-center gap-2",
											children: [/* @__PURE__ */ jsx("p", {
												className: "text-sm font-bold",
												children: r.name
											}), r.badge && /* @__PURE__ */ jsx("span", {
												className: "text-[10px] font-bold uppercase rounded-md bg-primary/10 text-primary px-2 py-0.5",
												children: r.badge
											})]
										}), /* @__PURE__ */ jsxs("p", {
											className: "text-xs text-muted-foreground",
											children: [
												r.desc,
												" · ",
												r.eta
											]
										})]
									}),
									/* @__PURE__ */ jsx("p", {
										className: "text-sm font-extrabold",
										children: r.price
									})
								]
							}, r.id);
						})
					}),
					/* @__PURE__ */ jsxs("div", {
						className: "mt-4 flex items-center gap-2",
						children: [/* @__PURE__ */ jsxs("button", {
							onClick: () => setShowPayment(true),
							className: "flex-1 flex items-center justify-center gap-2 rounded-full bg-secondary border border-transparent transition-colors focus-within:bg-background focus-within:border-primary focus:bg-background focus:border-primary px-3 py-2.5 text-xs font-semibold hover:bg-secondary/80 transition",
							children: [paymentMethod.type === "card" ? /* @__PURE__ */ jsx(CreditCard, { className: "h-4 w-4" }) : /* @__PURE__ */ jsx(Banknote, { className: "h-4 w-4" }), paymentMethod.type === "card" ? `•••• ${paymentMethod.last4}` : "Cash"]
						}), /* @__PURE__ */ jsxs("button", {
							className: "flex-1 flex items-center justify-center gap-2 rounded-full bg-secondary border border-transparent transition-colors focus-within:bg-background focus-within:border-primary focus:bg-background focus:border-primary px-3 py-2.5 text-xs font-semibold hover:bg-secondary/80 transition",
							children: [/* @__PURE__ */ jsx(Tag, { className: "h-4 w-4" }), " Add promo"]
						})]
					}),
					/* @__PURE__ */ jsxs(Link, {
						to: "/ride/track",
						className: "mt-3 grid place-items-center rounded-md bg-primary py-4 text-sm font-bold text-primary-foreground shadow-sm active:scale-[0.99] transition",
						children: ["Confirm ", rides.find((r) => r.id === selected)?.name]
					})
				]
			}),
			showPayment && /* @__PURE__ */ jsx("div", {
				className: "absolute inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-end",
				children: /* @__PURE__ */ jsxs("div", {
					className: "w-full bg-surface rounded-t-[2rem] p-5 shadow-float animate-in slide-in-from-bottom",
					children: [/* @__PURE__ */ jsxs("div", {
						className: "flex justify-between items-center mb-4",
						children: [/* @__PURE__ */ jsx("h3", {
							className: "text-lg font-bold",
							children: "Select Payment"
						}), /* @__PURE__ */ jsx("button", {
							onClick: () => setShowPayment(false),
							className: "h-8 w-8 rounded-full bg-secondary grid place-items-center hover:bg-secondary/80 transition",
							children: /* @__PURE__ */ jsx(X, { className: "h-4 w-4" })
						})]
					}), /* @__PURE__ */ jsx("div", {
						className: "space-y-2",
						children: paymentOptions.map((opt, i) => /* @__PURE__ */ jsxs("button", {
							onClick: () => {
								setPaymentMethod(opt);
								setShowPayment(false);
							},
							className: `w-full flex items-center gap-3 p-3 rounded-xl border transition ${paymentMethod.type === opt.type && paymentMethod.last4 === opt.last4 ? "border-primary bg-primary/5" : "border-border bg-surface hover:bg-secondary/50"}`,
							children: [
								/* @__PURE__ */ jsx("div", {
									className: `h-10 w-10 rounded-full grid place-items-center shrink-0 ${opt.type === "card" ? "bg-blue-100 text-blue-600" : "bg-green-100 text-green-600"}`,
									children: opt.type === "card" ? /* @__PURE__ */ jsx(CreditCard, { className: "h-5 w-5" }) : /* @__PURE__ */ jsx(Banknote, { className: "h-5 w-5" })
								}),
								/* @__PURE__ */ jsx("div", {
									className: "flex-1 text-left",
									children: /* @__PURE__ */ jsx("p", {
										className: "text-sm font-bold",
										children: opt.type === "card" ? `•••• ${opt.last4}` : "Cash"
									})
								}),
								paymentMethod.type === opt.type && paymentMethod.last4 === opt.last4 && /* @__PURE__ */ jsx("div", { className: "h-2.5 w-2.5 rounded-md bg-primary" })
							]
						}, i))
					})]
				})
			})
		]
	});
}
//#endregion
export { RideOptions as component };
