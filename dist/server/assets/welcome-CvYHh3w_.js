import { n as PhoneShell } from "./PhoneShell-BHLURtmB.js";
import { Link } from "@tanstack/react-router";
import { jsx, jsxs } from "react/jsx-runtime";
import { ChevronRight } from "lucide-react";
//#region src/routes/welcome.tsx?tsr-split=component
function Welcome() {
	return /* @__PURE__ */ jsxs(PhoneShell, {
		hideTabs: true,
		children: [/* @__PURE__ */ jsxs("div", {
			className: "hero-gradient text-primary-foreground flex-1 flex flex-col px-6 pt-10 pb-8 rounded-b-[2rem] relative overflow-hidden",
			children: [
				/* @__PURE__ */ jsx("div", { className: "absolute -right-16 -top-10 h-56 w-56 rounded-full bg-white/10" }),
				/* @__PURE__ */ jsx("div", { className: "absolute -left-10 bottom-24 h-40 w-40 rounded-full bg-white/10" }),
				/* @__PURE__ */ jsxs("div", {
					className: "flex items-center gap-2 relative",
					children: [/* @__PURE__ */ jsx("div", {
						className: "grid place-items-center h-18 w-12 overflow-hidden p-1.5",
						children: /* @__PURE__ */ jsx("img", {
							src: "/CarLocator.png",
							className: "h-full w-full object-fill",
							alt: "Car"
						})
					}), /* @__PURE__ */ jsx("span", {
						className: "text-lg font-extrabold tracking-tight",
						children: "Vura Ride"
					})]
				}),
				/* @__PURE__ */ jsxs("div", {
					className: "mt-auto relative",
					children: [/* @__PURE__ */ jsxs("h1", {
						className: "text-3xl font-extrabold leading-tight",
						children: [
							"Go anywhere. ",
							/* @__PURE__ */ jsx("br", {}),
							"Get anything."
						]
					}), /* @__PURE__ */ jsx("p", {
						className: "mt-3 text-sm opacity-90 max-w-[18rem]",
						children: "Request a ride, hop in, and relax. Drive on your terms — earn whenever you want."
					})]
				})
			]
		}), /* @__PURE__ */ jsxs("div", {
			className: "px-6 py-6 space-y-3 bg-surface",
			children: [
				/* @__PURE__ */ jsxs(Link, {
					to: "/signup",
					className: "flex items-center justify-center gap-2 rounded-2xl bg-primary py-4 text-sm font-bold text-primary-foreground shadow-sm",
					children: ["Create an account ", /* @__PURE__ */ jsx(ChevronRight, { className: "h-4 w-4" })]
				}),
				/* @__PURE__ */ jsx(Link, {
					to: "/login",
					className: "flex items-center justify-center rounded-2xl border border-border bg-surface py-4 text-sm font-bold",
					children: "I already have an account"
				}),
				/* @__PURE__ */ jsx("p", {
					className: "text-[11px] text-center text-muted-foreground mt-3 px-4",
					children: "By continuing, you agree to Vura Ride's Terms of Service and Privacy Policy."
				})
			]
		})]
	});
}
//#endregion
export { Welcome as component };
