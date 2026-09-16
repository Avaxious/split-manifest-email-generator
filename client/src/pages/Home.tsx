import {
  AlertTriangle,
  Anchor,
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Download,
  FileText,
  Files,
  History as HistoryIcon,
  Inbox,
  Info,
  LayoutDashboard,
  LockKeyhole,
  Mail,
  MoreHorizontal,
  Paperclip,
  Play,
  Plus,
  RefreshCw,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  UploadCloud,
  Workflow,
  X,
  Zap,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { toast } from "sonner";
import {
  buildEml,
  buildHtmlBody,
  buildPlainTextBody,
  buildSubject,
  createDemoFields,
  extractFieldsFromFiles,
  getMissingRequiredFields,
  normalizeDate,
  validateContainerNumber,
  validateDocumentFile,
  type FieldKey,
  type ShipmentField,
  type ShipmentFields,
} from "@shared/shipping";

type Screen = "dashboard" | "new" | "history" | "settings";
type WorkflowStep = "upload" | "extract" | "cross-check" | "review" | "email" | "outlook";
type FileStatus = "Ready" | "Uploaded" | "Analyzing" | "Analyzed" | "Error";
type UploadItem = { id: string; file: File; kind: string; status: FileStatus; reason?: string };
type Job = { id: string; createdAt: string; container: string; mbl: string; vessel: string; voyage: string; pol: string; status: string; outlook: string };
type StoredUploadItem = { id: string; name: string; size: number; type: string; kind: string; status: FileStatus };

const uploadDb = typeof indexedDB === "undefined" ? null : indexedDB;
function openUploadDb(): Promise<IDBDatabase | null> {
  if (!uploadDb) return Promise.resolve(null);
  return new Promise((resolve) => {
    const request = uploadDb.open("split-manifest-files", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("files");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
}
async function storeUploadFile(id: string, file: File) {
  const db = await openUploadDb(); if (!db) return;
  await new Promise<void>((resolve) => { const tx = db.transaction("files", "readwrite"); tx.objectStore("files").put(file, id); tx.oncomplete = () => resolve(); tx.onerror = () => resolve(); });
}
async function readUploadFile(id: string): Promise<File | undefined> {
  const db = await openUploadDb(); if (!db) return undefined;
  return new Promise((resolve) => { const request = db.transaction("files", "readonly").objectStore("files").get(id); request.onsuccess = () => resolve(request.result as File | undefined); request.onerror = () => resolve(undefined); });
}
async function deleteUploadFile(id: string) {
  const db = await openUploadDb(); if (!db) return;
  await new Promise<void>((resolve) => { const tx = db.transaction("files", "readwrite"); tx.objectStore("files").delete(id); tx.oncomplete = () => resolve(); tx.onerror = () => resolve(); });
}

type SignatureSettings = { signatureHtml: string; signatureText: string; dateFormat: string; retentionDays: string };

const navItems: Array<{ id: Screen; label: string; icon: typeof LayoutDashboard }> = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "new", label: "New email", icon: Plus },
  { id: "history", label: "History", icon: HistoryIcon },
  { id: "settings", label: "Settings", icon: Settings2 },
];

const steps: Array<{ id: WorkflowStep; label: string }> = [
  { id: "upload", label: "Upload" },
  { id: "extract", label: "Extract" },
  { id: "cross-check", label: "Cross-check" },
  { id: "review", label: "Review" },
  { id: "email", label: "Generate email" },
  { id: "outlook", label: "Outlook" },
];

const starterJobs: Job[] = [
  { id: "SM-2407", createdAt: "12 Sep 2026, 12:48", container: "BMOU4873674", mbl: "SIJEAAEC26005671", vessel: "YES / 26706W", voyage: "26706W", pol: "DUBAI", status: "EML Prepared", outlook: "Ready to open" },
  { id: "SM-2406", createdAt: "11 Sep 2026, 16:22", container: "TGHU9081123", mbl: "COSU6601849220", vessel: "EVER GIVEN / 041W", voyage: "041W", pol: "JEBEL ALI", status: "Needs Review", outlook: "—" },
  { id: "SM-2405", createdAt: "11 Sep 2026, 09:14", container: "MSCU7710248", mbl: "MAEU260901884", vessel: "MAERSK LIMA / 624S", voyage: "624S", pol: "PORT KLANG", status: "Outlook Draft Created", outlook: "Draft saved" },
  { id: "SM-2404", createdAt: "10 Sep 2026, 14:31", container: "CAIU4820910", mbl: "HLCUHAM26083421", vessel: "HAMBURG EXPRESS / 032E", voyage: "032E", pol: "SHANGHAI", status: "Failed", outlook: "Retry available" },
];

const defaultSettings: SignatureSettings = { signatureHtml: "", signatureText: "", dateFormat: "YYYY/MM/DD", retentionDays: "90" };

function formatSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fieldValue(fields: ShipmentFields, key: FieldKey) {
  return fields[key]?.value ?? "";
}

function ConfidenceBadge({ field }: { field: ShipmentField }) {
  const color = field.confidence >= 90 ? "high" : field.confidence >= 70 ? "medium" : "low";
  const styles = {
    high: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    medium: "bg-amber-50 text-amber-700 ring-amber-200",
    low: "bg-rose-50 text-rose-700 ring-rose-200",
  }[color];
  return <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${styles}`}><span className={`h-1.5 w-1.5 rounded-full ${color === "high" ? "bg-emerald-500" : color === "medium" ? "bg-amber-500" : "bg-rose-500"}`} />{field.confidence}%</span>;
}

function StatusBadge({ status }: { status: string }) {
  const className = status === "Confirmed" || status === "EML Prepared" || status === "Outlook Draft Created" || status === "Ready"
    ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
    : status === "Needs Review" || status === "Processing" || status === "Analyzing"
      ? "bg-amber-50 text-amber-700 ring-amber-200"
      : status === "Failed" || status === "Missing" || status === "Conflict"
        ? "bg-rose-50 text-rose-700 ring-rose-200"
        : "bg-slate-100 text-slate-600 ring-slate-200";
  return <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${className}`}><span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />{status}</span>;
}

function AppShell({ screen, onNavigate, children }: { screen: Screen; onNavigate: (screen: Screen) => void; children: React.ReactNode }) {
  return <div className="min-h-screen bg-[#f4f7fa] text-[#172b4d]">
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-[248px] flex-col border-r border-[#dce5ee] bg-[#10243e] text-white lg:flex">
      <div className="flex h-[78px] items-center gap-3 border-b border-white/10 px-7">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#2d8cff] shadow-[0_7px_18px_rgba(45,140,255,0.35)]"><Anchor className="h-5 w-5" /></div>
        <div><div className="text-[14px] font-bold leading-tight tracking-[-0.01em]">Split Manifest</div><div className="text-[11px] text-[#9fb4ca]">Email Generator</div></div>
      </div>
      <div className="px-5 pt-8"><div className="mb-3 px-3 text-[10px] font-bold uppercase tracking-[0.16em] text-[#7690aa]">Workspace</div>
        <nav className="space-y-1">{navItems.map((item) => { const Icon = item.icon; const active = item.id === screen; return <button key={item.id} onClick={() => onNavigate(item.id)} className={`group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[13px] font-semibold transition ${active ? "bg-[#1d426c] text-white shadow-[inset_3px_0_0_#55a7ff]" : "text-[#b6c8da] hover:bg-white/8 hover:text-white"}`}><Icon className={`h-[17px] w-[17px] ${active ? "text-[#65b2ff]" : "text-[#89a4bf]"}`} /><span>{item.label}</span>{item.id === "history" && <span className="ml-auto rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-[#d5e3f0]">24</span>}</button> })}</nav>
      </div>
      <div className="mt-auto p-5"><div className="rounded-2xl border border-white/10 bg-white/5 p-4"><div className="mb-3 flex items-center gap-2 text-xs font-semibold text-[#d9e7f4]"><ShieldCheck className="h-4 w-4 text-[#63b3ff]" /> Secure workspace</div><p className="text-[11px] leading-relaxed text-[#8fa7bf]">Files stay private and are only used for the current shipment workflow.</p></div><div className="mt-5 flex items-center gap-3 border-t border-white/10 pt-4"><div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#d6e9fb] text-xs font-bold text-[#0f4c81]">AM</div><div className="min-w-0"><div className="truncate text-xs font-bold text-white">Alex Morgan</div><div className="truncate text-[10px] text-[#91a8bf]">Operations team</div></div><MoreHorizontal className="ml-auto h-4 w-4 text-[#849db5]" /></div></div>
    </aside>
    <div className="lg:pl-[248px]">{children}</div>
  </div>;
}

function Topbar({ screen, onNew }: { screen: Screen; onNew: () => void }) {
  const titles: Record<Screen, [string, string]> = { dashboard: ["Operations overview", "Monitor jobs, review exceptions, and prepare Outlook-safe email drafts."], new: ["New split manifest email", "Upload source documents and prepare a verified draft."], history: ["Job history", "Search prior shipments and inspect their audit trail."], settings: ["Workspace settings", "Configure signatures, formats, and integration readiness."] };
  return <header className="sticky top-0 z-20 flex min-h-[78px] items-center justify-between border-b border-[#dde6ef] bg-[#f7f9fb]/95 px-5 backdrop-blur md:px-9"><div><div className="mb-1 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.12em] text-[#7a90a6]"><span>Split Manifest</span><ChevronRight className="h-3 w-3" /><span className="text-[#2d8cff]">{titles[screen][0]}</span></div><h1 className="text-[20px] font-bold tracking-[-0.025em] text-[#172b4d]">{titles[screen][0]}</h1><p className="hidden text-xs text-[#6d8194] sm:block">{titles[screen][1]}</p></div><div className="flex items-center gap-2.5"><div className="hidden items-center gap-2 rounded-full border border-[#dce5ee] bg-white px-3 py-2 text-xs text-[#5e7489] md:flex"><span className="h-2 w-2 rounded-full bg-emerald-500" /> All systems operational</div><button className="hidden h-9 w-9 items-center justify-center rounded-lg border border-[#dce5ee] bg-white text-[#71869a] shadow-sm transition hover:border-[#bad5ed] hover:text-[#2d8cff] sm:flex" aria-label="Notifications"><Inbox className="h-4 w-4" /></button>{screen !== "new" && <button onClick={onNew} className="flex h-9 items-center gap-2 rounded-lg bg-[#1677d2] px-3.5 text-xs font-bold text-white shadow-[0_5px_12px_rgba(22,119,210,0.18)] transition hover:bg-[#0e68bf] active:scale-[0.98]"><Plus className="h-4 w-4" /> New email</button>}</div></header>;
}

function Stepper({ current }: { current: WorkflowStep }) {
  const index = steps.findIndex((step) => step.id === current);
  return <div className="mb-7 flex items-center overflow-x-auto rounded-2xl border border-[#dce5ee] bg-white px-4 py-3 shadow-[0_4px_14px_rgba(22,58,91,0.03)]"><div className="flex min-w-[720px] w-full items-center justify-between">{steps.map((step, stepIndex) => { const complete = stepIndex < index; const active = stepIndex === index; return <div key={step.id} className="flex items-center"><div className="flex items-center gap-2"><div className={`flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-bold ring-1 ${complete ? "bg-[#e9f7ef] text-[#16945c] ring-[#b6e6ca]" : active ? "bg-[#1677d2] text-white ring-[#1677d2] shadow-[0_3px_8px_rgba(22,119,210,0.2)]" : "bg-[#f4f7fa] text-[#8093a5] ring-[#dce5ee]"}`}>{complete ? <Check className="h-3.5 w-3.5" /> : stepIndex + 1}</div><span className={`whitespace-nowrap text-[11px] font-bold ${active ? "text-[#1677d2]" : complete ? "text-[#48715a]" : "text-[#8b9bad]"}`}>{step.label}</span></div>{stepIndex < steps.length - 1 && <div className={`mx-4 h-px w-10 ${stepIndex < index ? "bg-[#8dd3aa]" : "bg-[#dce5ee]"}`} />}</div>; })}</div></div>;
}

function PageFrame({ children }: { children: React.ReactNode }) { return <main className="mx-auto max-w-[1420px] px-5 py-7 md:px-9">{children}</main>; }

export default function Home() {
  const [screen, setScreen] = useState<Screen>(() => {
    const saved = localStorage.getItem("split-manifest-screen");
    return saved === "new" || saved === "history" || saved === "settings" || saved === "dashboard" ? saved : "dashboard";
  });
  const [workflowStep, setWorkflowStep] = useState<WorkflowStep>(() => {
    const saved = localStorage.getItem("split-manifest-workflow-step");
    return saved === "extract" || saved === "cross-check" || saved === "review" || saved === "email" || saved === "outlook" || saved === "upload" ? saved : "upload";
  });
  const [uploadItems, setUploadItems] = useState<UploadItem[]>(() => {
    try {
      const stored = JSON.parse(localStorage.getItem("split-manifest-upload-items") || "[]") as StoredUploadItem[];
      return stored.map((item) => ({ id: item.id, file: new File([""], item.name, { type: item.type }), kind: item.kind, status: item.status }));
    } catch {
      return [];
    }
  });
  const [fields, setFields] = useState<ShipmentFields>(() => {
    try {
      return JSON.parse(localStorage.getItem("split-manifest-fields") || "null") || createDemoFields();
    } catch {
      return createDemoFields();
    }
  });
  const [processing, setProcessing] = useState(false);
  const [processingNote, setProcessingNote] = useState("Demo mode is ready — no AI credentials required.");
  const [emailSubject, setEmailSubject] = useState(() => localStorage.getItem("split-manifest-email-subject") || "");
  const [emailHtml, setEmailHtml] = useState(() => localStorage.getItem("split-manifest-email-html") || "");
  const [emailText, setEmailText] = useState(() => localStorage.getItem("split-manifest-email-text") || "");
  const [historyJobs, setHistoryJobs] = useState<Job[]>(() => { try { return JSON.parse(localStorage.getItem("split-manifest-jobs") || "null") || starterJobs; } catch { return starterJobs; } });
  const [settings, setSettings] = useState<SignatureSettings>(() => { try { return JSON.parse(localStorage.getItem("split-manifest-settings") || "null") || defaultSettings; } catch { return defaultSettings; } });
  const [historyQuery, setHistoryQuery] = useState("");
  const [selectedHistory, setSelectedHistory] = useState<Job | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const stored = JSON.parse(localStorage.getItem("split-manifest-upload-items") || "[]") as StoredUploadItem[];
      const restored = await Promise.all(stored.map(async (item) => ({ item, file: await readUploadFile(item.id) })));
      if (!active) return;
      const available = restored.filter((entry) => entry.file).map(({ item, file }) => ({ id: item.id, file: file!, kind: item.kind, status: item.status }));
      const unavailable = restored.filter((entry) => !entry.file);
      if (unavailable.length) setErrorMessage("Previous file bytes were unavailable after refresh. Please re-upload the affected document(s) before processing.");
      setUploadItems(available);
    })();
    return () => { active = false; };
  }, []);

  useEffect(() => { localStorage.setItem("split-manifest-jobs", JSON.stringify(historyJobs)); }, [historyJobs]);
  useEffect(() => { localStorage.setItem("split-manifest-screen", screen); }, [screen]);
  useEffect(() => { localStorage.setItem("split-manifest-workflow-step", workflowStep); }, [workflowStep]);
  useEffect(() => {
    const stored: StoredUploadItem[] = uploadItems.map((item) => ({ id: item.id, name: item.file.name, size: item.file.size, type: item.file.type, kind: item.kind, status: item.status }));
    localStorage.setItem("split-manifest-upload-items", JSON.stringify(stored));
  }, [uploadItems]);
  useEffect(() => { localStorage.setItem("split-manifest-fields", JSON.stringify(fields)); }, [fields]);
  useEffect(() => { localStorage.setItem("split-manifest-email-subject", emailSubject); }, [emailSubject]);
  useEffect(() => { localStorage.setItem("split-manifest-email-html", emailHtml); }, [emailHtml]);
  useEffect(() => { localStorage.setItem("split-manifest-email-text", emailText); }, [emailText]);

  const requiredMissing = useMemo(() => getMissingRequiredFields(fields), [fields]);
  const conflictingFields = useMemo(() => Object.values(fields).filter((field) => field.status === "Conflict").map((field) => field.label), [fields]);
  const containerWarning = useMemo(() => validateContainerNumber(fieldValue(fields, "container_number")), [fields]);
  const emailAttachments = useMemo(() => uploadItems, [uploadItems]);
  const filteredJobs = useMemo(() => historyJobs.filter((job) => `${job.container} ${job.mbl} ${job.vessel} ${job.voyage} ${job.pol} ${job.createdAt}`.toLowerCase().includes(historyQuery.toLowerCase())), [historyJobs, historyQuery]);

  function navigate(next: Screen) {
    setScreen(next);
    setErrorMessage("");
    if (next === "new") {
      setWorkflowStep("upload");
      setProcessingNote("Demo mode is ready — no AI credentials required.");
    }
  }

  function handleFiles(files: FileList | File[]) {
    const incoming = Array.from(files);
    const next: UploadItem[] = [];
    const errors: string[] = [];
    incoming.forEach((file) => {
      const validation = validateDocumentFile(file);
      if (!validation.valid) { errors.push(`${file.name}: ${validation.reason}`); return; }
      if (uploadItems.some((item) => item.file.name === file.name && item.file.size === file.size)) return;
      const id = `${file.name}-${file.size}-${Date.now()}-${Math.random()}`;
      void storeUploadFile(id, file);
      next.push({ id, file, kind: validation.kind!, status: "Ready" });
    });
    if (next.length) setUploadItems((current) => [...current, ...next]);
    if (errors.length) setErrorMessage(errors.join(" "));
    else if (next.length) setErrorMessage("");
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>) { if (event.target.files) handleFiles(event.target.files); event.target.value = ""; }
  function onDrop(event: DragEvent<HTMLDivElement>) { event.preventDefault(); if (event.dataTransfer.files) handleFiles(event.dataTransfer.files); }
  function removeFile(id: string) { void deleteUploadFile(id); setUploadItems((current) => current.filter((item) => item.id !== id)); }

  async function processDocuments() {
    if (!uploadItems.length) { setErrorMessage("Add at least one supported document before processing."); return; }
    const unavailable = uploadItems.filter((item) => item.file.size === 0);
    if (unavailable.length) { setErrorMessage(`File content is unavailable for ${unavailable.map((item) => item.file.name).join(", ")}. Please remove and re-upload it before processing.`); return; }
    setErrorMessage(""); setScreen("new"); setProcessing(true); setWorkflowStep("extract"); setProcessingNote("Validating file readability and extracting document text…");
    const initial = uploadItems.map((item) => ({ ...item, status: "Uploaded" as FileStatus })); setUploadItems(initial);
    for (let i = 0; i < initial.length; i += 1) {
      const current = initial[i];
      setProcessingNote(`Analyzing ${current.file.name}…`);
      setUploadItems((items) => items.map((item) => item.id === current.id ? { ...item, status: "Analyzing" } : item));
      await new Promise((resolve) => setTimeout(resolve, 420));
      setUploadItems((items) => items.map((item) => item.id === current.id ? { ...item, status: "Analyzed" } : item));
    }
    const extracted = await extractFieldsFromFiles(initial.map((item) => ({ file: item.file, name: item.file.name, kind: item.kind })));
    setFields(extracted);
    setWorkflowStep("cross-check"); setProcessingNote("Cross-check complete — values compared across all uploaded documents.");
    await new Promise((resolve) => setTimeout(resolve, 360));
    setWorkflowStep("review"); setProcessing(false); toast.success("Documents analyzed", { description: "Review extracted fields before generating the email." });
  }

  function updateField(key: FieldKey, value: string) {
    setFields((current) => ({ ...current, [key]: { ...current[key], value, status: value === current[key].originalValue ? current[key].status : "Manually Corrected" } }));
  }

  function normalizeEtd() {
    const normalized = normalizeDate(fieldValue(fields, "etd_date"));
    updateField("etd_date", normalized.value);
    if (normalized.ambiguous) setErrorMessage("Ambiguous date format. Confirm the ETD before generating the email."); else setErrorMessage("");
  }

  function generateEmail() {
    const missing = getMissingRequiredFields(fields);
    if (missing.length) { setErrorMessage(`Cannot generate email. Missing required field${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}.`); return; }
    if (conflictingFields.length) { setErrorMessage(`Cannot generate email. Resolve conflicting value${conflictingFields.length > 1 ? "s" : ""}: ${conflictingFields.join(", ")}.`); return; }
    if (!containerWarning.valid) { setErrorMessage("Container number format may be invalid. Correct it or confirm the value before continuing."); return; }
    const subject = buildSubject(fields);
    setEmailSubject(subject); setEmailHtml(buildHtmlBody(fields, settings.signatureHtml)); setEmailText(buildPlainTextBody(fields, settings.signatureText)); setWorkflowStep("email"); setErrorMessage("");
    toast.success("Email draft generated", { description: "Recipients are intentionally left blank for Outlook review." });
  }

  function saveSettings() { localStorage.setItem("split-manifest-settings", JSON.stringify(settings)); toast.success("Settings saved", { description: "Your signature and retention preferences are ready for the next draft." }); }

  async function downloadEml() {
    if (!emailSubject || !emailHtml) return;
    const eml = await buildEml(emailSubject, emailHtml, emailText, emailAttachments.map((item) => ({ name: item.file.name, file: item.file })));
    const url = URL.createObjectURL(new Blob([eml], { type: "message/rfc822;charset=utf-8" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = `${fieldValue(fields, "container_number") || "split-manifest"}.eml`; anchor.click(); URL.revokeObjectURL(url);
    setWorkflowStep("outlook");
    const job: Job = { id: `SM-${Math.floor(2407 + Math.random() * 90)}`, createdAt: new Date().toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }), container: fieldValue(fields, "container_number"), mbl: fieldValue(fields, "mbl_number"), vessel: `${fieldValue(fields, "vessel_name")} / ${fieldValue(fields, "voyage_number")}`, voyage: fieldValue(fields, "voyage_number"), pol: fieldValue(fields, "pol"), status: "EML Prepared", outlook: "Ready to open" };
    setHistoryJobs((current) => [job, ...current.filter((item) => item.container !== job.container)]);
    toast.success("Outlook-compatible EML prepared", { description: "No message was sent. Open the file in Outlook, add recipients, review, and send manually." });
  }

  const renderDashboard = () => <PageFrame><div className="mb-7 flex flex-col justify-between gap-5 md:flex-row md:items-end"><div><div className="mb-2 inline-flex items-center gap-2 rounded-full bg-[#e8f3fd] px-3 py-1.5 text-[11px] font-bold text-[#1470c4]"><Sparkles className="h-3.5 w-3.5" /> Workflow control center</div><h2 className="text-[30px] font-bold tracking-[-0.04em] text-[#172b4d]">Good afternoon, Alex</h2><p className="mt-1 text-[13px] text-[#6d8194]">Keep your shipment handoffs accurate, traceable, and ready for Outlook.</p></div><button onClick={() => navigate("new")} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-[#1677d2] px-5 text-[13px] font-bold text-white shadow-[0_7px_16px_rgba(22,119,210,0.2)] transition hover:bg-[#0e68bf] active:scale-[0.98]"><Plus className="h-4 w-4" /> New split manifest email <ArrowRight className="h-4 w-4" /></button></div>
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{[{ label: "Jobs this month", value: "24", sub: "+12% vs last month", icon: Files, tone: "blue" }, { label: "Needs review", value: "03", sub: "2 conflicts · 1 missing field", icon: AlertTriangle, tone: "amber" }, { label: "Prepared for Outlook", value: "18", sub: "100% user-controlled handoff", icon: Mail, tone: "green" }, { label: "Avg. processing time", value: "2m 18s", sub: "↓ 34s vs last month", icon: Clock3, tone: "slate" }].map((item) => { const Icon = item.icon; const tone = item.tone === "blue" ? "bg-[#eaf4ff] text-[#1677d2]" : item.tone === "amber" ? "bg-[#fff7e6] text-[#c88316]" : item.tone === "green" ? "bg-[#eaf9f0] text-[#1b9a5b]" : "bg-[#eef2f6] text-[#5b7289]"; return <div key={item.label} className="rounded-2xl border border-[#dce5ee] bg-white p-5 shadow-[0_4px_14px_rgba(22,58,91,0.035)]"><div className="mb-4 flex items-start justify-between"><div className={`flex h-9 w-9 items-center justify-center rounded-xl ${tone}`}><Icon className="h-4 w-4" /></div><MoreHorizontal className="h-4 w-4 text-[#a2b1bf]" /></div><div className="text-[24px] font-bold tracking-[-0.04em] text-[#172b4d]">{item.value}</div><div className="mt-1 text-[12px] font-semibold text-[#5c7288]">{item.label}</div><div className="mt-3 text-[11px] text-[#8193a3]">{item.sub}</div></div>; })}</div>
    <div className="mt-7 grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]"><section className="overflow-hidden rounded-2xl border border-[#dce5ee] bg-white shadow-[0_4px_14px_rgba(22,58,91,0.035)]"><div className="flex items-center justify-between border-b border-[#e5ebf1] px-5 py-4"><div><h3 className="text-[14px] font-bold text-[#172b4d]">Recent jobs</h3><p className="mt-0.5 text-[11px] text-[#8294a5]">Latest activity across your shipment handoffs</p></div><button onClick={() => navigate("history")} className="text-xs font-bold text-[#1677d2] hover:underline">View all <ChevronRight className="ml-0.5 inline h-3.5 w-3.5" /></button></div><div className="overflow-x-auto"><table className="w-full min-w-[800px] text-left"><thead><tr className="border-b border-[#e5ebf1] bg-[#fbfcfd] text-[10px] font-bold uppercase tracking-[0.08em] text-[#8799aa]"><th className="px-5 py-3">Date</th><th className="px-3 py-3">Container</th><th className="px-3 py-3">MBL</th><th className="px-3 py-3">Vessel / Voyage</th><th className="px-3 py-3">POL</th><th className="px-3 py-3">Status</th><th className="px-5 py-3">Outlook</th></tr></thead><tbody>{historyJobs.slice(0, 4).map((job) => <tr key={job.id} className="border-b border-[#edf1f5] text-[12px] last:border-0 hover:bg-[#f9fbfd]"><td className="whitespace-nowrap px-5 py-4 text-[#8192a2]">{job.createdAt}</td><td className="px-3 py-4 font-bold text-[#255071]">{job.container}</td><td className="px-3 py-4 font-mono text-[11px] text-[#61798f]">{job.mbl}</td><td className="px-3 py-4 font-semibold text-[#456278]">{job.vessel}</td><td className="px-3 py-4 text-[#61798f]">{job.pol}</td><td className="px-3 py-4"><StatusBadge status={job.status} /></td><td className="px-5 py-4 text-[#70869a]">{job.outlook}</td></tr>)}</tbody></table></div></section><aside className="rounded-2xl border border-[#dce5ee] bg-white p-5 shadow-[0_4px_14px_rgba(22,58,91,0.035)]"><div className="mb-4 flex items-center justify-between"><h3 className="text-[14px] font-bold">Workflow health</h3><span className="flex items-center gap-1.5 text-[11px] font-bold text-emerald-600"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Live</span></div><div className="space-y-4"><div><div className="mb-2 flex justify-between text-[11px] font-semibold"><span className="text-[#5d7388]">Fields confirmed</span><span className="text-[#172b4d]">94%</span></div><div className="h-2 overflow-hidden rounded-full bg-[#edf2f6]"><div className="h-full w-[94%] rounded-full bg-[#2eb875]" /></div></div><div><div className="mb-2 flex justify-between text-[11px] font-semibold"><span className="text-[#5d7388]">Documents processed</span><span className="text-[#172b4d]">87%</span></div><div className="h-2 overflow-hidden rounded-full bg-[#edf2f6]"><div className="h-full w-[87%] rounded-full bg-[#2d8cff]" /></div></div><div><div className="mb-2 flex justify-between text-[11px] font-semibold"><span className="text-[#5d7388]">Drafts reviewed by user</span><span className="text-[#172b4d]">100%</span></div><div className="h-2 overflow-hidden rounded-full bg-[#edf2f6]"><div className="h-full w-full rounded-full bg-[#6f82ff]" /></div></div></div><div className="mt-6 rounded-xl bg-[#f3f8fd] p-3.5"><div className="flex gap-2.5"><Info className="mt-0.5 h-4 w-4 shrink-0 text-[#1677d2]" /><p className="text-[11px] leading-relaxed text-[#53718d]">The generator never sends email automatically. Outlook handoff always stays under your control.</p></div></div></aside></div>
  </PageFrame>;

  const renderUpload = () => <PageFrame><Stepper current={workflowStep} /><div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]"><section className="rounded-2xl border border-[#dce5ee] bg-white p-6 shadow-[0_4px_14px_rgba(22,58,91,0.035)]"><div className="mb-6 flex items-start justify-between"><div><h2 className="text-[17px] font-bold text-[#172b4d]">Add shipping documents</h2><p className="mt-1 text-xs text-[#75899b]">Upload the source files used to validate this split manifest.</p></div><span className="rounded-full bg-[#edf7ff] px-3 py-1 text-[10px] font-bold text-[#1677d2]">Live extraction</span></div><div onDragOver={(event) => event.preventDefault()} onDrop={onDrop} onClick={() => fileInput.current?.click()} className="group flex min-h-[245px] cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-[#b9d4ea] bg-[#f7fbff] px-5 text-center transition hover:border-[#4ca1ea] hover:bg-[#f2f9ff]"><input ref={fileInput} type="file" multiple accept=".pdf,.xls,.xlsx,.doc,.docx,.txt,.csv" className="hidden" onChange={onFileChange} /><div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-white text-[#2d8cff] shadow-[0_5px_15px_rgba(37,112,176,0.11)] ring-1 ring-[#d9eafa] transition group-hover:scale-105"><UploadCloud className="h-7 w-7" /></div><div className="text-sm font-bold text-[#28516f]">Drop shipping documents here</div><div className="mt-1.5 text-xs text-[#8499aa]">or <span className="font-bold text-[#1677d2]">browse from your computer</span></div><div className="mt-5 flex items-center gap-2 text-[10px] font-semibold text-[#9aaaba]"><span className="rounded bg-white px-2 py-1 ring-1 ring-[#dce5ee]">PDF</span><span className="rounded bg-white px-2 py-1 ring-1 ring-[#dce5ee]">XLSX</span><span className="rounded bg-white px-2 py-1 ring-1 ring-[#dce5ee]">DOCX</span><span className="rounded bg-white px-2 py-1 ring-1 ring-[#dce5ee]">TXT</span><span>Max 25 MB / file</span></div></div>{errorMessage && <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><span>{errorMessage}</span><button className="ml-auto" onClick={() => setErrorMessage("")} aria-label="Dismiss error"><X className="h-4 w-4" /></button></div>}<div className="mt-6"><div className="mb-3 flex items-center justify-between"><h3 className="text-[13px] font-bold">Selected files <span className="ml-1 text-[#95a5b4]">{uploadItems.length}</span></h3>{uploadItems.length > 0 && <button onClick={() => { uploadItems.forEach((item) => void deleteUploadFile(item.id)); setUploadItems([]); }} className="text-[11px] font-semibold text-[#7d91a4] hover:text-rose-600">Clear all</button>}</div>{uploadItems.length === 0 ? <div className="rounded-xl border border-dashed border-[#dce5ee] px-4 py-7 text-center text-xs text-[#93a3b1]">No files selected yet. A PDF is recommended for source-page traceability.</div> : <div className="space-y-2">{uploadItems.map((item) => <div key={item.id} className="flex items-center gap-3 rounded-xl border border-[#e0e8ef] bg-[#fbfcfd] px-3.5 py-3"><div className={`flex h-9 w-9 items-center justify-center rounded-lg ${item.kind === "pdf" ? "bg-rose-50 text-rose-500" : "bg-[#edf5ff] text-[#438ed1]"}`}><FileText className="h-4 w-4" /></div><div className="min-w-0 flex-1"><div className="truncate text-xs font-bold text-[#36556e]">{item.file.name}</div><div className="mt-1 flex items-center gap-2 text-[10px] text-[#91a0ad]"><span>{formatSize(item.file.size)}</span><span className="h-1 w-1 rounded-full bg-[#cad4dd]" /><span className="uppercase">{item.kind}</span></div></div><StatusBadge status={item.status} /><button onClick={() => removeFile(item.id)} className="ml-1 rounded-md p-1.5 text-[#a4b2bf] transition hover:bg-rose-50 hover:text-rose-500" aria-label={`Remove ${item.file.name}`}><X className="h-4 w-4" /></button></div>)}</div>}</div><div className="mt-7 flex flex-col justify-between gap-3 border-t border-[#e5ebf1] pt-5 sm:flex-row sm:items-center"><div className="flex items-center gap-2 text-[11px] text-[#7b8e9f]"><LockKeyhole className="h-3.5 w-3.5 text-[#3b9f70]" /> Files remain private in this workflow</div><button onClick={processDocuments} disabled={!uploadItems.length || processing} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-[#1677d2] px-4 text-xs font-bold text-white shadow-[0_5px_12px_rgba(22,119,210,0.18)] transition hover:bg-[#0e68bf] disabled:cursor-not-allowed disabled:bg-[#a8bfd3]">{processing ? <><RefreshCw className="h-3.5 w-3.5 animate-spin" /> Processing…</> : <><Play className="h-3.5 w-3.5" /> Process documents</>}</button></div></section><aside className="space-y-4"><div className="rounded-2xl border border-[#dce5ee] bg-white p-5 shadow-[0_4px_14px_rgba(22,58,91,0.035)]"><div className="mb-4 flex items-center gap-2 text-[13px] font-bold"><Workflow className="h-4 w-4 text-[#2d8cff]" /> Processing pipeline</div><div className="space-y-3">{[["01", "Validate files", "Extension · MIME · size"], ["02", "Extract text", "OCR fallback available"], ["03", "Cross-check values", "Conflicts stay visible"], ["04", "Review & prepare", "No automatic sending"]].map(([number, title, subtitle]) => <div key={number} className="flex gap-3"><div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#f0f6fc] text-[10px] font-bold text-[#4a91cf]">{number}</div><div><div className="text-xs font-bold text-[#4e6579]">{title}</div><div className="mt-0.5 text-[10px] text-[#91a0ad]">{subtitle}</div></div></div>)}</div></div><div className="rounded-2xl border border-[#cfe2f2] bg-[#edf7ff] p-5"><div className="mb-2 flex items-center gap-2 text-xs font-bold text-[#1a6fb7]"><Zap className="h-4 w-4" /> Document extraction is enabled</div><p className="text-[11px] leading-relaxed text-[#5c7b95]">The extractor checks every uploaded PDF, Excel, CSV, TXT, and Word file. Missing values stay visible and are never fabricated.</p></div></aside></div></PageFrame>;

  const renderReview = () => <PageFrame><Stepper current="review" /><div className="mb-5 flex flex-col justify-between gap-3 md:flex-row md:items-end"><div><button onClick={() => setWorkflowStep("upload")} className="mb-3 inline-flex items-center gap-1.5 text-xs font-bold text-[#6c8398] hover:text-[#1677d2]"><ArrowLeft className="h-3.5 w-3.5" /> Back to files</button><h2 className="text-[21px] font-bold tracking-[-0.03em]">Review extracted shipment data</h2><p className="mt-1 text-xs text-[#75899b]">Confirm every value before creating the email. Manual changes are recorded for traceability.</p></div><div className="flex items-center gap-2"><span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-[#6d8194]"><Info className="h-3.5 w-3.5" /> Checked sources: {fields.container_number.sourceFile}</span></div></div><div className="mb-5 flex items-start gap-3 rounded-xl border border-[#c8e5d2] bg-[#f0fbf4] p-4 text-xs text-[#3c7653]"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#2aa66b]" /><div><div className="font-bold">Cross-check complete — review field statuses below for conflicts</div><div className="mt-1 text-[11px] text-[#60866e]">Values are compared across every readable uploaded document. Multiple values remain visible for review; edit the selected value if needed.</div></div></div>{errorMessage && <div className="mb-5 flex items-start gap-2.5 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{errorMessage}</div>}<section className="overflow-hidden rounded-2xl border border-[#dce5ee] bg-white shadow-[0_4px_14px_rgba(22,58,91,0.035)]"><div className="flex items-center justify-between border-b border-[#e5ebf1] px-5 py-4"><div><h3 className="text-[14px] font-bold">Extracted fields</h3><p className="mt-1 text-[11px] text-[#8799a9]">Source evidence and confidence are shown for each value.</p></div><div className="flex items-center gap-2 text-[10px] font-semibold text-[#8596a6]"><span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-500" /> High</span><span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-500" /> Review</span></div></div><div className="overflow-x-auto"><table className="w-full min-w-[940px] text-left"><thead><tr className="border-b border-[#e5ebf1] bg-[#fbfcfd] text-[10px] font-bold uppercase tracking-[0.08em] text-[#8799aa]"><th className="w-[18%] px-5 py-3">Field</th><th className="w-[28%] px-3 py-3">Reviewed value</th><th className="px-3 py-3">Confidence</th><th className="px-3 py-3">Status</th><th className="px-5 py-3">Source reference</th></tr></thead><tbody>{Object.values(fields).map((field) => <tr key={field.key} className="border-b border-[#edf1f5] align-top last:border-0"><td className="px-5 py-4"><div className="text-xs font-bold text-[#3c5a70]">{field.label}{requiredMissing.includes(field.label) && <span className="ml-1 text-rose-500">*</span>}</div><div className="mt-1 text-[10px] text-[#9aa8b4]">{field.key}</div></td><td className="px-3 py-4"><div className="relative"><input value={field.value} onChange={(event) => updateField(field.key, event.target.value)} onBlur={field.key === "etd_date" ? normalizeEtd : undefined} className="h-9 w-full rounded-lg border border-[#dce5ee] bg-white px-3 text-xs font-semibold text-[#294b63] outline-none transition placeholder:text-[#a4b0bc] focus:border-[#4ea2e8] focus:ring-3 focus:ring-[#d9edfd]" placeholder="Not Found" /></div>{field.status === "Manually Corrected" && <div className="mt-1 text-[10px] font-semibold text-[#aa7b1d]">Original: {field.originalValue}</div>}</td><td className="px-3 py-4"><ConfidenceBadge field={field} /></td><td className="px-3 py-4"><StatusBadge status={field.status} /></td><td className="px-5 py-4"><div className="text-[11px] font-semibold text-[#597288]">{field.sourceFile}{field.sourcePage ? ` · p.${field.sourcePage}` : ""}</div><div className="mt-1 max-w-[260px] text-[10px] leading-relaxed text-[#98a5b0]">{field.evidence}</div></td></tr>)}</tbody></table></div><div className="flex flex-col justify-between gap-3 border-t border-[#e5ebf1] bg-[#fbfcfd] px-5 py-4 sm:flex-row sm:items-center"><div className="text-[11px] text-[#8799a9]"><span className="font-bold text-[#526d83]">{requiredMissing.length ? `${requiredMissing.length} required field${requiredMissing.length > 1 ? "s" : ""} missing` : "All required fields present"}</span> · Seal and agent remain configurable.</div><button onClick={generateEmail} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-[#1677d2] px-4 text-xs font-bold text-white shadow-[0_5px_12px_rgba(22,119,210,0.18)] transition hover:bg-[#0e68bf]"><Mail className="h-3.5 w-3.5" /> Generate email</button></div></section><div className="mt-5 grid gap-4 md:grid-cols-3"><div className="rounded-xl border border-[#dce5ee] bg-white p-4"><div className="mb-2 flex items-center gap-2 text-xs font-bold"><CalendarDays className="h-4 w-4 text-[#2d8cff]" /> Date normalization</div><p className="text-[11px] leading-relaxed text-[#7c8e9e]">Final ETD values use <span className="font-bold text-[#506b81]">YYYY/MM/DD</span>. Ambiguous dates require confirmation.</p></div><div className="rounded-xl border border-[#dce5ee] bg-white p-4"><div className="mb-2 flex items-center gap-2 text-xs font-bold"><ShieldCheck className="h-4 w-4 text-[#2aa66b]" /> No hallucination</div><p className="text-[11px] leading-relaxed text-[#7c8e9e]">Missing values stay <span className="font-bold text-[#506b81]">Not Found</span>; multiple values are never silently discarded.</p></div><div className="rounded-xl border border-[#dce5ee] bg-white p-4"><div className="mb-2 flex items-center gap-2 text-xs font-bold"><MoreHorizontal className="h-4 w-4 text-[#9a7ce0]" /> Audit trail</div><p className="text-[11px] leading-relaxed text-[#7c8e9e]">Manual edits preserve the original value and are recorded as corrections.</p></div></div></PageFrame>;

  const renderEmail = () => <PageFrame><Stepper current={workflowStep === "outlook" ? "outlook" : "email"} /><div className="mb-5 flex flex-col justify-between gap-3 md:flex-row md:items-end"><div><button onClick={() => setWorkflowStep("review")} className="mb-3 inline-flex items-center gap-1.5 text-xs font-bold text-[#6c8398] hover:text-[#1677d2]"><ArrowLeft className="h-3.5 w-3.5" /> Back to review</button><h2 className="text-[21px] font-bold tracking-[-0.03em]">Email preview</h2><p className="mt-1 text-xs text-[#75899b]">Review the generated message. To, CC, and BCC remain blank for you to complete in Outlook.</p></div><div className="flex items-center gap-2 rounded-full border border-[#c8e5d2] bg-[#f0fbf4] px-3 py-1.5 text-[10px] font-bold text-[#32845a]"><ShieldCheck className="h-3.5 w-3.5" /> Never sends automatically</div></div>{workflowStep === "outlook" && <div className="mb-5 flex items-start gap-3 rounded-xl border border-[#bfe1f5] bg-[#edf8ff] p-4 text-xs text-[#2a638a]"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#1677d2]" /><div><div className="font-bold">Outlook-compatible email prepared</div><div className="mt-1 text-[11px]">The .EML draft is ready. Open it in Outlook, add recipients, review the attachments, and send manually.</div></div></div>}<div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_350px]"><section className="overflow-hidden rounded-2xl border border-[#dce5ee] bg-white shadow-[0_4px_14px_rgba(22,58,91,0.035)]"><div className="border-b border-[#e5ebf1] bg-[#fbfcfd] px-5 py-4"><div className="mb-2 text-[10px] font-bold uppercase tracking-[0.1em] text-[#8b9aa9]">Subject <span className="ml-1 font-normal normal-case tracking-normal text-[#b2bdc7]">(editable)</span></div><input value={emailSubject} onChange={(event) => setEmailSubject(event.target.value)} className="h-10 w-full rounded-lg border border-[#dce5ee] bg-white px-3 text-xs font-bold text-[#254b66] outline-none focus:border-[#4ea2e8] focus:ring-3 focus:ring-[#d9edfd]" /></div><div className="p-6"><div className="mb-5 flex items-center justify-between border-b border-[#edf1f5] pb-4"><div><div className="text-[11px] font-bold text-[#61798c]">To: <span className="font-normal text-[#a5b1bc]">Add recipients in Outlook</span></div><div className="mt-1 text-[11px] font-bold text-[#61798c]">CC / BCC: <span className="font-normal text-[#a5b1bc]">Not populated</span></div></div><div className="rounded-lg bg-[#f2f6fa] p-2 text-[#7890a4]"><Mail className="h-4 w-4" /></div></div><div className="email-preview" dangerouslySetInnerHTML={{ __html: emailHtml }} /></div></section><aside className="space-y-4"><div className="rounded-2xl border border-[#dce5ee] bg-white p-5 shadow-[0_4px_14px_rgba(22,58,91,0.035)]"><div className="mb-4 flex items-center justify-between"><h3 className="text-[14px] font-bold">Attachments</h3><span className="rounded-full bg-[#f1f5f8] px-2 py-1 text-[10px] font-bold text-[#75899b]">{emailAttachments.length} file{emailAttachments.length === 1 ? "" : "s"}</span></div>{emailAttachments.length ? <div className="space-y-2">{emailAttachments.map((item) => <div key={item.id} className="flex items-center gap-2.5 rounded-lg bg-[#f8fafc] px-3 py-2.5"><div className="flex h-7 w-7 items-center justify-center rounded-md bg-rose-50 text-rose-500"><Paperclip className="h-3.5 w-3.5" /></div><div className="min-w-0 flex-1 truncate text-[11px] font-semibold text-[#557086]">{item.file.name}</div><Check className="h-3.5 w-3.5 text-emerald-500" /></div>)}</div> : <div className="rounded-lg border border-dashed border-[#dce5ee] p-4 text-center text-[11px] text-[#8c9cab]">No attachments selected.</div>}<div className="mt-4 flex items-start gap-2 text-[10px] leading-relaxed text-[#8899a8]"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />Original filenames are preserved. Files are never renamed or modified.</div></div><div className="rounded-2xl border border-[#cfe2f2] bg-[#edf7ff] p-5"><div className="mb-2 flex items-center gap-2 text-[13px] font-bold text-[#226da9]"><Send className="h-4 w-4" /> Outlook handoff</div><p className="text-[11px] leading-relaxed text-[#5e7b92]">Microsoft Graph is not connected in this preview. The safe fallback creates an editable .EML draft — it does not call sendMail.</p><button onClick={downloadEml} className="mt-4 inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-[#1677d2] text-xs font-bold text-white shadow-[0_5px_12px_rgba(22,119,210,0.18)] transition hover:bg-[#0e68bf]"><Download className="h-3.5 w-3.5" /> Open / download .EML draft</button></div></aside></div></PageFrame>;

  const renderHistory = () => <PageFrame><div className="mb-6 flex flex-col justify-between gap-4 md:flex-row md:items-end"><div><h2 className="text-[22px] font-bold tracking-[-0.03em]">All processed jobs</h2><p className="mt-1 text-xs text-[#75899b]">Search by container, MBL, vessel, voyage, port, or date.</p></div><div className="relative w-full md:w-[300px]"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#96a5b2]" /><input value={historyQuery} onChange={(event) => setHistoryQuery(event.target.value)} placeholder="Search jobs…" className="h-10 w-full rounded-lg border border-[#dce5ee] bg-white pl-9 pr-3 text-xs outline-none focus:border-[#4ea2e8] focus:ring-3 focus:ring-[#d9edfd]" /></div></div><div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]"><section className="overflow-hidden rounded-2xl border border-[#dce5ee] bg-white shadow-[0_4px_14px_rgba(22,58,91,0.035)]"><div className="flex items-center justify-between border-b border-[#e5ebf1] px-5 py-4"><div className="flex items-center gap-2 text-xs font-bold"><SlidersHorizontal className="h-4 w-4 text-[#2d8cff]" /> {filteredJobs.length} matching jobs</div><button onClick={() => setHistoryQuery("")} className="text-[11px] font-bold text-[#71869a] hover:text-[#1677d2]">Clear filter</button></div><div className="overflow-x-auto"><table className="w-full min-w-[840px] text-left"><thead><tr className="border-b border-[#e5ebf1] bg-[#fbfcfd] text-[10px] font-bold uppercase tracking-[0.08em] text-[#8799aa]"><th className="px-5 py-3">Job date</th><th className="px-3 py-3">Container</th><th className="px-3 py-3">MBL</th><th className="px-3 py-3">Vessel / Voyage</th><th className="px-3 py-3">POL</th><th className="px-3 py-3">Status</th><th className="px-5 py-3">Open</th></tr></thead><tbody>{filteredJobs.map((job) => <tr key={job.id} className="border-b border-[#edf1f5] text-[12px] last:border-0 hover:bg-[#f9fbfd]"><td className="whitespace-nowrap px-5 py-4 text-[#8192a2]">{job.createdAt}</td><td className="px-3 py-4 font-bold text-[#255071]">{job.container}</td><td className="px-3 py-4 font-mono text-[11px] text-[#61798f]">{job.mbl}</td><td className="px-3 py-4 font-semibold text-[#456278]">{job.vessel}</td><td className="px-3 py-4 text-[#61798f]">{job.pol}</td><td className="px-3 py-4"><StatusBadge status={job.status} /></td><td className="px-5 py-4"><button onClick={() => setSelectedHistory(job)} className="inline-flex items-center gap-1 text-[11px] font-bold text-[#1677d2] hover:underline">Inspect <ChevronRight className="h-3.5 w-3.5" /></button></td></tr>)}</tbody></table></div></section><aside className="rounded-2xl border border-[#dce5ee] bg-white p-5 shadow-[0_4px_14px_rgba(22,58,91,0.035)]">{selectedHistory ? <><div className="mb-4 flex items-start justify-between"><div><div className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#8b9baa]">Job {selectedHistory.id}</div><h3 className="mt-1 text-[15px] font-bold">Shipment detail</h3></div><button onClick={() => setSelectedHistory(null)} className="text-[#9aa9b6] hover:text-[#1677d2]" aria-label="Close detail"><X className="h-4 w-4" /></button></div><div className="space-y-3 text-xs"><div><div className="text-[10px] font-bold uppercase text-[#93a2af]">Container</div><div className="mt-1 font-bold text-[#365870]">{selectedHistory.container}</div></div><div><div className="text-[10px] font-bold uppercase text-[#93a2af]">MBL</div><div className="mt-1 font-mono text-[11px] text-[#557086]">{selectedHistory.mbl}</div></div><div><div className="text-[10px] font-bold uppercase text-[#93a2af]">Vessel / voyage</div><div className="mt-1 font-semibold text-[#557086]">{selectedHistory.vessel}</div></div><div><div className="text-[10px] font-bold uppercase text-[#93a2af]">Outlook handoff</div><div className="mt-1"><StatusBadge status={selectedHistory.outlook === "Ready to open" ? "Ready" : selectedHistory.outlook} /></div></div></div><div className="mt-5 border-t border-[#e5ebf1] pt-4"><div className="mb-2 text-[10px] font-bold uppercase tracking-[0.1em] text-[#93a2af]">Audit trail</div><div className="space-y-3">{["job_created", "extraction_completed", "email_generated", "eml_generated"].map((event, index) => <div key={event} className="flex gap-2.5"><div className="mt-1 h-2 w-2 rounded-full bg-[#60a9e4] ring-4 ring-[#eaf5fd]" /><div><div className="text-[11px] font-semibold text-[#5d7487]">{event}</div><div className="text-[10px] text-[#9aa8b4]">{index === 0 ? selectedHistory.createdAt : "Recorded during workflow"}</div></div></div>)}</div></div></> : <div className="flex min-h-[260px] flex-col items-center justify-center text-center"><div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-[#edf6fd] text-[#398bc9]"><Search className="h-5 w-5" /></div><h3 className="text-sm font-bold">Inspect a job</h3><p className="mt-1 max-w-[210px] text-[11px] leading-relaxed text-[#8a9baa]">Select a previous shipment to view its files, extracted data, and handoff status.</p></div>}</aside></div></PageFrame>;

  const renderSettings = () => <PageFrame><div className="mb-6"><h2 className="text-[22px] font-bold tracking-[-0.03em]">Workspace settings</h2><p className="mt-1 text-xs text-[#75899b]">Your preferences apply to future email drafts. API keys are never shown here.</p></div><div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]"><section className="space-y-5"><div className="rounded-2xl border border-[#dce5ee] bg-white p-6 shadow-[0_4px_14px_rgba(22,58,91,0.035)]"><div className="mb-5 flex items-start justify-between"><div><h3 className="text-[15px] font-bold">Email signature</h3><p className="mt-1 text-xs text-[#8496a6]">Use plain text or HTML. If blank, the draft uses “Best regards,” only.</p></div><Mail className="h-5 w-5 text-[#2d8cff]" /></div><div className="grid gap-5 md:grid-cols-2"><label className="text-xs font-bold text-[#567086]">Plain-text signature<textarea value={settings.signatureText} onChange={(event) => setSettings((current) => ({ ...current, signatureText: event.target.value }))} placeholder={'Best regards,\nAlex Morgan\nShipping Operations'} className="mt-2 min-h-[130px] w-full resize-y rounded-lg border border-[#dce5ee] bg-[#fbfcfd] p-3 text-xs font-normal outline-none focus:border-[#4ea2e8] focus:ring-3 focus:ring-[#d9edfd]" /></label><label className="text-xs font-bold text-[#567086]">HTML signature<textarea value={settings.signatureHtml} onChange={(event) => setSettings((current) => ({ ...current, signatureHtml: event.target.value }))} placeholder="<p>Best regards,<br>Alex Morgan</p>" className="mt-2 min-h-[130px] w-full resize-y rounded-lg border border-[#dce5ee] bg-[#fbfcfd] p-3 font-mono text-[11px] font-normal outline-none focus:border-[#4ea2e8] focus:ring-3 focus:ring-[#d9edfd]" /></label></div></div><div className="rounded-2xl border border-[#dce5ee] bg-white p-6 shadow-[0_4px_14px_rgba(22,58,91,0.035)]"><div className="mb-5 flex items-start justify-between"><div><h3 className="text-[15px] font-bold">Document and date preferences</h3><p className="mt-1 text-xs text-[#8496a6]">These defaults help standardize outgoing operations emails.</p></div><CalendarDays className="h-5 w-5 text-[#2d8cff]" /></div><div className="grid gap-5 sm:grid-cols-2"><label className="text-xs font-bold text-[#567086]">Date format<select value={settings.dateFormat} onChange={(event) => setSettings((current) => ({ ...current, dateFormat: event.target.value }))} className="mt-2 h-10 w-full rounded-lg border border-[#dce5ee] bg-[#fbfcfd] px-3 text-xs font-normal outline-none focus:border-[#4ea2e8]"><option>YYYY/MM/DD</option><option>DD/MM/YYYY</option><option>MM/DD/YYYY</option></select></label><label className="text-xs font-bold text-[#567086]">Retention period<select value={settings.retentionDays} onChange={(event) => setSettings((current) => ({ ...current, retentionDays: event.target.value }))} className="mt-2 h-10 w-full rounded-lg border border-[#dce5ee] bg-[#fbfcfd] px-3 text-xs font-normal outline-none focus:border-[#4ea2e8]"><option value="30">30 days</option><option value="90">90 days</option><option value="180">180 days</option><option value="365">1 year</option></select></label></div><div className="mt-6 flex justify-end"><button onClick={saveSettings} className="inline-flex h-10 items-center gap-2 rounded-lg bg-[#1677d2] px-4 text-xs font-bold text-white shadow-[0_5px_12px_rgba(22,119,210,0.18)] hover:bg-[#0e68bf]"><Check className="h-3.5 w-3.5" /> Save preferences</button></div></div></section><aside className="space-y-5"><div className="rounded-2xl border border-[#dce5ee] bg-white p-5 shadow-[0_4px_14px_rgba(22,58,91,0.035)]"><h3 className="mb-4 text-[14px] font-bold">Integration readiness</h3><div className="space-y-3"><div className="flex items-center justify-between rounded-xl bg-[#f8fafc] px-3.5 py-3"><div className="flex items-center gap-2.5"><div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#eaf1fb] text-[#3676b8]"><Mail className="h-3.5 w-3.5" /></div><div><div className="text-[11px] font-bold text-[#4d687d]">Microsoft Graph</div><div className="text-[10px] text-[#97a5b1]">OAuth connection</div></div></div><StatusBadge status="Not connected" /></div><div className="flex items-center justify-between rounded-xl bg-[#f8fafc] px-3.5 py-3"><div className="flex items-center gap-2.5"><div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#e9f8ef] text-[#2d9b62]"><CheckCircle2 className="h-3.5 w-3.5" /></div><div><div className="text-[11px] font-bold text-[#4d687d]">Outlook fallback</div><div className="text-[10px] text-[#97a5b1]">.EML export</div></div></div><StatusBadge status="Available" /></div><div className="flex items-center justify-between rounded-xl bg-[#f8fafc] px-3.5 py-3"><div className="flex items-center gap-2.5"><div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#fff4df] text-[#c4871f]"><Sparkles className="h-3.5 w-3.5" /></div><div><div className="text-[11px] font-bold text-[#4d687d]">AI extraction</div><div className="text-[10px] text-[#97a5b1]">Provider abstraction</div></div></div><StatusBadge status="Available" /></div></div></div><div className="rounded-2xl border border-[#cfe2f2] bg-[#edf7ff] p-5"><div className="mb-2 flex items-center gap-2 text-xs font-bold text-[#226da9]"><LockKeyhole className="h-4 w-4" /> Privacy and control</div><p className="text-[11px] leading-relaxed text-[#5e7b92]">The app prepares drafts only. It never populates recipients, calls Microsoft Graph sendMail, or claims a message was sent.</p></div></aside></div></PageFrame>;

  const content = screen === "dashboard" ? renderDashboard() : screen === "history" ? renderHistory() : screen === "settings" ? renderSettings() : workflowStep === "upload" || workflowStep === "extract" || workflowStep === "cross-check" ? renderUpload() : renderReview();
  const showEmail = screen === "new" && (workflowStep === "email" || workflowStep === "outlook");
  return <AppShell screen={screen} onNavigate={navigate}><Topbar screen={screen} onNew={() => navigate("new")} />{showEmail ? renderEmail() : content}<footer className="mx-auto max-w-[1420px] px-5 pb-7 pt-1 text-[10px] text-[#9aabb8] md:px-9"><div className="flex flex-col justify-between gap-2 border-t border-[#dfe7ee] pt-4 sm:flex-row"><span>Split Manifest Email Generator · Operations workspace</span><span className="flex items-center gap-1.5"><ShieldCheck className="h-3 w-3 text-[#3e9e70]" /> No automatic sending</span></div></footer></AppShell>;
}
