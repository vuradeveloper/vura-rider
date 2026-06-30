import { a as useAuth, i as setUser, n as PhoneShell, r as clearUser } from "./PhoneShell-BHLURtmB.js";
import { useEffect, useState } from "react";
import { Link, Navigate, useNavigate } from "@tanstack/react-router";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { AlertTriangle, BadgeCheck, Car, ChevronRight, Gift, HelpCircle, LogOut, RefreshCw, Settings, Shield, ShieldCheck, Star, Wallet } from "lucide-react";
//#region src/routes/account.tsx?tsr-split=component
var items = [
	{
		icon: Wallet,
		label: "Wallet",
		sub: "•••• 4242 · R24.10 credits",
		to: "/wallet",
		wide: true
	},
	{
		icon: Gift,
		label: "Promotions",
		sub: "2 active offers",
		to: "/promotions",
		wide: false
	},
	{
		icon: Shield,
		label: "Safety",
		sub: "Trusted contacts, RideCheck",
		to: "/safety",
		wide: false
	},
	{
		icon: Settings,
		label: "Settings",
		sub: "Notifications, privacy",
		to: "/settings",
		wide: false
	},
	{
		icon: HelpCircle,
		label: "Help",
		sub: "Past trips, support",
		to: "/help",
		wide: false
	}
];
function Account() {
	const user = useAuth();
	const nav = useNavigate();
	const [ready, setReady] = useState(false);
	useEffect(() => setReady(true), []);
	if (!ready) return null;
	if (!user) return /* @__PURE__ */ jsx(Navigate, { to: "/welcome" });
	const initials = user.name.split(" ").map((p) => p[0]).join("").slice(0, 2).toUpperCase();
	const isVerified = Boolean(user.idNumber && (user.role === "driver" ? user.licenseDocumentName : user.idDocumentName));
	function signOut() {
		clearUser();
		nav({ to: "/welcome" });
	}
	function switchRole() {
		setUser({
			...user,
			role: user.role === "driver" ? "rider" : "driver"
		});
		nav({ to: user.role === "driver" ? "/" : "/driver" });
	}
	return /* @__PURE__ */ jsxs(PhoneShell, { children: [
		/* @__PURE__ */ jsxs("div", {
			className: "hero-gradient text-primary-foreground px-5 pt-4 pb-12 rounded-b-[2rem] relative overflow-hidden",
			children: [
				/* @__PURE__ */ jsx("div", { className: "absolute -right-12 -bottom-10 h-44 w-44 rounded-full bg-white/10" }),
				/* @__PURE__ */ jsx("h1", {
					className: "text-xl font-bold tracking-tight",
					children: "Account"
				}),
				/* @__PURE__ */ jsxs("div", {
					className: "mt-4 flex items-center gap-3 relative",
					children: [/* @__PURE__ */ jsx("div", {
						className: "h-16 w-16 rounded-full bg-surface text-primary grid place-items-center text-xl font-extrabold border border-border shadow-sm",
						children: initials || "U"
					}), /* @__PURE__ */ jsxs("div", { children: [
						/* @__PURE__ */ jsxs("div", {
							className: "flex items-center gap-2",
							children: [/* @__PURE__ */ jsx("p", {
								className: "text-lg font-bold",
								children: user.name
							}), isVerified && /* @__PURE__ */ jsxs("span", {
								className: "inline-flex items-center gap-1 rounded-full bg-[#10b981]/20 text-[#10b981] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider",
								children: [/* @__PURE__ */ jsx(BadgeCheck, { className: "h-3 w-3" }), " Verified"]
							})]
						}),
						/* @__PURE__ */ jsx("p", {
							className: "text-xs opacity-85 mt-0.5",
							children: user.email
						}),
						/* @__PURE__ */ jsxs("p", {
							className: "text-xs mt-1 inline-flex items-center gap-1 rounded-full bg-white/20 px-2 py-0.5 font-semibold capitalize",
							children: [
								/* @__PURE__ */ jsx(Star, { className: "h-3 w-3 fill-current" }),
								" 4.92 · ",
								user.role
							]
						})
					] })]
				})
			]
		}),
		/* @__PURE__ */ jsxs("div", {
			className: "px-5 -mt-6",
			children: [/* @__PURE__ */ jsx("div", {
				className: "grid grid-cols-3 gap-3 rounded-2xl bg-surface border border-border shadow-sm p-4 text-center",
				children: [
					{
						v: "128",
						l: "Trips"
					},
					{
						v: "R24",
						l: "Credits"
					},
					{
						v: "Gold",
						l: "Tier"
					}
				].map((s) => /* @__PURE__ */ jsxs("div", { children: [/* @__PURE__ */ jsx("p", {
					className: "text-lg font-extrabold",
					children: s.v
				}), /* @__PURE__ */ jsx("p", {
					className: "text-[11px] text-muted-foreground uppercase tracking-wider font-semibold",
					children: s.l
				})] }, s.l))
			}), /* @__PURE__ */ jsxs("div", {
				className: "mt-5 grid grid-cols-2 gap-3",
				children: [
					/* @__PURE__ */ jsxs("button", {
						onClick: switchRole,
						className: "col-span-2 rounded-xl bg-surface border border-border p-4 flex items-center gap-3 text-left shadow-sm hover:border-primary/40 transition",
						children: [
							/* @__PURE__ */ jsx("span", {
								className: "grid place-items-center h-10 w-10 rounded-full bg-accent text-primary shrink-0",
								children: /* @__PURE__ */ jsx(RefreshCw, { className: "h-4 w-4" })
							}),
							/* @__PURE__ */ jsxs("div", {
								className: "flex-1 min-w-0",
								children: [/* @__PURE__ */ jsxs("p", {
									className: "text-sm font-bold",
									children: ["Switch to ", user.role === "driver" ? "rider" : "driver"]
								}), /* @__PURE__ */ jsx("p", {
									className: "text-xs text-muted-foreground",
									children: "Try the other side of Vura"
								})]
							}),
							/* @__PURE__ */ jsx(ChevronRight, { className: "h-4 w-4 text-muted-foreground shrink-0" })
						]
					}),
					user.role === "driver" && /* @__PURE__ */ jsxs(Fragment, { children: [/* @__PURE__ */ jsxs("button", {
						onClick: () => nav({ to: "/car-scanner" }),
						className: "col-span-2 rounded-xl bg-surface border border-border p-4 flex items-center justify-between shadow-sm hover:border-primary/40 transition",
						children: [/* @__PURE__ */ jsxs("div", {
							className: "flex items-center gap-3",
							children: [/* @__PURE__ */ jsx("span", {
								className: "grid place-items-center h-10 w-10 rounded-full bg-accent text-primary shrink-0",
								children: /* @__PURE__ */ jsx(Car, { className: "h-4 w-4" })
							}), /* @__PURE__ */ jsxs("div", { children: [/* @__PURE__ */ jsx("p", {
								className: "text-sm font-bold",
								children: "Car Scanner"
							}), /* @__PURE__ */ jsx("p", {
								className: "text-xs text-muted-foreground",
								children: "Inspect your vehicle inside & out"
							})] })]
						}), /* @__PURE__ */ jsx(ChevronRight, { className: "h-4 w-4 text-muted-foreground shrink-0" })]
					}), /* @__PURE__ */ jsxs("button", {
						onClick: () => nav({
							to: "/car-scanner",
							search: { complaint: "true" }
						}),
						className: "col-span-2 rounded-xl bg-surface border border-red-200 p-4 flex items-center justify-between shadow-sm hover:border-red-400 transition",
						children: [/* @__PURE__ */ jsxs("div", {
							className: "flex items-center gap-3",
							children: [/* @__PURE__ */ jsx("span", {
								className: "grid place-items-center h-10 w-10 rounded-full bg-red-100 text-red-600 shrink-0",
								children: /* @__PURE__ */ jsx(AlertTriangle, { className: "h-4 w-4" })
							}), /* @__PURE__ */ jsxs("div", { children: [/* @__PURE__ */ jsx("p", {
								className: "text-sm font-bold text-red-700",
								children: "Complaint Scan"
							}), /* @__PURE__ */ jsx("p", {
								className: "text-xs text-muted-foreground",
								children: "Rescan after a rider complaint"
							})] })]
						}), /* @__PURE__ */ jsx(ChevronRight, { className: "h-4 w-4 text-muted-foreground shrink-0" })]
					})] }),
					/* @__PURE__ */ jsxs(Link, {
						to: "/architecture",
						className: "col-span-2 rounded-xl bg-surface border border-border p-4 flex items-center justify-between shadow-sm hover:border-purple-600/40 transition",
						children: [/* @__PURE__ */ jsxs("div", {
							className: "flex items-center gap-3",
							children: [/* @__PURE__ */ jsx("span", {
								className: "grid place-items-center h-10 w-10 rounded-full bg-purple-100 text-purple-600 shrink-0",
								children: /* @__PURE__ */ jsx(ShieldCheck, { className: "h-4 w-4" })
							}), /* @__PURE__ */ jsx("span", {
								className: "text-sm font-bold text-purple-600",
								children: "System Architecture"
							})]
						}), /* @__PURE__ */ jsx(ChevronRight, { className: "h-4 w-4 text-muted-foreground shrink-0" })]
					}),
					items.map((it) => /* @__PURE__ */ jsxs("button", {
						onClick: () => it.to ? nav({ to: it.to }) : alert(`Opening ${it.label}...`),
						className: `${it.wide ? "col-span-2 flex-row items-center justify-between" : "col-span-1 flex-col items-start"} rounded-xl bg-surface border border-border p-4 flex text-left shadow-sm hover:border-primary/40 transition`,
						children: [/* @__PURE__ */ jsxs("div", {
							className: `flex ${it.wide ? "flex-row items-center gap-3 flex-1 min-w-0" : "flex-col items-start gap-3 w-full"}`,
							children: [/* @__PURE__ */ jsx("span", {
								className: "grid place-items-center h-10 w-10 rounded-full bg-accent text-primary shrink-0",
								children: /* @__PURE__ */ jsx(it.icon, { className: "h-4 w-4" })
							}), /* @__PURE__ */ jsxs("div", {
								className: it.wide ? "flex-1 min-w-0" : "w-full",
								children: [/* @__PURE__ */ jsx("p", {
									className: "text-sm font-bold",
									children: it.label
								}), /* @__PURE__ */ jsx("p", {
									className: `text-muted-foreground mt-0.5 leading-tight ${it.wide ? "text-xs truncate" : "text-[10px] line-clamp-2"}`,
									children: it.sub
								})]
							})]
						}), it.wide && /* @__PURE__ */ jsx(ChevronRight, { className: "h-4 w-4 text-muted-foreground shrink-0 ml-3" })]
					}, it.label)),
					/* @__PURE__ */ jsxs("button", {
						onClick: signOut,
						className: "col-span-2 mt-2 flex items-center justify-center gap-2 rounded-xl border border-border bg-surface py-4 text-sm font-bold text-primary shadow-sm hover:bg-primary/5 transition",
						children: [/* @__PURE__ */ jsx(LogOut, { className: "h-4 w-4" }), " Sign out"]
					})
				]
			})]
		}),
		/* @__PURE__ */ jsx("div", { className: "h-6" })
	] });
}
//#endregion
export { Account as component };
