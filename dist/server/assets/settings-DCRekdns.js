import { a as useAuth, i as setUser, n as PhoneShell } from "./PhoneShell-BHLURtmB.js";
import { useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { ArrowLeft, BadgeCheck, FileText, Save, Upload } from "lucide-react";
//#region src/routes/settings.tsx?tsr-split=component
function SettingsPage() {
	const user = useAuth();
	const nav = useNavigate();
	const fileInputRef = useRef(null);
	const [name, setName] = useState(user?.name || "");
	const [email, setEmail] = useState(user?.email || "");
	const [phone, setPhone] = useState(user?.phone || "");
	const [idNumber, setIdNumber] = useState(user?.idNumber || "");
	const [docName, setDocName] = useState((user?.role === "driver" ? user?.licenseDocumentName : user?.idDocumentName) || "");
	if (!user) return null;
	const isDriver = user.role === "driver";
	let progress = 0;
	if (idNumber) progress += 50;
	if (docName) progress += 50;
	const isVerified = progress === 100;
	function handleSave(e) {
		e.preventDefault();
		setUser({
			...user,
			name,
			email,
			phone,
			idNumber,
			...isDriver ? { licenseDocumentName: docName } : { idDocumentName: docName }
		});
		nav({ to: "/account" });
	}
	function handleFileChange(e) {
		const file = e.target.files?.[0];
		if (file) setDocName(file.name);
	}
	return /* @__PURE__ */ jsxs(PhoneShell, {
		hideTabs: true,
		children: [/* @__PURE__ */ jsxs("div", {
			className: "hero-gradient text-primary-foreground px-5 pt-4 pb-8 rounded-b-[2rem] relative",
			children: [
				/* @__PURE__ */ jsx(Link, {
					to: "/account",
					className: "absolute top-4 left-4 grid place-items-center h-9 w-9 rounded-full bg-white/20 hover:bg-white/30 transition",
					children: /* @__PURE__ */ jsx(ArrowLeft, { className: "h-4 w-4" })
				}),
				/* @__PURE__ */ jsx("h1", {
					className: "mt-12 text-2xl font-extrabold tracking-tight",
					children: "Settings"
				}),
				/* @__PURE__ */ jsx("p", {
					className: "text-sm opacity-85 mt-1",
					children: "Update your personal details"
				})
			]
		}), /* @__PURE__ */ jsx("div", {
			className: "px-5 mt-6 flex-1 flex flex-col",
			children: /* @__PURE__ */ jsxs("form", {
				onSubmit: handleSave,
				className: "flex-1 flex flex-col gap-4",
				children: [
					/* @__PURE__ */ jsxs("div", {
						className: "space-y-2 mb-2",
						children: [/* @__PURE__ */ jsxs("div", {
							className: "flex items-center justify-between",
							children: [/* @__PURE__ */ jsxs("span", {
								className: `text-sm font-bold flex items-center gap-2 transition ${isVerified ? "text-[#10b981]" : "text-muted-foreground"}`,
								children: [/* @__PURE__ */ jsx(BadgeCheck, { className: "h-5 w-5" }), isVerified ? "Verified Account" : "Verification in progress"]
							}), /* @__PURE__ */ jsxs("span", {
								className: "text-xs font-semibold text-muted-foreground",
								children: [progress, "%"]
							})]
						}), /* @__PURE__ */ jsx("div", {
							className: "relative h-2.5 w-full overflow-hidden rounded-full bg-secondary",
							children: /* @__PURE__ */ jsx("div", {
								className: `h-full transition-all duration-500 ease-in-out ${isVerified ? "bg-[#10b981]" : "bg-muted-foreground"}`,
								style: { width: `${progress}%` }
							})
						})]
					}),
					/* @__PURE__ */ jsxs("div", {
						className: "space-y-1",
						children: [/* @__PURE__ */ jsx("label", {
							className: "text-xs font-bold text-muted-foreground ml-1",
							children: "Full Name"
						}), /* @__PURE__ */ jsx("input", {
							required: true,
							type: "text",
							value: name,
							onChange: (e) => setName(e.target.value),
							className: "w-full rounded-md border border-border bg-surface px-4 py-3.5 text-sm font-semibold transition focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
						})]
					}),
					/* @__PURE__ */ jsxs("div", {
						className: "space-y-1",
						children: [/* @__PURE__ */ jsx("label", {
							className: "text-xs font-bold text-muted-foreground ml-1",
							children: "Email Address"
						}), /* @__PURE__ */ jsx("input", {
							required: true,
							type: "email",
							value: email,
							onChange: (e) => setEmail(e.target.value),
							className: "w-full rounded-md border border-border bg-surface px-4 py-3.5 text-sm font-semibold transition focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
						})]
					}),
					/* @__PURE__ */ jsxs("div", {
						className: "space-y-1",
						children: [/* @__PURE__ */ jsx("label", {
							className: "text-xs font-bold text-muted-foreground ml-1",
							children: "Phone Number"
						}), /* @__PURE__ */ jsx("input", {
							required: true,
							type: "tel",
							value: phone,
							onChange: (e) => setPhone(e.target.value),
							className: "w-full rounded-md border border-border bg-surface px-4 py-3.5 text-sm font-semibold transition focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
						})]
					}),
					/* @__PURE__ */ jsxs("div", {
						className: "space-y-1",
						children: [/* @__PURE__ */ jsx("label", {
							className: "text-xs font-bold text-muted-foreground ml-1",
							children: "ID Number"
						}), /* @__PURE__ */ jsx("input", {
							type: "text",
							placeholder: "Enter your ID Number",
							value: idNumber,
							onChange: (e) => setIdNumber(e.target.value),
							className: "w-full rounded-md border border-border bg-surface px-4 py-3.5 text-sm font-semibold transition focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
						})]
					}),
					/* @__PURE__ */ jsxs("div", {
						className: "space-y-1 mt-2",
						children: [
							/* @__PURE__ */ jsx("label", {
								className: "text-xs font-bold text-muted-foreground ml-1",
								children: isDriver ? "Driver's License Document" : "ID Document"
							}),
							/* @__PURE__ */ jsx("div", {
								onClick: () => fileInputRef.current?.click(),
								className: "w-full border-2 border-dashed border-border rounded-md p-6 flex flex-col items-center justify-center gap-2 bg-surface cursor-pointer hover:border-primary/50 transition text-center",
								children: docName ? /* @__PURE__ */ jsxs(Fragment, { children: [/* @__PURE__ */ jsx(FileText, { className: "h-6 w-6 text-primary" }), /* @__PURE__ */ jsx("span", {
									className: "text-sm font-bold text-primary truncate max-w-full px-4",
									children: docName
								})] }) : /* @__PURE__ */ jsxs(Fragment, { children: [/* @__PURE__ */ jsx(Upload, { className: "h-6 w-6 text-muted-foreground" }), /* @__PURE__ */ jsxs("span", {
									className: "text-sm font-semibold text-muted-foreground",
									children: ["Tap to upload ", isDriver ? "Driver's License" : "ID Document"]
								})] })
							}),
							/* @__PURE__ */ jsx("input", {
								type: "file",
								className: "hidden",
								ref: fileInputRef,
								onChange: handleFileChange,
								accept: "image/*,.pdf"
							})
						]
					}),
					isDriver && /* @__PURE__ */ jsx("div", {
						className: "mt-2 pt-4 border-t border-border",
						children: /* @__PURE__ */ jsxs(Link, {
							to: "/car-scanner",
							className: "flex items-center justify-between p-4 rounded-md bg-secondary hover:bg-secondary/80 transition",
							children: [/* @__PURE__ */ jsxs("div", {
								className: "flex items-center gap-3",
								children: [/* @__PURE__ */ jsx("div", {
									className: "h-10 w-10 rounded-md bg-primary/10 grid place-items-center text-primary",
									children: /* @__PURE__ */ jsx(BadgeCheck, { className: "h-5 w-5" })
								}), /* @__PURE__ */ jsxs("div", { children: [/* @__PURE__ */ jsx("p", {
									className: "text-sm font-bold",
									children: "Vehicle Verification"
								}), /* @__PURE__ */ jsx("p", {
									className: "text-xs text-muted-foreground",
									children: "Scan your car inside & out"
								})] })]
							}), /* @__PURE__ */ jsx(ArrowLeft, { className: "h-4 w-4 rotate-180 text-muted-foreground" })]
						})
					}),
					/* @__PURE__ */ jsx("div", {
						className: "mt-auto pt-6 pb-6",
						children: /* @__PURE__ */ jsxs("button", {
							type: "submit",
							className: "w-full flex items-center justify-center gap-2 rounded-md bg-primary py-4 text-sm font-bold text-primary-foreground shadow-sm active:scale-[0.99] transition",
							children: [/* @__PURE__ */ jsx(Save, { className: "h-4 w-4" }), " Save Changes"]
						})
					})
				]
			})
		})]
	});
}
//#endregion
export { SettingsPage as component };
