import { a as useAuth, n as PhoneShell } from "./PhoneShell-BHLURtmB.js";
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { jsx, jsxs } from "react/jsx-runtime";
import { ArrowLeft, Banknote, ChevronRight, CreditCard, History, Plus, Trash2, X } from "lucide-react";
//#region src/routes/wallet.tsx?tsr-split=component
function WalletPage() {
	const isDriver = useAuth()?.role === "driver";
	const [methods, setMethods] = useState([{
		id: "1",
		type: "card",
		last4: "4242",
		expiry: "09/28"
	}, {
		id: "2",
		type: "cash",
		isDefault: true
	}]);
	const [isAdding, setIsAdding] = useState(false);
	const [newCardNumber, setNewCardNumber] = useState("");
	const [newCardExpiry, setNewCardExpiry] = useState("");
	const addCard = (e) => {
		e.preventDefault();
		if (newCardNumber.length >= 4) {
			setMethods([...methods, {
				id: Date.now().toString(),
				type: "card",
				last4: newCardNumber.slice(-4),
				expiry: newCardExpiry || "12/30"
			}]);
			setIsAdding(false);
			setNewCardNumber("");
			setNewCardExpiry("");
		}
	};
	const removeMethod = (id) => {
		setMethods(methods.filter((m) => m.id !== id));
	};
	const [isCashingOut, setIsCashingOut] = useState(false);
	const [savedBanks, setSavedBanks] = useState([]);
	const [isAddingBank, setIsAddingBank] = useState(false);
	const [bankName, setBankName] = useState("");
	const [accountNumber, setAccountNumber] = useState("");
	const handleCashoutNew = (e) => {
		e.preventDefault();
		if (bankName && accountNumber) {
			const newBank = {
				id: Date.now().toString(),
				bankName,
				accountNumber
			};
			setSavedBanks([...savedBanks, newBank]);
			alert(`R 1,240.50 successfully withdrawn to ${bankName} account ending in ${accountNumber.slice(-4)}!`);
			setIsCashingOut(false);
			setIsAddingBank(false);
			setBankName("");
			setAccountNumber("");
		}
	};
	const handleCashoutSaved = (bank) => {
		alert(`R 1,240.50 successfully withdrawn to ${bank.bankName} account ending in ${bank.accountNumber.slice(-4)}!`);
		setIsCashingOut(false);
	};
	return /* @__PURE__ */ jsxs(PhoneShell, {
		hideTabs: true,
		children: [
			/* @__PURE__ */ jsxs("div", {
				className: "hero-gradient text-primary-foreground px-5 pt-4 pb-8 rounded-b-[2rem] relative",
				children: [/* @__PURE__ */ jsx(Link, {
					to: "/account",
					className: "absolute top-4 left-4 grid place-items-center h-9 w-9 rounded-full bg-white/20 hover:bg-white/30 transition",
					children: /* @__PURE__ */ jsx(ArrowLeft, { className: "h-4 w-4" })
				}), /* @__PURE__ */ jsx("h1", {
					className: "mt-12 text-2xl font-extrabold tracking-tight",
					children: isDriver ? "Earnings & Wallet" : "Wallet"
				})]
			}),
			/* @__PURE__ */ jsxs("div", {
				className: "px-5 -mt-4 flex-1 flex flex-col pb-6 space-y-6 overflow-y-auto",
				children: [/* @__PURE__ */ jsxs("div", {
					className: "rounded-2xl bg-surface border border-border shadow-sm p-5 border border-border",
					children: [
						/* @__PURE__ */ jsx("p", {
							className: "text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1",
							children: isDriver ? "Available to cash out" : "Vura Cash"
						}),
						/* @__PURE__ */ jsx("p", {
							className: "text-3xl font-extrabold tracking-tight",
							children: isDriver ? "R 1,240.50" : "R 24.10"
						}),
						/* @__PURE__ */ jsxs("div", {
							className: "mt-4 flex gap-2",
							children: [/* @__PURE__ */ jsxs("button", {
								onClick: () => {
									if (isDriver) setIsCashingOut(true);
								},
								className: "flex-1 flex items-center justify-center gap-2 rounded-full bg-secondary border border-transparent transition-colors focus-within:bg-background focus-within:border-primary focus:bg-background focus:border-primary py-2.5 text-sm font-bold text-foreground hover:bg-secondary/80 transition",
								children: [isDriver ? /* @__PURE__ */ jsx(Banknote, { className: "h-4 w-4" }) : /* @__PURE__ */ jsx(Plus, { className: "h-4 w-4" }), isDriver ? "Cash out" : "Add funds"]
							}), /* @__PURE__ */ jsxs("button", {
								className: "flex-1 flex items-center justify-center gap-2 rounded-full bg-secondary border border-transparent transition-colors focus-within:bg-background focus-within:border-primary focus:bg-background focus:border-primary py-2.5 text-sm font-bold text-foreground hover:bg-secondary/80 transition",
								children: [/* @__PURE__ */ jsx(History, { className: "h-4 w-4" }), " Activity"]
							})]
						})
					]
				}), /* @__PURE__ */ jsxs("div", { children: [
					/* @__PURE__ */ jsx("div", {
						className: "flex items-center justify-between mb-3",
						children: /* @__PURE__ */ jsx("h2", {
							className: "text-sm font-extrabold text-foreground",
							children: "Payment methods"
						})
					}),
					/* @__PURE__ */ jsx("div", {
						className: "rounded-2xl bg-surface border border-border divide-y divide-border overflow-hidden shadow-sm",
						children: methods.map((m) => /* @__PURE__ */ jsxs("div", {
							className: "flex items-center gap-3 p-4 group",
							children: [
								/* @__PURE__ */ jsx("div", {
									className: `h-10 w-10 rounded-full grid place-items-center shrink-0 ${m.type === "card" ? "bg-blue-100 text-blue-600" : "bg-green-100 text-green-600"}`,
									children: m.type === "card" ? /* @__PURE__ */ jsx(CreditCard, { className: "h-5 w-5" }) : /* @__PURE__ */ jsx(Banknote, { className: "h-5 w-5" })
								}),
								/* @__PURE__ */ jsxs("div", {
									className: "flex-1 min-w-0",
									children: [/* @__PURE__ */ jsx("p", {
										className: "text-sm font-bold",
										children: m.type === "card" ? `•••• ${m.last4}` : "Cash"
									}), /* @__PURE__ */ jsx("p", {
										className: "text-xs text-muted-foreground",
										children: m.type === "card" ? `Expires ${m.expiry}` : "Default for rides"
									})]
								}),
								m.type === "card" && /* @__PURE__ */ jsx("button", {
									onClick: () => removeMethod(m.id),
									className: "h-8 w-8 rounded-full bg-red-50 text-red-600 grid place-items-center hover:bg-red-100 transition",
									children: /* @__PURE__ */ jsx(Trash2, { className: "h-4 w-4" })
								})
							]
						}, m.id))
					}),
					/* @__PURE__ */ jsxs("button", {
						onClick: () => setIsAdding(true),
						className: "mt-3 w-full flex items-center justify-center gap-2 rounded-md bg-secondary py-3.5 text-sm font-bold text-primary hover:bg-secondary/80 transition",
						children: [/* @__PURE__ */ jsx(Plus, { className: "h-4 w-4" }), " Add payment method"]
					})
				] })]
			}),
			isAdding && /* @__PURE__ */ jsx("div", {
				className: "absolute inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-end",
				children: /* @__PURE__ */ jsxs("div", {
					className: "w-full bg-surface rounded-t-[2rem] p-5 shadow-float animate-in slide-in-from-bottom",
					children: [/* @__PURE__ */ jsxs("div", {
						className: "flex justify-between items-center mb-4",
						children: [/* @__PURE__ */ jsx("h3", {
							className: "text-lg font-bold",
							children: "Add Card"
						}), /* @__PURE__ */ jsx("button", {
							onClick: () => setIsAdding(false),
							className: "h-8 w-8 rounded-full bg-secondary grid place-items-center hover:bg-secondary/80 transition",
							children: /* @__PURE__ */ jsx(X, { className: "h-4 w-4" })
						})]
					}), /* @__PURE__ */ jsxs("form", {
						onSubmit: addCard,
						className: "space-y-4",
						children: [
							/* @__PURE__ */ jsx("input", {
								required: true,
								type: "text",
								placeholder: "Card Number (min 4 digits)",
								value: newCardNumber,
								onChange: (e) => setNewCardNumber(e.target.value),
								className: "w-full rounded-md border border-border bg-secondary px-4 py-3.5 text-sm font-semibold transition focus:border-primary focus:outline-none"
							}),
							/* @__PURE__ */ jsxs("div", {
								className: "flex gap-4",
								children: [/* @__PURE__ */ jsx("input", {
									required: true,
									type: "text",
									placeholder: "Expiry (MM/YY)",
									value: newCardExpiry,
									onChange: (e) => setNewCardExpiry(e.target.value),
									className: "w-1/2 rounded-md border border-border bg-secondary px-4 py-3.5 text-sm font-semibold transition focus:border-primary focus:outline-none"
								}), /* @__PURE__ */ jsx("input", {
									required: true,
									type: "text",
									placeholder: "CVV (3 digits)",
									maxLength: 3,
									className: "w-1/2 rounded-md border border-border bg-secondary px-4 py-3.5 text-sm font-semibold transition focus:border-primary focus:outline-none"
								})]
							}),
							/* @__PURE__ */ jsx("button", {
								type: "submit",
								className: "w-full rounded-md bg-primary py-4 text-sm font-bold text-primary-foreground shadow-sm hover:bg-primary/90 transition",
								children: "Save Card"
							})
						]
					})]
				})
			}),
			isCashingOut && /* @__PURE__ */ jsx("div", {
				className: "absolute inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-end",
				children: /* @__PURE__ */ jsxs("div", {
					className: "w-full bg-surface rounded-t-[2rem] p-5 shadow-float animate-in slide-in-from-bottom",
					children: [/* @__PURE__ */ jsxs("div", {
						className: "flex justify-between items-center mb-4",
						children: [/* @__PURE__ */ jsx("h3", {
							className: "text-lg font-bold",
							children: "Cash Out Earnings"
						}), /* @__PURE__ */ jsx("button", {
							onClick: () => setIsCashingOut(false),
							className: "h-8 w-8 rounded-full bg-secondary grid place-items-center hover:bg-secondary/80 transition",
							children: /* @__PURE__ */ jsx(X, { className: "h-4 w-4" })
						})]
					}), savedBanks.length > 0 && !isAddingBank ? /* @__PURE__ */ jsxs("div", {
						className: "space-y-3",
						children: [
							/* @__PURE__ */ jsx("p", {
								className: "text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2",
								children: "Saved Accounts"
							}),
							savedBanks.map((bank) => /* @__PURE__ */ jsxs("button", {
								onClick: () => handleCashoutSaved(bank),
								className: "w-full flex items-center justify-between rounded-md border border-border bg-surface px-4 py-3.5 hover:bg-secondary/50 transition text-left",
								children: [/* @__PURE__ */ jsxs("div", { children: [/* @__PURE__ */ jsx("p", {
									className: "text-sm font-bold",
									children: bank.bankName
								}), /* @__PURE__ */ jsxs("p", {
									className: "text-xs text-muted-foreground",
									children: ["•••• ", bank.accountNumber.slice(-4)]
								})] }), /* @__PURE__ */ jsx(ChevronRight, { className: "h-4 w-4 text-muted-foreground" })]
							}, bank.id)),
							/* @__PURE__ */ jsxs("button", {
								onClick: () => setIsAddingBank(true),
								className: "mt-2 w-full flex items-center justify-center gap-2 rounded-md bg-secondary py-3.5 text-sm font-bold text-primary hover:bg-secondary/80 transition",
								children: [/* @__PURE__ */ jsx(Plus, { className: "h-4 w-4" }), " Add new bank account"]
							})
						]
					}) : /* @__PURE__ */ jsxs("form", {
						onSubmit: handleCashoutNew,
						className: "space-y-4",
						children: [
							savedBanks.length > 0 && /* @__PURE__ */ jsxs("button", {
								type: "button",
								onClick: () => setIsAddingBank(false),
								className: "flex items-center gap-1 text-xs font-bold text-muted-foreground mb-2 hover:text-foreground",
								children: [/* @__PURE__ */ jsx(ArrowLeft, { className: "h-3 w-3" }), " Back to saved accounts"]
							}),
							/* @__PURE__ */ jsxs("div", {
								className: "space-y-1",
								children: [/* @__PURE__ */ jsx("label", {
									className: "text-xs font-bold text-muted-foreground ml-1",
									children: "Bank Name"
								}), /* @__PURE__ */ jsx("div", {
									className: "relative",
									children: /* @__PURE__ */ jsxs("select", {
										required: true,
										value: bankName,
										onChange: (e) => setBankName(e.target.value),
										className: "w-full appearance-none rounded-md border border-border bg-secondary px-4 py-3.5 text-sm font-semibold transition focus:border-primary focus:outline-none",
										children: [
											/* @__PURE__ */ jsx("option", {
												value: "",
												disabled: true,
												children: "Select your bank"
											}),
											/* @__PURE__ */ jsx("option", {
												value: "FNB",
												children: "First National Bank (FNB)"
											}),
											/* @__PURE__ */ jsx("option", {
												value: "Standard Bank",
												children: "Standard Bank"
											}),
											/* @__PURE__ */ jsx("option", {
												value: "ABSA",
												children: "ABSA"
											}),
											/* @__PURE__ */ jsx("option", {
												value: "Nedbank",
												children: "Nedbank"
											}),
											/* @__PURE__ */ jsx("option", {
												value: "Capitec",
												children: "Capitec"
											}),
											/* @__PURE__ */ jsx("option", {
												value: "Discovery Bank",
												children: "Discovery Bank"
											}),
											/* @__PURE__ */ jsx("option", {
												value: "TymeBank",
												children: "TymeBank"
											})
										]
									})
								})]
							}),
							/* @__PURE__ */ jsxs("div", {
								className: "space-y-1",
								children: [/* @__PURE__ */ jsx("label", {
									className: "text-xs font-bold text-muted-foreground ml-1",
									children: "Account Number"
								}), /* @__PURE__ */ jsx("input", {
									required: true,
									type: "text",
									placeholder: "Enter your account number",
									value: accountNumber,
									onChange: (e) => setAccountNumber(e.target.value),
									className: "w-full rounded-md border border-border bg-secondary px-4 py-3.5 text-sm font-semibold transition focus:border-primary focus:outline-none"
								})]
							}),
							/* @__PURE__ */ jsx("button", {
								type: "submit",
								className: "w-full rounded-md bg-primary py-4 text-sm font-bold text-primary-foreground shadow-sm hover:bg-primary/90 transition mt-2",
								children: "Withdraw R 1,240.50"
							})
						]
					})]
				})
			})
		]
	});
}
//#endregion
export { WalletPage as component };
