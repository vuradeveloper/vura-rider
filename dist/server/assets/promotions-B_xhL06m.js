import { n as PhoneShell } from "./PhoneShell-BHLURtmB.js";
import { Link } from "@tanstack/react-router";
import { jsx, jsxs } from "react/jsx-runtime";
import { ArrowLeft, ChevronRight, Gift, Tag } from "lucide-react";
//#region src/routes/promotions.tsx?tsr-split=component
function PromotionsPage() {
	return /* @__PURE__ */ jsxs(PhoneShell, {
		hideTabs: true,
		children: [/* @__PURE__ */ jsxs("div", {
			className: "hero-gradient text-primary-foreground px-5 pt-4 pb-8 rounded-b-[2rem] relative",
			children: [/* @__PURE__ */ jsx(Link, {
				to: "/account",
				className: "absolute top-4 left-4 grid place-items-center h-9 w-9 rounded-full bg-white/20 hover:bg-white/30 transition",
				children: /* @__PURE__ */ jsx(ArrowLeft, { className: "h-4 w-4" })
			}), /* @__PURE__ */ jsx("h1", {
				className: "mt-12 text-2xl font-extrabold tracking-tight",
				children: "Promotions"
			})]
		}), /* @__PURE__ */ jsxs("div", {
			className: "px-5 mt-6 flex-1 flex flex-col pb-6 space-y-6 overflow-y-auto",
			children: [
				/* @__PURE__ */ jsxs("div", {
					className: "flex gap-2",
					children: [/* @__PURE__ */ jsx("input", {
						placeholder: "Enter promo code",
						className: "flex-1 rounded-md border border-border bg-surface px-4 py-3.5 text-sm font-semibold transition focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary shadow-sm"
					}), /* @__PURE__ */ jsx("button", {
						className: "rounded-2xl bg-primary px-5 font-bold text-primary-foreground shadow-sm hover:brightness-110 transition",
						children: "Apply"
					})]
				}),
				/* @__PURE__ */ jsxs("div", { children: [/* @__PURE__ */ jsx("h2", {
					className: "text-sm font-extrabold text-foreground mb-3",
					children: "Active Offers"
				}), /* @__PURE__ */ jsx("div", {
					className: "space-y-3",
					children: [{
						title: "20% off your next 3 rides",
						desc: "Up to R50 per ride. Valid until end of month.",
						active: true
					}, {
						title: "R100 Welcome Bonus",
						desc: "Applied automatically on your first ride.",
						active: true
					}].map((p, i) => /* @__PURE__ */ jsxs("div", {
						className: "rounded-2xl bg-surface border border-border p-4 shadow-sm flex items-start gap-4",
						children: [/* @__PURE__ */ jsx("div", {
							className: "h-10 w-10 rounded-full bg-red-100 text-red-600 grid place-items-center shrink-0",
							children: /* @__PURE__ */ jsx(Gift, { className: "h-5 w-5" })
						}), /* @__PURE__ */ jsxs("div", {
							className: "flex-1 min-w-0",
							children: [/* @__PURE__ */ jsx("p", {
								className: "text-sm font-bold",
								children: p.title
							}), /* @__PURE__ */ jsx("p", {
								className: "text-xs text-muted-foreground mt-1 leading-snug",
								children: p.desc
							})]
						})]
					}, i))
				})] }),
				/* @__PURE__ */ jsxs("div", {
					className: "rounded-md bg-secondary/50 p-4 border border-border flex items-center justify-between",
					children: [/* @__PURE__ */ jsxs("div", {
						className: "flex items-center gap-3",
						children: [/* @__PURE__ */ jsx(Tag, { className: "h-5 w-5 text-muted-foreground" }), /* @__PURE__ */ jsx("span", {
							className: "text-sm font-bold text-foreground",
							children: "Past promotions"
						})]
					}), /* @__PURE__ */ jsx(ChevronRight, { className: "h-4 w-4 text-muted-foreground" })]
				})
			]
		})]
	});
}
//#endregion
export { PromotionsPage as component };
