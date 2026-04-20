import { useState, useEffect } from "react";
import {
  Trophy, AlertTriangle, Star, StarHalf, Clock, Users,
  BookOpen, HandHeart, Lightbulb, Loader2, CheckCircle
} from "lucide-react";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { useAuth } from "@/lib/AuthContext";
import { db } from "@/lib/firebase";
import { collection, query, where, onSnapshot, limit } from "firebase/firestore";
import { subscribeEnrollments } from "@/lib/enrollmentQuery";
import { useIsMobile } from "@/hooks/use-mobile";

export default function BehaviourPage() {
  const { studentData } = useAuth();
  const isMobile = useIsMobile();
  const [loading, setLoading] = useState(true);
  const [teacherNotes, setTeacherNotes] = useState<any[]>([]);
  const [manualRating, setManualRating] = useState<number | null>(null);

  useEffect(() => {
    if (!studentData?.id) return;
    setLoading(true);
    const schoolId = studentData.schoolId;

    // 1. Enrollments — dual-listener helper picks up legacy enrollments
    // where studentId was stored as email by older writes.
    const unsubEnroll = subscribeEnrollments(studentData, (docs) => {
      const ratings = docs.map(d => d.data().manualBehaviourRating).filter(r => r !== undefined);
      if (ratings.length > 0) setManualRating(Math.max(...ratings));
    });

    // 2. Behavioural notes — single scoped query
    const notesQ = schoolId
      ? query(collection(db, "parent_notes"), where("schoolId", "==", schoolId), where("studentId", "==", studentData.id), limit(40))
      : query(collection(db, "parent_notes"), where("studentId", "==", studentData.id), limit(40));
    const unsubNotes = onSnapshot(notesQ, (snap) => {
      const notes = snap.docs
        .map(d => ({ id: d.id, ...d.data() as any }))
        .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
      setTeacherNotes(notes);
      setLoading(false);
    });

    return () => { unsubEnroll(); unsubNotes(); };
  }, [studentData?.id, studentData?.schoolId]);

  // Determine positive vs improvement notes heuristics
  const classifyNote = (note: any) => {
    if (note.category) return note.category; // Trust structured category if exists
    
    const c = (note.content || "").toLowerCase();
    if (c.includes("late") || c.includes("forgot") || c.includes("miss") || c.includes("issue") || c.includes("distract") || c.includes("warning") || c.includes("poor") || c.includes("failing") || c.includes("talkative")) {
       return "improvement";
    }
    return "positive";
  };

  const positiveNotes = teacherNotes.filter(n => classifyNote(n) === "positive");
  const improvementNotes = teacherNotes.filter(n => classifyNote(n) === "improvement");

  const getIconForPositive = (index: number) => {
    const icons = [Star, HandHeart, Lightbulb, Trophy];
    return icons[index % icons.length];
  };

  const getIconForImprovement = (index: number) => {
    const icons = [Clock, BookOpen, AlertTriangle];
    return icons[index % icons.length];
  };

  const formatNoteDate = (note: any) => {
     try {
       if (note.createdAt && typeof note.createdAt.toDate === 'function') {
         return note.createdAt.toDate().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
       } else if (note.createdAt?.toDate) {
          return note.createdAt.toDate().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
       }
     } catch (e) {}
     return 'Recent';
  };

  const calculatedRating = teacherNotes.length === 0 ? 5.0 : 
    Math.min(5.0, Math.max(1.0, 5.0 - (improvementNotes.length * 0.3) + (positiveNotes.length * 0.1)));

  const rating = manualRating !== null ? manualRating.toFixed(1) : calculatedRating.toFixed(1);

  // Generate dynamic chart data from joining date to now
  const getTrendData = () => {
    const months: any = {};
    const now = new Date();
    
    // 1. Determine Start Date (Join Date)
    let startDate = new Date(now.getFullYear(), now.getMonth() - 4, 1); // default 5 months
    
    const rawJoinDate = studentData?.enrolledAt || studentData?.createdAt;
    if (rawJoinDate) {
       const jDate = rawJoinDate.toDate ? rawJoinDate.toDate() : new Date(rawJoinDate);
       startDate = new Date(jDate.getFullYear(), jDate.getMonth(), 1);
    } else if (teacherNotes.length > 0) {
       // Fallback to first note date
       const firstNoteDate = teacherNotes.reduce((earliest, current) => {
          const d = current.createdAt?.toDate ? current.createdAt.toDate() : new Date();
          return d < earliest ? d : earliest;
       }, new Date());
       startDate = new Date(firstNoteDate.getFullYear(), firstNoteDate.getMonth(), 1);
    }

    // 2. Generate all months between start and now
    let tempDate = new Date(startDate);
    while (tempDate <= now) {
       const mName = tempDate.toLocaleString('default', { month: 'short' });
       const mYear = tempDate.getFullYear().toString().slice(-2);
       const key = `${mName} ${mYear}`;
       months[key] = { m: mName, key: key, pos: 0, improv: 0, count: 0, date: new Date(tempDate) };
       tempDate.setMonth(tempDate.getMonth() + 1);
    }

    // 3. Populate Data
    teacherNotes.forEach(n => {
      const date = n.createdAt?.toDate ? n.createdAt.toDate() : new Date();
      const mName = date.toLocaleString('default', { month: 'short' });
      const mYear = date.getFullYear().toString().slice(-2);
      const key = `${mName} ${mYear}`;
      if (months[key]) {
        if (classifyNote(n) === "positive") months[key].pos++;
        else months[key].improv++;
        months[key].count++;
      }
    });

    return Object.values(months).map((data: any) => {
       const isCurrentMonth = data.m === now.toLocaleString('default', { month: 'short' }) && 
                             data.date?.getFullYear() === now.getFullYear();
       
       const calculatedScore = data.count === 0 ? 5.0 : 
          Math.min(5.0, Math.max(1.0, 5.0 - (data.improv * 0.3) + (data.pos * 0.1)));

       return {
          m: data.m,
          key: data.key,
          score: isCurrentMonth && manualRating !== null ? manualRating : calculatedScore
       };
    });
  };

  const trendData = getTrendData();

  const renderStars = (rate: number) => {
    const stars = [];
    const fullStars = Math.floor(rate);
    const hasHalfStar = rate - fullStars >= 0.5;

    for (let i = 0; i < fullStars; i++) {
       stars.push(<Star key={`full-${i}`} className="w-8 h-8 text-amber-400 fill-amber-400" />);
    }
    if (hasHalfStar) {
       stars.push(<StarHalf key="half" className="w-8 h-8 text-amber-400 fill-amber-400" />);
    }
    const emptyStars = 5 - stars.length;
    for (let i = 0; i < emptyStars; i++) {
       stars.push(<Star key={`empty-${i}`} className="w-8 h-8 text-slate-200" />);
    }
    return stars;
  };

  /* ═══════════════════════════════════════════════════════════════
     MOBILE — Bright Blue Apple UI
     ═══════════════════════════════════════════════════════════════ */
  if (isMobile) {
    const B1 = "#0055FF", B2 = "#1166FF", B3 = "#2277FF", B4 = "#4499FF";
    const BG = "#EEF4FF", BG2 = "#E0ECFF";
    const T1 = "#001040", T3 = "#5070B0", T4 = "#99AACC";
    const SEP = "rgba(0,85,255,0.07)";
    const GREEN = "#00C853", GREEN_D = "#007830";
    const RED = "#FF3355";
    const ORANGE = "#FF8800";
    const GOLD = "#FFAA00";
    const VIOLET = "#7B3FF4";
    const SH = "0 0 0 0.5px rgba(0,85,255,0.08), 0 2px 8px rgba(0,85,255,0.08), 0 10px 26px rgba(0,85,255,0.10)";
    const SH_LG = "0 0 0 0.5px rgba(0,85,255,0.10), 0 4px 16px rgba(0,85,255,0.11), 0 18px 44px rgba(0,85,255,0.13)";

    const rateNum = parseFloat(rating);

    // Derive sub-metrics from available data
    const conductGrade =
      rateNum >= 4.8 ? "A+" :
      rateNum >= 4.5 ? "A"  :
      rateNum >= 4.0 ? "B+" :
      rateNum >= 3.5 ? "B"  :
      rateNum >= 3.0 ? "C"  : "D";
    const incidents = improvementNotes.length;
    const punctualityPct = Math.max(0, Math.round(100 - incidents * 8));
    const respectScore = rateNum.toFixed(1);
    const participationScore = (Math.max(1, Math.min(5, rateNum - (incidents ? 0.2 : 0) + (positiveNotes.length ? 0.1 : 0)))).toFixed(1);

    // Trend delta arrow direction
    const lastTwo = trendData.slice(-2);
    const trendUp = lastTwo.length === 2 && (lastTwo[1] as any).score >= (lastTwo[0] as any).score;

    // Tier badge for highlight rows
    const tierFor = (i: number) => i === 0 ? "Gold" : i === 1 ? "Good" : "Nice";

    // Stars for mobile score row
    const mobileStars = () => {
      const out = [];
      const full = Math.floor(rateNum);
      const half = rateNum - full >= 0.5;
      for (let i = 0; i < full; i++) {
        out.push(
          <svg key={`f${i}`} width="28" height="28" viewBox="0 0 32 32" fill="none">
            <polygon points="16,2 20.2,11.6 30.8,12.9 23,20.5 25.2,31 16,25.9 6.8,31 9,20.5 1.2,12.9 11.8,11.6" fill={GOLD} stroke="#FF9900" strokeWidth="0.5" />
          </svg>
        );
      }
      if (half) {
        out.push(
          <svg key="half" width="28" height="28" viewBox="0 0 32 32" fill="none">
            <defs>
              <linearGradient id="halfStarGrad" x1="0%" x2="100%" y1="0%" y2="0%">
                <stop offset="50%" stopColor={GOLD} />
                <stop offset="50%" stopColor="rgba(255,170,0,0.18)" />
              </linearGradient>
            </defs>
            <polygon points="16,2 20.2,11.6 30.8,12.9 23,20.5 25.2,31 16,25.9 6.8,31 9,20.5 1.2,12.9 11.8,11.6" fill="url(#halfStarGrad)" stroke="#FF9900" strokeWidth="0.5" />
          </svg>
        );
      }
      const rest = 5 - out.length;
      for (let i = 0; i < rest; i++) {
        out.push(
          <svg key={`e${i}`} width="28" height="28" viewBox="0 0 32 32" fill="none">
            <polygon points="16,2 20.2,11.6 30.8,12.9 23,20.5 25.2,31 16,25.9 6.8,31 9,20.5 1.2,12.9 11.8,11.6" fill="rgba(255,170,0,0.15)" stroke="rgba(255,170,0,0.35)" strokeWidth="0.5" />
          </svg>
        );
      }
      return out;
    };

    return (
      <div className="animate-in fade-in duration-500 -mx-3 -mt-3 md:mx-0 md:mt-0"
        style={{ fontFamily: "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif", background: BG, minHeight: "100vh" }}>

        {loading ? (
          <div className="flex flex-col items-center justify-center pt-24 gap-3">
            <Loader2 className="w-10 h-10 animate-spin" style={{ color: B1 }} />
            <p className="text-xs font-medium" style={{ color: T4 }}>Loading behaviour data…</p>
          </div>
        ) : (
          <>
            {/* ── Page Head ── */}
            <div className="px-[22px] pt-5">
              <div className="text-[9px] font-bold uppercase tracking-[0.12em] mb-1 flex items-center gap-[6px]" style={{ color: T4 }}>
                <span className="w-[5px] h-[5px] rounded-full" style={{ background: B1, boxShadow: "0 0 0 2px rgba(0,85,255,0.18)" }} />
                Student Report
              </div>
              <div className="text-[27px] font-bold leading-[1.08]" style={{ color: T1, letterSpacing: "-0.7px" }}>
                Behaviour &amp;<br />Discipline
              </div>
            </div>

            {/* ── Rating Card ── */}
            <div className="mx-5 mt-[18px] bg-white rounded-[26px] p-[22px] relative overflow-hidden"
              style={{ boxShadow: SH_LG, border: "0.5px solid rgba(0,85,255,0.10)" }}>
              <div className="absolute -top-[46px] -right-8 w-[160px] h-[160px] rounded-full pointer-events-none"
                style={{ background: "radial-gradient(circle, rgba(0,200,83,0.07) 0%, transparent 70%)" }} />
              <div className="text-[17px] font-bold mb-[3px] relative z-10" style={{ color: T1, letterSpacing: "-0.3px" }}>
                Overall Behavior Rating
              </div>
              <div className="text-[12px] mb-5 font-normal relative z-10" style={{ color: T3 }}>
                Based on teacher observations this term
              </div>

              <div className="flex items-center gap-4 mb-4 relative z-10">
                <div className="flex flex-col">
                  <div className="text-[56px] font-bold leading-none" style={{ color: GREEN, letterSpacing: "-2px" }}>{rating}</div>
                  <div className="text-[11px] font-bold uppercase tracking-[0.08em] mt-[3px]" style={{ color: T4 }}>Out of 5</div>
                </div>
                <div className="flex gap-1 ml-auto">
                  {mobileStars()}
                </div>
              </div>

              {/* Sub metrics */}
              <div className="grid grid-cols-3 gap-2 pt-4 relative z-10" style={{ borderTop: `0.5px solid ${SEP}` }}>
                <div className="flex flex-col items-center gap-[5px]">
                  <div className="text-[18px] font-bold leading-none" style={{ color: GREEN, letterSpacing: "-0.4px" }}>{conductGrade}</div>
                  <div className="text-[9px] font-bold uppercase tracking-[0.08em]" style={{ color: T4 }}>Conduct</div>
                  <div className="h-1 w-full rounded-[2px] overflow-hidden" style={{ background: BG2 }}>
                    <div className="h-full rounded-[2px]" style={{ width: `${Math.min(100, rateNum * 20)}%`, background: `linear-gradient(90deg, ${GREEN}, #66EE88)` }} />
                  </div>
                </div>
                <div className="flex flex-col items-center gap-[5px]">
                  <div className="text-[18px] font-bold leading-none" style={{ color: B1, letterSpacing: "-0.4px" }}>{punctualityPct}%</div>
                  <div className="text-[9px] font-bold uppercase tracking-[0.08em]" style={{ color: T4 }}>Punctual</div>
                  <div className="h-1 w-full rounded-[2px] overflow-hidden" style={{ background: BG2 }}>
                    <div className="h-full rounded-[2px]" style={{ width: `${punctualityPct}%`, background: `linear-gradient(90deg, ${B1}, ${B4})` }} />
                  </div>
                </div>
                <div className="flex flex-col items-center gap-[5px]">
                  <div className="text-[18px] font-bold leading-none" style={{ color: GOLD, letterSpacing: "-0.4px" }}>{respectScore}</div>
                  <div className="text-[9px] font-bold uppercase tracking-[0.08em]" style={{ color: T4 }}>Respect</div>
                  <div className="h-1 w-full rounded-[2px] overflow-hidden" style={{ background: BG2 }}>
                    <div className="h-full rounded-[2px]" style={{ width: `${Math.min(100, rateNum * 20)}%`, background: `linear-gradient(90deg, ${GOLD}, #FFDD44)` }} />
                  </div>
                </div>
              </div>
            </div>

            {/* ── Positive Highlights ── */}
            <div className="mx-5 mt-3 bg-white rounded-[24px] p-5"
              style={{ boxShadow: SH_LG, border: "0.5px solid rgba(0,85,255,0.10)" }}>
              <div className="flex items-center gap-[10px] mb-[14px]">
                <div className="w-[38px] h-[38px] rounded-[12px] flex items-center justify-center shrink-0"
                  style={{ background: `linear-gradient(135deg, ${GREEN}, #66EE88)`, boxShadow: "0 3px 10px rgba(0,200,83,0.26)" }}>
                  <Trophy className="w-5 h-5 text-white" strokeWidth={2.2} />
                </div>
                <div className="text-[16px] font-bold" style={{ color: T1, letterSpacing: "-0.3px" }}>Positive Highlights</div>
              </div>

              {positiveNotes.length === 0 ? (
                <div className="text-[13px] italic leading-[1.6] font-normal py-1" style={{ color: T3 }}>
                  No positive highlights yet. <strong style={{ color: GREEN, fontStyle: "normal", fontWeight: 700 }}>Keep shining!</strong>
                </div>
              ) : (
                positiveNotes.slice(0, 5).map((note, idx, arr) => {
                  const Icon = getIconForPositive(idx);
                  return (
                    <div key={note.id || idx}
                      className={`flex items-center gap-3 px-[14px] py-[13px] rounded-[16px] active:scale-[0.97] transition-transform cursor-pointer ${idx < arr.length - 1 ? "mb-2" : ""}`}
                      style={{
                        background: "rgba(0,200,83,0.09)",
                        border: "0.5px solid rgba(0,200,83,0.20)",
                        transitionTimingFunction: "cubic-bezier(0.34,1.56,0.64,1)"
                      }}>
                      <div className="w-8 h-8 rounded-[10px] flex items-center justify-center shrink-0"
                        style={{ background: "rgba(0,200,83,0.09)", border: "0.5px solid rgba(0,200,83,0.20)" }}>
                        <Icon className="w-[15px] h-[15px]" style={{ color: GREEN }} strokeWidth={2.5} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] font-bold truncate" style={{ color: T1, letterSpacing: "-0.1px", marginBottom: 2 }}>
                          {note.content || "Great behaviour"}
                        </div>
                        <div className="text-[10px] font-semibold flex items-center gap-[3px]" style={{ color: T4 }}>
                          <Clock className="w-[10px] h-[10px]" strokeWidth={2.5} />
                          {formatNoteDate(note)}
                          {note.teacherName && (
                            <>
                              <span className="w-1 h-1 rounded-full" style={{ background: T4 }} />
                              <span className="truncate">{typeof note.teacherName === "string" ? note.teacherName : "Teacher"}</span>
                            </>
                          )}
                        </div>
                      </div>
                      <div className="px-[10px] py-1 rounded-full text-[10px] font-bold shrink-0"
                        style={{ background: "rgba(0,200,83,0.09)", color: GREEN_D, border: "0.5px solid rgba(0,200,83,0.20)" }}>
                        {tierFor(idx)}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* ── Areas for Improvement ── */}
            <div className="mx-5 mt-3 bg-white rounded-[24px] p-5"
              style={{ boxShadow: SH_LG, border: "0.5px solid rgba(0,85,255,0.10)" }}>
              <div className="flex items-center gap-[10px] mb-[14px]">
                <div className="w-[38px] h-[38px] rounded-[12px] flex items-center justify-center shrink-0"
                  style={{ background: "rgba(255,136,0,0.09)", border: "0.5px solid rgba(255,136,0,0.22)" }}>
                  <AlertTriangle className="w-5 h-5" style={{ color: ORANGE }} strokeWidth={2.2} />
                </div>
                <div className="text-[16px] font-bold" style={{ color: T1, letterSpacing: "-0.3px" }}>Areas for Improvement</div>
              </div>

              {improvementNotes.length === 0 ? (
                <div className="text-[13px] italic leading-[1.6] font-normal py-1" style={{ color: T3 }}>
                  No areas for improvement recorded! <strong style={{ color: GREEN, fontStyle: "normal", fontWeight: 700 }}>Great job.</strong>
                </div>
              ) : (
                improvementNotes.slice(0, 5).map((note, idx, arr) => {
                  const Icon = getIconForImprovement(idx);
                  return (
                    <div key={note.id || idx}
                      className={`flex items-center gap-3 px-[14px] py-[13px] rounded-[16px] active:scale-[0.97] transition-transform cursor-pointer ${idx < arr.length - 1 ? "mb-2" : ""}`}
                      style={{
                        background: "rgba(255,51,85,0.09)",
                        border: "0.5px solid rgba(255,51,85,0.20)",
                        transitionTimingFunction: "cubic-bezier(0.34,1.56,0.64,1)"
                      }}>
                      <div className="w-8 h-8 rounded-[10px] flex items-center justify-center shrink-0"
                        style={{ background: "rgba(255,51,85,0.09)", border: "0.5px solid rgba(255,51,85,0.20)" }}>
                        <Icon className="w-[15px] h-[15px]" style={{ color: RED }} strokeWidth={2.5} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] font-bold truncate" style={{ color: T1, letterSpacing: "-0.1px", marginBottom: 2 }}>
                          {note.content || "Needs attention"}
                        </div>
                        <div className="text-[10px] font-semibold flex items-center gap-[3px]" style={{ color: T4 }}>
                          <Clock className="w-[10px] h-[10px]" strokeWidth={2.5} />
                          {formatNoteDate(note)}
                          {note.teacherName && (
                            <>
                              <span className="w-1 h-1 rounded-full" style={{ background: T4 }} />
                              <span className="truncate">{typeof note.teacherName === "string" ? note.teacherName : "Teacher"}</span>
                            </>
                          )}
                        </div>
                      </div>
                      <div className="px-[10px] py-1 rounded-full text-[10px] font-bold shrink-0"
                        style={{ background: "rgba(255,51,85,0.09)", color: RED, border: "0.5px solid rgba(255,51,85,0.20)" }}>
                        Focus
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* ── Behavior Trend Chart ── */}
            {trendData.length > 1 && (
              <div className="mx-5 mt-3 bg-white rounded-[24px] p-5"
                style={{ boxShadow: SH_LG, border: "0.5px solid rgba(0,85,255,0.10)" }}>
                <div className="flex items-center justify-between mb-1">
                  <div className="text-[17px] font-bold" style={{ color: T1, letterSpacing: "-0.3px" }}>Behavior Trend</div>
                  <div className="px-[11px] py-1 rounded-full text-[11px] font-bold"
                    style={{ background: "rgba(0,85,255,0.10)", color: B1, border: "0.5px solid rgba(0,85,255,0.18)" }}>
                    {rating} {trendUp ? "↑" : "↓"}
                  </div>
                </div>
                <div className="text-[12px] mb-4 font-normal" style={{ color: T3 }}>Rating progression across months</div>
                <div style={{ height: 160 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={trendData} margin={{ top: 6, right: 6, left: -22, bottom: 0 }}>
                      <defs>
                        <linearGradient id="behMobileLine" x1="0%" y1="0%" x2="100%" y2="0%">
                          <stop offset="0%" stopColor={B1} />
                          <stop offset="100%" stopColor="#66BBFF" />
                        </linearGradient>
                        <linearGradient id="behMobileArea" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={B1} stopOpacity={0.14} />
                          <stop offset="100%" stopColor={B1} stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="0" vertical={false} stroke="rgba(0,85,255,0.06)" />
                      <XAxis dataKey="m" axisLine={false} tickLine={false} tick={{ fontSize: 9, fill: T4, fontWeight: 600 }} />
                      <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 9, fill: T4, fontWeight: 600 }} domain={[1, 5]} width={28} />
                      <Tooltip
                        contentStyle={{ borderRadius: 12, border: "0.5px solid rgba(0,85,255,0.15)", boxShadow: "0 4px 20px rgba(0,85,255,0.12)", fontSize: 11, padding: "6px 10px", background: "#fff" }}
                        formatter={(val: any) => [`${val.toFixed?.(1) ?? val}`, "Rating"]}
                      />
                      <Area type="monotone" dataKey="score" stroke="url(#behMobileLine)" strokeWidth={2.5} fill="url(#behMobileArea)" dot={{ r: 4, strokeWidth: 2, stroke: "#fff", fill: B1 }} activeDot={{ r: 6, strokeWidth: 2 }} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {/* ── Breakdown Grid 2×2 ── */}
            <div className="grid grid-cols-2 gap-2 mx-5 mt-3">
              {[
                { val: conductGrade, label: "Conduct",      color: GREEN,  ico: CheckCircle, icoBg: `linear-gradient(135deg, ${GREEN}, #66EE88)`, icoSh: "0 2px 8px rgba(0,200,83,0.24)" },
                { val: `${punctualityPct}%`, label: "Punctuality", color: B1,  ico: Clock,       icoBg: `linear-gradient(135deg, ${B1}, ${B3})`,      icoSh: "0 2px 8px rgba(0,85,255,0.24)" },
                { val: respectScore, label: "Respect",      color: GOLD,   ico: Star,        icoBg: `linear-gradient(135deg, ${GOLD}, #FFDD44)`,  icoSh: "0 2px 8px rgba(255,170,0,0.24)" },
                { val: participationScore, label: "Participation", color: VIOLET, ico: Users,      icoBg: "linear-gradient(135deg, #7B3FF4, #AA77FF)", icoSh: "0 2px 8px rgba(123,63,244,0.24)" },
              ].map(({ val, label, color, ico: Icon, icoBg, icoSh }) => (
                <div key={label} className="rounded-[16px] px-[14px] py-[13px] active:bg-[#E0ECFF] transition-colors cursor-pointer"
                  style={{ background: BG, border: "0.5px solid rgba(0,85,255,0.10)" }}>
                  <div className="w-7 h-7 rounded-[9px] flex items-center justify-center mb-2"
                    style={{ background: icoBg, boxShadow: icoSh }}>
                    <Icon className="w-[14px] h-[14px] text-white" strokeWidth={2.5} />
                  </div>
                  <div className="text-[20px] font-bold leading-none mb-[2px]" style={{ color, letterSpacing: "-0.5px" }}>{val}</div>
                  <div className="text-[10px] font-bold uppercase tracking-[0.07em]" style={{ color: T4 }}>{label}</div>
                </div>
              ))}
            </div>

            {/* ── Dark Summary ── */}
            <div className="mx-5 mt-3 rounded-[24px] px-[22px] py-5 relative overflow-hidden"
              style={{
                background: "linear-gradient(140deg, #001888 0%, #0033CC 48%, #0055FF 100%)",
                boxShadow: "0 8px 30px rgba(0,51,204,0.32), 0 0 0 0.5px rgba(255,255,255,0.14)",
              }}>
              <div className="absolute -top-[38px] -right-[26px] w-[170px] h-[170px] rounded-full pointer-events-none"
                style={{ background: "radial-gradient(circle, rgba(255,255,255,0.12) 0%, transparent 65%)" }} />
              <div className="absolute inset-0 pointer-events-none" style={{
                backgroundImage: "linear-gradient(rgba(255,255,255,0.014) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.014) 1px, transparent 1px)",
                backgroundSize: "24px 24px"
              }} />
              <div className="text-[9px] font-bold uppercase tracking-[0.12em] mb-[10px] relative z-10" style={{ color: "rgba(255,255,255,0.48)" }}>
                Term Behaviour Summary
              </div>
              <div className="grid grid-cols-3 rounded-[16px] overflow-hidden relative z-10" style={{ gap: "1px", background: "rgba(255,255,255,0.12)" }}>
                <div className="py-[14px] px-3 text-center" style={{ background: "rgba(255,255,255,0.08)" }}>
                  <div className="text-[24px] font-bold text-white leading-none mb-1" style={{ letterSpacing: "-0.7px" }}>{rating}</div>
                  <div className="text-[9px] font-bold uppercase tracking-[0.09em]" style={{ color: "rgba(255,255,255,0.40)" }}>Rating</div>
                </div>
                <div className="py-[14px] px-3 text-center" style={{ background: "rgba(255,255,255,0.08)" }}>
                  <div className="text-[24px] font-bold text-white leading-none mb-1" style={{ letterSpacing: "-0.7px" }}>{incidents}</div>
                  <div className="text-[9px] font-bold uppercase tracking-[0.09em]" style={{ color: "rgba(255,255,255,0.40)" }}>{incidents === 1 ? "Incident" : "Incidents"}</div>
                </div>
                <div className="py-[14px] px-3 text-center" style={{ background: "rgba(255,255,255,0.08)" }}>
                  <div className="text-[24px] font-bold text-white leading-none mb-1" style={{ letterSpacing: "-0.7px" }}>{conductGrade}</div>
                  <div className="text-[9px] font-bold uppercase tracking-[0.09em]" style={{ color: "rgba(255,255,255,0.40)" }}>Grade</div>
                </div>
              </div>
            </div>

            <div className="h-6" />
          </>
        )}
      </div>
    );
  }

  /* ═══════════════════════════════════════════════════════════════
     DESKTOP — Existing UI (unchanged)
     ═══════════════════════════════════════════════════════════════ */
  return (
    <div className="animate-in fade-in slide-in-from-bottom-5 duration-700 pb-24 text-left font-sans mx-auto px-4 lg:px-0 pt-8 max-w-6xl">

      {loading ? (
        <div className="flex h-64 items-center justify-center">
           <Loader2 className="w-12 h-12 text-blue-500 animate-spin" />
        </div>
      ) : (
        <>
          {/* HEADER SECTION */}
          <div className="mb-6">
             <h1 className="text-xl font-bold text-slate-800 uppercase tracking-widest leading-none">BEHAVIOUR & DISCIPLINE</h1>
          </div>

          <div className="space-y-6">
            
            {/* OVERALL BEHAVIOR RATING */}
            <div className="bg-white border border-slate-100 rounded-[1rem] p-8 shadow-[0px_2px_15px_rgba(0,0,0,0.02)] flex flex-col md:flex-row justify-between items-center gap-6">
               <div>
                  <h2 className="text-[19px] font-black text-slate-800 tracking-tight">Overall Behavior Rating</h2>
                  <p className="text-[13px] font-medium text-slate-400 mt-1">Based on teacher observations this term</p>
               </div>
               
               <div className="flex items-center gap-6 md:border-l md:border-slate-100 md:pl-8 h-full">
                  <div className="text-right">
                     <p className="text-5xl font-black text-emerald-500 tracking-tighter leading-none">{rating}</p>
                     <p className="text-[10px] font-black uppercase text-slate-400 mt-1.5 tracking-widest text-center">OUT OF 5</p>
                  </div>
                  <div className="flex items-center gap-1.5">
                     {renderStars(parseFloat(rating))}
                  </div>
               </div>
            </div>

            {/* 2 COLUMNS: POSITIVE HIGHLIGHTS & AREAS FOR IMPROVEMENT */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
               
               {/* POSITIVE HIGHLIGHTS */}
               <div className="bg-white border border-slate-100 rounded-[1rem] p-8 shadow-[0px_2px_15px_rgba(0,0,0,0.02)] flex flex-col">
                  <div className="flex items-center gap-3 mb-6">
                     <Trophy className="w-6 h-6 text-emerald-500 fill-emerald-100" />
                     <h2 className="text-lg font-black text-slate-800 tracking-tight">Positive Highlights</h2>
                  </div>
                  
                  <div className="space-y-4 flex-1">
                     {positiveNotes.length === 0 ? (
                        <p className="text-[14px] font-medium text-[#94a3b8] italic">No positive highlights recorded yet.</p>
                     ) : (
                        positiveNotes.map((note, idx) => {
                           const Icon = getIconForPositive(idx);
                           return (
                             <div key={note.id || idx} className="bg-white border border-emerald-200 rounded-lg p-5 flex gap-5 transition-all hover:bg-emerald-50/50 shadow-sm">
                                <Icon className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5 fill-emerald-100" />
                                <div>
                                   <p className="text-[15px] font-semibold text-slate-700 leading-snug mb-2">{note.content}</p>
                                   <div className="flex items-center gap-2 text-[12px] font-medium text-slate-400">
                                      <span>{formatNoteDate(note)}</span>
                                      {note.teacherName && (
                                        <>
                                          <span className="w-1 h-1 rounded-full bg-slate-300" />
                                          <span>{typeof note.teacherName === 'string' ? note.teacherName : 'Teacher'}</span>
                                        </>
                                      )}
                                   </div>
                                </div>
                             </div>
                           )
                        })
                     )}
                  </div>
               </div>

               {/* AREAS FOR IMPROVEMENT */}
               <div className="bg-white border border-slate-100 rounded-[1rem] p-8 shadow-[0px_2px_15px_rgba(0,0,0,0.02)] flex flex-col">
                  <div className="flex items-center gap-3 mb-6">
                     <AlertTriangle className="w-6 h-6 text-amber-500" />
                     <h2 className="text-lg font-black text-slate-800 tracking-tight">Areas for Improvement</h2>
                  </div>
                  
                  <div className="space-y-4 flex-1">
                     {improvementNotes.length === 0 ? (
                        <p className="text-[14px] font-medium text-[#94a3b8] italic">No areas for improvement recorded! Great job.</p>
                     ) : (
                        improvementNotes.map((note, idx) => {
                           const Icon = getIconForImprovement(idx);
                           return (
                             <div key={note.id || idx} className="bg-amber-50/30 border border-amber-200 rounded-lg p-5 flex gap-5 transition-all hover:bg-amber-50/70 shadow-sm">
                                <Icon className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                                <div>
                                   <p className="text-[15px] font-semibold text-slate-700 leading-snug mb-2">{note.content}</p>
                                   <div className="flex items-center gap-2 text-[12px] font-medium text-slate-400">
                                      <span>{formatNoteDate(note)}</span>
                                      {note.teacherName && (
                                        <>
                                          <span className="w-1 h-1 rounded-full bg-slate-300" />
                                          <span>{typeof note.teacherName === 'string' ? note.teacherName : 'Teacher'}</span>
                                        </>
                                      )}
                                   </div>
                                </div>
                             </div>
                           )
                        })
                     )}
                  </div>
               </div>
            </div>

            {/* BEHAVIOR TREND CHART */}
            <div className="bg-white border border-slate-100 rounded-[1rem] p-8 shadow-[0px_2px_15px_rgba(0,0,0,0.02)]">
               <h2 className="text-[17px] font-black text-slate-800 tracking-tight mb-8">Behavior Trend</h2>
               <div className="h-[280px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                     <AreaChart data={trendData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                        <defs>
                           <linearGradient id="colorScore" x1="0" y1="0" x2="1" y2="1">
                              <stop offset="5%" stopColor="#6366f1" stopOpacity={0.4}/>
                              <stop offset="50%" stopColor="#8b5cf6" stopOpacity={0.2}/>
                              <stop offset="95%" stopColor="#10b981" stopOpacity={0.4}/>
                           </linearGradient>
                           <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
                              <feGaussianBlur stdDeviation="3" result="blur" />
                              <feComposite in="SourceGraphic" in2="blur" operator="over" />
                           </filter>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                        <XAxis dataKey="m" axisLine={false} tickLine={false} tick={{ fontSize: 13, fontWeight: 800, fill: '#cbd5e1' }} dy={10} />
                        <YAxis domain={[1, 5]} axisLine={false} tickLine={false} tick={{ fontSize: 13, fontWeight: 800, fill: '#cbd5e1' }} dx={-10} />
                        <Tooltip 
                           contentStyle={{ borderRadius: '2rem', border: 'none', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.15)', fontWeight: '900', textTransform: 'uppercase', fontStyle: 'italic', fontSize: '10px', background: 'rgba(255,255,255,0.96)', backdropFilter: 'blur(10px)' }} 
                           labelStyle={{ color: '#6366f1', marginBottom: '4px' }}
                        />
                        <Area 
                           type="monotone" 
                           dataKey="score" 
                           stroke="url(#lineGradient)" 
                           fillOpacity={1} 
                           fill="url(#colorScore)" 
                           strokeWidth={5} 
                           dot={{ r: 6, fill: '#6366f1', strokeWidth: 3, stroke: '#fff' }}
                           activeDot={{ r: 8, strokeWidth: 0, fill: '#10b981' }}
                           filter="url(#glow)"
                        />
                        <defs>
                           <linearGradient id="lineGradient" x1="0" y1="0" x2="1" y2="0">
                              <stop offset="0%" stopColor="#6366f1" />
                              <stop offset="50%" stopColor="#8b5cf6" />
                              <stop offset="100%" stopColor="#10b981" />
                           </linearGradient>
                        </defs>
                     </AreaChart>
                  </ResponsiveContainer>
               </div>
            </div>

          </div>
        </>
      )}
    </div>
  );
}
