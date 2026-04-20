import { useState, useEffect } from "react";
import {
  Clock, School,
  ShieldCheck, Loader2, Target, MessageSquare,
  BookOpen, ChevronRight, Layers
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../lib/AuthContext";
import { db } from "../lib/firebase";
import { doc as fbDoc, getDoc as fbGetDoc } from "firebase/firestore";
import { subscribeEnrollments } from "../lib/enrollmentQuery";
import { useIsMobile } from "@/hooks/use-mobile";

// Index-based vibrant fallback colors (so every card is colorful even if subject unknown)
const INDEX_THEMES = [
  { bg: "from-violet-500 to-purple-700",  light: "bg-violet-50",  text: "text-violet-700",  iconBg: "bg-violet-600"  },
  { bg: "from-rose-500 to-pink-600",      light: "bg-rose-50",    text: "text-rose-700",    iconBg: "bg-rose-500"    },
  { bg: "from-amber-500 to-orange-600",   light: "bg-amber-50",   text: "text-amber-700",   iconBg: "bg-amber-500"   },
  { bg: "from-sky-500 to-cyan-600",       light: "bg-sky-50",     text: "text-sky-700",     iconBg: "bg-sky-600"     },
  { bg: "from-teal-500 to-emerald-600",   light: "bg-teal-50",    text: "text-teal-700",    iconBg: "bg-teal-600"    },
  { bg: "from-blue-500 to-indigo-600",    light: "bg-blue-50",    text: "text-blue-700",    iconBg: "bg-blue-600"    },
];

// Subject → color theme (matches by keyword, fallback is index-based)
const subjectTheme = (subject: string, idx: number) => {
  const s = subject?.toLowerCase() || "";
  if (s.includes("math"))     return { bg: "from-blue-500 to-indigo-600",   light: "bg-blue-50",    text: "text-blue-700",    iconBg: "bg-blue-600"    };
  if (s.includes("english"))  return { bg: "from-emerald-500 to-teal-600",  light: "bg-emerald-50", text: "text-emerald-700",  iconBg: "bg-emerald-600" };
  if (s.includes("hindi"))    return { bg: "from-orange-500 to-amber-600",  light: "bg-orange-50",  text: "text-orange-700",  iconBg: "bg-orange-500"  };
  if (s.includes("science"))  return { bg: "from-cyan-500 to-sky-600",      light: "bg-cyan-50",    text: "text-cyan-700",    iconBg: "bg-cyan-600"    };
  if (s.includes("social") || s.includes("sst") || s.includes("history") || s.includes("geo"))
                               return { bg: "from-purple-500 to-violet-700", light: "bg-purple-50",  text: "text-purple-700",  iconBg: "bg-purple-600"  };
  if (s.includes("computer") || s.includes("it"))
                               return { bg: "from-rose-500 to-pink-600",     light: "bg-rose-50",    text: "text-rose-700",    iconBg: "bg-rose-500"    };
  if (s.includes("physics"))  return { bg: "from-sky-500 to-blue-600",      light: "bg-sky-50",     text: "text-sky-700",     iconBg: "bg-sky-600"     };
  if (s.includes("chem"))     return { bg: "from-lime-500 to-green-600",    light: "bg-lime-50",    text: "text-lime-700",    iconBg: "bg-lime-600"    };
  if (s.includes("urdu") || s.includes("arabic"))
                               return { bg: "from-teal-500 to-emerald-600",  light: "bg-teal-50",    text: "text-teal-700",    iconBg: "bg-teal-600"    };
  // Vibrant index-based fallback — never dull!
  return INDEX_THEMES[idx % INDEX_THEMES.length];
};

// Resolve the actual subject name from any field Firestore might use
const resolveSubject = (en: any): string =>
  en.subject || en.subjectName || en.Subject || en.name || en.title || en.courseName || en.course || "";

// ── Mobile bright-blue palette — all shades of blue, rotated per-card ──
const BLUE_HEROES = [
  "linear-gradient(140deg, #0044EE 0%, #1166FF 48%, #44AAFF 100%)",
  "linear-gradient(140deg, #002DBB 0%, #004FFF 48%, #2277FF 100%)",
  "linear-gradient(140deg, #003399 0%, #0055FF 48%, #3388FF 100%)",
  "linear-gradient(140deg, #0022AA 0%, #0044DD 48%, #2266EE 100%)",
];
const BLUE_AVATARS = [
  { bg: "linear-gradient(140deg,#0044EE,#2277FF)", shadow: "0 3px 12px rgba(0,68,238,0.32)" },
  { bg: "linear-gradient(140deg,#002DBB,#0055FF)", shadow: "0 3px 12px rgba(0,45,187,0.32)" },
  { bg: "linear-gradient(140deg,#003399,#3388FF)", shadow: "0 3px 12px rgba(0,51,153,0.32)" },
  { bg: "linear-gradient(140deg,#0022AA,#2266EE)", shadow: "0 3px 12px rgba(0,34,170,0.32)" },
];

const ClassesPage = () => {
  const { studentData } = useAuth();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [enrollments, setEnrollments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!studentData?.id) return;
    setLoading(true);

    const processEnrollments = async (docs: { id: string; data: () => any }[]) => {
      const raw = docs.map((d) => ({ id: d.id, ...(d.data() as any) }));

      const enriched = await Promise.all(raw.map(async (en: any) => {
        let teacherName = en.teacherName || "Faculty";
        if (en.teacherId) {
          try {
            const snap = await fbGetDoc(fbDoc(db, "teachers", en.teacherId));
            if (snap.exists()) teacherName = snap.data().name;
          } catch { /* keep fallback */ }
        }
        const initials = teacherName.split(" ").map((n: string) => n[0]).join("").toUpperCase().substring(0, 2);
        return { ...en, teacherName, initials };
      }));

      setEnrollments(enriched);
      setLoading(false);
    };

    // Dual-listener helper — matches enrollments by either studentId OR
    // studentEmail so legacy enrollments (where studentId was set to email
    // by older teacher/principal-dashboard code) still appear here.
    const unsub = subscribeEnrollments(studentData, processEnrollments);
    return () => unsub();
  }, [studentData?.id, studentData?.schoolId, studentData?.email]);

  const childFirstName = studentData?.name?.split(" ")[0] || "your child";
  const uniqueTeacherCount = new Set(enrollments.map(e => e.teacherId).filter(Boolean)).size;

  /* ═══════════════════════════════════════════════════════════════
     MOBILE — Bright Blue Apple UI
     ═══════════════════════════════════════════════════════════════ */
  if (isMobile) {
    const B1 = "#0055FF";
    const B2 = "#1166FF";
    const BG = "#EEF4FF";
    const BG2 = "#E0ECFF";
    const T1 = "#001040";
    const T3 = "#5070B0";
    const T4 = "#99AACC";
    const SEP = "rgba(0,85,255,0.07)";
    const SH = "0 0 0 0.5px rgba(0,85,255,0.08), 0 2px 8px rgba(0,85,255,0.10), 0 10px 28px rgba(0,85,255,0.12)";
    const SH_LG = "0 0 0 0.5px rgba(0,85,255,0.10), 0 4px 16px rgba(0,85,255,0.12), 0 18px 44px rgba(0,85,255,0.15)";
    const SH_BTN = "0 6px 22px rgba(0,85,255,0.42), 0 2px 6px rgba(0,85,255,0.24)";

    return (
      <div className="animate-in fade-in duration-500 -mx-3 -mt-3 md:mx-0 md:mt-0"
        style={{ fontFamily: "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif", background: BG, minHeight: "100vh" }}>

        {/* ── Page Head ── */}
        <div className="px-[22px] pt-[18px] pb-0">
          <div className="text-[9px] font-bold uppercase tracking-[0.12em] mb-1" style={{ color: T4 }}>Parent Dashboard</div>
          <h1 className="text-[28px] font-bold leading-[1.12]" style={{ color: T1, letterSpacing: "-0.7px" }}>My Classes</h1>
          <p className="text-[13px] mt-1 font-normal" style={{ color: T3 }}>
            Enrolled subjects &amp; schedules for {childFirstName}
          </p>
        </div>

        {/* ── Top Message CTA ── */}
        <button
          onClick={() => navigate("/teacher-notes")}
          className="w-[calc(100%-40px)] mx-5 mt-[18px] rounded-[20px] px-5 py-[17px] flex items-center justify-between relative overflow-hidden active:scale-[0.97] transition-transform"
          style={{ background: `linear-gradient(135deg, ${B1} 0%, ${B2} 100%)`, boxShadow: SH_BTN }}
        >
          <div className="absolute inset-0 pointer-events-none" style={{ background: "linear-gradient(135deg, rgba(255,255,255,0.16) 0%, transparent 52%)" }} />
          <div className="absolute inset-0 pointer-events-none" style={{
            backgroundImage: "linear-gradient(rgba(255,255,255,0.015) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.015) 1px, transparent 1px)",
            backgroundSize: "24px 24px"
          }} />
          <div className="flex items-center gap-3 relative z-10">
            <div className="w-11 h-11 rounded-[14px] flex items-center justify-center shrink-0"
              style={{ background: "rgba(255,255,255,0.20)", border: "0.5px solid rgba(255,255,255,0.30)" }}>
              <MessageSquare className="w-[22px] h-[22px]" style={{ color: "rgba(255,255,255,0.95)" }} strokeWidth={2.2} />
            </div>
            <div className="text-left">
              <div className="text-[16px] font-bold text-white" style={{ letterSpacing: "-0.2px" }}>Message Teacher</div>
              <div className="text-[11px]" style={{ color: "rgba(255,255,255,0.55)" }}>Send a direct message to faculty</div>
            </div>
          </div>
          <div className="w-9 h-9 rounded-[12px] flex items-center justify-center shrink-0 relative z-10"
            style={{ background: "rgba(255,255,255,0.18)", border: "0.5px solid rgba(255,255,255,0.26)" }}>
            <ChevronRight className="w-[14px] h-[14px]" style={{ color: "rgba(255,255,255,0.90)" }} strokeWidth={2.5} />
          </div>
        </button>

        {/* ── Loading / Empty / Content ── */}
        {loading ? (
          <div className="flex flex-col items-center justify-center py-24 gap-4">
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center" style={{ background: BG2, border: `0.5px solid ${SEP}` }}>
              <Loader2 className="w-7 h-7 animate-spin" style={{ color: B1 }} />
            </div>
            <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: T4 }}>Loading classes…</p>
          </div>
        ) : enrollments.length === 0 ? (
          <div className="mx-5 mt-5 py-16 rounded-[26px] flex flex-col items-center text-center border-2 border-dashed" style={{ borderColor: "rgba(0,85,255,0.22)" }}>
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4" style={{ background: BG2 }}>
              <Target className="w-8 h-8" style={{ color: T4 }} />
            </div>
            <h3 className="text-base font-bold" style={{ color: T3 }}>No Classes Found</h3>
            <p className="text-sm mt-1" style={{ color: T4 }}>No subject enrollments yet.</p>
          </div>
        ) : (
          <>
            {/* ── Per-class cards ── */}
            {enrollments.map((en, idx) => {
              const subject = resolveSubject(en);
              const hero = BLUE_HEROES[idx % BLUE_HEROES.length];
              const avatar = BLUE_AVATARS[idx % BLUE_AVATARS.length];
              const className = en.className || en.classGroup || en.classSection || en.class || en.section || null;
              const schedule = en.schedule || "08:30 – 09:30 AM";
              const year = en.academicYear || "2025 – 26";
              const isClassTeacher = !!en.isClassTeacher || !!en.classTeacher;

              return (
                <div key={en.id} className="mx-5 mt-[14px] rounded-[26px] overflow-hidden bg-white"
                  style={{ boxShadow: SH_LG, border: "0.5px solid rgba(0,85,255,0.10)" }}>

                  {/* Hero */}
                  <div className="relative overflow-hidden px-5 pt-6 pb-[26px]" style={{ background: hero }}>
                    <div className="absolute -top-11 -right-[30px] w-[200px] h-[200px] rounded-full pointer-events-none"
                      style={{ background: "radial-gradient(circle, rgba(255,255,255,0.22) 0%, transparent 65%)" }} />
                    <div className="absolute -bottom-[50px] -left-5 w-[160px] h-[160px] rounded-full pointer-events-none"
                      style={{ background: "radial-gradient(circle, rgba(255,255,255,0.12) 0%, transparent 65%)" }} />

                    {/* Active pill */}
                    <div className="absolute top-4 right-4 z-[2] flex items-center gap-[5px] px-[13px] py-[5px] rounded-full text-[10px] font-bold tracking-[0.06em] text-white"
                      style={{ background: "rgba(255,255,255,0.22)", border: "0.5px solid rgba(255,255,255,0.36)", WebkitBackdropFilter: "blur(8px)", backdropFilter: "blur(8px)" }}>
                      <span className="w-[6px] h-[6px] rounded-full bg-white animate-pulse" style={{ boxShadow: "0 0 0 2.5px rgba(255,255,255,0.28)" }} />
                      Active
                    </div>

                    <div className="w-12 h-12 rounded-[16px] flex items-center justify-center mb-4 relative z-10"
                      style={{ background: "rgba(255,255,255,0.22)", border: "0.5px solid rgba(255,255,255,0.32)", WebkitBackdropFilter: "blur(8px)", backdropFilter: "blur(8px)" }}>
                      <BookOpen className="w-6 h-6 text-white" strokeWidth={2.1} />
                    </div>

                    <div className="text-[9px] font-bold uppercase tracking-[0.12em] mb-[6px] relative z-10" style={{ color: "rgba(255,255,255,0.52)" }}>
                      Subject
                    </div>
                    <h2 className="text-[28px] font-bold text-white mb-[14px] relative z-10 leading-[1.08]" style={{ letterSpacing: "-0.7px" }}>
                      {subject || "Class"}
                    </h2>

                    {/* Class / section tag */}
                    {className ? (
                      <div className="inline-flex items-center gap-[6px] px-[15px] py-[7px] rounded-full relative z-10 text-[12px] font-bold text-white"
                        style={{ background: "rgba(255,255,255,0.20)", border: "0.5px solid rgba(255,255,255,0.32)", WebkitBackdropFilter: "blur(8px)", backdropFilter: "blur(8px)", boxShadow: "0 2px 8px rgba(0,0,0,0.12)" }}>
                        <Layers className="w-3 h-3" style={{ color: "rgba(255,255,255,0.85)" }} strokeWidth={2.2} />
                        {className}
                      </div>
                    ) : (
                      <div className="inline-flex items-center gap-[6px] px-[15px] py-[7px] rounded-full relative z-10 text-[11px] font-medium"
                        style={{ background: "rgba(255,255,255,0.15)", color: "rgba(255,255,255,0.65)" }}>
                        <Layers className="w-3 h-3" style={{ color: "rgba(255,255,255,0.6)" }} />
                        Class not assigned
                      </div>
                    )}
                  </div>

                  {/* Body */}
                  <div className="p-5">
                    {/* Teacher row */}
                    <div className="flex items-center gap-[13px] px-4 py-[14px] rounded-[18px] mb-[14px]"
                      style={{ background: BG, border: "0.5px solid rgba(0,85,255,0.12)" }}>
                      <div className="w-11 h-11 rounded-[14px] flex items-center justify-center text-[15px] font-bold text-white shrink-0"
                        style={{ background: avatar.bg, boxShadow: avatar.shadow }}>
                        {en.initials}
                      </div>
                      <div>
                        <div className="text-[9px] font-bold uppercase tracking-[0.09em] mb-[3px]" style={{ color: T4 }}>
                          {isClassTeacher ? "Class Teacher" : "Subject Teacher"}
                        </div>
                        <div className="text-[15px] font-bold" style={{ color: T1, letterSpacing: "-0.2px" }}>
                          {en.teacherName}
                        </div>
                      </div>
                    </div>

                    {/* Meta grid */}
                    <div className="grid grid-cols-2 gap-[10px] mb-4">
                      <div className="flex items-center gap-[10px] px-[14px] py-[13px] rounded-[16px]"
                        style={{ background: BG, border: "0.5px solid rgba(0,85,255,0.12)" }}>
                        <div className="w-8 h-8 rounded-[10px] flex items-center justify-center shrink-0"
                          style={{ background: "rgba(0,85,255,0.10)", border: "0.5px solid rgba(0,85,255,0.18)" }}>
                          <Clock className="w-[14px] h-[14px]" style={{ color: B1 }} strokeWidth={2.2} />
                        </div>
                        <div className="min-w-0">
                          <div className="text-[9px] font-bold uppercase tracking-[0.08em] mb-[3px]" style={{ color: T4 }}>Schedule</div>
                          <div className="text-[13px] font-bold truncate" style={{ color: T1, letterSpacing: "-0.1px" }}>{schedule}</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-[10px] px-[14px] py-[13px] rounded-[16px]"
                        style={{ background: BG, border: "0.5px solid rgba(0,85,255,0.12)" }}>
                        <div className="w-8 h-8 rounded-[10px] flex items-center justify-center shrink-0"
                          style={{ background: "rgba(0,85,255,0.10)", border: "0.5px solid rgba(0,85,255,0.18)" }}>
                          <School className="w-[14px] h-[14px]" style={{ color: B1 }} strokeWidth={2.2} />
                        </div>
                        <div className="min-w-0">
                          <div className="text-[9px] font-bold uppercase tracking-[0.08em] mb-[3px]" style={{ color: T4 }}>Year</div>
                          <div className="text-[13px] font-bold truncate" style={{ color: T1, letterSpacing: "-0.1px" }}>{year}</div>
                        </div>
                      </div>
                    </div>

                    {/* Message button */}
                    <button
                      onClick={() => navigate("/teacher-notes", { state: { teacherId: en.teacherId } })}
                      className="w-full rounded-[16px] px-[18px] py-[14px] flex items-center justify-between relative overflow-hidden active:scale-[0.97] transition-transform"
                      style={{ background: `linear-gradient(135deg, ${B1}, ${B2})`, boxShadow: "0 4px 18px rgba(0,85,255,0.34), 0 1px 4px rgba(0,85,255,0.20)" }}
                    >
                      <div className="absolute inset-0 pointer-events-none" style={{ background: "linear-gradient(135deg, rgba(255,255,255,0.15) 0%, transparent 52%)" }} />
                      <div className="flex items-center gap-[10px] relative z-10">
                        <MessageSquare className="w-[17px] h-[17px] text-white" strokeWidth={2.2} />
                        <span className="text-[14px] font-bold text-white" style={{ letterSpacing: "-0.1px" }}>Message Teacher</span>
                      </div>
                      <div className="w-[30px] h-[30px] rounded-[10px] flex items-center justify-center relative z-10"
                        style={{ background: "rgba(255,255,255,0.18)", border: "0.5px solid rgba(255,255,255,0.26)" }}>
                        <ChevronRight className="w-[13px] h-[13px]" style={{ color: "rgba(255,255,255,0.85)" }} strokeWidth={2.5} />
                      </div>
                    </button>
                  </div>
                </div>
              );
            })}

            {/* ── Enrollment verified card ── */}
            <div className="mx-5 mt-[14px] rounded-[24px] p-[22px] relative overflow-hidden"
              style={{
                background: "linear-gradient(140deg, #001888 0%, #0033CC 48%, #0055FF 100%)",
                boxShadow: "0 10px 36px rgba(0,51,204,0.38), 0 0 0 0.5px rgba(255,255,255,0.16)",
                border: "0.5px solid rgba(255,255,255,0.16)"
              }}>
              <div className="absolute -top-[42px] -right-[30px] w-[200px] h-[200px] rounded-full pointer-events-none"
                style={{ background: "radial-gradient(circle, rgba(255,255,255,0.16) 0%, transparent 65%)" }} />
              <div className="absolute inset-0 pointer-events-none" style={{
                backgroundImage: "linear-gradient(rgba(255,255,255,0.015) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.015) 1px, transparent 1px)",
                backgroundSize: "24px 24px"
              }} />

              <div className="flex items-center gap-[13px] mb-5 relative z-10">
                <div className="w-12 h-12 rounded-[16px] flex items-center justify-center shrink-0"
                  style={{ background: "rgba(255,255,255,0.18)", border: "0.5px solid rgba(255,255,255,0.28)" }}>
                  <ShieldCheck className="w-6 h-6 text-white" strokeWidth={2.2} />
                </div>
                <div>
                  <div className="text-[9px] font-bold uppercase tracking-[0.12em] mb-1" style={{ color: "rgba(255,255,255,0.45)" }}>Enrollment Verified</div>
                  <div className="text-[17px] font-bold text-white" style={{ letterSpacing: "-0.3px" }}>Academic Registry Active</div>
                </div>
              </div>

              <div className="grid grid-cols-2 rounded-[18px] overflow-hidden relative z-10" style={{ gap: "1px", background: "rgba(255,255,255,0.14)" }}>
                <div className="py-[18px] flex flex-col items-center gap-[5px]" style={{ background: "rgba(255,255,255,0.09)" }}>
                  <div className="text-[34px] font-bold text-white leading-none" style={{ letterSpacing: "-1.5px" }}>{enrollments.length}</div>
                  <div className="text-[9px] font-bold uppercase tracking-[0.10em]" style={{ color: "rgba(255,255,255,0.42)" }}>Subjects</div>
                </div>
                <div className="py-[18px] flex flex-col items-center gap-[5px]" style={{ background: "rgba(255,255,255,0.09)" }}>
                  <div className="text-[34px] font-bold text-white leading-none" style={{ letterSpacing: "-1.5px" }}>{uniqueTeacherCount || enrollments.length}</div>
                  <div className="text-[9px] font-bold uppercase tracking-[0.10em]" style={{ color: "rgba(255,255,255,0.42)" }}>Teachers</div>
                </div>
              </div>
            </div>

            {/* ── All Subjects Section ── */}
            <div className="px-[22px] pt-5 text-[9px] font-bold uppercase tracking-[0.10em] flex items-center gap-2"
              style={{ color: T4 }}>
              <span>All Subjects</span>
              <span className="flex-1 h-px" style={{ background: "rgba(0,85,255,0.14)" }} />
            </div>

            <div className="mx-5 mt-[14px] bg-white rounded-[22px] overflow-hidden"
              style={{ boxShadow: SH, border: "0.5px solid rgba(0,85,255,0.12)" }}>
              <div className="flex items-center justify-between px-[18px] pt-4 pb-3" style={{ borderBottom: `0.5px solid ${SEP}` }}>
                <div className="text-[16px] font-bold" style={{ color: T1, letterSpacing: "-0.3px" }}>Enrolled Subjects</div>
                <div className="px-[11px] py-[4px] rounded-full text-[11px] font-bold"
                  style={{ background: "rgba(0,85,255,0.10)", border: "0.5px solid rgba(0,85,255,0.18)", color: B1 }}>
                  {enrollments.length} Active
                </div>
              </div>
              {enrollments.map((en, idx, arr) => {
                const subject = resolveSubject(en);
                const avatar = BLUE_AVATARS[idx % BLUE_AVATARS.length];
                const schedule = en.schedule || "08:30 – 09:30 AM";
                return (
                  <div key={en.id}
                    className="flex items-center gap-[13px] px-[18px] py-[14px] cursor-pointer active:bg-[#EEF4FF] transition-colors"
                    style={{ borderBottom: idx < arr.length - 1 ? `0.5px solid ${SEP}` : "none" }}
                    onClick={() => navigate("/teacher-notes", { state: { teacherId: en.teacherId } })}>
                    <div className="w-11 h-11 rounded-[14px] flex items-center justify-center shrink-0"
                      style={{ background: avatar.bg, boxShadow: avatar.shadow }}>
                      <BookOpen className="w-5 h-5 text-white" strokeWidth={2.2} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[14px] font-bold truncate" style={{ color: T1, letterSpacing: "-0.2px" }}>{subject || "Class"}</div>
                      <div className="text-[11px] mt-0.5 truncate" style={{ color: T3 }}>{en.teacherName} · {schedule}</div>
                    </div>
                    <div className="px-[11px] py-1 rounded-full text-[10px] font-bold shrink-0"
                      style={{ background: "rgba(0,85,255,0.10)", color: "#0033AA", border: "0.5px solid rgba(0,85,255,0.22)" }}>
                      Active
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        <div className="h-6" />
      </div>
    );
  }

  /* ═══════════════════════════════════════════════════════════════
     DESKTOP — Existing UI (unchanged)
     ═══════════════════════════════════════════════════════════════ */
  return (
    <div className="animate-in fade-in duration-500 pb-28 font-montserrat">

      {/* ── HEADER ── */}
      <div className="mb-8">
        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.25em] mb-1">Parent Dashboard</p>
        <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">My Classes</h1>
        <p className="text-sm text-slate-500 mt-1 font-medium">
          All enrolled subjects for <span className="text-slate-800 font-bold">{studentData?.name}</span>
        </p>
      </div>

      {/* ── CONTENT ── */}
      {loading ? (
        <div className="py-40 flex flex-col items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center">
            <Loader2 className="w-7 h-7 text-slate-400 animate-spin" />
          </div>
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest">Loading classes...</p>
        </div>

      ) : enrollments.length === 0 ? (
        <div className="py-40 text-center border-2 border-dashed border-slate-100 rounded-3xl">
          <div className="w-16 h-16 rounded-2xl bg-slate-50 flex items-center justify-center mx-auto mb-4">
            <Target className="w-8 h-8 text-slate-300" />
          </div>
          <h3 className="text-base font-bold text-slate-400">No Classes Found</h3>
          <p className="text-sm text-slate-300 mt-1">No subject enrollments yet.</p>
        </div>

      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
          {enrollments.map((en, idx) => {
            const subject = resolveSubject(en);
            const theme = subjectTheme(subject, idx);
            const className = en.className || en.classGroup || en.classSection || en.class || en.section || null;

            return (
              <div key={en.id} className="bg-white border border-slate-100 rounded-3xl overflow-hidden shadow-sm hover:shadow-lg transition-all duration-300 group flex flex-col">

                {/* Card Top — Gradient Banner */}
                <div className={`bg-gradient-to-br ${theme.bg} p-5 pb-8 relative overflow-hidden`}>
                  {/* Decorative circle */}
                  <div className="absolute -right-6 -top-6 w-28 h-28 rounded-full bg-white/10" />
                  <div className="absolute -right-2 top-8 w-16 h-16 rounded-full bg-white/10" />

                  {/* Subject icon + initials */}
                  <div className="flex items-start justify-between relative z-10">
                    <div className="w-12 h-12 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center">
                      <BookOpen className="w-6 h-6 text-white" />
                    </div>
                    <div className="flex items-center gap-1.5 bg-white/20 backdrop-blur-sm rounded-full px-3 py-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                      <span className="text-[10px] font-bold text-white uppercase tracking-wider">Active</span>
                    </div>
                  </div>

                  {/* Subject Name */}
                  <div className="mt-4 relative z-10">
                    <h2 className="text-xl font-extrabold text-white tracking-tight leading-tight">{subject || "Class"}</h2>

                    {/* Class Name badge — the key thing user wanted */}
                    {className ? (
                      <div className="mt-2 inline-flex items-center gap-1.5 bg-white/25 backdrop-blur-sm rounded-full px-3 py-1">
                        <Layers className="w-3 h-3 text-white/80" />
                        <span className="text-[11px] font-bold text-white tracking-wide">{className}</span>
                      </div>
                    ) : (
                      <div className="mt-2 inline-flex items-center gap-1.5 bg-white/15 rounded-full px-3 py-1">
                        <Layers className="w-3 h-3 text-white/60" />
                        <span className="text-[11px] font-medium text-white/60 tracking-wide">Class not assigned</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Card Body */}
                <div className="p-5 flex flex-col flex-1 -mt-3 bg-white rounded-t-3xl relative z-10">

                  {/* Teacher */}
                  <div className="flex items-center gap-3 mb-4">
                    <div className={`w-9 h-9 rounded-xl ${theme.iconBg} flex items-center justify-center text-white text-xs font-black flex-shrink-0`}>
                      {en.initials}
                    </div>
                    <div>
                      <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest leading-none mb-0.5">Teacher</p>
                      <p className="text-sm font-bold text-slate-800 leading-tight">{en.teacherName}</p>
                    </div>
                  </div>

                  {/* Details Grid */}
                  <div className="grid grid-cols-2 gap-3 mb-5">
                    <InfoChip icon={Clock} label="Schedule" value={en.schedule || "08:30 – 09:30 AM"} lightBg={theme.light} textColor={theme.text} />
                    <InfoChip icon={School} label="Year" value={en.academicYear || "2025-26"} lightBg={theme.light} textColor={theme.text} />
                  </div>

                  {/* Spacer + CTA */}
                  <div className="mt-auto">
                    <button
                      onClick={() => navigate("/teacher-notes", { state: { teacherId: en.teacherId } })}
                      className={`w-full h-11 rounded-2xl flex items-center justify-center gap-2 text-sm font-bold transition-all active:scale-95 group-hover:gap-3 bg-gradient-to-r ${theme.bg} text-white shadow-sm`}
                    >
                      <MessageSquare className="w-4 h-4" />
                      Message Teacher
                      <ChevronRight className="w-4 h-4 opacity-60 group-hover:opacity-100 transition-all" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── FOOTER STATS ── */}
      {!loading && enrollments.length > 0 && (
        <div className="mt-8 rounded-3xl overflow-hidden">
          <div className="bg-slate-900 p-5 md:p-6 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-2xl bg-white/10 flex items-center justify-center border border-white/10 flex-shrink-0">
                <ShieldCheck className="w-6 h-6 text-emerald-400" />
              </div>
              <div>
                <p className="text-[10px] font-bold text-blue-300 uppercase tracking-widest">Enrollment Verified</p>
                <p className="text-base font-extrabold text-white mt-0.5">Academic Registry Active</p>
              </div>
            </div>
            <div className="flex gap-8 text-right">
              <div>
                <p className="text-3xl font-black text-white leading-none">{enrollments.length}</p>
                <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400 mt-1">Subjects</p>
              </div>
              <div>
                <p className="text-3xl font-black text-white leading-none">
                  {enrollments.filter(e => e.teacherId).length}
                </p>
                <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400 mt-1">Teachers</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const InfoChip = ({ icon: Icon, label, value, lightBg, textColor }: any) => (
  <div className={`${lightBg} rounded-2xl p-3`}>
    <div className="flex items-center gap-1.5 mb-1">
      <Icon className={`w-3 h-3 ${textColor}`} />
      <p className={`text-[9px] font-bold uppercase tracking-widest ${textColor} opacity-80`}>{label}</p>
    </div>
    <p className="text-xs font-bold text-slate-700 leading-tight">{value}</p>
  </div>
);

export default ClassesPage;