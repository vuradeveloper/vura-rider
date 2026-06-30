import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { ArrowLeft, Camera, CheckCircle2, AlertTriangle, Car, Trash2, Eye, Loader2, ShieldAlert } from "lucide-react";
import { PhoneShell } from "@/components/PhoneShell";
import { useAuth } from "@/lib/auth";
import { useState, useRef } from "react";
import {
  submitScan,
  getAngles,
  type ScanImage,
  type ScanSection,
  type ScanType,
} from "@/lib/car-scan";
import { analyzeCarImage } from "@/lib/vision";

interface ScannerSearch {
  complaint?: string;
}

export const Route = createFileRoute("/car-scanner")({
  head: () => ({ meta: [{ title: "Car Scanner — Vura" }] }),
  component: CarScannerPage,
  validateSearch: (s: Record<string, unknown>): ScannerSearch => ({
    complaint: typeof s.complaint === "string" ? s.complaint : undefined,
  }),
});

const STEP_INTRO = "intro";
const STEP_SCAN = "scan";
const STEP_PREVIEW = "preview";

function CarScannerPage() {
  const user = useAuth();
  const nav = useNavigate();
  const search = useSearch({ from: "/car-scanner" });
  const isComplaint = search.complaint === "true";

  const [step, setStep] = useState<string>(STEP_INTRO);
  const [section, setSection] = useState<ScanSection>("exterior");
  const [images, setImages] = useState<ScanImage[]>([]);
  const [notes, setNotes] = useState("");
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [currentAngleId, setCurrentAngleId] = useState<string | null>(null);

  if (!user) return null;

  const angles = getAngles(section);

  function handleStart() {
    setStep(STEP_SCAN);
  }

  function handleCapture(angleId: string) {
    setCurrentAngleId(angleId);
    fileRef.current?.click();
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !currentAngleId) return;
    const angle = angles.find((a) => a.id === currentAngleId);
    if (!angle) return;

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const newImage: ScanImage = {
        id: `${currentAngleId}-${Date.now()}`,
        angle: currentAngleId,
        label: angle.label,
        dataUrl,
        timestamp: Date.now(),
        analyzing: true,
      };
      setImages((prev) => {
        const filtered = prev.filter((img) => img.angle !== currentAngleId);
        return [...filtered, newImage];
      });

      analyzeCarImage({
        data: {
          imageBase64: dataUrl,
          angle: currentAngleId,
          label: angle.label,
        },
      })
        .then((analysis) => {
          setImages((prev) =>
            prev.map((img) =>
              img.id === newImage.id
                ? { ...img, analysis, analyzing: false }
                : img
            )
          );
        })
        .catch(() => {
          setImages((prev) =>
            prev.map((img) =>
              img.id === newImage.id ? { ...img, analyzing: false } : img
            )
          );
        });
    };
    reader.readAsDataURL(file);
    e.target.value = "";
    setCurrentAngleId(null);
  }

  function handleRemoveImage(imageId: string) {
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
    const scan = {
      id: `scan-${Date.now()}`,
      images,
      timestamp: Date.now(),
      type: (isComplaint ? "complaint" : "routine") as ScanType,
      notes,
      submitted: true,
    };
    submitScan(scan);
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

  const sectionComplete =
    images.filter((img) => angles.some((a) => a.id === img.angle)).length ===
    angles.length;

  const totalAngleList = [...getAngles("exterior"), ...getAngles("interior")];
  const totalAngleCount = totalAngleList.length;
  const totalCaptured = totalAngleList.filter((a) =>
    images.some((img) => img.angle === a.id)
  ).length;

  return (
    <PhoneShell hideTabs>
      <div
        className={`hero-gradient text-primary-foreground px-5 pt-4 pb-8 rounded-b-[2rem] relative ${
          isComplaint ? "!bg-red-600" : ""
        }`}
      >
        <button
          onClick={handleBack}
          className="absolute top-4 left-4 grid place-items-center h-9 w-9 rounded-full bg-white/20 hover:bg-white/30 transition z-10"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>

        <div className="mt-12 flex items-center gap-3">
          <div
            className={`h-12 w-12 rounded-full grid place-items-center ${
              isComplaint ? "bg-red-400" : "bg-white/20"
            }`}
          >
            {isComplaint ? (
              <AlertTriangle className="h-6 w-6" />
            ) : (
              <Car className="h-6 w-6" />
            )}
          </div>
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight">
              {isComplaint ? "Complaint Scan" : "Car Scanner"}
            </h1>
            <p className="text-sm opacity-85 mt-0.5">
              {isComplaint
                ? "Required — a rider reported damage"
                : "Verify your vehicle is in good condition"}
            </p>
          </div>
        </div>

        {isComplaint && (
          <div className="mt-3 flex items-center gap-2 rounded-xl bg-red-400/30 px-4 py-2.5 text-sm font-semibold">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>
              A rider has reported damage. Please scan all angles of your car to
              verify its condition.
            </span>
          </div>
        )}
      </div>

      <div className="px-5 flex-1 flex flex-col">
        {step === STEP_INTRO && (
          <IntroStep
            isComplaint={isComplaint}
            onStart={handleStart}
          />
        )}

        {step === STEP_SCAN && (
          <ScanStep
            section={section}
            setSection={setSection}
            images={images}
            fileRef={fileRef}
            onCapture={handleCapture}
            onRemoveImage={handleRemoveImage}
            onResetSection={handleResetSection}
            sectionComplete={sectionComplete}
            totalCaptured={totalCaptured}
            totalAngles={totalAngleCount}
            onDone={handleDoneScanning}
            onFileChange={handleFileChange}
          />
        )}

        {step === STEP_PREVIEW && (
          <PreviewStep
            images={images}
            notes={notes}
            setNotes={setNotes}
            isComplaint={isComplaint}
            previewImage={previewImage}
            setPreviewImage={setPreviewImage}
            onSubmit={handleSubmit}
            getAngles={getAngles}
          />
        )}
      </div>

      <div className="h-6" />
    </PhoneShell>
  );
}

function IntroStep({
  isComplaint,
  onStart,
}: {
  isComplaint: boolean;
  onStart: () => void;
}) {
  return (
    <div className="flex-1 flex flex-col mt-6">
      <div className="rounded-2xl bg-surface border border-border shadow-sm p-5">
        <h3 className="text-sm font-bold">What to scan</h3>
        <div className="mt-4 space-y-3">
          <div className="flex items-start gap-3">
            <span className="grid place-items-center h-8 w-8 rounded-full bg-accent text-primary shrink-0 mt-0.5">
              <Car className="h-4 w-4" />
            </span>
            <div>
              <p className="text-sm font-semibold">Exterior — 6 angles</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Front, rear, left side, right side, hood, and trunk
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <span className="grid place-items-center h-8 w-8 rounded-full bg-accent text-primary shrink-0 mt-0.5">
              <Eye className="h-4 w-4" />
            </span>
            <div>
              <p className="text-sm font-semibold">Interior — 4 angles</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Dashboard, front seats, back seats, and trunk interior
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-4 rounded-2xl bg-surface border border-border shadow-sm p-5">
        <h3 className="text-sm font-bold">Tips for a good scan</h3>
        <ul className="mt-3 space-y-2 text-xs text-muted-foreground">
          <li className="flex items-start gap-2">
            <CheckCircle2 className="h-3.5 w-3.5 text-[#10b981] shrink-0 mt-0.5" />
            Park in a well-lit area with space around the car
          </li>
          <li className="flex items-start gap-2">
            <CheckCircle2 className="h-3.5 w-3.5 text-[#10b981] shrink-0 mt-0.5" />
            Stand about 2 meters away for exterior shots
          </li>
          <li className="flex items-start gap-2">
            <CheckCircle2 className="h-3.5 w-3.5 text-[#10b981] shrink-0 mt-0.5" />
            Make sure the entire section is visible in frame
          </li>
          <li className="flex items-start gap-2">
            <CheckCircle2 className="h-3.5 w-3.5 text-[#10b981] shrink-0 mt-0.5" />
            Avoid glare from direct sunlight
          </li>
        </ul>
      </div>

      <div className="mt-auto pt-6 pb-4">
        <button
          onClick={onStart}
          className={`w-full rounded-2xl py-4 text-sm font-bold text-primary-foreground shadow-sm active:scale-[0.99] transition ${
            isComplaint
              ? "bg-red-600 hover:bg-red-700"
              : "bg-primary hover:bg-primary/90"
          }`}
        >
          {isComplaint ? "Start Complaint Scan" : "Start Scanning"}
        </button>
      </div>
    </div>
  );
}

function ScanStep({
  section,
  setSection,
  images,
  fileRef,
  onCapture,
  onRemoveImage,
  onResetSection,
  sectionComplete,
  totalCaptured,
  totalAngles,
  onDone,
  onFileChange,
}: {
  section: ScanSection;
  setSection: (s: ScanSection) => void;
  images: ScanImage[];
  fileRef: React.RefObject<HTMLInputElement | null>;
  onCapture: (angleId: string) => void;
  onRemoveImage: (imageId: string) => void;
  onResetSection: () => void;
  sectionComplete: boolean;
  totalCaptured: number;
  totalAngles: number;
  onDone: () => void;
  onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  const angles = getAngles(section);

  return (
    <div className="flex-1 flex flex-col mt-6 gap-4">
      <div className="flex rounded-xl bg-surface border border-border p-1 gap-1">
        <button
          onClick={() => setSection("exterior")}
          className={`flex-1 rounded-lg py-2.5 text-xs font-bold transition ${
            section === "exterior"
              ? "bg-primary text-primary-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Exterior ({getAngles("exterior").length})
        </button>
        <button
          onClick={() => setSection("interior")}
          className={`flex-1 rounded-lg py-2.5 text-xs font-bold transition ${
            section === "interior"
              ? "bg-primary text-primary-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Interior ({getAngles("interior").length})
        </button>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
          {section === "exterior" ? "Outside the car" : "Inside the car"}
        </p>
        <button
          onClick={onResetSection}
          className="text-xs font-semibold text-primary hover:underline"
        >
          Reset
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {angles.map((angle) => {
          const captured = images.find((img) => img.angle === angle.id);
          return (
            <button
              key={angle.id}
              onClick={() => !captured && onCapture(angle.id)}
              className={`relative rounded-2xl border-2 overflow-hidden aspect-square transition ${
                captured
                  ? "border-[#10b981]"
                  : "border-dashed border-border bg-secondary hover:border-primary/50"
              }`}
            >
              {captured ? (
                <>
                  <img
                    src={captured.dataUrl}
                    alt={angle.label}
                    className="h-full w-full object-cover"
                  />
                  <div className="absolute inset-0 bg-black/20" />
                  <div className="absolute top-2 right-2 flex gap-1">
                    <span
                      onClick={(e) => {
                        e.stopPropagation();
                        onRemoveImage(captured.id);
                      }}
                      className="grid place-items-center h-7 w-7 rounded-full bg-black/50 text-white hover:bg-red-600"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </span>
                  </div>
                  <div className="absolute bottom-0 left-0 right-0 bg-black/60 px-3 py-2">
                    {captured.analyzing ? (
                      <div className="flex items-center gap-1.5">
                        <Loader2 className="h-3.5 w-3.5 text-white animate-spin" />
                        <span className="text-xs font-bold text-white">
                          Analyzing...
                        </span>
                      </div>
                    ) : captured.analysis ? (
                      <div className="flex items-center gap-1.5">
                        {captured.analysis.hasDamage ? (
                          <>
                            <AlertTriangle className="h-3.5 w-3.5 text-yellow-400" />
                            <span className="text-xs font-bold text-yellow-400 capitalize">
                              {captured.analysis.severity} damage
                            </span>
                          </>
                        ) : (
                          <>
                            <CheckCircle2 className="h-3.5 w-3.5 text-[#10b981]" />
                            <span className="text-xs font-bold text-[#10b981]">
                              Clean
                            </span>
                          </>
                        )}
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5">
                        <CheckCircle2 className="h-3.5 w-3.5 text-[#10b981]" />
                        <span className="text-xs font-bold text-white">
                          {angle.label}
                        </span>
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-muted-foreground p-3 gap-2">
                  <Camera className="h-6 w-6" />
                  <span className="text-xs font-semibold text-center">
                    {angle.label}
                  </span>
                  <span className="text-[10px] text-center leading-tight">
                    {angle.desc}
                  </span>
                </div>
              )}
            </button>
          );
        })}
      </div>

      <input
        type="file"
        ref={fileRef}
        className="hidden"
        accept="image/*"
        capture="environment"
        onChange={onFileChange}
      />

      <div className="mt-auto pt-4 pb-4 space-y-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <div className="flex-1 h-2 rounded-full bg-secondary overflow-hidden">
            <div
              className="h-full bg-primary transition-all duration-500 rounded-full"
              style={{ width: `${(totalCaptured / totalAngles) * 100}%` }}
            />
          </div>
          <span className="font-bold shrink-0">
            {totalCaptured}/{totalAngles}
          </span>
        </div>

        {images.some((img) => img.analyzing) && (
          <p className="text-xs text-muted-foreground flex items-center gap-1.5">
            <Loader2 className="h-3 w-3 animate-spin text-primary" />
            AI analyzing {images.filter((img) => img.analyzing).length} photo
            {images.filter((img) => img.analyzing).length !== 1 ? "s" : ""}...
          </p>
        )}

        <button
          onClick={onDone}
          disabled={totalCaptured === 0}
          className="w-full rounded-2xl bg-primary py-4 text-sm font-bold text-primary-foreground shadow-sm active:scale-[0.99] transition disabled:opacity-40 disabled:pointer-events-none"
        >
          {totalCaptured >= totalAngles
            ? "Review & Submit"
            : `Continue (${totalCaptured}/${totalAngles} captured)`}
        </button>
      </div>
    </div>
  );
}

function PreviewStep({
  images,
  notes,
  setNotes,
  isComplaint,
  previewImage,
  setPreviewImage,
  onSubmit,
  getAngles,
}: {
  images: ScanImage[];
  notes: string;
  setNotes: (n: string) => void;
  isComplaint: boolean;
  previewImage: string | null;
  setPreviewImage: (u: string | null) => void;
  onSubmit: () => void;
  getAngles: (s: ScanSection) => { id: string; label: string }[];
}) {
  const extAngles = getAngles("exterior");
  const intAngles = getAngles("interior");

  return (
    <div className="flex-1 flex flex-col mt-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-extrabold">Review your scan</h3>
        <span className="text-xs font-bold text-muted-foreground">
          {images.length} photos
        </span>
      </div>

      <DamageSummary images={images} isComplaint={isComplaint} />

      <div className="space-y-4">
        <SectionPreview
          title="Exterior"
          angles={extAngles}
          images={images}
          onPreview={setPreviewImage}
        />

        <SectionPreview
          title="Interior"
          angles={intAngles}
          images={images}
          onPreview={setPreviewImage}
        />
      </div>

      <div className="mt-4">
        <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground ml-1">
          Notes (optional)
        </label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder={
            isComplaint
              ? "Describe any damage or explain the condition..."
              : "Add any notes about the vehicle condition..."
          }
          rows={2}
          className="mt-1 w-full rounded-xl bg-secondary border border-transparent focus-within:bg-background focus-within:border-primary px-3 py-3 text-sm font-medium outline-none resize-none"
        />
      </div>

      <div className="mt-auto pt-6 pb-4">
        <button
          onClick={onSubmit}
          className={`w-full rounded-2xl py-4 text-sm font-bold text-primary-foreground shadow-sm active:scale-[0.99] transition ${
            isComplaint
              ? "bg-red-600 hover:bg-red-700"
              : "bg-primary hover:bg-primary/90"
          }`}
        >
          {isComplaint ? "Submit Complaint Scan" : "Submit Scan"}
        </button>
      </div>

      {previewImage && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center"
          onClick={() => setPreviewImage(null)}
        >
          <img
            src={previewImage}
            alt="Preview"
            className="max-h-[80vh] max-w-[90vw] rounded-2xl object-contain"
          />
        </div>
      )}
    </div>
  );
}

function DamageSummary({
  images,
  isComplaint,
}: {
  images: ScanImage[];
  isComplaint: boolean;
}) {
  const analyzed = images.filter((img) => img.analysis);
  const damaged = analyzed.filter((img) => img.analysis?.hasDamage);
  const bySeverity = (sev: string) =>
    damaged.filter((img) => img.analysis?.severity === sev).length;
  const severeCount = bySeverity("severe");
  const moderateCount = bySeverity("moderate");
  const minorCount = bySeverity("minor");

  if (analyzed.length === 0) return null;

  if (damaged.length === 0) {
    return (
      <div className="mb-4 rounded-xl bg-[#10b981]/10 border border-[#10b981]/30 p-4 flex items-center gap-3">
        <div className="h-10 w-10 rounded-full bg-[#10b981]/20 grid place-items-center shrink-0">
          <ShieldAlert className="h-5 w-5 text-[#10b981]" />
        </div>
        <div>
          <p className="text-sm font-bold text-[#10b981]">All Clear</p>
          <p className="text-xs text-muted-foreground">
            AI inspection found no damage across {analyzed.length} analyzed angles
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mb-4 rounded-xl bg-red-50 border border-red-200 p-4">
      <div className="flex items-center gap-3 mb-3">
        <div className="h-10 w-10 rounded-full bg-red-100 grid place-items-center shrink-0">
          <AlertTriangle className="h-5 w-5 text-red-600" />
        </div>
        <div>
          <p className="text-sm font-bold text-red-700">
            {isComplaint ? "Damage Confirmed" : "Damage Detected"}
          </p>
          <p className="text-xs text-red-600">
            AI found damage in {damaged.length} of {analyzed.length} analyzed
            angles
          </p>
        </div>
      </div>

      {severeCount > 0 && (
        <div className="flex items-center gap-2 text-xs mb-1">
          <span className="h-2 w-2 rounded-full bg-red-600 shrink-0" />
          <span className="font-bold text-red-700">{severeCount} severe</span>
          <span className="text-muted-foreground">
            — structural or large damage
          </span>
        </div>
      )}
      {moderateCount > 0 && (
        <div className="flex items-center gap-2 text-xs mb-1">
          <span className="h-2 w-2 rounded-full bg-yellow-500 shrink-0" />
          <span className="font-bold text-yellow-700">
            {moderateCount} moderate
          </span>
          <span className="text-muted-foreground">
            — dent larger than a coin
          </span>
        </div>
      )}
      {minorCount > 0 && (
        <div className="flex items-center gap-2 text-xs">
          <span className="h-2 w-2 rounded-full bg-blue-500 shrink-0" />
          <span className="font-bold text-blue-700">{minorCount} minor</span>
          <span className="text-muted-foreground">
            — small scratch or chip
          </span>
        </div>
      )}

      <div className="mt-3 space-y-1.5 border-t border-red-200 pt-3">
        {damaged.slice(0, 4).map((img) => (
          <p
            key={img.id}
            className="text-xs text-red-700 flex items-start gap-1.5"
          >
            <span className="shrink-0 mt-0.5">&#8226;</span>
            <span>
              <strong>{img.label}:</strong> {img.analysis?.description}
            </span>
          </p>
        ))}
        {damaged.length > 4 && (
          <p className="text-xs text-muted-foreground pl-3.5">
            +{damaged.length - 4} more damaged areas
          </p>
        )}
      </div>
    </div>
  );
}

function SectionPreview({
  title,
  angles,
  images,
  onPreview,
}: {
  title: string;
  angles: { id: string; label: string }[];
  images: ScanImage[];
  onPreview: (url: string) => void;
}) {
  const sectionImages = angles
    .map((a) => images.find((img) => img.angle === a.id))
    .filter(Boolean) as ScanImage[];

  if (sectionImages.length === 0) return null;

  return (
    <div>
      <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">
        {title} ({sectionImages.length}/{angles.length})
      </h4>
      <div className="grid grid-cols-3 gap-2">
        {sectionImages.map((img) => (
          <button
            key={img.id}
            onClick={() => onPreview(img.dataUrl)}
            className="rounded-xl overflow-hidden border border-border aspect-square"
          >
            <img
              src={img.dataUrl}
              alt={img.label}
              className="h-full w-full object-cover"
            />
          </button>
        ))}
      </div>
    </div>
  );
}
