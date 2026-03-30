import React, { useState, useEffect } from "react";
import { 
  CheckCircle2, 
  CircleDashed, 
  AlertCircle, 
  Lightbulb, 
  Loader2,
  Sparkles,
  TrendingUp,
  Layout,
  GraduationCap
} from "lucide-react";
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer
} from 'recharts';
import { useAuth } from "../lib/AuthContext";
import { db } from "../lib/firebase";
import { collection, query, where, onSnapshot } from "firebase/firestore";
import { ParentAIController } from "../ai/controller/ai-controller";

const ConceptStrengthsPage = () => {
  const { studentData } = useAuth();
  const [enrollments, setEnrollments] = useState<any[]>([]);
  const [allScores, setAllScores] = useState<any[]>([]);
  const [attendance, setAttendance] = useState<any[]>([]);
  const [assignments, setAssignments] = useState<any[]>([]);
  const [aiAnalysis, setAiAnalysis] = useState<any>(null);
  const [activeSubject, setActiveSubject] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);

  useEffect(() => {
    if (!studentData?.id) return;
    setLoading(true);
    
    // Sync Enrollments
    const qEnroll = query(collection(db, "enrollments"), where("studentId", "==", studentData.id));
    const unsubEnroll = onSnapshot(qEnroll, (snap) => {
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() } as any));
      // Filter out redundant 'General' labels if real classes exist
      const filtered = data.filter((en: any) => (en.subject || en.className || "").toLowerCase() !== "general");
      const sorted = filtered.sort((a: any, b: any) => (a.subject || "").localeCompare(b.subject || ""));
      setEnrollments(sorted);
      if (!activeSubject) {
        setActiveSubject("Overview");
      }
    });

    // Sync Test Scores
    const qScores = query(collection(db, "test_scores"), where("studentId", "==", studentData.id));
    const unsubScores = onSnapshot(qScores, (snap) => {
      setAllScores(snap.docs.map(d => ({ id: d.id, ...d.data() } as any)));
    });

    // Sync Attendance
    const qAtt = query(collection(db, "attendance"), where("studentId", "==", studentData.id));
    const unsubAtt = onSnapshot(qAtt, (snap) => {
      setAttendance(snap.docs.map(d => ({ id: d.id, ...d.data() } as any)));
    });

    // Sync Assignments
    const qAssign = query(collection(db, "assignments"));
    const unsubAssign = onSnapshot(qAssign, (snap) => {
       setAssignments(snap.docs.map(d => ({ id: d.id, ...d.data() } as any)));
       setLoading(false);
    });

    return () => { unsubEnroll(); unsubScores(); unsubAtt(); unsubAssign(); };
  }, [studentData?.id]);

  useEffect(() => {
    const fetchAIInsights = async () => {
       if (enrollments.length > 0 && !aiAnalysis && !analyzing) {
          setAnalyzing(true);
          try {
             const context = {
                scores: allScores,
                assignments: assignments,
                attendance: attendance,
                enrolled_subjects: Array.from(new Set(enrollments.map(e => e.subject || e.className || "General")))
             };
             const result = await ParentAIController.getRealConceptMastery(studentData?.name || "Student", context);
             if (result.status === "success") {
                setAiAnalysis(result.data);
             }
          } finally {
             setAnalyzing(false);
          }
       }
    };
    fetchAIInsights();
  }, [enrollments, allScores, assignments, attendance]);

  if (loading) {
    return (
      <div className="h-[70vh] flex flex-col items-center justify-center">
        <Loader2 className="w-12 h-12 text-[#1e3a8a] animate-spin mb-4" />
        <p className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-400 italic">Accessing Concept Node...</p>
      </div>
    );
  }

  // --- LOCAL CATEGORIZATION FALLBACK ---
  const getLocalMasteryData = () => {
    // If Overview, show all. If specific subject, filter strictly (but allow General overlap).
    const subjectScores = allScores.filter(s => {
      if (activeSubject === "Overview") return true;
      const sub = (s.subject || s.className || "General").toLowerCase();
      const active = (activeSubject || "").toLowerCase();
      // Match subject to tab - OR include General scores if they exist for the student
      return sub === active || sub.includes(active) || active.includes(sub) || sub === "general";
    });

    const strong: any[] = [];
    const developing: any[] = [];
    const attention: any[] = [];

    subjectScores.forEach(s => {
      const pct = s.percentage || (s.maxScore ? (s.score / s.maxScore * 100) : 0) || 0;
      const rawDate = s.timestamp || s.createdAt || s.date;
      let dateStr = "Recent";
      if (rawDate) {
        const d = rawDate.toDate ? rawDate.toDate() : new Date(rawDate);
        if (!isNaN(d.getTime())) {
          dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        }
      }

      const item = {
        title: s.testName || s.title || "Scholastic Unit",
        score: `${s.score}/${s.maxScore || 100}`,
        ai_msg: `GRADE DECIDED • ${dateStr.toUpperCase()}`,
        mastery: `${Math.round(pct)}% MASTERY`
      };

      if (pct >= 85) strong.push(item);
      else if (pct >= 70) developing.push(item);
      else attention.push(item);
    });

    return { strong, developing, attention };
  };

  const currentData = aiAnalysis?.subjects?.[activeSubject] || getLocalMasteryData() || {
    strong: [], developing: [], attention: [], recommended_focus: "Data is being synthesized..."
  };

  // Generate dynamic chart data from allScores
  const getChartData = () => {
    if (allScores.length === 0) return [];
    
    // Determine real time span from actual tests
    const dates = allScores.map(s => {
       const d = s.timestamp?.toDate ? s.timestamp.toDate() : (s.createdAt?.toDate ? s.createdAt.toDate() : new Date(s.timestamp || s.createdAt || Date.now()));
       return d.getTime();
    }).filter(t => !isNaN(t));

    if (dates.length === 0) dates.push(Date.now());
    
    const minD = new Date(Math.min(...dates));
    const maxD = new Date();
    
    let startD = new Date(minD.getFullYear(), minD.getMonth(), 1);
    const endD = new Date(maxD.getFullYear(), maxD.getMonth(), 1);
    
    const diff = (endD.getFullYear() - startD.getFullYear()) * 12 + (endD.getMonth() - startD.getMonth());
    if (diff > 11) {
       startD = new Date(endD.getFullYear(), endD.getMonth() - 11, 1);
    } else if (diff === 0) {
       startD = new Date(endD.getFullYear(), endD.getMonth() - 3, 1);
    }
    
    const monthsInOrder = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const displayMonths: any[] = [];
    let curr = new Date(startD);
    while (curr <= endD) {
       displayMonths.push({ 
         name: monthsInOrder[curr.getMonth()], 
         index: curr.getMonth(), 
         year: curr.getFullYear(),
         label: `${monthsInOrder[curr.getMonth()]} '${curr.getFullYear().toString().slice(-2)}`
       });
       curr.setMonth(curr.getMonth() + 1);
    }

    const subjectNames = enrollments.length > 0 ? enrollments.map(e => e.subject || e.className || "General") : ["General Achievement"];
    
    return displayMonths.map(m => {
      const entry: any = { month: m.label };
      subjectNames.forEach(sub => {
        const subScores = allScores.filter(s => {
          const sDate = s.timestamp?.toDate ? s.timestamp.toDate() : (s.createdAt?.toDate ? s.createdAt.toDate() : new Date(s.timestamp || s.createdAt || Date.now()));
          const scoreMonth = sDate.getMonth();
          const scoreYear = sDate.getFullYear();
          const scoreSub = (s.subject || s.className || "General").toLowerCase();
          
          const sClassId = s.classId || "";
          const en = enrollments.find(e => (e.subject || e.className || "General") === sub);
          const enClassId = en?.classId || "";

          const monthMatch = scoreMonth === m.index && scoreYear === m.year;
          
          let subjectMatch = false;
          if (enClassId && sClassId && enClassId === sClassId) {
             subjectMatch = true;
          } else {
             const activeSub = (sub || "").toLowerCase();
             // Match strictly or inclusively depending on the generic nature
             subjectMatch = scoreSub.includes(activeSub) || activeSub.includes(scoreSub) || scoreSub === "general" || activeSub === "general";
          }
          
          return monthMatch && subjectMatch;
        });

        if (subScores.length > 0) {
          const avg = subScores.reduce((acc, curr) => {
             const pct = curr.percentage || (curr.maxScore ? (curr.score / curr.maxScore * 100) : 0) || 0;
             return acc + pct;
          }, 0) / subScores.length;
          entry[sub] = Math.round(avg);
          entry[`${sub}_tests`] = subScores.map(ts => ({
             topic: ts.testName || ts.title || ts.subject || "Assessment",
             score: `${ts.score}/${ts.maxScore || 100}`
          }));
        } else {
          entry[sub] = null;
        }
      });
      return entry;
    });
  };

  const chartData = enrollments.length > 0 ? getChartData() : [];
  const subjectList = enrollments.map(e => e.subject || e.className || "General");

  const getWidth = (score: string) => {
    if (!score) return 50;
    if (score.includes('%')) return parseInt(score);
    if (score.includes('/')) {
      const [got, max] = score.split('/').map(num => parseFloat(num.trim()));
      if (max > 0) return (got / max) * 100;
    }
    const val = parseInt(score);
    if (!isNaN(val)) return val > 100 ? 100 : val;
    if (score.startsWith('A')) return 90;
    if (score.startsWith('B')) return 75;
    if (score.startsWith('C')) return 60;
    return 40;
  };

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-white p-5 rounded-[2rem] shadow-2xl border border-slate-100 min-w-[240px] z-50">
          <p className="text-sm font-black text-slate-800 uppercase tracking-widest mb-4 border-b border-slate-100 pb-3">{label}</p>
          <div className="space-y-4">
          {payload.map((p: any, idx: number) => {
            const testsData = p.payload[`${p.dataKey}_tests`];
            return (
              <div key={idx} className="bg-slate-50/50 rounded-2xl p-3 border border-slate-50">
                 <div className="flex items-center gap-2 mb-2">
                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: p.stroke || p.color }} />
                    <p className="text-[11px] font-black uppercase tracking-widest text-slate-600 line-clamp-1 truncate">{p.dataKey}</p>
                    <span className="ml-auto text-sm font-black tracking-tighter" style={{ color: p.stroke || p.color }}>{p.value}%</span>
                 </div>
                 {testsData && testsData.length > 0 && (
                   <div className="space-y-1.5 mt-2">
                     {testsData.map((t: any, i: number) => (
                        <div key={i} className="flex items-center justify-between text-[10px] bg-white px-2 py-1.5 rounded-lg shadow-sm border border-slate-100">
                          <span className="text-slate-500 font-bold truncate max-w-[130px]">{t.topic}</span>
                          <span className="font-black text-slate-800 shrink-0 ml-2">{t.score}</span>
                        </div>
                     ))}
                   </div>
                 )}
              </div>
            )
          })}
          </div>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="animate-in fade-in duration-700 pb-20 font-sans text-left max-w-[1400px] mx-auto">
      
      {/* ── HEADER ── */}
      <div className="mb-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
           <div className="flex items-center gap-2 mb-2">
             <div className="w-2 h-2 rounded-full bg-indigo-600" />
             <p className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-400">Scholastic Matrix</p>
           </div>
           <h1 className="text-4xl font-black text-slate-900 tracking-tighter uppercase italic">Concept Strengths</h1>
        </div>
        
        {analyzing && (
          <div className="flex items-center gap-3 px-6 py-3 bg-indigo-50 rounded-2xl border border-indigo-100">
            <Loader2 className="w-4 h-4 text-indigo-600 animate-spin" />
            <span className="text-xs font-black text-indigo-600 uppercase tracking-widest italic">AI Analysis In Progress...</span>
          </div>
        )}
      </div>

      {/* ── SUBJECT TABS ── */}
      <div className="flex flex-wrap gap-3 mb-12">
        <button
          onClick={() => setActiveSubject("Overview")}
          className={`px-8 py-3.5 rounded-[1.2rem] text-sm font-black transition-all duration-300 transform border-2 ${
            activeSubject === "Overview"
            ? "bg-[#1e3a8a] text-white border-[#1e3a8a] shadow-xl shadow-indigo-100 -translate-y-1" 
            : "bg-white text-slate-500 border-slate-100 hover:border-indigo-200 hover:text-indigo-600"
          }`}
        >
          Overview
        </button>
        {enrollments.map((en) => {
          const name = en.subject || en.className || "General";
          const isActive = activeSubject === name;
          if (name === "Overview") return null; // Avoid duplicates
          return (
            <button
              key={en.id}
              onClick={() => setActiveSubject(name)}
              className={`px-8 py-3.5 rounded-[1.2rem] text-sm font-black transition-all duration-300 transform border-2 ${
                isActive 
                ? "bg-[#1e3a8a] text-white border-[#1e3a8a] shadow-xl shadow-indigo-100 -translate-y-1" 
                : "bg-white text-slate-500 border-slate-100 hover:border-indigo-200 hover:text-indigo-600"
              }`}
            >
              {name}
            </button>
          );
        })}
      </div>

      {/* ── 3-COLUMN CONCEPT GRID ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mb-16">
        
        {/* COLUMN 1: STRONG */}
        <div className="bg-[#f8fafc] rounded-[2.5rem] p-8 border border-slate-100/50">
           <div className="flex items-center gap-3 mb-8">
              <div className="w-10 h-10 rounded-2xl bg-emerald-100 text-emerald-600 flex items-center justify-center">
                 <CheckCircle2 size={20} />
              </div>
              <h3 className="text-xl font-black text-slate-800 tracking-tight italic">Strong</h3>
           </div>
           
           <div className="space-y-4">
              {currentData.strong && currentData.strong.length > 0 ? currentData.strong.map((c: any, i: number) => (
                <div key={i} className="bg-white p-6 rounded-[2.5rem] shadow-sm hover:shadow-md transition-all flex items-center gap-6">
                   <div className="w-14 h-14 rounded-full border border-slate-100 flex items-center justify-center shrink-0">
                     <GraduationCap className="w-6 h-6 text-slate-400" />
                   </div>
                   
                   <div className="flex-1">
                     <h4 className="text-[17px] font-black text-slate-800 tracking-tight leading-none mb-1.5">{c.title}</h4>
                     <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{c.ai_msg}</p>
                   </div>
                   
                   <div className="text-right shrink-0">
                     <p className="text-2xl font-black italic tracking-tighter leading-none mb-1 text-[#10b981]">
                       {c.score}
                     </p>
                     <p className="text-[9px] font-black uppercase tracking-widest text-[#10b981]/80">
                       {c.mastery}
                     </p>
                   </div>
                </div>
              )) : (
                <div className="py-12 flex flex-col items-center justify-center opacity-40">
                   <CheckCircle2 className="w-8 h-8 text-slate-200 mb-2" />
                   <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest italic">Awaiting Peak Scores</p>
                </div>
              )}
           </div>
        </div>

        {/* COLUMN 2: DEVELOPING */}
        <div className="bg-[#f8fafc] rounded-[2.5rem] p-8 border border-slate-100/50">
           <div className="flex items-center gap-3 mb-8">
              <div className="w-10 h-10 rounded-2xl bg-amber-100 text-amber-600 flex items-center justify-center">
                 <CircleDashed size={20} className="animate-spin-slow" />
              </div>
              <h3 className="text-xl font-black text-slate-800 tracking-tight italic">Developing</h3>
           </div>
           
           <div className="space-y-4">
              {currentData.developing && currentData.developing.length > 0 ? currentData.developing.map((c: any, i: number) => (
                <div key={i} className="bg-white p-6 rounded-[2.5rem] shadow-sm hover:shadow-md transition-all flex items-center gap-6">
                   <div className="w-14 h-14 rounded-full border border-slate-100 flex items-center justify-center shrink-0">
                     <GraduationCap className="w-6 h-6 text-slate-400" />
                   </div>
                   
                   <div className="flex-1">
                     <h4 className="text-[17px] font-black text-slate-800 tracking-tight leading-none mb-1.5">{c.title}</h4>
                     <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{c.ai_msg}</p>
                   </div>
                   
                   <div className="text-right shrink-0">
                     <p className="text-2xl font-black italic tracking-tighter leading-none mb-1 text-slate-800">
                       {c.score}
                     </p>
                     <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">
                       {c.mastery}
                     </p>
                   </div>
                </div>
              )) : (
                <div className="py-12 flex flex-col items-center justify-center opacity-40">
                   <CircleDashed className="w-8 h-8 text-slate-200 mb-2" />
                   <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest italic">Stable Performance</p>
                </div>
              )}
           </div>
        </div>

        {/* COLUMN 3: NEEDS ATTENTION */}
        <div className="bg-[#f8fafc] rounded-[2.5rem] p-8 border border-slate-100/50">
           <div className="flex items-center gap-3 mb-8">
              <div className="w-10 h-10 rounded-2xl bg-rose-100 text-rose-600 flex items-center justify-center">
                 <AlertCircle size={20} />
              </div>
              <h3 className="text-xl font-black text-slate-800 tracking-tight italic">Needs Attention</h3>
           </div>
           
           <div className="space-y-4">
              {currentData.attention && currentData.attention.length > 0 ? currentData.attention.map((c: any, i: number) => (
                <div key={i} className="bg-white p-6 rounded-[2.5rem] shadow-sm hover:shadow-md transition-all flex items-center gap-6">
                   <div className="w-14 h-14 rounded-full border border-slate-100 flex items-center justify-center shrink-0">
                     <GraduationCap className="w-6 h-6 text-slate-400" />
                   </div>
                   
                   <div className="flex-1">
                     <h4 className="text-[17px] font-black text-slate-800 tracking-tight leading-none mb-1.5">{c.title}</h4>
                     <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{c.ai_msg}</p>
                   </div>
                   
                   <div className="text-right shrink-0">
                     <p className="text-2xl font-black italic tracking-tighter leading-none mb-1 text-rose-500">
                       {c.score}
                     </p>
                     <p className="text-[9px] font-black uppercase tracking-widest text-rose-500/80">
                       {c.mastery}
                     </p>
                   </div>
                </div>
              )) : (
                <div className="py-12 flex flex-col items-center justify-center opacity-40">
                   <AlertCircle className="w-8 h-8 text-slate-200 mb-2" />
                   <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest italic">Target Under Supervision</p>
                </div>
              )}
           </div>
        </div>
      </div>

      {/* ── CONCEPT MASTERY PROGRESS CHART ── */}
      <div className="bg-white rounded-[3rem] p-10 border border-slate-100 shadow-sm">
         <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-12">
            <div>
               <h3 className="text-2xl font-black text-slate-900 tracking-tighter italic uppercase mb-2">Concept Mastery Progress</h3>
               <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Temporal Intelligence Analysis</p>
            </div>
             <div className="flex flex-wrap gap-4 justify-end">
               {subjectList.slice(0, 4).map((tag, i) => (
                 <div key={i} className="flex items-center gap-2">
                    <div className={`w-3 h-3 rounded-full ${i === 0 ? 'bg-emerald-500' : i === 1 ? 'bg-[#1e3a8a]' : i === 2 ? 'bg-rose-500' : 'bg-amber-500'}`} />
                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">{tag}</span>
                 </div>
               ))}
            </div>
         </div>

         <div className="h-[400px] w-full">
            <ResponsiveContainer width="100%" height="100%">
               <LineChart data={chartData} margin={{ top: 20, right: 30, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis 
                    dataKey="month" 
                    axisLine={false} 
                    tickLine={false} 
                    tick={{ fill: '#94a3b8', fontSize: 11, fontWeight: 900 }}
                    dy={10}
                  />
                  <YAxis 
                    axisLine={false} 
                    tickLine={false} 
                    tick={{ fill: '#94a3b8', fontSize: 11, fontWeight: 900 }}
                    domain={[0, 100]}
                  />
                  <Tooltip content={<CustomTooltip />} cursor={{ stroke: '#f1f5f9', strokeWidth: 2 }} />
                  {subjectList.slice(0, 4).map((sub, i) => (
                     <Line 
                        key={i} 
                        type="monotone" 
                        dataKey={sub} 
                        stroke={i === 0 ? "#10b981" : i === 1 ? "#1e3a8a" : i === 2 ? "#f43f5e" : "#f59e0b"} 
                        strokeWidth={3} 
                        dot={{ r: 4, fill: i === 0 ? "#10b981" : i === 1 ? "#1e3a8a" : i === 2 ? "#f43f5e" : "#f59e0b", strokeWidth: 2, stroke: '#fff' }}
                        activeDot={{ r: 6, strokeWidth: 0 }}
                        connectNulls
                     />
                  ))}
               </LineChart>
            </ResponsiveContainer>
         </div>
      </div>

    </div>
  );
};

export default ConceptStrengthsPage;
