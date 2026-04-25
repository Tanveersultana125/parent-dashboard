import { useEffect, useMemo, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Printer, MessageSquare, AlertCircle, Loader2, ChevronLeft, ChevronRight, CheckCircle2, FileText, BookOpen, Calendar, TrendingUp, BarChart3, Activity } from "lucide-react";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, RadarChart, PolarGrid, PolarAngleAxis, Radar } from "recharts";
import { doc, getDoc, collection, query, where, getDocs, onSnapshot, updateDoc } from "firebase/firestore";
import { db } from "../lib/firebase";
import { useAuth } from "../lib/AuthContext";
import { toast } from "sonner";
import { useIsMobile } from "../hooks/use-mobile";

// ── Tokens ───────────────────────────────────────────────────────────────────
const T = {
  bg: "#EEF4FF", white: "#ffffff", ink: "#0f172a", ink2: "#475569", ink3: "#94a3b8",
  bdr: "#e2e8f0", s1: "#f1f5f9", s2: "#e2e8f0",
  blue: "#3B5BDB", blBg: "#EDF2FF", blBdr: "#BAC8FF",
  grn: "#16a34a", glBg: "#f0fdf4", red: "#dc2626", rlBg: "#fef2f2",
  amb: "#d97706", alBg: "#fffbeb", pur: "#7c3aed",
};

const toDate = (v: any): Date | null => { if (!v) return null; if (v?.toDate) return v.toDate(); if (v?.seconds) return new Date(v.seconds * 1000); const d = new Date(v); return isNaN(d.getTime()) ? null : d; };
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const timeAgo = (v: any) => { const d = toDate(v); if (!d) return ""; const s = (Date.now() - d.getTime()) / 1000; if (s < 60) return "just now"; if (s < 3600) return `${Math.floor(s / 60)}m ago`; if (s < 86400) return `${Math.floor(s / 3600)}h ago`; return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }).toUpperCase(); };

// ── 3D Card wrapper with hover tilt ──────────────────────────────────────────
const Card = ({ children, title, action, style }: { children: React.ReactNode; title?: string; action?: React.ReactNode; style?: React.CSSProperties }) => {
  const [tilt, setTilt] = useState({ x: 0, y: 0 });
  const [hovered, setHovered] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const handleMove = (e: React.MouseEvent) => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    setTilt({ x: (y - 0.5) * -8, y: (x - 0.5) * 8 });
  };
  const handleLeave = () => { setTilt({ x: 0, y: 0 }); setHovered(false); };

  return (
    <div
      ref={ref}
      onMouseMove={handleMove}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={handleLeave}
      style={{
        background: T.white,
        border: `1px solid ${hovered ? "rgba(59,91,219,0.25)" : "rgba(59,91,219,0.12)"}`,
        borderRadius: 16,
        overflow: "hidden",
        transform: `perspective(800px) rotateX(${tilt.x}deg) rotateY(${tilt.y}deg) ${hovered ? "translateY(-4px) scale(1.01)" : "translateY(0) scale(1)"}`,
        transition: "transform 0.2s ease, border-color 0.3s ease, box-shadow 0.3s ease",
        boxShadow: "0 20px 40px rgba(59,91,219,0.1), 0 8px 16px rgba(0,0,0,0.06), 0 0 0 1px rgba(59,91,219,0.08)",
        willChange: "transform",
        position: "relative",
        ...style,
      }}
    >
      {hovered && (
        <div style={{
          position: "absolute", inset: 0, pointerEvents: "none", zIndex: 1,
          background: `radial-gradient(circle at ${(tilt.y / 8 + 0.5) * 100}% ${(-tilt.x / 8 + 0.5) * 100}%, rgba(59,91,219,0.06) 0%, transparent 60%)`,
          borderRadius: 16,
        }} />
      )}
      {title && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 20px", borderBottom: `1px solid ${T.s2}`, position: "relative", zIndex: 2 }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: T.ink }}>{title}</span>
          {action || null}
        </div>
      )}
      <div style={{ padding: "16px 20px", position: "relative", zIndex: 2 }}>{children}</div>
    </div>
  );
};

const DetailLink = () => <span style={{ fontSize: 11, color: T.blue, fontWeight: 500, cursor: "pointer" }}>Details →</span>;

// ═══════════════════════════════════════════════════════════════════════════════
// PARENT MY CHILD — canonical design (matches owner/principal/teacher)
// ═══════════════════════════════════════════════════════════════════════════════
const MyChildPage = () => {
  const { studentData } = useAuth();
  const navigate = useNavigate();
  const isMobile = useIsMobile();

  const [loading, setLoading] = useState(true);
  const [masterProfile, setMasterProfile] = useState<any>(null);
  const [attendance, setAttendance] = useState<any[]>([]);
  const [testScores, setTestScores] = useState<any[]>([]);
  const [assignments, setAssignments] = useState<any[]>([]);
  const [submissions, setSubmissions] = useState<any[]>([]);
  const [incidents, setIncidents] = useState<any[]>([]);
  const [parentNotes, setParentNotes] = useState<any[]>([]);
  const [interventions, setInterventions] = useState<any[]>([]);
  const [calMonth, setCalMonth] = useState(new Date());

  const sid = studentData?.id || studentData?.studentId || "";
  const email = (studentData?.email || "").toLowerCase();

  // ── Fetch ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!sid || !studentData?.schoolId) { setLoading(false); return; }
    const schoolId = studentData.schoolId;

    // Live-subscribe to the student's master record
    const unsubStudent = onSnapshot(doc(db, "students", sid), (d) => {
      if (d.exists()) setMasterProfile(d.data());
    }, (err) => {
      // Permission-denied or network failure — don't leave masterProfile stale
      // forever; fall back to the cached studentData from AuthContext.
      console.error("[MyChild] student doc listener error:", err);
    });

    const run = async () => {
      setLoading(true);
      try {
        const byId = (col: string) => getDocs(query(
          collection(db, col),
          where("schoolId", "==", schoolId),
          where("studentId", "==", sid),
        ));
        const byEmail = (col: string) => email ? getDocs(query(
          collection(db, col),
          where("schoolId", "==", schoolId),
          where("studentEmail", "==", email),
        )) : Promise.resolve(null as any);
        const merge = (a: any, b: any) => { const l: any[] = []; if (a) a.docs.forEach((d: any) => l.push({ id: d.id, ...d.data() })); if (b) b.docs.forEach((d: any) => { if (!l.find(x => x.id === d.id)) l.push({ id: d.id, ...d.data() }); }); return l; };

        const [aI, aE, sI, sE, rI, rE, subI, subE, inc, pn, iv] = await Promise.all([
          byId("attendance"), byEmail("attendance"),
          byId("test_scores"), byEmail("test_scores"),
          byId("results"), byEmail("results"),
          byId("submissions"), byEmail("submissions"),
          byId("incidents"), byId("parent_notes"), byId("interventions"),
        ]);
        setAttendance(merge(aI, aE));
        setTestScores([...merge(sI, sE), ...merge(rI, rE)]);
        setSubmissions(merge(subI, subE));
        setIncidents(inc.docs.map((d: any) => ({ id: d.id, ...d.data() })));
        setParentNotes(pn.docs.map((d: any) => ({ id: d.id, ...d.data() })));
        setInterventions(iv.docs.map((d: any) => ({ id: d.id, ...d.data() })));

        const classId = studentData.classId || merge(await byId("enrollments"), await byEmail("enrollments"))[0]?.classId;
        if (classId) {
          const asSnap = await getDocs(query(
            collection(db, "assignments"),
            where("schoolId", "==", schoolId),
            where("classId", "==", classId),
          ));
          setAssignments(asSnap.docs.map((d: any) => ({ id: d.id, ...d.data() })));
        }
      } catch (e) { console.error("MyChild fetch error:", e); }
      finally { setLoading(false); }
    };
    run();
    return () => unsubStudent();
  }, [sid, email, studentData?.schoolId, studentData?.classId]);

  // Merged student (live master overrides cached studentData)
  const student = useMemo(() => ({ ...studentData, ...(masterProfile || {}) }), [studentData, masterProfile]);

  // ── Metrics ────────────────────────────────────────────────────────────────
  const m = useMemo(() => {
    const tot = attendance.length;
    const pres = attendance.filter(r => r.status === "present").length;
    const late = attendance.filter(r => r.status === "late").length;
    const abs = tot - pres - late;
    const attRate = tot > 0 ? ((pres + late) / tot) * 100 : 0;

    const vals = testScores.map(t => Number(t.percentage ?? t.score ?? 0)).filter(n => !isNaN(n) && n > 0);
    const avg = vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;

    const subScores: Record<string, number> = {};
    const subCounts: Record<string, number> = {};
    testScores.forEach(t => {
      const sub = (t.subject || t.subjectName || "General").toUpperCase();
      const p = Number(t.percentage ?? t.score ?? 0);
      if (isNaN(p) || p <= 0) return;
      subScores[sub] = (subScores[sub] || 0) + p;
      subCounts[sub] = (subCounts[sub] || 0) + 1;
    });
    Object.keys(subScores).forEach(k => { subScores[k] = Math.round(subScores[k] / subCounts[k]); });

    const sorted = [...testScores].sort((a, b) => (toDate(b.timestamp || b.createdAt)?.getTime() || 0) - (toDate(a.timestamp || a.createdAt)?.getTime() || 0));
    const r3 = sorted.slice(0, 3).map(t => Number(t.percentage ?? t.score ?? 0)).filter(n => !isNaN(n));
    const p3 = sorted.slice(3, 6).map(t => Number(t.percentage ?? t.score ?? 0)).filter(n => !isNaN(n));
    const rAvg = r3.length ? r3.reduce((a, b) => a + b, 0) / r3.length : 0;
    const pAvg = p3.length ? p3.reduce((a, b) => a + b, 0) / p3.length : 0;
    const trend: "up" | "down" | "flat" = rAvg - pAvg >= 5 ? "up" : pAvg - rAvg >= 5 ? "down" : "flat";

    const now = new Date();
    const monthly = Array.from({ length: 6 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
      const mAtt = attendance.filter(r => { const dt = toDate(r.date); return dt && dt.getMonth() === d.getMonth() && dt.getFullYear() === d.getFullYear(); });
      const mSc = testScores.filter(t => { const dt = toDate(t.timestamp || t.createdAt); return dt && dt.getMonth() === d.getMonth() && dt.getFullYear() === d.getFullYear(); });
      const mP = mAtt.filter(r => r.status === "present" || r.status === "late").length;
      const attP = mAtt.length > 0 ? (mP / mAtt.length) * 100 : 0;
      const sV = mSc.map(t => Number(t.percentage ?? t.score ?? 0)).filter(n => !isNaN(n) && n > 0);
      const scP = sV.length > 0 ? sV.reduce((a, b) => a + b, 0) / sV.length : 0;
      return { month: MONTHS[d.getMonth()], score: Math.round(scP), attendance: Math.round(attP) };
    });

    const subCount = submissions.length;
    const asgCount = assignments.length;
    const completion = asgCount > 0 ? (subCount / asgCount) * 100 : 0;
    const days = new Set(attendance.map(a => toDate(a.date)?.toDateString())).size;

    return { tot, pres, late, abs, attRate, avg, subScores, trend, monthly, subCount, asgCount, completion, days };
  }, [attendance, testScores, submissions, assignments]);

  const overallRisk = Math.round((Math.max(0, 100 - m.attRate) + Math.max(0, 100 - m.avg) + Math.max(0, 100 - m.completion) + Math.min(100, incidents.length * 25)) / 4);
  const riskLevel = overallRisk < 20 ? "STABLE" : overallRisk < 45 ? "MONITOR" : overallRisk < 70 ? "ELEVATED" : "CRITICAL";
  const riskColor = overallRisk < 20 ? T.grn : overallRisk < 45 ? T.amb : T.red;

  const subEntries = Object.entries(m.subScores);
  const radarData = subEntries.map(([sub, sc]) => ({ subject: sub.slice(0, 10), score: sc, fullMark: 100 }));

  const calYear = calMonth.getFullYear();
  const calMon = calMonth.getMonth();
  const firstDay = new Date(calYear, calMon, 1).getDay();
  const daysInMonth = new Date(calYear, calMon + 1, 0).getDate();
  const calDays = Array.from({ length: 42 }, (_, i) => {
    const dayNum = i - firstDay + 1;
    if (dayNum < 1 || dayNum > daysInMonth) return null;
    const d = new Date(calYear, calMon, dayNum);
    const dateStr = d.toISOString().split("T")[0];
    const rec = attendance.find(a => { const ad = toDate(a.date); return ad && ad.toISOString().split("T")[0] === dateStr; });
    return { dayNum, date: d, status: rec?.status || null };
  });
  const calPresent = attendance.filter(a => { const d = toDate(a.date); return d && d.getMonth() === calMon && d.getFullYear() === calYear && a.status === "present"; }).length;
  const calLate = attendance.filter(a => { const d = toDate(a.date); return d && d.getMonth() === calMon && d.getFullYear() === calYear && a.status === "late"; }).length;
  const calAbsent = attendance.filter(a => { const d = toDate(a.date); return d && d.getMonth() === calMon && d.getFullYear() === calYear && a.status === "absent"; }).length;

  // ── Quick profile edit (parent can update basic fields) ─────────────────────
  const [editOpen, setEditOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ dob: "", bloodGroup: "", parentPhone: "", emergencyContact: "" });
  useEffect(() => {
    if (student) setForm({
      dob: student.dob || "",
      bloodGroup: student.bloodGroup || "",
      parentPhone: student.parentPhone || "",
      emergencyContact: student.emergencyContact || "",
    });
  }, [student?.id]);

  const handleSave = async () => {
    if (!sid) return;
    setSaving(true);
    try {
      await updateDoc(doc(db, "students", sid), form);
      toast.success("Profile updated!");
      setEditOpen(false);
    } catch { toast.error("Failed to update."); }
    finally { setSaving(false); }
  };

  if (loading) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "60vh", gap: 10 }}>
      <Loader2 className="animate-spin" size={20} color={T.blue} /><span style={{ fontSize: 13, color: T.ink3 }}>Loading your child's profile...</span>
    </div>
  );
  if (!student || !sid) return (
    <div style={{ textAlign: "center", padding: 64 }}>
      <AlertCircle size={40} color={T.red} style={{ margin: "0 auto 12px" }} />
      <p style={{ fontSize: 16, fontWeight: 600, color: T.ink }}>No child profile linked to this account.</p>
    </div>
  );

  const sName = student.name || student.studentName || "My Child";
  const initials = sName.split(" ").map((n: string) => n[0]).join("").toUpperCase().slice(0, 2);
  const today = new Date();

  const scoreHistory = [...testScores]
    .sort((a, b) => (toDate(b.timestamp || b.createdAt)?.getTime() || 0) - (toDate(a.timestamp || a.createdAt)?.getTime() || 0))
    .slice(0, 6);
  const barChartData = [...scoreHistory].reverse().map(t => ({
    name: (t.subject || t.subjectName || "TEST").slice(0, 8),
    score: Number(t.percentage ?? t.score ?? 0),
  }));

  return (
    <div style={{ minHeight: "100vh", background: T.bg, padding: isMobile ? "12px 12px 60px" : "20px 24px 60px", fontFamily: "'Inter','Plus Jakarta Sans',-apple-system,sans-serif" }}>

      {/* ═══ TOP BAR ══════════════════════════════════════════════════════════ */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: isMobile ? 14 : 24, gap: 8, flexWrap: "wrap" }}>
        <button onClick={() => navigate("/")} style={{ display: "flex", alignItems: "center", gap: 6, padding: isMobile ? "7px 12px" : "8px 16px", borderRadius: 10, border: `1px solid ${T.bdr}`, background: T.white, color: T.ink2, fontSize: isMobile ? 12 : 13, fontWeight: 500, cursor: "pointer", flexShrink: 0 }}>
          <ArrowLeft size={14} /> {isMobile ? "BACK" : "RETURN"}
        </button>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => window.print()} style={{ display: "flex", alignItems: "center", gap: 6, padding: isMobile ? "7px 12px" : "8px 16px", borderRadius: 10, border: `1px solid ${T.bdr}`, background: T.white, color: T.ink2, fontSize: 12, fontWeight: 500, cursor: "pointer" }}>
            <Printer size={13} /> {isMobile ? "PDF" : "EXPORT"}
          </button>
          <button onClick={() => navigate("/teacher-notes")} style={{ display: "flex", alignItems: "center", gap: 6, padding: isMobile ? "7px 12px" : "8px 16px", borderRadius: 10, border: "none", background: T.blue, color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
            <MessageSquare size={13} /> {isMobile ? "MSG" : "CONTACT"}
          </button>
        </div>
      </div>

      {/* ═══ HERO: 3-COLUMN (mobile: stacked, profile first) ═══ */}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 280px 1fr", gap: isMobile ? 14 : 20, marginBottom: isMobile ? 14 : 20 }}>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Card title="Academic Performance">
            <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 16 }}>
              <div style={{ position: "relative", width: 64, height: 64 }}>
                <svg width="64" height="64" viewBox="0 0 64 64">
                  <circle cx="32" cy="32" r="26" fill="none" stroke={T.s2} strokeWidth="6" />
                  <circle cx="32" cy="32" r="26" fill="none" stroke={T.blue} strokeWidth="6" strokeLinecap="round"
                    strokeDasharray={2 * Math.PI * 26} strokeDashoffset={2 * Math.PI * 26 * (1 - m.avg / 100)} transform="rotate(-90 32 32)"
                    style={{ transition: "stroke-dashoffset 1s ease" }} />
                </svg>
                <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 700, color: T.blue }}>{(m.avg / 25).toFixed(1)}</div>
              </div>
              <div>
                <div style={{ fontSize: 28, fontWeight: 800, color: T.ink }}>{Math.round(m.avg)}%</div>
                <div style={{ fontSize: 11, color: T.ink3, display: "flex", alignItems: "center", gap: 4 }}>
                  Avg Score · {testScores.length} tests
                  {m.trend === "up" && <TrendingUp size={12} color={T.grn} />}
                  {m.trend === "down" && <TrendingUp size={12} color={T.red} style={{ transform: "scaleY(-1)" }} />}
                </div>
              </div>
            </div>
            {subEntries.slice(0, 5).map(([sub, sc]) => (
              <div key={sub} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 11, color: T.ink3, width: 100, flexShrink: 0 }}>{sub}</span>
                <div style={{ flex: 1, height: 6, background: T.s1, borderRadius: 3, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${sc}%`, background: sc >= 75 ? T.blue : sc >= 50 ? T.amb : T.red, borderRadius: 3, transition: "width 1s ease" }} />
                </div>
                <span style={{ fontSize: 12, fontWeight: 600, color: sc >= 75 ? T.blue : sc >= 50 ? T.amb : T.red, width: 30, textAlign: "right" }}>{sc}</span>
              </div>
            ))}
          </Card>

          <Card title="Attendance">
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              <div style={{ position: "relative", width: 72, height: 72 }}>
                <svg width="72" height="72" viewBox="0 0 72 72">
                  <circle cx="36" cy="36" r="28" fill="none" stroke={T.s2} strokeWidth="7" />
                  <circle cx="36" cy="36" r="28" fill="none"
                    stroke={m.attRate >= 85 ? T.grn : m.attRate >= 70 ? T.amb : T.red}
                    strokeWidth="7" strokeLinecap="round"
                    strokeDasharray={2 * Math.PI * 28} strokeDashoffset={2 * Math.PI * 28 * (1 - m.attRate / 100)}
                    transform="rotate(-90 36 36)" style={{ transition: "stroke-dashoffset 1s ease" }} />
                </svg>
                <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, fontWeight: 700, color: m.attRate >= 85 ? T.grn : T.amb }}>{Math.round(m.attRate)}%</div>
              </div>
              <div>
                <div style={{ fontSize: 15, fontWeight: 600, color: T.ink }}>Present</div>
                <div style={{ fontSize: 12, color: T.ink3, marginTop: 2 }}>Late: {m.late} · Abs: {m.abs}</div>
                <div style={{ fontSize: 11, color: T.ink3, marginTop: 2 }}>{m.pres + m.late} / {m.tot} days</div>
              </div>
            </div>
          </Card>

          <Card title="Subject Mastery" action={<DetailLink />}>
            {radarData.length >= 3 && (
              <div style={{ height: 180, marginBottom: 12 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <RadarChart cx="50%" cy="50%" outerRadius="70%" data={radarData}>
                    <PolarGrid stroke={T.s2} />
                    <PolarAngleAxis dataKey="subject" tick={{ fill: T.ink3, fontSize: 10 }} />
                    <Radar dataKey="score" stroke={T.blue} fill={T.blue} fillOpacity={0.15} strokeWidth={2} />
                  </RadarChart>
                </ResponsiveContainer>
              </div>
            )}
            {subEntries.map(([sub, sc]) => (
              <div key={sub} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <span style={{ fontSize: 11, color: T.ink3, width: 90, flexShrink: 0 }}>{sub}</span>
                <div style={{ flex: 1, height: 6, background: T.s1, borderRadius: 3, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${sc}%`, background: sc >= 75 ? T.blue : sc >= 50 ? T.grn : T.red, borderRadius: 3 }} />
                </div>
                <span style={{ fontSize: 12, fontWeight: 600, color: T.ink, width: 28, textAlign: "right" }}>{sc}</span>
              </div>
            ))}
          </Card>
        </div>

        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", paddingTop: isMobile ? 16 : 20, order: isMobile ? -1 : 0, padding: isMobile ? "20px 16px 18px" : undefined, background: isMobile ? T.white : "transparent", borderRadius: isMobile ? 16 : 0, border: isMobile ? `1px solid ${T.bdr}` : "none" }}>
          <div style={{ width: isMobile ? 110 : 140, height: isMobile ? 110 : 140, borderRadius: "50%", border: `4px solid ${T.blue}`, background: T.blBg, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: isMobile ? 12 : 16, boxShadow: "0 8px 30px rgba(59,91,219,0.15)" }}>
            <span style={{ fontSize: 42, fontWeight: 800, color: T.blue }}>{initials}</span>
          </div>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: T.ink, textAlign: "center", marginBottom: 4 }}>{sName}</h2>
          <p style={{ fontSize: 12, color: T.ink3, textAlign: "center", marginBottom: 4 }}>{student.className || student.class || "—"}</p>
          <p style={{ fontSize: 11, color: T.ink3, textAlign: "center", marginBottom: 12 }}>Roll: {student.rollNo || student.roll || "—"} · ID: {sid.slice(0, 6).toUpperCase()}</p>
          <div style={{ display: "flex", gap: 6 }}>
            <span style={{ padding: "4px 12px", borderRadius: 20, background: T.glBg, color: T.grn, fontSize: 10, fontWeight: 600 }}>ACTIVE</span>
            <span style={{ padding: "4px 12px", borderRadius: 20, background: riskColor === T.grn ? T.glBg : riskColor === T.amb ? T.alBg : T.rlBg, color: riskColor, fontSize: 10, fontWeight: 600 }}>{riskLevel}</span>
          </div>
          <button onClick={() => setEditOpen(true)} style={{ marginTop: 14, padding: "6px 14px", borderRadius: 20, border: `1px solid ${T.bdr}`, background: T.white, color: T.ink2, fontSize: 11, fontWeight: 500, cursor: "pointer" }}>
            Edit Profile
          </button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Card title="Behaviour Record" action={<DetailLink />}>
            {incidents.length === 0 ? (
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", background: T.glBg, borderRadius: 10 }}>
                <CheckCircle2 size={14} color={T.grn} /><span style={{ fontSize: 12, color: T.grn, fontWeight: 500 }}>No incidents recorded</span>
              </div>
            ) : incidents.slice(0, 3).map(inc => (
              <div key={inc.id} style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "8px 0", borderBottom: `1px solid ${T.s2}` }}>
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: T.red, marginTop: 5, flexShrink: 0 }} />
                <div>
                  <span style={{ fontSize: 12, fontWeight: 600, color: T.red }}>{(inc.type || "INCIDENT").toUpperCase()}</span>
                  <p style={{ fontSize: 11, color: T.ink3, marginTop: 2 }}>{(inc.description || inc.content || "").slice(0, 80)}</p>
                </div>
              </div>
            ))}
          </Card>

          <Card title="AI Intelligence" action={<DetailLink />}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 11, color: T.ink3 }}>Predicted next score:</span>
              <span style={{ fontSize: 20, fontWeight: 700, color: T.blue }}>{Math.min(100, Math.round(m.avg + Math.max(0, (100 - m.avg) * 0.05)))}%</span>
            </div>
            <div style={{ fontSize: 11, color: T.ink3, lineHeight: 1.6 }}>
              {m.trend === "up" ? "Performance is improving. Your child is on a positive trajectory." :
               m.trend === "down" ? "Performance has dipped recently. Consider checking in with teachers." :
               "Performance is stable. Keep up consistent study habits."}
            </div>
          </Card>

          <Card title="Teacher Messages" action={<DetailLink />}>
            {parentNotes.length === 0 ? (
              <p style={{ fontSize: 12, color: T.ink3, textAlign: "center", padding: "8px 0" }}>No messages yet</p>
            ) : parentNotes.slice(0, 2).map(n => (
              <div key={n.id} style={{ padding: "8px 0", borderBottom: `1px solid ${T.s2}` }}>
                <div style={{ fontSize: 10, color: n.from === "teacher" ? T.blue : T.grn, fontWeight: 600, marginBottom: 2 }}>
                  {n.from === "teacher" ? (n.teacherName || "TEACHER") : "YOU"} · {timeAgo(n.createdAt)}
                </div>
                <p style={{ fontSize: 12, color: T.ink2, lineHeight: 1.5, margin: 0 }}>{(n.content || n.message || "").slice(0, 100)}</p>
              </div>
            ))}
          </Card>

          <Card title="Teacher Observations">
            {parentNotes.filter(n => n.from === "teacher").length === 0 ? (
              <p style={{ fontSize: 12, color: T.ink3, textAlign: "center" }}>No observations yet</p>
            ) : (
              <div style={{ padding: "10px 14px", background: T.blBg, borderLeft: `3px solid ${T.blue}`, borderRadius: 8 }}>
                <p style={{ fontSize: 12, color: T.ink2, lineHeight: 1.6, margin: 0, fontStyle: "italic" }}>
                  "{(parentNotes.find(n => n.from === "teacher")?.content || parentNotes.find(n => n.from === "teacher")?.message || "").slice(0, 150)}"
                </p>
              </div>
            )}
          </Card>
        </div>
      </div>

      {/* ═══ PERFORMANCE TIMELINE ═══ */}
      <Card title="Performance Timeline" action={<DetailLink />} style={{ marginBottom: isMobile ? 14 : 20 }}>
        <div style={{ height: isMobile ? 160 : 200 }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={m.monthly}>
              <defs>
                <linearGradient id="pBlGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={T.blue} stopOpacity={0.15} /><stop offset="95%" stopColor={T.blue} stopOpacity={0} /></linearGradient>
                <linearGradient id="pGnGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={T.grn} stopOpacity={0.15} /><stop offset="95%" stopColor={T.grn} stopOpacity={0} /></linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={T.s2} />
              <XAxis dataKey="month" tick={{ fill: T.ink3, fontSize: 11 }} axisLine={{ stroke: T.s2 }} />
              <YAxis tick={{ fill: T.ink3, fontSize: 11 }} axisLine={{ stroke: T.s2 }} domain={[0, 100]} />
              <Tooltip contentStyle={{ background: T.white, border: `1px solid ${T.bdr}`, borderRadius: 8, fontSize: 12 }} />
              <Area type="monotone" dataKey="score" stroke={T.blue} fill="url(#pBlGrad)" strokeWidth={2.5} />
              <Area type="monotone" dataKey="attendance" stroke={T.grn} fill="url(#pGnGrad)" strokeWidth={2} strokeDasharray="5 3" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {/* ═══ ASSIGNMENTS + RISK ═══ */}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: isMobile ? 14 : 20, marginBottom: isMobile ? 14 : 20 }}>
        <Card title={`Assignments · ${m.subCount}/${m.asgCount}`} action={<span style={{ fontSize: 11, color: T.blue, fontWeight: 500, cursor: "pointer" }}>View All →</span>}>
          {[...assignments].sort((a, b) => (toDate(b.dueDate)?.getTime() || 0) - (toDate(a.dueDate)?.getTime() || 0)).slice(0, 5).map(a => {
            const sub = submissions.find((s: any) => s.assignmentId === a.id);
            return (
              <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 0", borderBottom: `1px solid ${T.s2}` }}>
                <CheckCircle2 size={14} color={sub ? T.grn : T.ink3} />
                <span style={{ fontSize: 13, color: T.ink, flex: 1 }}>{(a.title || "Assignment").slice(0, 35)}</span>
              </div>
            );
          })}
          {assignments.length === 0 && <p style={{ fontSize: 12, color: T.ink3, textAlign: "center" }}>No assignments</p>}
        </Card>

        <Card title="Risk Assessment" action={<DetailLink />}>
          <div style={{ fontSize: 22, fontWeight: 800, color: riskColor, marginBottom: 14 }}>{riskLevel}</div>
          {[
            { label: "ATTENDANCE", val: m.attRate, color: m.attRate >= 85 ? T.blue : T.amb, extra: undefined as string | undefined },
            { label: "ACADEMIC", val: m.avg, color: m.avg >= 75 ? T.blue : m.avg >= 50 ? T.amb : T.red, extra: undefined },
            { label: "SUBMISSION", val: m.completion, color: m.completion >= 80 ? T.blue : T.amb, extra: undefined },
            { label: "BEHAVIOURAL", val: incidents.length > 0 ? -1 : 100, color: incidents.length === 0 ? T.blue : T.red, extra: incidents.length > 0 ? `${incidents.length} Events` : undefined },
          ].map(r => (
            <div key={r.label} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <span style={{ fontSize: 11, color: T.ink3, width: 100, flexShrink: 0 }}>{r.label}</span>
              <div style={{ flex: 1, height: 6, background: T.s1, borderRadius: 3, overflow: "hidden" }}>
                {r.val >= 0 && <div style={{ height: "100%", width: `${r.val}%`, background: r.color, borderRadius: 3, transition: "width 1s" }} />}
              </div>
              <span style={{ fontSize: 12, fontWeight: 600, color: r.color, width: 60, textAlign: "right" }}>{r.extra || `${Math.round(r.val >= 0 ? r.val : 0)}%`}</span>
            </div>
          ))}
        </Card>
      </div>

      {/* ═══ CALENDAR + SUPPORT ═══ */}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: isMobile ? 14 : 20, marginBottom: isMobile ? 14 : 20 }}>
        <Card title="Attendance Calendar" action={<span style={{ fontSize: 11, color: T.ink3 }}>Daily attendance record</span>}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 16, marginBottom: 14 }}>
            <button onClick={() => setCalMonth(new Date(calYear, calMon - 1))} style={{ background: "none", border: "none", cursor: "pointer", color: T.ink3 }}><ChevronLeft size={16} /></button>
            <span style={{ fontSize: 13, fontWeight: 600, color: T.ink }}>{MONTHS[calMon]} {calYear}</span>
            <button onClick={() => setCalMonth(new Date(calYear, calMon + 1))} style={{ background: "none", border: "none", cursor: "pointer", color: T.ink3 }}><ChevronRight size={16} /></button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 14 }}>
            <div style={{ textAlign: "center", padding: "10px 0", background: T.glBg, borderRadius: 10 }}>
              <div style={{ fontSize: 20, fontWeight: 700, color: T.grn }}>{calPresent}</div><div style={{ fontSize: 10, color: T.grn }}>PRESENT</div>
            </div>
            <div style={{ textAlign: "center", padding: "10px 0", background: T.alBg, borderRadius: 10 }}>
              <div style={{ fontSize: 20, fontWeight: 700, color: T.amb }}>{calLate}</div><div style={{ fontSize: 10, color: T.amb }}>LATE</div>
            </div>
            <div style={{ textAlign: "center", padding: "10px 0", background: T.rlBg, borderRadius: 10 }}>
              <div style={{ fontSize: 20, fontWeight: 700, color: T.red }}>{calAbsent}</div><div style={{ fontSize: 10, color: T.red }}>ABSENT</div>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4, textAlign: "center" }}>
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(d => (
              <div key={d} style={{ fontSize: 10, fontWeight: 600, color: T.ink3, padding: "4px 0" }}>{d}</div>
            ))}
            {calDays.map((d, i) => {
              if (!d) return <div key={i} />;
              const isToday = d.date.toDateString() === today.toDateString();
              const bg = d.status === "present" ? T.grn : d.status === "late" ? T.amb : d.status === "absent" ? T.red : "transparent";
              const isWknd = d.date.getDay() === 0 || d.date.getDay() === 6;
              return (
                <div key={i} style={{
                  width: 32, height: 32, borderRadius: isToday ? "50%" : 8, margin: "0 auto",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 12, fontWeight: isToday ? 700 : 400,
                  color: d.status ? "#fff" : isWknd ? T.ink3 : T.ink,
                  background: isToday && !d.status ? T.blue : bg,
                }}>
                  {d.dayNum}
                </div>
              );
            })}
          </div>
          <div style={{ display: "flex", gap: isMobile ? 10 : 14, marginTop: 12, justifyContent: "center", flexWrap: "wrap", rowGap: 8 }}>
            {[{ c: T.grn, l: "Present" }, { c: T.amb, l: "Late" }, { c: T.red, l: "Absent" }, { c: T.s2, l: "Weekend" }, { c: "transparent", l: "No Data" }].map(x => (
              <div key={x.l} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <div style={{ width: 8, height: 8, borderRadius: 2, background: x.c, border: x.c === "transparent" ? `1px solid ${T.s2}` : "none" }} />
                <span style={{ fontSize: 10, color: T.ink3 }}>{x.l}</span>
              </div>
            ))}
          </div>
        </Card>

        <Card title="Support Actions" action={<DetailLink />}>
          {interventions.length === 0 ? (
            <p style={{ fontSize: 12, color: T.ink3, textAlign: "center", padding: "20px 0" }}>No active interventions</p>
          ) : interventions.map(iv => (
            <div key={iv.id} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "12px 0", borderBottom: `1px solid ${T.s2}` }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: iv.status === "completed" ? T.grn : T.amb, marginTop: 5, flexShrink: 0 }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11, color: T.ink3, marginBottom: 2 }}>{timeAgo(iv.createdAt)}</div>
                <div style={{ fontSize: 13, fontWeight: 600, color: T.ink }}>{iv.actionTitle || iv.title || "Intervention"}</div>
                <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                  <span style={{ padding: "2px 8px", borderRadius: 4, background: T.blBg, color: T.blue, fontSize: 10, fontWeight: 600 }}>{(iv.actionType || iv.type || "GENERAL").toUpperCase()}</span>
                  <span style={{ padding: "2px 8px", borderRadius: 4, background: iv.status === "completed" ? T.glBg : T.alBg, color: iv.status === "completed" ? T.grn : T.amb, fontSize: 10, fontWeight: 600 }}>{iv.status === "completed" ? "Complete" : "Active"}</span>
                </div>
              </div>
              <span style={{ fontSize: 10, color: T.ink3, flexShrink: 0 }}>{iv.assignedTo || ""}</span>
            </div>
          ))}
        </Card>
      </div>

      {/* ═══ INCIDENTS + OVERVIEW ═══ */}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: isMobile ? 14 : 20, marginBottom: isMobile ? 14 : 20 }}>
        <Card title="Incidents" action={<DetailLink />}>
          {incidents.length === 0 ? (
            <div style={{ textAlign: "center", padding: "20px 0" }}>
              <CheckCircle2 size={24} color={T.grn} style={{ margin: "0 auto 8px" }} />
              <p style={{ fontSize: 12, color: T.grn, fontWeight: 500 }}>No incidents on record</p>
            </div>
          ) : incidents.map(inc => (
            <div key={inc.id} style={{ padding: "10px 0", borderBottom: `1px solid ${T.s2}` }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: T.red }}>• {(inc.type || "INCIDENT").toUpperCase()}</span>
                <span style={{ fontSize: 10, color: T.ink3 }}>{timeAgo(inc.createdAt || inc.date)}</span>
              </div>
              <p style={{ fontSize: 11, color: T.ink2, marginTop: 4, lineHeight: 1.5 }}>{(inc.description || inc.content || "").slice(0, 120)}</p>
            </div>
          ))}
          {incidents.length > 0 && (
            <div style={{ textAlign: "center", padding: "10px 0", marginTop: 8, background: T.rlBg, borderRadius: 8 }}>
              <span style={{ fontSize: 11, color: T.red, fontWeight: 500 }}>Total: {incidents.length} incident{incidents.length > 1 ? "s" : ""} recorded</span>
            </div>
          )}
        </Card>

        <Card title="Overview" action={<span style={{ fontSize: 11, color: T.blue, cursor: "pointer" }}>Dashboard →</span>}>
          {[
            { icon: FileText, label: "TOTAL TESTS", val: testScores.length },
            { icon: BookOpen, label: "SUBJECTS TRACKED", val: subEntries.length },
            { icon: Calendar, label: "DAYS ON RECORD", val: m.days },
            { icon: Activity, label: "AVG ATTENDANCE", val: `${Math.round(m.attRate)}%` },
            { icon: BarChart3, label: "ASSIGNMENT RATE", val: `${Math.round(m.completion)}%` },
            { icon: MessageSquare, label: "TEACHER MESSAGES", val: parentNotes.length },
          ].map(item => (
            <div key={item.label} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 0", borderBottom: `1px solid ${T.s2}` }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <item.icon size={14} color={T.ink3} />
                <span style={{ fontSize: 12, color: T.ink3 }}>{item.label}</span>
              </div>
              <span style={{ fontSize: 13, fontWeight: 600, color: T.ink }}>{item.val}</span>
            </div>
          ))}
        </Card>
      </div>

      {/* ═══ COMMS + SCORE HISTORY ═══ */}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: isMobile ? 14 : 20, marginBottom: isMobile ? 14 : 20 }}>
        <Card title={`Communications · ${parentNotes.length} entries`} action={<span style={{ fontSize: 11, color: T.blue, cursor: "pointer" }}>View All →</span>}>
          {parentNotes.slice(0, 3).map(n => (
            <div key={n.id} style={{ padding: "12px 0", borderBottom: `1px solid ${T.s2}` }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: T.ink }}>{n.from === "teacher" ? (n.teacherName || "TEACHER") : "YOU"}</span>
                <span style={{ padding: "2px 8px", borderRadius: 4, background: n.from === "teacher" ? T.blBg : T.glBg, color: n.from === "teacher" ? T.blue : T.grn, fontSize: 10, fontWeight: 600 }}>{n.from === "teacher" ? "FACULTY" : "PARENT"}</span>
                <span style={{ fontSize: 10, color: T.ink3, marginLeft: "auto" }}>{timeAgo(n.createdAt)}</span>
              </div>
              <p style={{ fontSize: 12, color: T.ink2, lineHeight: 1.5, margin: 0 }}>{(n.content || n.message || "").slice(0, 120)}</p>
            </div>
          ))}
          {parentNotes.length === 0 && <p style={{ fontSize: 12, color: T.ink3, textAlign: "center", padding: "16px 0" }}>No communications</p>}
        </Card>

        <Card title={`Score History · ${testScores.length} records`} action={<span style={{ fontSize: 11, color: T.blue, cursor: "pointer" }}>View All →</span>}>
          {barChartData.length > 0 && (
            <div style={{ height: 150, marginBottom: 12 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={barChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke={T.s2} />
                  <XAxis dataKey="name" tick={{ fill: T.ink3, fontSize: 9 }} axisLine={{ stroke: T.s2 }} />
                  <YAxis tick={{ fill: T.ink3, fontSize: 9 }} axisLine={{ stroke: T.s2 }} domain={[0, 100]} />
                  <Tooltip contentStyle={{ background: T.white, border: `1px solid ${T.bdr}`, borderRadius: 8, fontSize: 11 }} />
                  <Bar dataKey="score" fill={T.blue} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
          <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, minWidth: 280 }}>
            <thead>
              <tr>{["SUBJECT", "DATE", "SCORE"].map(h => <th key={h} style={{ textAlign: "left", padding: "6px 8px", fontSize: 10, color: T.ink3, fontWeight: 600, borderBottom: `1px solid ${T.s2}` }}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {scoreHistory.map(t => {
                const d = toDate(t.timestamp || t.createdAt);
                return (
                  <tr key={t.id} style={{ borderBottom: `1px solid ${T.s2}` }}>
                    <td style={{ padding: "8px", color: T.ink }}>{(t.subject || t.subjectName || "TEST").slice(0, 20)}</td>
                    <td style={{ padding: "8px", color: T.ink3 }}>{d ? d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" }).toUpperCase() : "—"}</td>
                    <td style={{ padding: "8px", fontWeight: 600, color: T.blue }}>{Number(t.percentage ?? t.score ?? 0)}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        </Card>
      </div>

      {/* ═══ BOTTOM STATUS BAR ═══ */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: isMobile ? "10px 14px" : "10px 20px", background: T.white, border: `1px solid ${T.bdr}`, borderRadius: 12, fontSize: 10, color: T.ink3, flexWrap: "wrap", gap: isMobile ? 8 : 0, rowGap: 6 }}>
        <span>★ ENGAGE: {Math.min(100, parentNotes.length * 20)}%</span>
        {!isMobile && <span>★ Status: Active</span>}
        {!isMobile && <span>★ Data: Live</span>}
        <span>★ Secured</span>
        <span>★ ID: {sid.slice(0, 8).toUpperCase()}</span>
        <span style={{ color: T.blue, fontWeight: 600 }}>{new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
      </div>

      {/* ═══ EDIT PROFILE MODAL ═══ */}
      {editOpen && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.4)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }} onClick={() => setEditOpen(false)}>
          <div onClick={e => e.stopPropagation()} style={{ background: T.white, borderRadius: 16, width: 420, maxWidth: "90vw", padding: 24, boxShadow: "0 20px 60px rgba(0,0,0,0.15)" }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: T.ink, marginBottom: 16 }}>Edit Profile</h3>
            {([
              { key: "dob", label: "Date of Birth", type: "date" },
              { key: "bloodGroup", label: "Blood Group", type: "text" },
              { key: "parentPhone", label: "Parent Phone", type: "tel" },
              { key: "emergencyContact", label: "Emergency Contact", type: "tel" },
            ] as const).map(f => (
              <div key={f.key} style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 10, fontWeight: 600, color: T.ink3, textTransform: "uppercase", letterSpacing: "0.05em" }}>{f.label}</label>
                <input
                  type={f.type}
                  value={(form as any)[f.key]}
                  onChange={e => setForm({ ...form, [f.key]: e.target.value })}
                  maxLength={100}
                  style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: `1px solid ${T.bdr}`, fontSize: 13, outline: "none", marginTop: 4 }}
                />
              </div>
            ))}
            <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
              <button onClick={() => setEditOpen(false)} style={{ flex: 1, padding: "10px 16px", borderRadius: 10, border: `1px solid ${T.bdr}`, background: T.white, color: T.ink2, fontSize: 13, fontWeight: 500, cursor: "pointer" }}>Cancel</button>
              <button onClick={handleSave} disabled={saving} style={{ flex: 1, padding: "10px 16px", borderRadius: 10, border: "none", background: T.blue, color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer", opacity: saving ? 0.6 : 1 }}>
                {saving ? "Saving..." : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MyChildPage;