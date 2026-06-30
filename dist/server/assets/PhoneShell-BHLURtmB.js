import { Suspense, lazy, useEffect, useState } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { jsx, jsxs } from "react/jsx-runtime";
import { BarChart3, Car, Compass, Home, Receipt, User, Wallet } from "lucide-react";
//#region src/lib/auth.ts
var KEY = "vura.auth.user";
function getUser() {
	if (typeof window === "undefined") return null;
	try {
		const raw = localStorage.getItem(KEY);
		return raw ? JSON.parse(raw) : null;
	} catch {
		return null;
	}
}
function setUser(u) {
	localStorage.setItem(KEY, JSON.stringify(u));
	window.dispatchEvent(new Event("vura:auth"));
}
function clearUser() {
	localStorage.removeItem(KEY);
	window.dispatchEvent(new Event("vura:auth"));
}
function useAuth() {
	const [user, setU] = useState(null);
	useEffect(() => {
		setU(getUser());
		const h = () => setU(getUser());
		window.addEventListener("vura:auth", h);
		window.addEventListener("storage", h);
		return () => {
			window.removeEventListener("vura:auth", h);
			window.removeEventListener("storage", h);
		};
	}, []);
	return user;
}
//#endregion
//#region src/components/AnimatedMap.tsx
var AnimatedMapDynamic = lazy(() => import("./AnimatedMapInner-CWSlAc3E.js"));
function AnimatedMap({ mode = "idle", height = 320, onComplete }) {
	const [isMounted, setIsMounted] = useState(false);
	useEffect(() => {
		setIsMounted(true);
	}, []);
	if (!isMounted) return /* @__PURE__ */ jsx("div", { style: {
		height,
		background: "#f8f9fa",
		width: "100%"
	} });
	return /* @__PURE__ */ jsx(Suspense, {
		fallback: /* @__PURE__ */ jsx("div", { style: {
			height,
			background: "#f8f9fa",
			width: "100%"
		} }),
		children: /* @__PURE__ */ jsx(AnimatedMapDynamic, {
			mode,
			height,
			onComplete
		})
	});
}
//#endregion
//#region src/components/PhoneShell.tsx
function StatusBar() {
	return /* @__PURE__ */ jsxs("div", {
		className: "flex items-center justify-between px-6 pt-3 pb-1 text-xs font-semibold text-foreground/80",
		children: [/* @__PURE__ */ jsx("span", { children: "9:41" }), /* @__PURE__ */ jsxs("span", {
			className: "flex items-center gap-1",
			children: [
				/* @__PURE__ */ jsx("span", { className: "inline-block h-2 w-2 rounded-full bg-foreground/70" }),
				/* @__PURE__ */ jsx("span", { className: "inline-block h-2 w-3 rounded-sm bg-foreground/70" }),
				/* @__PURE__ */ jsx("span", { className: "inline-block h-2 w-5 rounded-sm border border-foreground/70" })
			]
		})]
	});
}
var riderTabs = [
	{
		to: "/",
		label: "Home",
		icon: Home
	},
	{
		to: "/services",
		label: "Services",
		icon: Compass
	},
	{
		to: "/activity",
		label: "Activity",
		icon: Receipt
	},
	{
		to: "/account",
		label: "Account",
		icon: User
	}
];
var driverTabs = [
	{
		to: "/driver",
		label: "Drive",
		icon: Car
	},
	{
		to: "/driver/earnings",
		label: "Earnings",
		icon: Wallet
	},
	{
		to: "/driver/trips",
		label: "Trips",
		icon: BarChart3
	},
	{
		to: "/account",
		label: "Account",
		icon: User
	}
];
function PhoneShell({ children, hideTabs = false }) {
	const pathname = useRouterState({ select: (s) => s.location.pathname });
	const tabs = useAuth()?.role === "driver" ? driverTabs : riderTabs;
	return /* @__PURE__ */ jsx("div", {
		className: "min-h-screen w-full bg-gradient-to-br from-accent via-background to-secondary flex items-start justify-center py-6 px-3 sm:py-12",
		children: /* @__PURE__ */ jsx("div", {
			className: "w-full max-w-[420px] phone-frame relative",
			children: /* @__PURE__ */ jsxs("div", {
				className: "bg-surface min-h-[820px] flex flex-col",
				children: [
					/* @__PURE__ */ jsx(StatusBar, {}),
					/* @__PURE__ */ jsx("div", {
						className: "flex-1 flex flex-col",
						children
					}),
					!hideTabs && /* @__PURE__ */ jsx("nav", {
						className: "sticky bottom-0 grid grid-cols-4 border-t border-border bg-surface/95 backdrop-blur px-2 pt-2 pb-4",
						children: tabs.map((t) => {
							const active = pathname === t.to;
							const Icon = t.icon;
							return /* @__PURE__ */ jsxs(Link, {
								to: t.to,
								className: `flex flex-col items-center gap-1 py-1.5 text-[11px] font-medium transition-colors ${active ? "text-primary" : "text-muted-foreground"}`,
								children: [active ? /* @__PURE__ */ jsx("span", {
									className: "grid place-items-center h-9 w-9 rounded-md bg-primary text-primary-foreground shadow-soft -mt-5",
									children: /* @__PURE__ */ jsx(Icon, { className: "h-4 w-4" })
								}) : /* @__PURE__ */ jsx(Icon, { className: "h-5 w-5" }), /* @__PURE__ */ jsx("span", { children: t.label })]
							}, t.to);
						})
					})
				]
			})
		})
	});
}
function FakeMap({ height = 320, mode = "idle", onComplete }) {
	return /* @__PURE__ */ jsx(AnimatedMap, {
		height,
		mode,
		onComplete
	});
}
//#endregion
export { useAuth as a, setUser as i, PhoneShell as n, clearUser as r, FakeMap as t };
