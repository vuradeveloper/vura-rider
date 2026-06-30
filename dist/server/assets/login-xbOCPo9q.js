import { i as setUser, n as PhoneShell } from "./PhoneShell-BHLURtmB.js";
import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { jsx, jsxs } from "react/jsx-runtime";
import { ArrowLeft, Eye, EyeOff, Lock, Mail } from "lucide-react";
//#region src/routes/login.tsx?tsr-split=component
function Login() {
	const nav = useNavigate();
	const [email, setEmail] = useState("sagar@vura.app");
	const [pwd, setPwd] = useState("password");
	const [show, setShow] = useState(false);
	const role = "rider";
	function submit(e) {
		e.preventDefault();
		setUser({
			name: email.split("@")[0] || "Rider",
			email,
			role
		});
		nav({ to: "/" });
	}
	return /* @__PURE__ */ jsxs(PhoneShell, {
		hideTabs: true,
		children: [/* @__PURE__ */ jsxs("div", {
			className: "px-5 pt-3 pb-2 flex items-center gap-3",
			children: [/* @__PURE__ */ jsx(Link, {
				to: "/welcome",
				className: "grid place-items-center h-9 w-9 rounded-full bg-secondary",
				children: /* @__PURE__ */ jsx(ArrowLeft, { className: "h-4 w-4" })
			}), /* @__PURE__ */ jsx("h1", {
				className: "text-base font-bold",
				children: "Sign in"
			})]
		}), /* @__PURE__ */ jsxs("div", {
			className: "px-5 pt-4 pb-6 flex-1 flex flex-col justify-center relative z-10",
			children: [/* @__PURE__ */ jsxs("div", {
				className: "bg-surface border border-border shadow-md rounded-[1.5rem] p-6 pb-8",
				children: [
					/* @__PURE__ */ jsx("h2", {
						className: "text-2xl font-extrabold tracking-tight",
						children: "Welcome back"
					}),
					/* @__PURE__ */ jsx("p", {
						className: "text-sm text-muted-foreground mt-1 mb-5",
						children: "Enter your details to continue."
					}),
					/* @__PURE__ */ jsxs("form", {
						onSubmit: submit,
						className: "space-y-4",
						children: [
							/* @__PURE__ */ jsxs("label", {
								className: "block",
								children: [/* @__PURE__ */ jsx("span", {
									className: "text-[11px] font-bold uppercase tracking-wider text-muted-foreground ml-1",
									children: "Email"
								}), /* @__PURE__ */ jsxs("div", {
									className: "mt-1 flex items-center gap-2 rounded-xl bg-secondary border border-transparent focus-within:bg-background focus-within:border-primary px-4 py-3 transition-colors",
									children: [/* @__PURE__ */ jsx(Mail, { className: "h-4 w-4 text-muted-foreground" }), /* @__PURE__ */ jsx("input", {
										type: "email",
										value: email,
										onChange: (e) => setEmail(e.target.value),
										className: "flex-1 bg-transparent text-sm font-medium outline-none px-1",
										required: true
									})]
								})]
							}),
							/* @__PURE__ */ jsxs("label", {
								className: "block",
								children: [/* @__PURE__ */ jsx("span", {
									className: "text-[11px] font-bold uppercase tracking-wider text-muted-foreground ml-1",
									children: "Password"
								}), /* @__PURE__ */ jsxs("div", {
									className: "mt-1 flex items-center gap-2 rounded-xl bg-secondary border border-transparent focus-within:bg-background focus-within:border-primary px-4 py-3 transition-colors",
									children: [
										/* @__PURE__ */ jsx(Lock, { className: "h-4 w-4 text-muted-foreground" }),
										/* @__PURE__ */ jsx("input", {
											type: show ? "text" : "password",
											value: pwd,
											onChange: (e) => setPwd(e.target.value),
											className: "flex-1 bg-transparent text-sm font-medium outline-none px-1",
											required: true
										}),
										/* @__PURE__ */ jsx("button", {
											type: "button",
											onClick: () => setShow((s) => !s),
											className: "text-muted-foreground",
											children: show ? /* @__PURE__ */ jsx(EyeOff, { className: "h-4 w-4" }) : /* @__PURE__ */ jsx(Eye, { className: "h-4 w-4" })
										})
									]
								})]
							}),
							/* @__PURE__ */ jsx("div", {
								className: "flex justify-end mt-1 mb-2",
								children: /* @__PURE__ */ jsx(Link, {
									to: "/login",
									className: "text-xs font-semibold text-primary hover:underline",
									children: "Forgot password?"
								})
							}),
							/* @__PURE__ */ jsx("button", {
								type: "submit",
								className: "w-full rounded-2xl bg-primary py-4 text-sm font-bold text-primary-foreground shadow-sm active:scale-[0.99] transition mt-2",
								children: "Sign in"
							})
						]
					}),
					/* @__PURE__ */ jsxs("div", {
						className: "mt-6 flex items-center gap-3 text-xs text-muted-foreground",
						children: [
							/* @__PURE__ */ jsx("span", { className: "h-px flex-1 bg-border" }),
							" or continue with ",
							/* @__PURE__ */ jsx("span", { className: "h-px flex-1 bg-border" })
						]
					}),
					/* @__PURE__ */ jsx("div", {
						className: "mt-4 grid grid-cols-3 gap-2",
						children: [
							"Google",
							"Apple",
							"Phone"
						].map((p) => /* @__PURE__ */ jsx("button", {
							className: "rounded-xl border border-border py-2.5 text-xs font-bold transition hover:border-primary/40 shadow-sm",
							children: p
						}, p))
					})
				]
			}), /* @__PURE__ */ jsxs("p", {
				className: "mt-8 text-center text-sm font-medium",
				children: [
					"New to Vura Ride?",
					" ",
					/* @__PURE__ */ jsx(Link, {
						to: "/signup",
						className: "font-bold text-primary hover:underline",
						children: "Create account"
					})
				]
			})]
		})]
	});
}
//#endregion
export { Login as component };
