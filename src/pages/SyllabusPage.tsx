import { useState, useEffect } from "react";
import {
  Loader2, FileText, Search, Download, ExternalLink, User, Calendar, Library
} from "lucide-react";
import { useAuth } from "@/lib/AuthContext";
import { db } from "@/lib/firebase";
import { openSafeExternalUrl } from "@/lib/safeExternalUrl";
import { collection, query, where, onSnapshot } from "firebase/firestore";
import { useIsMobile } from "@/hooks/use-mobile";

const formatBytes = (bytes?: number) => {
  if (!bytes || bytes <= 0) return "";
  const units = ["B", "KB", "MB", "GB"];
  let val = bytes;
  let i = 0;
  while (val >= 1024 && i < units.length - 1) { val /= 1024; i++; }
  return `${val.toFixed(val < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
};

const formatRelative = (ts: any) => {
  if (!ts) return "";
  const d = ts?.toDate?.() || (typeof ts === "number" ? new Date(ts) : new Date(ts));
  if (isNaN(d.getTime())) return "";
  const diffMs = Date.now() - d.getTime();
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min${min === 1 ? "" : "s"} ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? "" : "s"} ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day} day${day === 1 ? "" : "s"} ago`;
  const wk = Math.floor(day / 7);
  if (wk < 5) return `${wk} week${wk === 1 ? "" : "s"} ago`;
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
};

const SyllabusPage = () => {
  const { studentData } = useAuth();
  const isMobile = useIsMobile();
  const [loading, setLoading] = useState(true);
  const [docs, setDocs] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | "pdf" | "doc" | "img" | "xls">("all");

  useEffect(() => {
    if (!studentData?.schoolId || !studentData?.classId) {
      setDocs([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    const q = query(
      collection(db, "syllabi"),
      where("schoolId", "==", studentData.schoolId),
      where("classId", "==", studentData.classId)
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        if (cancelled) return;
        const data = snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as any) }))
          .filter((d) => d.isActive !== false)
          .sort((a, b) => {
            const am = a.uploadedAt?.toMillis?.() ?? 0;
            const bm = b.uploadedAt?.toMillis?.() ?? 0;
            return bm - am;
          });
        setDocs(data);
        setLoading(false);
      },
      (err) => {
        if (cancelled) return;
        console.error("Syllabus listener error:", err);
        setDocs([]);
        setLoading(false);
      }
    );

    return () => { cancelled = true; unsub(); };
  }, [studentData?.schoolId, studentData?.classId]);

  const handleView = (url: string) => {
    if (!openSafeExternalUrl(url)) {
      console.warn("[Syllabus] Refused to open non-https/blob URL");
    }
  };

  /* ═══════════════════════════════════════════════════════════════
     MOBILE — Bright Blue Apple UI
     ═══════════════════════════════════════════════════════════════ */
  if (isMobile) {
    const B1 = "#0055FF", B2 = "#1166FF";
    const BG = "#EEF4FF";
    const T1 = "#001040", T3 = "#5070B0", T4 = "#99AACC";
    const GREEN = "#00C853";
    const RED = "#FF3355";
    const ORANGE = "#FF8800";
    const SH = "0 0 0 0.5px rgba(0,85,255,0.08), 0 2px 8px rgba(0,85,255,0.08), 0 10px 28px rgba(0,85,255,0.10)";
    const SH_LG = "0 0 0 0.5px rgba(0,85,255,0.10), 0 4px 16px rgba(0,85,255,0.11), 0 18px 44px rgba(0,85,255,0.13)";
    const SH_BTN = "0 6px 20px rgba(0,85,255,0.40), 0 2px 5px rgba(0,85,255,0.22)";

    // ── File type detection (by fileType / fileName extension / mime) ──
    type DocType = "pdf" | "doc" | "img" | "xls" | "other";
    const detectType = (d: any): DocType => {
      const name: string = (d.fileName || d.name || "").toLowerCase();
      const mime: string = (d.fileType || d.mimeType || "").toLowerCase();
      if (mime.includes("pdf") || name.endsWith(".pdf")) return "pdf";
      if (mime.includes("image") || /\.(png|jpe?g|gif|webp|bmp|heic|svg)$/.test(name)) return "img";
      if (mime.includes("sheet") || mime.includes("excel") || /\.(xlsx?|csv|numbers)$/.test(name)) return "xls";
      if (mime.includes("word") || mime.includes("document") || /\.(docx?|rtf|txt|odt|pages)$/.test(name)) return "doc";
      return "other";
    };

    const themeMap: Record<DocType, {
      icoBg: string; icoShadow: string;
      tagBg: string; tagColor: string; tagBorder: string;
      tagLabel: string;
      viewLabel: string;
    }> = {
      pdf: {
        icoBg: "linear-gradient(135deg, #FF3355, #FF6688)",
        icoShadow: "0 4px 14px rgba(255,51,85,0.30)",
        tagBg: "rgba(255,51,85,0.08)", tagColor: RED, tagBorder: "rgba(255,51,85,0.18)",
        tagLabel: "PDF", viewLabel: "View PDF",
      },
      doc: {
        icoBg: `linear-gradient(135deg, ${B1}, #2277FF)`,
        icoShadow: "0 4px 14px rgba(0,85,255,0.28)",
        tagBg: "rgba(0,85,255,0.10)", tagColor: B1, tagBorder: "rgba(0,85,255,0.20)",
        tagLabel: "DOC", viewLabel: "Open Document",
      },
      img: {
        icoBg: `linear-gradient(135deg, ${GREEN}, #66EE88)`,
        icoShadow: "0 4px 14px rgba(0,200,83,0.26)",
        tagBg: "rgba(0,200,83,0.10)", tagColor: "#007830", tagBorder: "rgba(0,200,83,0.22)",
        tagLabel: "IMG", viewLabel: "View Image",
      },
      xls: {
        icoBg: `linear-gradient(135deg, ${ORANGE}, #FFCC44)`,
        icoShadow: "0 4px 14px rgba(255,136,0,0.26)",
        tagBg: "rgba(255,136,0,0.08)", tagColor: "#884400", tagBorder: "rgba(255,136,0,0.18)",
        tagLabel: "XLS", viewLabel: "Open Sheet",
      },
      other: {
        icoBg: `linear-gradient(135deg, ${B1}, #2277FF)`,
        icoShadow: "0 4px 14px rgba(0,85,255,0.28)",
        tagBg: "rgba(0,85,255,0.10)", tagColor: B1, tagBorder: "rgba(0,85,255,0.20)",
        tagLabel: "FILE", viewLabel: "Open File",
      },
    };

    const isRecent = (ts: any) => {
      if (!ts) return false;
      const d = ts?.toDate?.() || new Date(ts);
      if (isNaN(d.getTime())) return false;
      return Date.now() - d.getTime() < 1000 * 60 * 60 * 24 * 3; // < 3 days
    };

    // Apply search then type filter
    const docsWithType = docs.map(d => ({ ...d, __type: detectType(d) }));
    const searchFiltered = searchQuery.trim()
      ? docsWithType.filter(d => {
          const q = searchQuery.trim().toLowerCase();
          return (d.title || "").toLowerCase().includes(q) ||
                 (d.fileName || "").toLowerCase().includes(q) ||
                 (d.uploadedByName || "").toLowerCase().includes(q);
        })
      : docsWithType;
    const mobileFiltered = typeFilter === "all"
      ? searchFiltered
      : searchFiltered.filter(d => d.__type === typeFilter);

    // Summary
    const totalBytes = docs.reduce((sum, d) => sum + (d.fileSize || 0), 0);
    const pdfCount = docs.filter(d => detectType(d) === "pdf").length;

    const FILTERS: { key: typeof typeFilter; label: string }[] = [
      { key: "all", label: "All" },
      { key: "pdf", label: "PDF" },
      { key: "doc", label: "Docs" },
      { key: "img", label: "Images" },
      { key: "xls", label: "Sheets" },
    ];

    const docSubtitle = studentData?.className ? `Syllabus & notes for ${studentData.className}` : "Syllabus & notes shared by your teachers";

    // No class assigned — mobile empty state
    if (!studentData?.classId) {
      return (
        <div className="animate-in fade-in duration-500 -mx-3 -mt-3 md:mx-0 md:mt-0"
          style={{ fontFamily: "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif", background: BG, minHeight: "100vh" }}>
          <div className="flex items-start justify-between px-[22px] pt-[18px]">
            <div>
              <div className="text-[26px] font-bold mb-[3px]" style={{ color: T1, letterSpacing: "-0.7px" }}>Class Documents</div>
              <div className="text-[12px] font-normal" style={{ color: T3 }}>Syllabus &amp; notes shared by your teachers</div>
            </div>
          </div>
          <div className="mx-5 mt-6 bg-white rounded-[24px] px-5 py-8 flex flex-col items-center gap-3 relative overflow-hidden"
            style={{ boxShadow: SH_LG, border: "0.5px solid rgba(0,85,255,0.10)" }}>
            <div className="absolute -top-[50px] -right-[40px] w-[180px] h-[180px] rounded-full pointer-events-none"
              style={{ background: "radial-gradient(circle, rgba(0,85,255,0.05) 0%, transparent 70%)" }} />
            <div className="w-[72px] h-[72px] rounded-[24px] flex items-center justify-center relative z-10"
              style={{ background: `linear-gradient(135deg, ${B1}, ${B2})`, boxShadow: `${SH_BTN}, 0 0 0 10px rgba(0,85,255,0.08)` }}>
              <Library className="w-8 h-8 text-white" strokeWidth={2.1} />
            </div>
            <div className="text-[18px] font-bold relative z-10 text-center" style={{ color: T1, letterSpacing: "-0.4px" }}>No Class Assigned</div>
            <div className="text-[13px] text-center max-w-[220px] leading-[1.6] font-normal relative z-10" style={{ color: T3 }}>
              Please contact your school administration to be assigned to a class.
            </div>
          </div>
          <div className="h-6" />
        </div>
      );
    }

    return (
      <div className="animate-in fade-in duration-500 -mx-3 -mt-3 md:mx-0 md:mt-0"
        style={{ fontFamily: "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif", background: BG, minHeight: "100vh" }}>

        {/* ── Page Head ── */}
        <div className="flex items-start justify-between px-[22px] pt-[18px]">
          <div>
            <div className="text-[26px] font-bold mb-[3px]" style={{ color: T1, letterSpacing: "-0.7px" }}>Class Documents</div>
            <div className="text-[12px] font-normal" style={{ color: T3 }}>{docSubtitle}</div>
          </div>
          {docs.length > 0 && (
            <div className="px-3 py-[5px] rounded-full text-[10px] font-bold tracking-[0.04em] text-white whitespace-nowrap mt-1 shrink-0"
              style={{ background: `linear-gradient(135deg, ${B1}, ${B2})`, boxShadow: "0 3px 10px rgba(0,85,255,0.28)" }}>
              {docs.length} Doc{docs.length === 1 ? "" : "s"}
            </div>
          )}
        </div>

        {/* ── Search ── */}
        <div className="mx-5 mt-4 relative">
          <div className="absolute left-[15px] top-1/2 -translate-y-1/2 pointer-events-none">
            <Search className="w-4 h-4" style={{ color: "rgba(0,85,255,0.40)" }} strokeWidth={2.2} />
          </div>
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search by title, file name, or teacher..."
            className="w-full py-[13px] pr-4 pl-11 rounded-[17px] text-[14px] font-normal outline-none bg-white"
            style={{
              border: "0.5px solid rgba(0,85,255,0.12)",
              color: T1,
              letterSpacing: "-0.1px",
              boxShadow: SH,
              fontFamily: "inherit",
            }}
          />
        </div>

        {/* ── Filter chips ── */}
        <div className="flex gap-2 px-5 pt-3 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
          {FILTERS.map(f => {
            const isAct = typeFilter === f.key;
            return (
              <button
                key={f.key}
                onClick={() => setTypeFilter(f.key)}
                className="px-[14px] py-[7px] rounded-full text-[11px] font-bold flex-shrink-0 transition-transform active:scale-[0.94]"
                style={{
                  background: isAct ? `linear-gradient(135deg, ${B1}, ${B2})` : "#FFFFFF",
                  color: isAct ? "#fff" : T3,
                  border: isAct ? "0.5px solid transparent" : "0.5px solid rgba(0,85,255,0.12)",
                  boxShadow: isAct ? "0 3px 12px rgba(0,85,255,0.30)" : SH,
                  transitionTimingFunction: "cubic-bezier(0.34,1.56,0.64,1)",
                }}>
                {f.label}
              </button>
            );
          })}
        </div>

        {/* ── Section label ── */}
        <div className="px-[22px] pt-[18px] text-[9px] font-bold uppercase tracking-[0.10em] flex items-center gap-2"
          style={{ color: T4 }}>
          <span>Recent Documents</span>
          <span className="flex-1 h-px" style={{ background: "rgba(0,85,255,0.12)" }} />
        </div>

        {/* ── Content ── */}
        {loading ? (
          <div className="mx-5 mt-[14px] bg-white rounded-[24px] py-10 flex flex-col items-center gap-3"
            style={{ boxShadow: SH_LG, border: "0.5px solid rgba(0,85,255,0.10)" }}>
            <Loader2 className="w-8 h-8 animate-spin" style={{ color: B1 }} />
            <p className="text-xs font-bold uppercase tracking-widest" style={{ color: T4 }}>Loading documents…</p>
          </div>
        ) : mobileFiltered.length === 0 ? (
          <div className="mx-5 mt-[14px] bg-white rounded-[24px] px-5 py-8 flex flex-col items-center gap-3 relative overflow-hidden"
            style={{ boxShadow: SH_LG, border: "0.5px solid rgba(0,85,255,0.10)" }}>
            <div className="absolute -top-[50px] -right-[40px] w-[180px] h-[180px] rounded-full pointer-events-none"
              style={{ background: "radial-gradient(circle, rgba(0,85,255,0.05) 0%, transparent 70%)" }} />
            <div className="absolute -bottom-[50px] -left-[30px] w-[160px] h-[160px] rounded-full pointer-events-none"
              style={{ background: "radial-gradient(circle, rgba(0,85,255,0.04) 0%, transparent 70%)" }} />
            <div className="w-[72px] h-[72px] rounded-[24px] flex items-center justify-center relative z-10"
              style={{ background: `linear-gradient(135deg, ${B1}, ${B2})`, boxShadow: `${SH_BTN}, 0 0 0 10px rgba(0,85,255,0.08)` }}>
              <FileText className="w-8 h-8 text-white" strokeWidth={2.1} />
            </div>
            <div className="text-[18px] font-bold relative z-10 text-center" style={{ color: T1, letterSpacing: "-0.4px" }}>
              {searchQuery || typeFilter !== "all" ? "No Matches Found" : "No Documents Yet"}
            </div>
            <div className="text-[13px] text-center max-w-[220px] leading-[1.6] font-normal relative z-10" style={{ color: T3 }}>
              {searchQuery
                ? "Try a different search term."
                : typeFilter !== "all"
                ? `No ${FILTERS.find(f => f.key === typeFilter)?.label} files in this library yet.`
                : "Your teacher will upload syllabus notes, study materials and exam guides here."}
            </div>
          </div>
        ) : (
          mobileFiltered.map((doc: any) => {
            const theme = themeMap[doc.__type as DocType];
            const recent = isRecent(doc.uploadedAt);
            const subjectGuess =
              (doc.subject || doc.category || doc.tag || "").toString() ||
              (studentData?.className ? `Grade ${studentData.className}` : "");
            return (
              <div
                key={doc.id}
                role="button"
                tabIndex={0}
                aria-label={`Open ${doc.title || "document"}`}
                onClick={() => handleView(doc.fileUrl)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleView(doc.fileUrl); } }}
                className="mx-5 mt-[14px] bg-white rounded-[24px] p-5 relative overflow-hidden cursor-pointer active:scale-[0.97] transition-transform focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0055FF]/40"
                style={{ boxShadow: SH_LG, border: "0.5px solid rgba(0,85,255,0.10)", transitionTimingFunction: "cubic-bezier(0.34,1.56,0.64,1)" }}>
                <div className="absolute -top-10 -right-7 w-[140px] h-[140px] rounded-full pointer-events-none"
                  style={{ background: "radial-gradient(circle, rgba(0,85,255,0.05) 0%, transparent 70%)" }} />

                <div className="flex items-start gap-[14px] mb-4 relative z-10">
                  <div className="w-[50px] h-[50px] rounded-[16px] flex items-center justify-center shrink-0"
                    style={{ background: theme.icoBg, boxShadow: theme.icoShadow }}>
                    <FileText className="w-6 h-6 text-white" strokeWidth={2.1} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[16px] font-bold mb-[5px] leading-[1.3]" style={{ color: T1, letterSpacing: "-0.3px" }}>
                      {doc.title || "Untitled Document"}
                    </div>
                    {doc.fileName && (
                      <div className="text-[11px] font-medium truncate max-w-full mb-[3px]" style={{ color: T3, letterSpacing: "-0.1px" }}>
                        {doc.fileName}
                      </div>
                    )}
                    <div className="flex items-center gap-[10px] flex-wrap">
                      {doc.fileSize ? (
                        <div className="px-[9px] py-[3px] rounded-full text-[10px] font-bold tracking-[0.02em]"
                          style={{ background: "rgba(0,85,255,0.08)", border: "0.5px solid rgba(0,85,255,0.16)", color: B1 }}>
                          {formatBytes(doc.fileSize)}
                        </div>
                      ) : null}
                      {doc.uploadedAt && (
                        <div className="flex items-center gap-1 text-[11px] font-medium" style={{ color: T3 }}>
                          <Calendar className="w-[10px] h-[10px]" strokeWidth={2.5} />
                          {formatRelative(doc.uploadedAt)}
                        </div>
                      )}
                    </div>
                    {doc.uploadedByName && (
                      <div className="flex items-center gap-1 mt-[5px]">
                        <User className="w-[10px] h-[10px]" style={{ color: T3 }} strokeWidth={2.5} />
                        <span className="text-[10px] font-bold uppercase tracking-[0.06em]" style={{ color: T3 }}>
                          By {doc.uploadedByName}
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex gap-[6px] mb-3 relative z-10 flex-wrap">
                  <div className="px-[11px] py-1 rounded-full text-[10px] font-bold"
                    style={{ background: theme.tagBg, color: theme.tagColor, border: `0.5px solid ${theme.tagBorder}` }}>
                    {theme.tagLabel}
                  </div>
                  {subjectGuess && (
                    <div className="px-[11px] py-1 rounded-full text-[10px] font-bold"
                      style={{ background: "rgba(0,85,255,0.08)", color: B1, border: "0.5px solid rgba(0,85,255,0.16)" }}>
                      {subjectGuess}
                    </div>
                  )}
                  {recent && (
                    <div className="px-[11px] py-1 rounded-full text-[10px] font-bold"
                      style={{ background: "rgba(0,200,83,0.10)", color: "#007830", border: "0.5px solid rgba(0,200,83,0.22)" }}>
                      New
                    </div>
                  )}
                </div>

                <div className="flex gap-[10px] relative z-10">
                  <button
                    onClick={e => { e.stopPropagation(); handleView(doc.fileUrl); }}
                    disabled={!doc.fileUrl}
                    className="flex-1 h-11 rounded-[14px] flex items-center justify-center gap-2 text-[14px] font-bold text-white disabled:opacity-50 relative overflow-hidden active:scale-[0.97] transition-transform"
                    style={{
                      background: `linear-gradient(135deg, ${B1}, ${B2})`,
                      boxShadow: SH_BTN,
                      letterSpacing: "0.02em",
                      transitionTimingFunction: "cubic-bezier(0.34,1.56,0.64,1)",
                    }}>
                    <div className="absolute inset-0 pointer-events-none" style={{ background: "linear-gradient(135deg, rgba(255,255,255,0.14) 0%, transparent 52%)" }} />
                    <ExternalLink className="w-[15px] h-[15px]" strokeWidth={2.2} />
                    <span className="relative z-10">{theme.viewLabel}</span>
                  </button>
                  <a
                    href={doc.fileUrl || "#"}
                    target="_blank"
                    rel="noopener noreferrer"
                    download={doc.fileName || true}
                    onClick={e => { e.stopPropagation(); if (!doc.fileUrl) e.preventDefault(); }}
                    aria-label="Download document"
                    className="w-11 h-11 rounded-[14px] flex items-center justify-center shrink-0 active:scale-90 transition-transform"
                    style={{
                      background: BG,
                      border: "0.5px solid rgba(0,85,255,0.16)",
                      boxShadow: SH,
                      opacity: doc.fileUrl ? 1 : 0.5,
                      pointerEvents: doc.fileUrl ? "auto" : "none",
                      transitionTimingFunction: "cubic-bezier(0.34,1.56,0.64,1)",
                    }}>
                    <Download className="w-4 h-4" style={{ color: "rgba(0,85,255,0.7)" }} strokeWidth={2.2} />
                  </a>
                </div>
              </div>
            );
          })
        )}

        {/* ── Summary Dark ── */}
        {!loading && docs.length > 0 && (
          <div className="mx-5 mt-[14px] rounded-[22px] px-5 py-[18px] relative overflow-hidden"
            style={{
              background: "linear-gradient(140deg, #001888 0%, #0033CC 48%, #0055FF 100%)",
              boxShadow: "0 8px 28px rgba(0,51,204,0.32), 0 0 0 0.5px rgba(255,255,255,0.14)",
            }}>
            <div className="absolute -top-[35px] -right-[25px] w-[160px] h-[160px] rounded-full pointer-events-none"
              style={{ background: "radial-gradient(circle, rgba(255,255,255,0.12) 0%, transparent 65%)" }} />
            <div className="absolute inset-0 pointer-events-none" style={{
              backgroundImage: "linear-gradient(rgba(255,255,255,0.014) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.014) 1px, transparent 1px)",
              backgroundSize: "24px 24px"
            }} />
            <div className="text-[9px] font-bold uppercase tracking-[0.12em] mb-[10px] relative z-10" style={{ color: "rgba(255,255,255,0.48)" }}>
              Document Library
            </div>
            <div className="grid grid-cols-3 rounded-[16px] overflow-hidden relative z-10" style={{ gap: "1px", background: "rgba(255,255,255,0.12)" }}>
              <div className="py-3 px-[14px] text-center" style={{ background: "rgba(255,255,255,0.08)" }}>
                <div className="text-[22px] font-bold text-white leading-none mb-1" style={{ letterSpacing: "-0.6px" }}>{docs.length}</div>
                <div className="text-[9px] font-bold uppercase tracking-[0.09em]" style={{ color: "rgba(255,255,255,0.40)" }}>Total</div>
              </div>
              <div className="py-3 px-[14px] text-center" style={{ background: "rgba(255,255,255,0.08)" }}>
                <div className="text-[22px] font-bold text-white leading-none mb-1" style={{ letterSpacing: "-0.6px" }}>{pdfCount}</div>
                <div className="text-[9px] font-bold uppercase tracking-[0.09em]" style={{ color: "rgba(255,255,255,0.40)" }}>{pdfCount === 1 ? "PDF" : "PDFs"}</div>
              </div>
              <div className="py-3 px-[14px] text-center" style={{ background: "rgba(255,255,255,0.08)" }}>
                <div className="text-[22px] font-bold text-white leading-none mb-1" style={{ letterSpacing: "-0.6px" }}>
                  {totalBytes > 0 ? formatBytes(totalBytes) : "—"}
                </div>
                <div className="text-[9px] font-bold uppercase tracking-[0.09em]" style={{ color: "rgba(255,255,255,0.40)" }}>Storage</div>
              </div>
            </div>
          </div>
        )}

        <div className="h-6" />
      </div>
    );
  }

  /* ═══════════════════════════════════════════════════════════════
     DESKTOP — Bright Blue Apple UI (matches mobile)
     ═══════════════════════════════════════════════════════════════ */
  const B1 = "#0055FF", B2 = "#1166FF";
  const BG = "#EEF4FF";
  const T1 = "#001040", T3 = "#5070B0", T4 = "#99AACC";
  const GREEN = "#00C853";
  const RED = "#FF3355";
  const ORANGE = "#FF8800";
  const SH = "0 0 0 0.5px rgba(0,85,255,0.08), 0 2px 8px rgba(0,85,255,0.08), 0 10px 28px rgba(0,85,255,0.10)";
  const SH_LG = "0 0 0 0.5px rgba(0,85,255,0.10), 0 4px 16px rgba(0,85,255,0.11), 0 18px 44px rgba(0,85,255,0.13)";
  const SH_BTN = "0 6px 20px rgba(0,85,255,0.40), 0 2px 5px rgba(0,85,255,0.22)";

  type DocTypeD = "pdf" | "doc" | "img" | "xls" | "other";
  const detectTypeD = (d: any): DocTypeD => {
    const name: string = (d.fileName || d.name || "").toLowerCase();
    const mime: string = (d.fileType || d.mimeType || "").toLowerCase();
    if (mime.includes("pdf") || name.endsWith(".pdf")) return "pdf";
    if (mime.includes("image") || /\.(png|jpe?g|gif|webp|bmp|heic|svg)$/.test(name)) return "img";
    if (mime.includes("sheet") || mime.includes("excel") || /\.(xlsx?|csv|numbers)$/.test(name)) return "xls";
    if (mime.includes("word") || mime.includes("document") || /\.(docx?|rtf|txt|odt|pages)$/.test(name)) return "doc";
    return "other";
  };

  const themeMapD: Record<DocTypeD, { icoBg: string; icoShadow: string; tagBg: string; tagColor: string; tagBorder: string; tagLabel: string; viewLabel: string; }> = {
    pdf:   { icoBg: "linear-gradient(135deg, #FF3355, #FF6688)", icoShadow: "0 4px 14px rgba(255,51,85,0.30)", tagBg: "rgba(255,51,85,0.08)", tagColor: RED, tagBorder: "rgba(255,51,85,0.18)", tagLabel: "PDF", viewLabel: "View PDF" },
    doc:   { icoBg: `linear-gradient(135deg, ${B1}, #2277FF)`, icoShadow: "0 4px 14px rgba(0,85,255,0.28)", tagBg: "rgba(0,85,255,0.10)", tagColor: B1, tagBorder: "rgba(0,85,255,0.20)", tagLabel: "DOC", viewLabel: "Open Document" },
    img:   { icoBg: `linear-gradient(135deg, ${GREEN}, #66EE88)`, icoShadow: "0 4px 14px rgba(0,200,83,0.26)", tagBg: "rgba(0,200,83,0.10)", tagColor: "#007830", tagBorder: "rgba(0,200,83,0.22)", tagLabel: "IMG", viewLabel: "View Image" },
    xls:   { icoBg: `linear-gradient(135deg, ${ORANGE}, #FFCC44)`, icoShadow: "0 4px 14px rgba(255,136,0,0.26)", tagBg: "rgba(255,136,0,0.08)", tagColor: "#884400", tagBorder: "rgba(255,136,0,0.18)", tagLabel: "XLS", viewLabel: "Open Sheet" },
    other: { icoBg: `linear-gradient(135deg, ${B1}, #2277FF)`, icoShadow: "0 4px 14px rgba(0,85,255,0.28)", tagBg: "rgba(0,85,255,0.10)", tagColor: B1, tagBorder: "rgba(0,85,255,0.20)", tagLabel: "FILE", viewLabel: "Open File" },
  };

  const isRecentD = (ts: any) => {
    if (!ts) return false;
    const d = ts?.toDate?.() || new Date(ts);
    if (isNaN(d.getTime())) return false;
    return Date.now() - d.getTime() < 1000 * 60 * 60 * 24 * 3;
  };

  const docsWithTypeD = docs.map(d => ({ ...d, __type: detectTypeD(d) }));
  const searchFilteredD = searchQuery.trim()
    ? docsWithTypeD.filter(d => {
        const q = searchQuery.trim().toLowerCase();
        return (d.title || "").toLowerCase().includes(q) ||
               (d.fileName || "").toLowerCase().includes(q) ||
               (d.uploadedByName || "").toLowerCase().includes(q);
      })
    : docsWithTypeD;
  const finalFilteredD = typeFilter === "all"
    ? searchFilteredD
    : searchFilteredD.filter(d => d.__type === typeFilter);

  const totalBytesD = docs.reduce((sum, d) => sum + (d.fileSize || 0), 0);
  const pdfCountD = docs.filter(d => detectTypeD(d) === "pdf").length;
  const docSubtitleD = studentData?.className ? `Syllabus & notes for ${studentData.className}` : "Syllabus & notes shared by your teachers";

  const FILTERS_D: { key: typeof typeFilter; label: string }[] = [
    { key: "all", label: "All" },
    { key: "pdf", label: "PDF" },
    { key: "doc", label: "Docs" },
    { key: "img", label: "Images" },
    { key: "xls", label: "Sheets" },
  ];

  // No class assigned state (desktop)
  if (!studentData?.classId) {
    return (
      <div className="animate-in fade-in duration-500 -m-4 sm:-m-6 md:-m-8 min-h-[calc(100vh-64px)]"
        style={{ fontFamily: "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif", background: BG }}>
        <div className="w-full px-6 pt-8 pb-12">
          <div className="mb-6">
            <div className="text-[32px] font-bold" style={{ color: T1, letterSpacing: "-0.9px" }}>Class Documents</div>
            <div className="text-[14px] mt-2 font-normal" style={{ color: T3 }}>Syllabus &amp; notes shared by your teachers</div>
          </div>
          <div className="bg-white rounded-[28px] px-6 py-16 flex flex-col items-center gap-4 relative overflow-hidden"
            style={{ boxShadow: SH_LG, border: "0.5px solid rgba(0,85,255,0.10)" }}>
            <div className="absolute -top-[60px] -right-[50px] w-[240px] h-[240px] rounded-full pointer-events-none"
              style={{ background: "radial-gradient(circle, rgba(0,85,255,0.06) 0%, transparent 70%)" }} />
            <div className="w-[90px] h-[90px] rounded-[28px] flex items-center justify-center relative z-10"
              style={{ background: `linear-gradient(135deg, ${B1}, ${B2})`, boxShadow: `${SH_BTN}, 0 0 0 12px rgba(0,85,255,0.08)` }}>
              <Library className="w-10 h-10 text-white" strokeWidth={2.1} />
            </div>
            <div className="text-[22px] font-bold relative z-10 text-center" style={{ color: T1, letterSpacing: "-0.5px" }}>No Class Assigned</div>
            <div className="text-[14px] text-center max-w-[400px] leading-[1.6] font-normal relative z-10" style={{ color: T3 }}>
              Please contact your school administration to be assigned to a class.
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="animate-in fade-in duration-500 -m-4 sm:-m-6 md:-m-8 min-h-[calc(100vh-64px)]"
      style={{ fontFamily: "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif", background: BG }}>
      <div className="w-full px-6 pt-8 pb-12">

        {/* ── Toolbar ── */}
        <div className="flex items-start justify-between gap-6 flex-wrap mb-5">
          <div>
            <div className="text-[32px] font-bold" style={{ color: T1, letterSpacing: "-0.9px" }}>Class Documents</div>
            <div className="text-[14px] mt-2 font-normal" style={{ color: T3 }}>{docSubtitleD}</div>
          </div>
          {docs.length > 0 && (
            <div className="px-4 py-[10px] rounded-full text-[13px] font-bold tracking-[0.02em] text-white whitespace-nowrap"
              style={{ background: `linear-gradient(135deg, ${B1}, ${B2})`, boxShadow: "0 3px 10px rgba(0,85,255,0.28)" }}>
              {docs.length} Document{docs.length === 1 ? "" : "s"}
            </div>
          )}
        </div>

        {/* ── Search + Filter row ── */}
        <div className="flex items-center gap-3 mb-5 flex-wrap">
          <div className="flex-1 min-w-[280px] relative">
            <div className="absolute left-[15px] top-1/2 -translate-y-1/2 pointer-events-none">
              <Search className="w-[17px] h-[17px]" style={{ color: "rgba(0,85,255,0.40)" }} strokeWidth={2.2} />
            </div>
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search by title, file name, or teacher..."
              className="w-full py-[14px] pr-4 pl-12 rounded-[16px] text-[14px] font-normal outline-none bg-white"
              style={{
                border: "0.5px solid rgba(0,85,255,0.12)",
                color: T1,
                letterSpacing: "-0.1px",
                boxShadow: SH,
                fontFamily: "inherit",
              }}
            />
          </div>
          <div className="flex gap-2 overflow-x-auto [&::-webkit-scrollbar]:hidden" style={{ scrollbarWidth: "none" }}>
            {FILTERS_D.map(f => {
              const isAct = typeFilter === f.key;
              return (
                <button
                  key={f.key}
                  onClick={() => setTypeFilter(f.key)}
                  className="px-4 py-[11px] rounded-[16px] text-[12px] font-bold flex-shrink-0 transition-transform hover:scale-[1.03]"
                  style={{
                    background: isAct ? `linear-gradient(135deg, ${B1}, ${B2})` : "#FFFFFF",
                    color: isAct ? "#fff" : T3,
                    border: isAct ? "0.5px solid transparent" : "0.5px solid rgba(0,85,255,0.12)",
                    boxShadow: isAct ? "0 3px 12px rgba(0,85,255,0.30)" : SH,
                  }}>
                  {f.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Content ── */}
        {loading ? (
          <div className="bg-white rounded-[24px] py-20 flex flex-col items-center gap-3"
            style={{ boxShadow: SH_LG, border: "0.5px solid rgba(0,85,255,0.10)" }}>
            <Loader2 className="w-10 h-10 animate-spin" style={{ color: B1 }} />
            <p className="text-xs font-bold uppercase tracking-widest" style={{ color: T4 }}>Loading documents…</p>
          </div>
        ) : finalFilteredD.length === 0 ? (
          <div className="bg-white rounded-[24px] px-6 py-20 flex flex-col items-center gap-4 relative overflow-hidden"
            style={{ boxShadow: SH_LG, border: "0.5px solid rgba(0,85,255,0.10)" }}>
            <div className="absolute -top-[60px] -right-[50px] w-[240px] h-[240px] rounded-full pointer-events-none"
              style={{ background: "radial-gradient(circle, rgba(0,85,255,0.05) 0%, transparent 70%)" }} />
            <div className="absolute -bottom-[60px] -left-[40px] w-[200px] h-[200px] rounded-full pointer-events-none"
              style={{ background: "radial-gradient(circle, rgba(0,85,255,0.04) 0%, transparent 70%)" }} />
            <div className="w-[90px] h-[90px] rounded-[28px] flex items-center justify-center relative z-10"
              style={{ background: `linear-gradient(135deg, ${B1}, ${B2})`, boxShadow: `${SH_BTN}, 0 0 0 12px rgba(0,85,255,0.08)` }}>
              <FileText className="w-10 h-10 text-white" strokeWidth={2.1} />
            </div>
            <div className="text-[22px] font-bold relative z-10 text-center" style={{ color: T1, letterSpacing: "-0.5px" }}>
              {searchQuery || typeFilter !== "all" ? "No Matches Found" : "No Documents Yet"}
            </div>
            <div className="text-[14px] text-center max-w-[440px] leading-[1.6] font-normal relative z-10" style={{ color: T3 }}>
              {searchQuery
                ? "Try a different search term."
                : typeFilter !== "all"
                ? `No ${FILTERS_D.find(f => f.key === typeFilter)?.label} files in this library yet.`
                : "Your teacher will upload syllabus notes, study materials and exam guides here."}
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
            {finalFilteredD.map((doc: any) => {
              const theme = themeMapD[doc.__type as DocTypeD];
              const recent = isRecentD(doc.uploadedAt);
              const subjectGuess =
                (doc.subject || doc.category || doc.tag || "").toString() ||
                (studentData?.className ? `Grade ${studentData.className}` : "");
              return (
                <div
                  key={doc.id}
                  role="button"
                  tabIndex={0}
                  aria-label={`Open ${doc.title || "document"}`}
                  onClick={() => handleView(doc.fileUrl)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleView(doc.fileUrl); } }}
                  className="bg-white rounded-[24px] p-6 relative overflow-hidden cursor-pointer transition-all duration-200 hover:-translate-y-1.5 hover:shadow-2xl hover:scale-[1.015] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0055FF]/40"
                  style={{ boxShadow: SH_LG, border: "0.5px solid rgba(0,85,255,0.10)" }}>
                  <div className="absolute -top-10 -right-7 w-[160px] h-[160px] rounded-full pointer-events-none"
                    style={{ background: "radial-gradient(circle, rgba(0,85,255,0.05) 0%, transparent 70%)" }} />

                  <div className="flex items-start gap-[14px] mb-4 relative z-10">
                    <div className="w-[56px] h-[56px] rounded-[18px] flex items-center justify-center shrink-0"
                      style={{ background: theme.icoBg, boxShadow: theme.icoShadow }}>
                      <FileText className="w-7 h-7 text-white" strokeWidth={2.1} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[17px] font-bold mb-1 leading-[1.3]" style={{ color: T1, letterSpacing: "-0.3px" }}>
                        {doc.title || "Untitled Document"}
                      </div>
                      {doc.fileName && (
                        <div className="text-[11px] font-medium truncate max-w-full mb-1" style={{ color: T3, letterSpacing: "-0.1px" }}>
                          {doc.fileName}
                        </div>
                      )}
                      <div className="flex items-center gap-[10px] flex-wrap">
                        {doc.fileSize ? (
                          <div className="px-[9px] py-[3px] rounded-full text-[10px] font-bold tracking-[0.02em]"
                            style={{ background: "rgba(0,85,255,0.08)", border: "0.5px solid rgba(0,85,255,0.16)", color: B1 }}>
                            {formatBytes(doc.fileSize)}
                          </div>
                        ) : null}
                        {doc.uploadedAt && (
                          <div className="flex items-center gap-1 text-[11px] font-medium" style={{ color: T3 }}>
                            <Calendar className="w-[11px] h-[11px]" strokeWidth={2.5} />
                            {formatRelative(doc.uploadedAt)}
                          </div>
                        )}
                      </div>
                      {doc.uploadedByName && (
                        <div className="flex items-center gap-1 mt-2">
                          <User className="w-[11px] h-[11px]" style={{ color: T3 }} strokeWidth={2.5} />
                          <span className="text-[10px] font-bold uppercase tracking-[0.06em]" style={{ color: T3 }}>
                            By {doc.uploadedByName}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex gap-[6px] mb-3 relative z-10 flex-wrap">
                    <div className="px-3 py-1 rounded-full text-[10px] font-bold"
                      style={{ background: theme.tagBg, color: theme.tagColor, border: `0.5px solid ${theme.tagBorder}` }}>
                      {theme.tagLabel}
                    </div>
                    {subjectGuess && (
                      <div className="px-3 py-1 rounded-full text-[10px] font-bold"
                        style={{ background: "rgba(0,85,255,0.08)", color: B1, border: "0.5px solid rgba(0,85,255,0.16)" }}>
                        {subjectGuess}
                      </div>
                    )}
                    {recent && (
                      <div className="px-3 py-1 rounded-full text-[10px] font-bold"
                        style={{ background: "rgba(0,200,83,0.10)", color: "#007830", border: "0.5px solid rgba(0,200,83,0.22)" }}>
                        New
                      </div>
                    )}
                  </div>

                  <div className="flex gap-[10px] relative z-10">
                    <button
                      onClick={e => { e.stopPropagation(); handleView(doc.fileUrl); }}
                      disabled={!doc.fileUrl}
                      className="flex-1 h-11 rounded-[14px] flex items-center justify-center gap-2 text-[14px] font-bold text-white disabled:opacity-50 relative overflow-hidden transition-transform hover:scale-[1.01]"
                      style={{
                        background: `linear-gradient(135deg, ${B1}, ${B2})`,
                        boxShadow: SH_BTN,
                        letterSpacing: "0.02em",
                      }}>
                      <div className="absolute inset-0 pointer-events-none" style={{ background: "linear-gradient(135deg, rgba(255,255,255,0.14) 0%, transparent 52%)" }} />
                      <ExternalLink className="w-[15px] h-[15px] relative z-10" strokeWidth={2.2} />
                      <span className="relative z-10">{theme.viewLabel}</span>
                    </button>
                    <a
                      href={doc.fileUrl || "#"}
                      target="_blank"
                      rel="noopener noreferrer"
                      download={doc.fileName || true}
                      onClick={e => { e.stopPropagation(); if (!doc.fileUrl) e.preventDefault(); }}
                      aria-label="Download document"
                      className="w-11 h-11 rounded-[14px] flex items-center justify-center shrink-0 transition-transform hover:scale-[1.05]"
                      style={{
                        background: BG,
                        border: "0.5px solid rgba(0,85,255,0.16)",
                        boxShadow: SH,
                        opacity: doc.fileUrl ? 1 : 0.5,
                        pointerEvents: doc.fileUrl ? "auto" : "none",
                      }}>
                      <Download className="w-[17px] h-[17px]" style={{ color: "rgba(0,85,255,0.7)" }} strokeWidth={2.2} />
                    </a>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ── Summary Dark Card ── */}
        {!loading && docs.length > 0 && (
          <div className="mt-5 rounded-[24px] px-7 py-6 relative overflow-hidden transition-all duration-200 hover:-translate-y-1 hover:shadow-2xl"
            style={{
              background: "linear-gradient(140deg, #001888 0%, #0033CC 48%, #0055FF 100%)",
              boxShadow: "0 8px 28px rgba(0,51,204,0.32), 0 0 0 0.5px rgba(255,255,255,0.14)",
            }}>
            <div className="absolute -top-[45px] -right-[30px] w-[220px] h-[220px] rounded-full pointer-events-none"
              style={{ background: "radial-gradient(circle, rgba(255,255,255,0.12) 0%, transparent 65%)" }} />
            <div className="absolute inset-0 pointer-events-none" style={{
              backgroundImage: "linear-gradient(rgba(255,255,255,0.014) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.014) 1px, transparent 1px)",
              backgroundSize: "24px 24px"
            }} />
            <div className="text-[10px] font-bold uppercase tracking-[0.12em] mb-4 relative z-10" style={{ color: "rgba(255,255,255,0.48)" }}>
              Document Library
            </div>
            <div className="grid grid-cols-3 rounded-[18px] overflow-hidden relative z-10" style={{ gap: "1px", background: "rgba(255,255,255,0.12)" }}>
              <div className="py-5 px-4 text-center" style={{ background: "rgba(255,255,255,0.08)" }}>
                <div className="text-[36px] font-bold text-white leading-none mb-2" style={{ letterSpacing: "-1.2px" }}>{docs.length}</div>
                <div className="text-[10px] font-bold uppercase tracking-[0.10em]" style={{ color: "rgba(255,255,255,0.42)" }}>Total Documents</div>
              </div>
              <div className="py-5 px-4 text-center" style={{ background: "rgba(255,255,255,0.08)" }}>
                <div className="text-[36px] font-bold text-white leading-none mb-2" style={{ letterSpacing: "-1.2px" }}>{pdfCountD}</div>
                <div className="text-[10px] font-bold uppercase tracking-[0.10em]" style={{ color: "rgba(255,255,255,0.42)" }}>{pdfCountD === 1 ? "PDF File" : "PDF Files"}</div>
              </div>
              <div className="py-5 px-4 text-center" style={{ background: "rgba(255,255,255,0.08)" }}>
                <div className="text-[36px] font-bold text-white leading-none mb-2" style={{ letterSpacing: "-1.2px" }}>
                  {totalBytesD > 0 ? formatBytes(totalBytesD) : "—"}
                </div>
                <div className="text-[10px] font-bold uppercase tracking-[0.10em]" style={{ color: "rgba(255,255,255,0.42)" }}>Total Storage</div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default SyllabusPage;