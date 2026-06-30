import { n as PhoneShell } from "./PhoneShell-BHLURtmB.js";
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { jsx, jsxs } from "react/jsx-runtime";
import { AlertCircle, ArrowLeft, Car, ChevronRight, MessageSquare, Receipt } from "lucide-react";
//#region src/routes/help.tsx?tsr-split=component
function HelpPage() {
	const [activeTopic, setActiveTopic] = useState(null);
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
				children: "Help"
			})]
		}), /* @__PURE__ */ jsxs("div", {
			className: "px-5 mt-6 flex-1 flex flex-col pb-6 space-y-6 overflow-y-auto",
			children: [/* @__PURE__ */ jsxs("div", { children: [
				/* @__PURE__ */ jsx("h2", {
					className: "text-sm font-extrabold text-foreground mb-3",
					children: "Recent Trip"
				}),
				/* @__PURE__ */ jsxs("div", {
					className: "rounded-2xl bg-surface border border-border shadow-sm p-4 border border-border flex items-center justify-between cursor-pointer hover:border-primary/40 transition",
					children: [/* @__PURE__ */ jsxs("div", {
						className: "flex items-center gap-4",
						children: [/* @__PURE__ */ jsxs("div", {
							className: "h-12 w-12 rounded-full bg-secondary border border-transparent transition-colors focus-within:bg-background focus-within:border-primary focus:bg-background focus:border-primary flex flex-col items-center justify-center",
							children: [/* @__PURE__ */ jsx("span", {
								className: "text-[10px] uppercase font-bold text-muted-foreground leading-none",
								children: "Jun"
							}), /* @__PURE__ */ jsx("span", {
								className: "text-lg font-extrabold text-foreground leading-tight",
								children: "19"
							})]
						}), /* @__PURE__ */ jsxs("div", { children: [/* @__PURE__ */ jsx("p", {
							className: "text-sm font-bold",
							children: "Toyota Prius"
						}), /* @__PURE__ */ jsx("p", {
							className: "text-xs text-muted-foreground mt-0.5",
							children: "R 15.90 • Cancelled"
						})] })]
					}), /* @__PURE__ */ jsx(ChevronRight, { className: "h-4 w-4 text-muted-foreground" })]
				}),
				/* @__PURE__ */ jsx("button", {
					className: "mt-2 text-xs font-bold text-primary w-full text-left ml-2",
					children: "View all past trips"
				})
			] }), /* @__PURE__ */ jsxs("div", { children: [/* @__PURE__ */ jsx("h2", {
				className: "text-sm font-extrabold text-foreground mb-3",
				children: "All topics"
			}), /* @__PURE__ */ jsx("div", {
				className: "rounded-2xl bg-surface border border-border divide-y divide-border overflow-hidden shadow-sm",
				children: [
					{
						id: "trip",
						icon: Car,
						title: "Trip Issues and Refunds"
					},
					{
						id: "account",
						icon: Receipt,
						title: "Account and Payment Options"
					},
					{
						id: "safety",
						icon: AlertCircle,
						title: "Report a Safety Incident"
					},
					{
						id: "support",
						icon: MessageSquare,
						title: "Support Messages"
					}
				].map((t) => /* @__PURE__ */ jsxs("div", { children: [/* @__PURE__ */ jsxs("div", {
					onClick: () => setActiveTopic(activeTopic === t.id ? null : t.id),
					className: "flex items-center gap-3 p-4 active:bg-secondary/50 transition cursor-pointer",
					children: [
						/* @__PURE__ */ jsx("div", {
							className: "h-8 w-8 rounded-full bg-secondary text-foreground grid place-items-center shrink-0",
							children: /* @__PURE__ */ jsx(t.icon, { className: "h-4 w-4" })
						}),
						/* @__PURE__ */ jsx("p", {
							className: "text-sm font-bold flex-1 min-w-0",
							children: t.title
						}),
						/* @__PURE__ */ jsx(ChevronRight, { className: `h-4 w-4 text-muted-foreground transition-transform ${activeTopic === t.id ? "rotate-90" : ""}` })
					]
				}), activeTopic === t.id && /* @__PURE__ */ jsx("div", {
					className: "px-4 pb-4 animate-in slide-in-from-top-2",
					children: /* @__PURE__ */ jsxs("div", {
						className: "rounded-full bg-secondary border border-transparent transition-colors focus-within:bg-background focus-within:border-primary focus:bg-background focus:border-primary p-4 border border-border",
						children: [
							/* @__PURE__ */ jsx("p", {
								className: "text-sm font-bold text-foreground",
								children: "Support Assistant"
							}),
							/* @__PURE__ */ jsxs("p", {
								className: "text-xs text-muted-foreground mt-1",
								children: [
									"Our team is available to assist you with ",
									t.title.toLowerCase(),
									". We typically reply within 2 hours."
								]
							}),
							/* @__PURE__ */ jsx("button", {
								onClick: () => alert("Connecting to support..."),
								className: "mt-3 text-xs font-bold bg-primary text-primary-foreground px-3 py-1.5 rounded-lg shadow-sm",
								children: "Contact Support"
							})
						]
					})
				})] }, t.id))
			})] })]
		})]
	});
}
//#endregion
export { HelpPage as component };
