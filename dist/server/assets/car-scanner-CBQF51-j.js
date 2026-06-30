import { i as createServerFn } from "./esm-Dova13aH.js";
import { a as useAuth, n as PhoneShell } from "./PhoneShell-BHLURtmB.js";
import { t as createSsrRpc } from "./createSsrRpc-Bb57tAE3.js";
import { useRef, useState } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { AlertTriangle, ArrowLeft, Camera, Car, CheckCircle2, Eye, Loader2, ShieldAlert, Trash2 } from "lucide-react";
//#region src/lib/car-scan.ts
var SCANS_KEY = "vura.car-scans";
function getAll() {
	if (typeof window === "undefined") return [];
	try {
		const raw = localStorage.getItem(SCANS_KEY);
		return raw ? JSON.parse(raw) : [];
	} catch {
		return [];
	}
}
function saveAll(scans) {
	localStorage.setItem(SCANS_KEY, JSON.stringify(scans));
	window.dispatchEvent(new Event("vura:car-scans"));
}
function submitScan(scan) {
	const scans = getAll();
	scans.push(scan);
	saveAll(scans);
}
var EXTERIOR_ANGLES = [
	{
		id: "front",
		label: "Front",
		desc: "Stand 2m in front of the car"
	},
	{
		id: "rear",
		label: "Rear",
		desc: "Stand 2m behind the car"
	},
	{
		id: "left",
		label: "Left Side",
		desc: "Stand 2m from the left side"
	},
	{
		id: "right",
		label: "Right Side",
		desc: "Stand 2m from the right side"
	},
	{
		id: "hood",
		label: "Hood / Bonnet",
		desc: "Top-down view of the hood"
	},
	{
		id: "trunk",
		label: "Trunk / Boot",
		desc: "Close-up of the trunk area"
	}
];
var INTERIOR_ANGLES = [
	{
		id: "dashboard",
		label: "Dashboard",
		desc: "Front dashboard & steering wheel"
	},
	{
		id: "front-seats",
		label: "Front Seats",
		desc: "Driver & passenger seats"
	},
	{
		id: "back-seats",
		label: "Back Seats",
		desc: "Rear passenger area"
	},
	{
		id: "trunk-interior",
		label: "Trunk Interior",
		desc: "Inside the trunk/boot"
	}
];
function getAngles(section) {
	return section === "exterior" ? EXTERIOR_ANGLES : INTERIOR_ANGLES;
}
//#endregion
//#region src/lib/vision.ts
var analyzeCarImage = createServerFn({ method: "POST" }).validator((data) => data).handler(createSsrRpc("9f0b7d8c14dbe0b4b239e41c0f124d57127f5e2ebc7d6c7ae8afb695afae8967"));
//#endregion
//#region src/routes/car-scanner.tsx?tsr-split=component
var STEP_INTRO = "intro";
var STEP_SCAN = "scan";
var STEP_PREVIEW = "preview";
function CarScannerPage() {
	const user = useAuth();
	const nav = useNavigate();
	const isComplaint = useSearch({ from: "/car-scanner" }).complaint === "true";
	const [step, setStep] = useState(STEP_INTRO);
	const [section, setSection] = useState("exterior");
	const [images, setImages] = useState([]);
	const [notes, setNotes] = useState("");
	const [previewImage, setPreviewImage] = useState(null);
	const fileRef = useRef(null);
	const [currentAngleId, setCurrentAngleId] = useState(null);
	if (!user) return null;
	const angles = getAngles(section);
	function handleStart() {
		setStep(STEP_SCAN);
	}
	function handleCapture(angleId) {
		setCurrentAngleId(angleId);
		fileRef.current?.click();
	}
	function handleFileChange(e) {
		const file = e.target.files?.[0];
		if (!file || !currentAngleId) return;
		const angle = angles.find((a) => a.id === currentAngleId);
		if (!angle) return;
		const reader = new FileReader();
		reader.onload = () => {
			const dataUrl = reader.result;
			const newImage = {
				id: `${currentAngleId}-${Date.now()}`,
				angle: currentAngleId,
				label: angle.label,
				dataUrl,
				timestamp: Date.now(),
				analyzing: true
			};
			setImages((prev) => {
				return [...prev.filter((img) => img.angle !== currentAngleId), newImage];
			});
			analyzeCarImage({ data: {
				imageBase64: dataUrl,
				angle: currentAngleId,
				label: angle.label
			} }).then((analysis) => {
				setImages((prev) => prev.map((img) => img.id === newImage.id ? {
					...img,
					analysis,
					analyzing: false
				} : img));
			}).catch(() => {
				setImages((prev) => prev.map((img) => img.id === newImage.id ? {
					...img,
					analyzing: false
				} : img));
			});
		};
		reader.readAsDataURL(file);
		e.target.value = "";
		setCurrentAngleId(null);
	}
	function handleRemoveImage(imageId) {
		setImages((prev) => prev.filter((img) => img.id !== imageId));
	}
	function handleResetSection() {
		const sectionIds = angles.map((a) => a.id);
		setImages((prev) => prev.filter((img) => !sectionIds.includes(img.angle)));
	}
	function handleDoneScanning() {
		setStep(STEP_PREVIEW);
	}
	function handleSubmit() {
		submitScan({
			id: `scan-${Date.now()}`,
			images,
			timestamp: Date.now(),
			type: isComplaint ? "complaint" : "routine",
			notes,
			submitted: true
		});
		nav({ to: "/account" });
	}
	function handleBack() {
		if (step === STEP_SCAN) {
			setStep(STEP_INTRO);
			return;
		}
		if (step === STEP_PREVIEW) {
			setStep(STEP_SCAN);
			return;
		}
		nav({ to: "/account" });
	}
	const sectionComplete = images.filter((img) => angles.some((a) => a.id === img.angle)).length === angles.length;
	const totalAngleList = [...getAngles("exterior"), ...getAngles("interior")];
	const totalAngleCount = totalAngleList.length;
	const totalCaptured = totalAngleList.filter((a) => images.some((img) => img.angle === a.id)).length;
	return /* @__PURE__ */ jsxs(PhoneShell, {
		hideTabs: true,
		children: [
			/* @__PURE__ */ jsxs("div", {
				className: `hero-gradient text-primary-foreground px-5 pt-4 pb-8 rounded-b-[2rem] relative ${isComplaint ? "!bg-red-600" : ""}`,
				children: [
					/* @__PURE__ */ jsx("button", {
						onClick: handleBack,
						className: "absolute top-4 left-4 grid place-items-center h-9 w-9 rounded-full bg-white/20 hover:bg-white/30 transition z-10",
						children: /* @__PURE__ */ jsx(ArrowLeft, { className: "h-4 w-4" })
					}),
					/* @__PURE__ */ jsxs("div", {
						className: "mt-12 flex items-center gap-3",
						children: [/* @__PURE__ */ jsx("div", {
							className: `h-12 w-12 rounded-full grid place-items-center ${isComplaint ? "bg-red-400" : "bg-white/20"}`,
							children: isComplaint ? /* @__PURE__ */ jsx(AlertTriangle, { className: "h-6 w-6" }) : /* @__PURE__ */ jsx(Car, { className: "h-6 w-6" })
						}), /* @__PURE__ */ jsxs("div", { children: [/* @__PURE__ */ jsx("h1", {
							className: "text-2xl font-extrabold tracking-tight",
							children: isComplaint ? "Complaint Scan" : "Car Scanner"
						}), /* @__PURE__ */ jsx("p", {
							className: "text-sm opacity-85 mt-0.5",
							children: isComplaint ? "Required — a rider reported damage" : "Verify your vehicle is in good condition"
						})] })]
					}),
					isComplaint && /* @__PURE__ */ jsxs("div", {
						className: "mt-3 flex items-center gap-2 rounded-xl bg-red-400/30 px-4 py-2.5 text-sm font-semibold",
						children: [/* @__PURE__ */ jsx(AlertTriangle, { className: "h-4 w-4 shrink-0" }), /* @__PURE__ */ jsx("span", { children: "A rider has reported damage. Please scan all angles of your car to verify its condition." })]
					})
				]
			}),
			/* @__PURE__ */ jsxs("div", {
				className: "px-5 flex-1 flex flex-col",
				children: [
					step === STEP_INTRO && /* @__PURE__ */ jsx(IntroStep, {
						isComplaint,
						onStart: handleStart
					}),
					step === STEP_SCAN && /* @__PURE__ */ jsx(ScanStep, {
						section,
						setSection,
						images,
						fileRef,
						onCapture: handleCapture,
						onRemoveImage: handleRemoveImage,
						onResetSection: handleResetSection,
						sectionComplete,
						totalCaptured,
						totalAngles: totalAngleCount,
						onDone: handleDoneScanning,
						onFileChange: handleFileChange
					}),
					step === STEP_PREVIEW && /* @__PURE__ */ jsx(PreviewStep, {
						images,
						notes,
						setNotes,
						isComplaint,
						previewImage,
						setPreviewImage,
						onSubmit: handleSubmit,
						getAngles
					})
				]
			}),
			/* @__PURE__ */ jsx("div", { className: "h-6" })
		]
	});
}
function IntroStep({ isComplaint, onStart }) {
	return /* @__PURE__ */ jsxs("div", {
		className: "flex-1 flex flex-col mt-6",
		children: [
			/* @__PURE__ */ jsxs("div", {
				className: "rounded-2xl bg-surface border border-border shadow-sm p-5",
				children: [/* @__PURE__ */ jsx("h3", {
					className: "text-sm font-bold",
					children: "What to scan"
				}), /* @__PURE__ */ jsxs("div", {
					className: "mt-4 space-y-3",
					children: [/* @__PURE__ */ jsxs("div", {
						className: "flex items-start gap-3",
						children: [/* @__PURE__ */ jsx("span", {
							className: "grid place-items-center h-8 w-8 rounded-full bg-accent text-primary shrink-0 mt-0.5",
							children: /* @__PURE__ */ jsx(Car, { className: "h-4 w-4" })
						}), /* @__PURE__ */ jsxs("div", { children: [/* @__PURE__ */ jsx("p", {
							className: "text-sm font-semibold",
							children: "Exterior — 6 angles"
						}), /* @__PURE__ */ jsx("p", {
							className: "text-xs text-muted-foreground mt-0.5",
							children: "Front, rear, left side, right side, hood, and trunk"
						})] })]
					}), /* @__PURE__ */ jsxs("div", {
						className: "flex items-start gap-3",
						children: [/* @__PURE__ */ jsx("span", {
							className: "grid place-items-center h-8 w-8 rounded-full bg-accent text-primary shrink-0 mt-0.5",
							children: /* @__PURE__ */ jsx(Eye, { className: "h-4 w-4" })
						}), /* @__PURE__ */ jsxs("div", { children: [/* @__PURE__ */ jsx("p", {
							className: "text-sm font-semibold",
							children: "Interior — 4 angles"
						}), /* @__PURE__ */ jsx("p", {
							className: "text-xs text-muted-foreground mt-0.5",
							children: "Dashboard, front seats, back seats, and trunk interior"
						})] })]
					})]
				})]
			}),
			/* @__PURE__ */ jsxs("div", {
				className: "mt-4 rounded-2xl bg-surface border border-border shadow-sm p-5",
				children: [/* @__PURE__ */ jsx("h3", {
					className: "text-sm font-bold",
					children: "Tips for a good scan"
				}), /* @__PURE__ */ jsxs("ul", {
					className: "mt-3 space-y-2 text-xs text-muted-foreground",
					children: [
						/* @__PURE__ */ jsxs("li", {
							className: "flex items-start gap-2",
							children: [/* @__PURE__ */ jsx(CheckCircle2, { className: "h-3.5 w-3.5 text-[#10b981] shrink-0 mt-0.5" }), "Park in a well-lit area with space around the car"]
						}),
						/* @__PURE__ */ jsxs("li", {
							className: "flex items-start gap-2",
							children: [/* @__PURE__ */ jsx(CheckCircle2, { className: "h-3.5 w-3.5 text-[#10b981] shrink-0 mt-0.5" }), "Stand about 2 meters away for exterior shots"]
						}),
						/* @__PURE__ */ jsxs("li", {
							className: "flex items-start gap-2",
							children: [/* @__PURE__ */ jsx(CheckCircle2, { className: "h-3.5 w-3.5 text-[#10b981] shrink-0 mt-0.5" }), "Make sure the entire section is visible in frame"]
						}),
						/* @__PURE__ */ jsxs("li", {
							className: "flex items-start gap-2",
							children: [/* @__PURE__ */ jsx(CheckCircle2, { className: "h-3.5 w-3.5 text-[#10b981] shrink-0 mt-0.5" }), "Avoid glare from direct sunlight"]
						})
					]
				})]
			}),
			/* @__PURE__ */ jsx("div", {
				className: "mt-auto pt-6 pb-4",
				children: /* @__PURE__ */ jsx("button", {
					onClick: onStart,
					className: `w-full rounded-2xl py-4 text-sm font-bold text-primary-foreground shadow-sm active:scale-[0.99] transition ${isComplaint ? "bg-red-600 hover:bg-red-700" : "bg-primary hover:bg-primary/90"}`,
					children: isComplaint ? "Start Complaint Scan" : "Start Scanning"
				})
			})
		]
	});
}
function ScanStep({ section, setSection, images, fileRef, onCapture, onRemoveImage, onResetSection, sectionComplete, totalCaptured, totalAngles, onDone, onFileChange }) {
	const angles = getAngles(section);
	return /* @__PURE__ */ jsxs("div", {
		className: "flex-1 flex flex-col mt-6 gap-4",
		children: [
			/* @__PURE__ */ jsxs("div", {
				className: "flex rounded-xl bg-surface border border-border p-1 gap-1",
				children: [/* @__PURE__ */ jsxs("button", {
					onClick: () => setSection("exterior"),
					className: `flex-1 rounded-lg py-2.5 text-xs font-bold transition ${section === "exterior" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`,
					children: [
						"Exterior (",
						getAngles("exterior").length,
						")"
					]
				}), /* @__PURE__ */ jsxs("button", {
					onClick: () => setSection("interior"),
					className: `flex-1 rounded-lg py-2.5 text-xs font-bold transition ${section === "interior" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`,
					children: [
						"Interior (",
						getAngles("interior").length,
						")"
					]
				})]
			}),
			/* @__PURE__ */ jsxs("div", {
				className: "flex items-center justify-between",
				children: [/* @__PURE__ */ jsx("p", {
					className: "text-xs font-bold text-muted-foreground uppercase tracking-wider",
					children: section === "exterior" ? "Outside the car" : "Inside the car"
				}), /* @__PURE__ */ jsx("button", {
					onClick: onResetSection,
					className: "text-xs font-semibold text-primary hover:underline",
					children: "Reset"
				})]
			}),
			/* @__PURE__ */ jsx("div", {
				className: "grid grid-cols-2 gap-3",
				children: angles.map((angle) => {
					const captured = images.find((img) => img.angle === angle.id);
					return /* @__PURE__ */ jsx("button", {
						onClick: () => !captured && onCapture(angle.id),
						className: `relative rounded-2xl border-2 overflow-hidden aspect-square transition ${captured ? "border-[#10b981]" : "border-dashed border-border bg-secondary hover:border-primary/50"}`,
						children: captured ? /* @__PURE__ */ jsxs(Fragment, { children: [
							/* @__PURE__ */ jsx("img", {
								src: captured.dataUrl,
								alt: angle.label,
								className: "h-full w-full object-cover"
							}),
							/* @__PURE__ */ jsx("div", { className: "absolute inset-0 bg-black/20" }),
							/* @__PURE__ */ jsx("div", {
								className: "absolute top-2 right-2 flex gap-1",
								children: /* @__PURE__ */ jsx("span", {
									onClick: (e) => {
										e.stopPropagation();
										onRemoveImage(captured.id);
									},
									className: "grid place-items-center h-7 w-7 rounded-full bg-black/50 text-white hover:bg-red-600",
									children: /* @__PURE__ */ jsx(Trash2, { className: "h-3.5 w-3.5" })
								})
							}),
							/* @__PURE__ */ jsx("div", {
								className: "absolute bottom-0 left-0 right-0 bg-black/60 px-3 py-2",
								children: captured.analyzing ? /* @__PURE__ */ jsxs("div", {
									className: "flex items-center gap-1.5",
									children: [/* @__PURE__ */ jsx(Loader2, { className: "h-3.5 w-3.5 text-white animate-spin" }), /* @__PURE__ */ jsx("span", {
										className: "text-xs font-bold text-white",
										children: "Analyzing..."
									})]
								}) : captured.analysis ? /* @__PURE__ */ jsx("div", {
									className: "flex items-center gap-1.5",
									children: captured.analysis.hasDamage ? /* @__PURE__ */ jsxs(Fragment, { children: [/* @__PURE__ */ jsx(AlertTriangle, { className: "h-3.5 w-3.5 text-yellow-400" }), /* @__PURE__ */ jsxs("span", {
										className: "text-xs font-bold text-yellow-400 capitalize",
										children: [captured.analysis.severity, " damage"]
									})] }) : /* @__PURE__ */ jsxs(Fragment, { children: [/* @__PURE__ */ jsx(CheckCircle2, { className: "h-3.5 w-3.5 text-[#10b981]" }), /* @__PURE__ */ jsx("span", {
										className: "text-xs font-bold text-[#10b981]",
										children: "Clean"
									})] })
								}) : /* @__PURE__ */ jsxs("div", {
									className: "flex items-center gap-1.5",
									children: [/* @__PURE__ */ jsx(CheckCircle2, { className: "h-3.5 w-3.5 text-[#10b981]" }), /* @__PURE__ */ jsx("span", {
										className: "text-xs font-bold text-white",
										children: angle.label
									})]
								})
							})
						] }) : /* @__PURE__ */ jsxs("div", {
							className: "flex flex-col items-center justify-center h-full text-muted-foreground p-3 gap-2",
							children: [
								/* @__PURE__ */ jsx(Camera, { className: "h-6 w-6" }),
								/* @__PURE__ */ jsx("span", {
									className: "text-xs font-semibold text-center",
									children: angle.label
								}),
								/* @__PURE__ */ jsx("span", {
									className: "text-[10px] text-center leading-tight",
									children: angle.desc
								})
							]
						})
					}, angle.id);
				})
			}),
			/* @__PURE__ */ jsx("input", {
				type: "file",
				ref: fileRef,
				className: "hidden",
				accept: "image/*",
				capture: "environment",
				onChange: onFileChange
			}),
			/* @__PURE__ */ jsxs("div", {
				className: "mt-auto pt-4 pb-4 space-y-3",
				children: [
					/* @__PURE__ */ jsxs("div", {
						className: "flex items-center gap-2 text-xs text-muted-foreground",
						children: [/* @__PURE__ */ jsx("div", {
							className: "flex-1 h-2 rounded-full bg-secondary overflow-hidden",
							children: /* @__PURE__ */ jsx("div", {
								className: "h-full bg-primary transition-all duration-500 rounded-full",
								style: { width: `${totalCaptured / totalAngles * 100}%` }
							})
						}), /* @__PURE__ */ jsxs("span", {
							className: "font-bold shrink-0",
							children: [
								totalCaptured,
								"/",
								totalAngles
							]
						})]
					}),
					images.some((img) => img.analyzing) && /* @__PURE__ */ jsxs("p", {
						className: "text-xs text-muted-foreground flex items-center gap-1.5",
						children: [
							/* @__PURE__ */ jsx(Loader2, { className: "h-3 w-3 animate-spin text-primary" }),
							"AI analyzing ",
							images.filter((img) => img.analyzing).length,
							" photo",
							images.filter((img) => img.analyzing).length !== 1 ? "s" : "",
							"..."
						]
					}),
					/* @__PURE__ */ jsx("button", {
						onClick: onDone,
						disabled: totalCaptured === 0,
						className: "w-full rounded-2xl bg-primary py-4 text-sm font-bold text-primary-foreground shadow-sm active:scale-[0.99] transition disabled:opacity-40 disabled:pointer-events-none",
						children: totalCaptured >= totalAngles ? "Review & Submit" : `Continue (${totalCaptured}/${totalAngles} captured)`
					})
				]
			})
		]
	});
}
function PreviewStep({ images, notes, setNotes, isComplaint, previewImage, setPreviewImage, onSubmit, getAngles }) {
	const extAngles = getAngles("exterior");
	const intAngles = getAngles("interior");
	return /* @__PURE__ */ jsxs("div", {
		className: "flex-1 flex flex-col mt-6",
		children: [
			/* @__PURE__ */ jsxs("div", {
				className: "flex items-center justify-between mb-4",
				children: [/* @__PURE__ */ jsx("h3", {
					className: "text-base font-extrabold",
					children: "Review your scan"
				}), /* @__PURE__ */ jsxs("span", {
					className: "text-xs font-bold text-muted-foreground",
					children: [images.length, " photos"]
				})]
			}),
			/* @__PURE__ */ jsx(DamageSummary, {
				images,
				isComplaint
			}),
			/* @__PURE__ */ jsxs("div", {
				className: "space-y-4",
				children: [/* @__PURE__ */ jsx(SectionPreview, {
					title: "Exterior",
					angles: extAngles,
					images,
					onPreview: setPreviewImage
				}), /* @__PURE__ */ jsx(SectionPreview, {
					title: "Interior",
					angles: intAngles,
					images,
					onPreview: setPreviewImage
				})]
			}),
			/* @__PURE__ */ jsxs("div", {
				className: "mt-4",
				children: [/* @__PURE__ */ jsx("label", {
					className: "text-[11px] font-bold uppercase tracking-wider text-muted-foreground ml-1",
					children: "Notes (optional)"
				}), /* @__PURE__ */ jsx("textarea", {
					value: notes,
					onChange: (e) => setNotes(e.target.value),
					placeholder: isComplaint ? "Describe any damage or explain the condition..." : "Add any notes about the vehicle condition...",
					rows: 2,
					className: "mt-1 w-full rounded-xl bg-secondary border border-transparent focus-within:bg-background focus-within:border-primary px-3 py-3 text-sm font-medium outline-none resize-none"
				})]
			}),
			/* @__PURE__ */ jsx("div", {
				className: "mt-auto pt-6 pb-4",
				children: /* @__PURE__ */ jsx("button", {
					onClick: onSubmit,
					className: `w-full rounded-2xl py-4 text-sm font-bold text-primary-foreground shadow-sm active:scale-[0.99] transition ${isComplaint ? "bg-red-600 hover:bg-red-700" : "bg-primary hover:bg-primary/90"}`,
					children: isComplaint ? "Submit Complaint Scan" : "Submit Scan"
				})
			}),
			previewImage && /* @__PURE__ */ jsx("div", {
				className: "fixed inset-0 z-50 bg-black/90 flex items-center justify-center",
				onClick: () => setPreviewImage(null),
				children: /* @__PURE__ */ jsx("img", {
					src: previewImage,
					alt: "Preview",
					className: "max-h-[80vh] max-w-[90vw] rounded-2xl object-contain"
				})
			})
		]
	});
}
function DamageSummary({ images, isComplaint }) {
	const analyzed = images.filter((img) => img.analysis);
	const damaged = analyzed.filter((img) => img.analysis?.hasDamage);
	const bySeverity = (sev) => damaged.filter((img) => img.analysis?.severity === sev).length;
	const severeCount = bySeverity("severe");
	const moderateCount = bySeverity("moderate");
	const minorCount = bySeverity("minor");
	if (analyzed.length === 0) return null;
	if (damaged.length === 0) return /* @__PURE__ */ jsxs("div", {
		className: "mb-4 rounded-xl bg-[#10b981]/10 border border-[#10b981]/30 p-4 flex items-center gap-3",
		children: [/* @__PURE__ */ jsx("div", {
			className: "h-10 w-10 rounded-full bg-[#10b981]/20 grid place-items-center shrink-0",
			children: /* @__PURE__ */ jsx(ShieldAlert, { className: "h-5 w-5 text-[#10b981]" })
		}), /* @__PURE__ */ jsxs("div", { children: [/* @__PURE__ */ jsx("p", {
			className: "text-sm font-bold text-[#10b981]",
			children: "All Clear"
		}), /* @__PURE__ */ jsxs("p", {
			className: "text-xs text-muted-foreground",
			children: [
				"AI inspection found no damage across ",
				analyzed.length,
				" analyzed angles"
			]
		})] })]
	});
	return /* @__PURE__ */ jsxs("div", {
		className: "mb-4 rounded-xl bg-red-50 border border-red-200 p-4",
		children: [
			/* @__PURE__ */ jsxs("div", {
				className: "flex items-center gap-3 mb-3",
				children: [/* @__PURE__ */ jsx("div", {
					className: "h-10 w-10 rounded-full bg-red-100 grid place-items-center shrink-0",
					children: /* @__PURE__ */ jsx(AlertTriangle, { className: "h-5 w-5 text-red-600" })
				}), /* @__PURE__ */ jsxs("div", { children: [/* @__PURE__ */ jsx("p", {
					className: "text-sm font-bold text-red-700",
					children: isComplaint ? "Damage Confirmed" : "Damage Detected"
				}), /* @__PURE__ */ jsxs("p", {
					className: "text-xs text-red-600",
					children: [
						"AI found damage in ",
						damaged.length,
						" of ",
						analyzed.length,
						" analyzed angles"
					]
				})] })]
			}),
			severeCount > 0 && /* @__PURE__ */ jsxs("div", {
				className: "flex items-center gap-2 text-xs mb-1",
				children: [
					/* @__PURE__ */ jsx("span", { className: "h-2 w-2 rounded-full bg-red-600 shrink-0" }),
					/* @__PURE__ */ jsxs("span", {
						className: "font-bold text-red-700",
						children: [severeCount, " severe"]
					}),
					/* @__PURE__ */ jsx("span", {
						className: "text-muted-foreground",
						children: "— structural or large damage"
					})
				]
			}),
			moderateCount > 0 && /* @__PURE__ */ jsxs("div", {
				className: "flex items-center gap-2 text-xs mb-1",
				children: [
					/* @__PURE__ */ jsx("span", { className: "h-2 w-2 rounded-full bg-yellow-500 shrink-0" }),
					/* @__PURE__ */ jsxs("span", {
						className: "font-bold text-yellow-700",
						children: [moderateCount, " moderate"]
					}),
					/* @__PURE__ */ jsx("span", {
						className: "text-muted-foreground",
						children: "— dent larger than a coin"
					})
				]
			}),
			minorCount > 0 && /* @__PURE__ */ jsxs("div", {
				className: "flex items-center gap-2 text-xs",
				children: [
					/* @__PURE__ */ jsx("span", { className: "h-2 w-2 rounded-full bg-blue-500 shrink-0" }),
					/* @__PURE__ */ jsxs("span", {
						className: "font-bold text-blue-700",
						children: [minorCount, " minor"]
					}),
					/* @__PURE__ */ jsx("span", {
						className: "text-muted-foreground",
						children: "— small scratch or chip"
					})
				]
			}),
			/* @__PURE__ */ jsxs("div", {
				className: "mt-3 space-y-1.5 border-t border-red-200 pt-3",
				children: [damaged.slice(0, 4).map((img) => /* @__PURE__ */ jsxs("p", {
					className: "text-xs text-red-700 flex items-start gap-1.5",
					children: [/* @__PURE__ */ jsx("span", {
						className: "shrink-0 mt-0.5",
						children: "•"
					}), /* @__PURE__ */ jsxs("span", { children: [
						/* @__PURE__ */ jsxs("strong", { children: [img.label, ":"] }),
						" ",
						img.analysis?.description
					] })]
				}, img.id)), damaged.length > 4 && /* @__PURE__ */ jsxs("p", {
					className: "text-xs text-muted-foreground pl-3.5",
					children: [
						"+",
						damaged.length - 4,
						" more damaged areas"
					]
				})]
			})
		]
	});
}
function SectionPreview({ title, angles, images, onPreview }) {
	const sectionImages = angles.map((a) => images.find((img) => img.angle === a.id)).filter(Boolean);
	if (sectionImages.length === 0) return null;
	return /* @__PURE__ */ jsxs("div", { children: [/* @__PURE__ */ jsxs("h4", {
		className: "text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2",
		children: [
			title,
			" (",
			sectionImages.length,
			"/",
			angles.length,
			")"
		]
	}), /* @__PURE__ */ jsx("div", {
		className: "grid grid-cols-3 gap-2",
		children: sectionImages.map((img) => /* @__PURE__ */ jsx("button", {
			onClick: () => onPreview(img.dataUrl),
			className: "rounded-xl overflow-hidden border border-border aspect-square",
			children: /* @__PURE__ */ jsx("img", {
				src: img.dataUrl,
				alt: img.label,
				className: "h-full w-full object-cover"
			})
		}, img.id))
	})] });
}
//#endregion
export { CarScannerPage as component };
