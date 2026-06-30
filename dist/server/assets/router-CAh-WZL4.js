import { useEffect } from "react";
import { HeadContent, Link, Outlet, Scripts, createFileRoute, createRootRouteWithContext, createRouter, lazyRouteComponent, useRouter } from "@tanstack/react-router";
import { jsx, jsxs } from "react/jsx-runtime";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
//#region src/styles.css?url
var styles_default = "/assets/styles-4WDUqBSm.css";
//#endregion
//#region src/lib/lovable-error-reporting.ts
function reportLovableError(error, context = {}) {
	if (typeof window === "undefined") return;
	window.__lovableEvents?.captureException?.(error, {
		source: "react_error_boundary",
		route: window.location.pathname,
		...context
	}, {
		mechanism: "react_error_boundary",
		handled: false,
		severity: "error"
	});
}
//#endregion
//#region src/routes/__root.tsx
function NotFoundComponent() {
	return /* @__PURE__ */ jsx("div", {
		className: "flex min-h-screen items-center justify-center bg-background px-4",
		children: /* @__PURE__ */ jsxs("div", {
			className: "max-w-md text-center",
			children: [
				/* @__PURE__ */ jsx("h1", {
					className: "text-7xl font-bold text-foreground",
					children: "404"
				}),
				/* @__PURE__ */ jsx("p", {
					className: "mt-2 text-sm text-muted-foreground",
					children: "This screen doesn't exist."
				}),
				/* @__PURE__ */ jsx(Link, {
					to: "/",
					className: "mt-6 inline-flex rounded-md bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground",
					children: "Back home"
				})
			]
		})
	});
}
function ErrorComponent({ error, reset }) {
	const router = useRouter();
	useEffect(() => {
		reportLovableError(error, { boundary: "tanstack_root_error_component" });
	}, [error]);
	return /* @__PURE__ */ jsx("div", {
		className: "flex min-h-screen items-center justify-center bg-background px-4",
		children: /* @__PURE__ */ jsxs("div", {
			className: "max-w-md text-center",
			children: [/* @__PURE__ */ jsx("h1", {
				className: "text-xl font-semibold",
				children: "Something went wrong"
			}), /* @__PURE__ */ jsx("button", {
				onClick: () => {
					router.invalidate();
					reset();
				},
				className: "mt-6 rounded-md bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground",
				children: "Try again"
			})]
		})
	});
}
var Route$17 = createRootRouteWithContext()({
	head: () => ({
		meta: [
			{ charSet: "utf-8" },
			{
				name: "viewport",
				content: "width=device-width, initial-scale=1"
			},
			{ title: "Vura — Rides on demand" },
			{
				name: "description",
				content: "Book a ride, order food, send packages — all in one app."
			},
			{
				property: "og:title",
				content: "Vura — Rides on demand"
			},
			{
				property: "og:description",
				content: "Book a ride, order food, send packages — all in one app."
			}
		],
		links: [
			{
				rel: "stylesheet",
				href: styles_default
			},
			{
				rel: "preconnect",
				href: "https://fonts.googleapis.com"
			},
			{
				rel: "preconnect",
				href: "https://fonts.gstatic.com",
				crossOrigin: "anonymous"
			},
			{
				rel: "stylesheet",
				href: "https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap"
			}
		]
	}),
	shellComponent: RootShell,
	component: RootComponent,
	notFoundComponent: NotFoundComponent,
	errorComponent: ErrorComponent
});
function RootShell({ children }) {
	return /* @__PURE__ */ jsxs("html", {
		lang: "en",
		children: [/* @__PURE__ */ jsx("head", { children: /* @__PURE__ */ jsx(HeadContent, {}) }), /* @__PURE__ */ jsxs("body", { children: [children, /* @__PURE__ */ jsx(Scripts, {})] })]
	});
}
function RootComponent() {
	const { queryClient } = Route$17.useRouteContext();
	return /* @__PURE__ */ jsx(QueryClientProvider, {
		client: queryClient,
		children: /* @__PURE__ */ jsx(Outlet, {})
	});
}
//#endregion
//#region src/routes/welcome.tsx
var $$splitComponentImporter$16 = () => import("./welcome-CvYHh3w_.js");
var Route$16 = createFileRoute("/welcome")({
	head: () => ({ meta: [{ title: "Welcome to Vura Ride" }] }),
	component: lazyRouteComponent($$splitComponentImporter$16, "component")
});
//#endregion
//#region src/routes/wallet.tsx
var $$splitComponentImporter$15 = () => import("./wallet-2d-Tukmz.js");
var Route$15 = createFileRoute("/wallet")({
	head: () => ({ meta: [{ title: "Wallet — Vura" }] }),
	component: lazyRouteComponent($$splitComponentImporter$15, "component")
});
//#endregion
//#region src/routes/signup.tsx
var $$splitComponentImporter$14 = () => import("./signup-DZJKXcQp.js");
var Route$14 = createFileRoute("/signup")({
	head: () => ({ meta: [{ title: "Create account — Vura" }] }),
	component: lazyRouteComponent($$splitComponentImporter$14, "component")
});
//#endregion
//#region src/routes/settings.tsx
var $$splitComponentImporter$13 = () => import("./settings-DCRekdns.js");
var Route$13 = createFileRoute("/settings")({
	head: () => ({ meta: [{ title: "Settings — Vura" }] }),
	component: lazyRouteComponent($$splitComponentImporter$13, "component")
});
//#endregion
//#region src/routes/services.tsx
var $$splitComponentImporter$12 = () => import("./services-CbkMXa5J.js");
var Route$12 = createFileRoute("/services")({
	head: () => ({ meta: [{ title: "Services — Vura" }] }),
	component: lazyRouteComponent($$splitComponentImporter$12, "component")
});
//#endregion
//#region src/routes/search.tsx
var $$splitComponentImporter$11 = () => import("./search-sMY05XhX.js");
var Route$11 = createFileRoute("/search")({
	head: () => ({ meta: [{ title: "Where to? — Vura" }] }),
	component: lazyRouteComponent($$splitComponentImporter$11, "component")
});
//#endregion
//#region src/routes/safety.tsx
var $$splitComponentImporter$10 = () => import("./safety-C6KTCRix.js");
var Route$10 = createFileRoute("/safety")({
	head: () => ({ meta: [{ title: "Safety — Vura" }] }),
	component: lazyRouteComponent($$splitComponentImporter$10, "component")
});
//#endregion
//#region src/routes/promotions.tsx
var $$splitComponentImporter$9 = () => import("./promotions-B_xhL06m.js");
var Route$9 = createFileRoute("/promotions")({
	head: () => ({ meta: [{ title: "Promotions — Vura" }] }),
	component: lazyRouteComponent($$splitComponentImporter$9, "component")
});
//#endregion
//#region src/routes/login.tsx
var $$splitComponentImporter$8 = () => import("./login-xbOCPo9q.js");
var Route$8 = createFileRoute("/login")({
	head: () => ({ meta: [{ title: "Sign in — Vura" }] }),
	component: lazyRouteComponent($$splitComponentImporter$8, "component")
});
//#endregion
//#region src/routes/help.tsx
var $$splitComponentImporter$7 = () => import("./help-BqQG6UgJ.js");
var Route$7 = createFileRoute("/help")({
	head: () => ({ meta: [{ title: "Help — Vura" }] }),
	component: lazyRouteComponent($$splitComponentImporter$7, "component")
});
//#endregion
//#region src/routes/car-scanner.tsx
var $$splitComponentImporter$6 = () => import("./car-scanner-CBQF51-j.js");
var Route$6 = createFileRoute("/car-scanner")({
	head: () => ({ meta: [{ title: "Car Scanner — Vura" }] }),
	component: lazyRouteComponent($$splitComponentImporter$6, "component"),
	validateSearch: (s) => ({ complaint: typeof s.complaint === "string" ? s.complaint : void 0 })
});
//#endregion
//#region src/routes/architecture.tsx
var $$splitComponentImporter$5 = () => import("./architecture-B8mUdpZx.js");
var Route$5 = createFileRoute("/architecture")({
	head: () => ({ meta: [{ title: "System Architecture — Vura" }] }),
	component: lazyRouteComponent($$splitComponentImporter$5, "component")
});
//#endregion
//#region src/routes/activity.tsx
var $$splitComponentImporter$4 = () => import("./activity-BGSnmGkE.js");
var Route$4 = createFileRoute("/activity")({
	head: () => ({ meta: [{ title: "Activity — Vura" }] }),
	component: lazyRouteComponent($$splitComponentImporter$4, "component")
});
//#endregion
//#region src/routes/account.tsx
var $$splitComponentImporter$3 = () => import("./account-DqncikTw.js");
var Route$3 = createFileRoute("/account")({
	head: () => ({ meta: [{ title: "Account — Vura" }] }),
	component: lazyRouteComponent($$splitComponentImporter$3, "component")
});
//#endregion
//#region src/routes/index.tsx
var $$splitComponentImporter$2 = () => import("./routes-A-jsXk7n.js");
var Route$2 = createFileRoute("/")({
	head: () => ({ meta: [{ title: "Vura — Get there, your way" }, {
		name: "description",
		content: "Request a ride in seconds. Track your driver in real time."
	}] }),
	component: lazyRouteComponent($$splitComponentImporter$2, "component")
});
//#endregion
//#region src/routes/ride.track.tsx
var $$splitComponentImporter$1 = () => import("./ride.track-HsaCSFA9.js");
var Route$1 = createFileRoute("/ride/track")({
	head: () => ({ meta: [{ title: "Your driver is on the way — Vura" }] }),
	component: lazyRouteComponent($$splitComponentImporter$1, "component")
});
//#endregion
//#region src/routes/ride.options.tsx
var $$splitComponentImporter = () => import("./ride.options-zGJbSat3.js");
var Route = createFileRoute("/ride/options")({
	head: () => ({ meta: [{ title: "Choose your ride — Vura" }] }),
	component: lazyRouteComponent($$splitComponentImporter, "component")
});
//#endregion
//#region src/routeTree.gen.ts
var WelcomeRoute = Route$16.update({
	id: "/welcome",
	path: "/welcome",
	getParentRoute: () => Route$17
});
var WalletRoute = Route$15.update({
	id: "/wallet",
	path: "/wallet",
	getParentRoute: () => Route$17
});
var SignupRoute = Route$14.update({
	id: "/signup",
	path: "/signup",
	getParentRoute: () => Route$17
});
var SettingsRoute = Route$13.update({
	id: "/settings",
	path: "/settings",
	getParentRoute: () => Route$17
});
var ServicesRoute = Route$12.update({
	id: "/services",
	path: "/services",
	getParentRoute: () => Route$17
});
var SearchRoute = Route$11.update({
	id: "/search",
	path: "/search",
	getParentRoute: () => Route$17
});
var SafetyRoute = Route$10.update({
	id: "/safety",
	path: "/safety",
	getParentRoute: () => Route$17
});
var PromotionsRoute = Route$9.update({
	id: "/promotions",
	path: "/promotions",
	getParentRoute: () => Route$17
});
var LoginRoute = Route$8.update({
	id: "/login",
	path: "/login",
	getParentRoute: () => Route$17
});
var HelpRoute = Route$7.update({
	id: "/help",
	path: "/help",
	getParentRoute: () => Route$17
});
var CarScannerRoute = Route$6.update({
	id: "/car-scanner",
	path: "/car-scanner",
	getParentRoute: () => Route$17
});
var ArchitectureRoute = Route$5.update({
	id: "/architecture",
	path: "/architecture",
	getParentRoute: () => Route$17
});
var ActivityRoute = Route$4.update({
	id: "/activity",
	path: "/activity",
	getParentRoute: () => Route$17
});
var AccountRoute = Route$3.update({
	id: "/account",
	path: "/account",
	getParentRoute: () => Route$17
});
var IndexRoute = Route$2.update({
	id: "/",
	path: "/",
	getParentRoute: () => Route$17
});
var RideTrackRoute = Route$1.update({
	id: "/ride/track",
	path: "/ride/track",
	getParentRoute: () => Route$17
});
var rootRouteChildren = {
	IndexRoute,
	AccountRoute,
	ActivityRoute,
	ArchitectureRoute,
	CarScannerRoute,
	HelpRoute,
	LoginRoute,
	PromotionsRoute,
	SafetyRoute,
	SearchRoute,
	ServicesRoute,
	SettingsRoute,
	SignupRoute,
	WalletRoute,
	WelcomeRoute,
	RideOptionsRoute: Route.update({
		id: "/ride/options",
		path: "/ride/options",
		getParentRoute: () => Route$17
	}),
	RideTrackRoute
};
var routeTree = Route$17._addFileChildren(rootRouteChildren)._addFileTypes();
//#endregion
//#region src/router.tsx
var getRouter = () => {
	return createRouter({
		routeTree,
		context: { queryClient: new QueryClient() },
		scrollRestoration: true,
		defaultPreloadStaleTime: 0
	});
};
//#endregion
export { getRouter };
