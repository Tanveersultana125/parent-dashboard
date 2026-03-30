import React, { useState, useEffect } from "react";
import { 
  Calendar, CheckCircle, Clock, ChevronRight, Filter, 
  Sparkles, BrainCircuit, Rocket, Zap, Info, Loader2,
  Award, BarChart3, TrendingUp, Star, ShieldCheck, ArrowUpRight, GraduationCap,
  FlaskConical, Calculator, Book, History, Trophy, Layout, Target
} from "lucide-react";
import { useAuth } from "@/lib/AuthContext";
import { db } from "@/lib/firebase";
import { collection, query, where, onSnapshot, orderBy, limit } from "firebase/firestore";

const TestsPage = () => {
  const { studentData } = useAuth();
  const [loading, setLoading] = useState(true);
  const [upcomingTests, setUpcomingTests] = useState<any[]>([]);
  const [recentResults, setRecentResults] = useState<any[]>([]);
  
  // Performance Stats
  const [stats, setStats] = useState({
     aGrade: 0,
     bGrade: 0,
     cGrade: 0,
     belowC: 0,
     totalTaken: 0
  });

  useEffect(() => {
    if (!studentData?.id) return;
    setLoading(true);

    // 1. Fetch Class Enrollments to get relevant tests
    const qEnroll = query(collection(db, "enrollments"), where("studentId", "==", studentData.id));
    const unsubEnroll = onSnapshot(qEnroll, (enrollSnap) => {
        const classIds = enrollSnap.docs.map(d => d.data().classId).filter(id => !!id);
        const searchIds = classIds.length > 0 ? classIds : [studentData.classId || "General"];

        // 2. Fetch Tests for these classes
        const qTests = query(
          collection(db, "tests"),
          where("classId", "in", searchIds.slice(0, 10)) // Firestore limit
        );

        const unsubTests = onSnapshot(qTests, (snap) => {
            const now = new Date();
            const allTests = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
            const filtered = allTests
                .filter((t: any) => {
                   const d = t.date || t.testDate;
                   return d && new Date(d) >= now;
                })
                .sort((a: any, b: any) => new Date(a.date || a.testDate).getTime() - new Date(b.date || b.testDate).getTime());
            
            setUpcomingTests(filtered);
        });

        return () => unsubTests();
    });

    // 3. Fetch Student Test Scores (Removed server-side orderBy to bypass indexing requirements)
    const qScores = query(
        collection(db, "test_scores"), 
        where("studentId", "==", studentData.id),
        limit(20)
    );

    const unsubScores = onSnapshot(qScores, (snap) => {
        // Sort client-side to avoid "Query requires an index" error
        const scores = snap.docs
          .map(d => ({ id: d.id, ...(d.data() as any) }))
          .sort((a, b) => {
            const timeA = a.timestamp?.toMillis?.() || new Date(a.timestamp || 0).getTime();
            const timeB = b.timestamp?.toMillis?.() || new Date(b.timestamp || 0).getTime();
            return timeB - timeA; // Latest first
          });

        setRecentResults(scores);

        let a=0, b=0, c=0, d=0;
        scores.forEach((s: any) => {
           const pct = s.percentage || (s.score / s.maxScore * 100);
           if (pct >= 85) a++;
           else if (pct >= 70) b++;
           else if (pct >= 50) c++;
           else d++;
        });
        setStats({ aGrade: a, bGrade: b, cGrade: c, belowC: d, totalTaken: scores.length });
        setLoading(false);
    }, (err) => {
        console.error("Scores Sync Error:", err);
        setLoading(false);
    });

    return () => { unsubEnroll(); unsubScores(); };
  }, [studentData?.id, studentData?.classId]);

  const getSubjectIcon = (title: string = "") => {
     const t = title.toLowerCase();
     if (t.includes('sci')) return <FlaskConical className="w-5 h-5 text-amber-500" />;
     if (t.includes('math')) return <Calculator className="w-5 h-5 text-blue-500" />;
     if (t.includes('history')) return <History className="w-5 h-5 text-rose-500" />;
     if (t.includes('english') || t.includes('lang')) return <Book className="w-5 h-5 text-indigo-500" />;
     return <GraduationCap className="w-5 h-5 text-slate-500" />;
  };

  const getDayDiff = (dateStr: string) => {
     if (!dateStr) return 0;
     const diff = new Date(dateStr).getTime() - new Date().getTime();
     const days = Math.ceil(diff / (1000 * 3600 * 24));
     return days < 0 ? 0 : days;
  };

  const formatDate = (date: any) => {
     if (!date) return "--";
     const d = date.toDate ? date.toDate() : new Date(date);
     return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const nextTest = upcomingTests[0];

  return (
    <div className="animate-in fade-in duration-700 pb-24 text-left font-sans">
      
      {/* ── MASTER BANNER (UPCOMING HIGHLIGHT) ── */}
      <div className="bg-gradient-to-br from-[#1e3a8a] via-blue-700 to-indigo-900 rounded-[3.5rem] p-12 mb-12 text-white relative overflow-hidden shadow-2xl group">
         <div className="absolute top-0 right-0 p-12 opacity-10 group-hover:scale-110 transition-transform duration-1000">
            <Trophy className="w-60 h-60" />
         </div>
         <div className="flex flex-col md:flex-row items-center justify-between gap-10 relative z-10">
            <div className="flex items-center gap-10 text-center md:text-left flex-col md:flex-row">
               <div className="w-24 h-24 rounded-[2.5rem] bg-white/10 backdrop-blur-xl flex items-center justify-center border border-white/20 shadow-inner">
                  <Calendar className="w-10 h-10 text-blue-200" />
               </div>
               <div>
                  <p className="text-[11px] font-black uppercase tracking-[0.4em] mb-3 text-blue-200/60">Next Institutional Milestone</p>
                  <h2 className="text-4xl md:text-5xl font-black italic tracking-tighter mb-2 leading-none">
                     {nextTest?.testName || "No active milestones"}
                  </h2>
                  <p className="text-xl font-bold text-blue-100/80">
                     {nextTest?.date ? formatDate(nextTest.date) : "Academic Registry Clear"} • 09:00 AM
                  </p>
               </div>
            </div>
            <div className="text-center md:text-right flex flex-col items-center md:items-end">
               <div className="flex items-baseline gap-1">
                  <span className="text-7xl font-black italic tracking-tighter leading-none mb-1 text-white">
                     {nextTest ? getDayDiff(nextTest.date) : "0"}
                  </span>
                  <span className="text-xl font-black italic text-blue-300">D</span>
               </div>
               <p className="text-[10px] font-black uppercase tracking-widest text-blue-200/40 italic">Countdown Active</p>
            </div>
         </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 mb-12">
         
         {/* ── UPCOMING TESTS LIST ── */}
         <div className="bg-white rounded-[4rem] p-10 border border-slate-100 shadow-sm flex flex-col">
            <div className="flex items-center justify-between mb-10">
               <h3 className="text-2xl font-black text-slate-800 tracking-tight italic">Examination Queue</h3>
               <div className="w-10 h-10 rounded-2xl bg-slate-50 flex items-center justify-center text-slate-400 border border-slate-100"><Filter size={18} /></div>
            </div>
            <div className="space-y-4 flex-1">
               {loading ? <div className="py-20 flex justify-center"><Loader2 className="w-10 h-10 animate-spin text-indigo-500" /></div> : 
                upcomingTests.length === 0 ? (
                  <div className="py-20 text-center flex flex-col items-center">
                     <ShieldCheck className="w-16 h-16 text-slate-100 mb-4" />
                     <p className="text-sm font-bold text-slate-300 italic uppercase">All targets currently neutralized.</p>
                  </div>
                ) :
                upcomingTests.map((t, i) => (
                  <div key={i} className="flex items-center justify-between p-6 bg-slate-50/40 rounded-[2.5rem] border border-slate-50 hover:bg-white hover:shadow-2xl hover:scale-[1.02] transition-all cursor-pointer group">
                     <div className="flex items-center gap-6">
                        <div className="w-14 h-14 rounded-3xl bg-white shadow-sm flex items-center justify-center group-hover:bg-[#1e3a8a] group-hover:text-white transition-all transform group-hover:rotate-6">
                           {getSubjectIcon(t.testName || t.subject)}
                        </div>
                        <div>
                           <p className="text-lg font-black text-slate-800 tracking-tight leading-none mb-1">{t.testName}</p>
                           <div className="flex items-center gap-2">
                              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{formatDate(t.date)}</span>
                              <div className="w-1 h-1 rounded-full bg-slate-200" />
                              <span className="text-[10px] font-black text-indigo-500 uppercase tracking-widest">{t.subject || "General"}</span>
                           </div>
                        </div>
                     </div>
                     <div className="bg-white px-4 py-2 rounded-2xl shadow-sm border border-slate-50 text-[10px] font-black text-[#1e3a8a] uppercase tracking-widest">
                        T-{getDayDiff(t.date)} Days
                     </div>
                  </div>
                ))
               }
            </div>
         </div>

         {/* ── RECENT RESULTS LIST ── */}
         <div className="bg-white rounded-[4rem] p-10 border border-slate-100 shadow-sm flex flex-col">
            <div className="flex items-center justify-between mb-10">
               <h3 className="text-2xl font-black text-slate-800 tracking-tight italic">Scholastic Records</h3>
               <div className="w-10 h-10 rounded-2xl bg-slate-50 flex items-center justify-center text-slate-400 border border-slate-100"><BarChart3 size={18} /></div>
            </div>
            <div className="space-y-4 flex-1">
               {loading ? <div className="py-20 flex justify-center"><Loader2 className="w-10 h-10 animate-spin text-indigo-500" /></div> :
                recentResults.length === 0 ? (
                  <div className="py-20 text-center flex flex-col items-center">
                     <Target className="w-16 h-16 text-slate-100 mb-4" />
                     <p className="text-sm font-bold text-slate-300 italic uppercase">Awaiting graded assessments.</p>
                  </div>
                ) :
                recentResults.map((r, i) => {
                  const pct = r.percentage || (r.score / r.maxScore * 100);
                  const isHigh = pct >= 80;
                  return (
                    <div key={i} className="flex items-center justify-between p-6 bg-slate-50/40 rounded-[2.5rem] border border-slate-50 hover:bg-white hover:shadow-2xl hover:scale-[1.02] transition-all group">
                       <div className="flex items-center gap-6">
                          <div className={`w-14 h-14 rounded-3xl bg-white shadow-sm flex items-center justify-center transition-all transform group-hover:-rotate-6 ${isHigh ? 'text-emerald-500' : 'text-amber-500'}`}>
                             {getSubjectIcon(r.testName || r.subject)}
                          </div>
                          <div>
                             <p className="text-lg font-black text-slate-800 tracking-tight leading-none mb-1">{r.testName}</p>
                             <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                                Grade Decided • {formatDate(r.timestamp)}
                             </p>
                          </div>
                       </div>
                       <div className="text-right">
                          <p className={`text-2xl font-black italic tracking-tighter leading-none ${isHigh ? 'text-emerald-500' : 'text-slate-800'}`}>
                             {r.score}/{r.maxScore}
                          </p>
                          <p className={`text-[9px] font-black uppercase tracking-widest mt-1 ${isHigh ? 'text-emerald-500/60' : 'text-slate-400'}`}>
                             {Math.round(pct)}% Mastery
                          </p>
                       </div>
                    </div>
                  );
                })
               }
            </div>
         </div>
      </div>

      {/* ── PERFORMANCE SUMMARY GRID ── */}
      <div className="bg-slate-950 rounded-[4.5rem] p-12 text-white relative overflow-hidden shadow-2xl">
         <div className="absolute top-0 left-0 w-full h-full bg-[radial-gradient(circle_at_50%_50%,rgba(30,58,138,0.2),transparent)] pointer-events-none" />
         <div className="flex flex-col md:flex-row items-center justify-between mb-12 relative z-10 gap-6">
            <div>
               <h3 className="text-3xl font-black tracking-tighter italic mb-2">Term Aggregate Metrics</h3>
               <p className="text-slate-500 text-xs font-bold uppercase tracking-[0.2em]">Analyzing cognitive distribution across {stats.totalTaken} graded units</p>
            </div>
            <div className="bg-white/5 border border-white/10 px-8 py-4 rounded-3xl flex items-center gap-4">
               <TrendingUp className="text-emerald-500 w-5 h-5" />
               <span className="text-sm font-black uppercase tracking-widest">Steady Growth Detected</span>
            </div>
         </div>
         <div className="grid grid-cols-2 md:grid-cols-4 gap-8 relative z-10">
            {[
               { val: stats.aGrade, label: 'Elite (A)', color: 'text-emerald-400', bg: 'bg-emerald-400/10', border: 'border-emerald-400/20' },
               { val: stats.bGrade, label: 'Advancing (B)', color: 'text-blue-400', bg: 'bg-blue-400/10', border: 'border-blue-400/20' },
               { val: stats.cGrade, label: 'Competent (C)', color: 'text-amber-400', bg: 'bg-amber-400/10', border: 'border-amber-400/20' },
               { val: stats.belowC, label: 'Requires Support', color: 'text-rose-400', bg: 'bg-rose-400/10', border: 'border-rose-400/20' },
            ].map((g, i) => (
              <div key={i} className={`p-10 rounded-[3rem] ${g.bg} text-center flex flex-col items-center justify-center border ${g.border} group transition-all hover:bg-white/5 cursor-default`}>
                 <p className={`text-6xl font-black ${g.color} mb-4 italic tracking-tighter group-hover:scale-110 transition-transform`}>{g.val}</p>
                 <p className="text-[11px] font-black text-white/50 uppercase tracking-[0.2em]">{g.label}</p>
              </div>
            ))}
         </div>
      </div>
    </div>
  );
};

export default TestsPage;
