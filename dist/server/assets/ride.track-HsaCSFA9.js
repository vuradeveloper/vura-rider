import { n as PhoneShell, t as FakeMap } from "./PhoneShell-BHLURtmB.js";
import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { jsx, jsxs } from "react/jsx-runtime";
import { AlertTriangle, MessageCircle, Phone, Share2, Shield, Star, X } from "lucide-react";
//#region src/routes/ride.track.tsx?tsr-split=component
function Track() {
	const navigate = useNavigate();
	const [showCancel, setShowCancel] = useState(false);
	const [isCompleted, setIsCompleted] = useState(false);
	const [rating, setRating] = useState(0);
	return /* @__PURE__ */ jsxs(PhoneShell, {
		hideTabs: true,
		children: [
			/* @__PURE__ */ jsxs("div", {
				className: "relative",
				children: [
					/* @__PURE__ */ jsx(FakeMap, {
						height: 420,
						mode: "track",
						onComplete: () => setIsCompleted(true)
					}),
					/* @__PURE__ */ jsx(Link, {
						to: "/",
						className: "absolute top-3 right-4 grid place-items-center h-9 w-9 rounded-full bg-surface border border-border shadow-sm",
						children: /* @__PURE__ */ jsx(X, { className: "h-4 w-4" })
					}),
					/* @__PURE__ */ jsx("div", {
						className: "absolute top-3 left-1/2 -translate-x-1/2 rounded-full bg-foreground text-background px-4 py-1.5 text-xs font-bold shadow-float",
						children: "Arriving in 3 min"
					}),
					/* @__PURE__ */ jsxs("div", {
						className: "absolute top-14 left-1/2 -translate-x-1/2 rounded-full bg-green-100 border border-green-200 text-green-800 px-3 py-1 text-[10px] font-bold shadow-float flex items-center gap-1",
						children: [/* @__PURE__ */ jsx(Shield, { className: "h-3 w-3" }), " Smart Safety Active"]
					})
				]
			}),
			/* @__PURE__ */ jsxs("div", {
				className: "-mt-6 rounded-t-3xl bg-surface px-5 pt-5 pb-4 flex-1 flex flex-col shadow-float",
				children: [
					/* @__PURE__ */ jsx("div", { className: "mx-auto h-1.5 w-12 rounded-full bg-border mb-4" }),
					/* @__PURE__ */ jsxs("div", {
						className: "flex items-center gap-3",
						children: [
							/* @__PURE__ */ jsx("div", {
								className: "h-14 w-14 rounded-full bg-gradient-to-br from-primary to-primary/60 grid place-items-center text-primary-foreground font-bold text-lg",
								children: "MR"
							}),
							/* @__PURE__ */ jsxs("div", {
								className: "flex-1",
								children: [/* @__PURE__ */ jsxs("div", {
									className: "flex items-center gap-1",
									children: [/* @__PURE__ */ jsx("p", {
										className: "font-bold",
										children: "Marcus R."
									}), /* @__PURE__ */ jsxs("span", {
										className: "flex items-center gap-0.5 text-xs font-semibold ml-1",
										children: [/* @__PURE__ */ jsx(Star, { className: "h-3 w-3 fill-primary text-primary" }), " 4.96"]
									})]
								}), /* @__PURE__ */ jsx("p", {
									className: "text-xs text-muted-foreground",
									children: "Toyota Prius · Silver"
								})]
							}),
							/* @__PURE__ */ jsxs("div", {
								className: "text-right",
								children: [/* @__PURE__ */ jsx("p", {
									className: "text-lg font-extrabold tracking-tight",
									children: "LX24 PQR"
								}), /* @__PURE__ */ jsx("p", {
									className: "text-[10px] uppercase tracking-wider text-muted-foreground",
									children: "Plate"
								})]
							})
						]
					}),
					/* @__PURE__ */ jsxs("div", {
						className: "mt-4 grid grid-cols-4 gap-2",
						children: [
							/* @__PURE__ */ jsxs("button", {
								className: "flex flex-col items-center gap-1 rounded-full bg-secondary border border-transparent transition-colors focus-within:bg-background focus-within:border-primary focus:bg-background focus:border-primary py-3 text-xs font-semibold",
								children: [/* @__PURE__ */ jsx(Phone, { className: "h-4 w-4 text-primary" }), " Call"]
							}),
							/* @__PURE__ */ jsxs("button", {
								className: "flex flex-col items-center gap-1 rounded-full bg-secondary border border-transparent transition-colors focus-within:bg-background focus-within:border-primary focus:bg-background focus:border-primary py-3 text-xs font-semibold",
								children: [/* @__PURE__ */ jsx(MessageCircle, { className: "h-4 w-4 text-primary" }), " Chat"]
							}),
							/* @__PURE__ */ jsxs("button", {
								className: "flex flex-col items-center gap-1 rounded-full bg-secondary border border-transparent transition-colors focus-within:bg-background focus-within:border-primary focus:bg-background focus:border-primary py-3 text-xs font-semibold",
								onClick: () => alert("Ride link copied to clipboard!"),
								children: [/* @__PURE__ */ jsx(Share2, { className: "h-4 w-4 text-primary" }), " Share"]
							}),
							/* @__PURE__ */ jsxs("button", {
								className: "flex flex-col items-center gap-1 rounded-xl bg-red-50 text-red-700 py-3 text-xs font-bold border border-red-200",
								onClick: () => alert("SOS Triggered! Dispatching emergency services."),
								children: [/* @__PURE__ */ jsx(AlertTriangle, { className: "h-4 w-4 text-red-600" }), " SOS"]
							})
						]
					}),
					/* @__PURE__ */ jsxs("div", {
						className: "mt-4 rounded-md border border-border p-3.5",
						children: [/* @__PURE__ */ jsx("p", {
							className: "text-[11px] uppercase tracking-wider font-bold text-muted-foreground",
							children: "Trip"
						}), /* @__PURE__ */ jsxs("div", {
							className: "mt-2 flex items-start gap-3 text-sm",
							children: [
								/* @__PURE__ */ jsxs("div", {
									className: "flex flex-col items-center pt-1.5",
									children: [
										/* @__PURE__ */ jsx("span", { className: "h-2.5 w-2.5 rounded-full bg-foreground" }),
										/* @__PURE__ */ jsx("span", { className: "w-px h-6 border-l-2 border-dashed border-muted-foreground/40" }),
										/* @__PURE__ */ jsx("span", { className: "h-2.5 w-2.5 rounded-md bg-primary" })
									]
								}),
								/* @__PURE__ */ jsxs("div", {
									className: "flex-1 space-y-3",
									children: [/* @__PURE__ */ jsx("p", {
										className: "font-medium leading-tight",
										children: "Current location"
									}), /* @__PURE__ */ jsx("p", {
										className: "font-medium leading-tight",
										children: "Shoreditch High St, London"
									})]
								}),
								/* @__PURE__ */ jsx("p", {
									className: "text-sm font-extrabold",
									children: "R15.90"
								})
							]
						})]
					}),
					/* @__PURE__ */ jsx("button", {
						onClick: () => setShowCancel(true),
						className: "mt-auto grid place-items-center rounded-md bg-secondary py-3.5 text-sm font-bold w-full hover:bg-secondary/80 transition",
						children: "Cancel trip"
					})
				]
			}),
			showCancel && /* @__PURE__ */ jsx("div", {
				className: "absolute inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-end",
				children: /* @__PURE__ */ jsxs("div", {
					className: "w-full bg-surface rounded-t-[2rem] p-5 shadow-float animate-in slide-in-from-bottom",
					children: [/* @__PURE__ */ jsxs("div", {
						className: "flex justify-between items-center mb-4",
						children: [/* @__PURE__ */ jsx("h3", {
							className: "text-lg font-bold",
							children: "Why are you cancelling?"
						}), /* @__PURE__ */ jsx("button", {
							onClick: () => setShowCancel(false),
							className: "h-8 w-8 rounded-full bg-secondary grid place-items-center hover:bg-secondary/80 transition",
							children: /* @__PURE__ */ jsx(X, { className: "h-4 w-4" })
						})]
					}), /* @__PURE__ */ jsx("div", {
						className: "space-y-2",
						children: [
							"Driver is taking too long",
							"Driver asked me to cancel",
							"I accidentally requested",
							"Wait time was too long",
							"Driver isn't moving",
							"My pickup location is wrong"
						].map((opt, i) => /* @__PURE__ */ jsx("button", {
							onClick: () => {
								setShowCancel(false);
								navigate({ to: "/" });
							},
							className: "w-full text-left px-4 py-3.5 rounded-full border border-border bg-surface hover:bg-secondary/50 transition text-sm font-semibold",
							children: opt
						}, i))
					})]
				})
			}),
			isCompleted && /* @__PURE__ */ jsx("div", {
				className: "absolute inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-end",
				children: /* @__PURE__ */ jsxs("div", {
					className: "w-full bg-surface rounded-t-[2rem] p-6 shadow-float animate-in slide-in-from-bottom",
					children: [
						/* @__PURE__ */ jsx("h3", {
							className: "text-xl font-extrabold text-center mb-1",
							children: "Rate your driver"
						}),
						/* @__PURE__ */ jsx("p", {
							className: "text-sm text-center text-muted-foreground mb-6",
							children: "How was your trip with Marcus R.?"
						}),
						/* @__PURE__ */ jsx("div", {
							className: "flex justify-center gap-2 mb-6",
							children: [
								1,
								2,
								3,
								4,
								5
							].map((star) => /* @__PURE__ */ jsx("button", {
								onClick: () => setRating(star),
								className: "p-1 transition hover:scale-110 active:scale-95",
								children: /* @__PURE__ */ jsx(Star, { className: `h-10 w-10 ${rating >= star ? "fill-primary text-primary" : "text-border"}` })
							}, star))
						}),
						/* @__PURE__ */ jsx("textarea", {
							placeholder: "Add a comment (optional)",
							className: "w-full rounded-md border border-border bg-secondary px-4 py-3.5 text-sm font-semibold transition focus:border-primary focus:outline-none resize-none h-24 mb-6"
						}),
						/* @__PURE__ */ jsx("button", {
							disabled: rating === 0,
							onClick: () => navigate({ to: "/" }),
							className: "w-full rounded-md bg-primary py-4 text-sm font-bold text-primary-foreground shadow-sm hover:bg-primary/90 transition disabled:opacity-50 disabled:cursor-not-allowed",
							children: "Submit Rating"
						})
					]
				})
			})
		]
	});
}
//#endregion
export { Track as component };
