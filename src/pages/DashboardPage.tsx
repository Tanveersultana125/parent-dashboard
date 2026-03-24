import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/AuthContext";
import { 
  CheckCircle, AlertCircle, Calendar, Star, ArrowUp, Clock, CheckSquare, 
  Sparkles, BrainCircuit, Rocket, Zap, MessageSquare, Loader2, Info, Layout, TrendingUp
} from "lucide-react";
import { ParentAIController } from "../ai/controller/ai-controller";
import { db } from "@/lib/firebase";
import { collection, query, where, onSnapshot, getDocs, Unsubscribe, limit, orderBy } from "firebase/firestore";

const DashboardPage = () => {
  const { studentData, user } = useAuth();
  const navigate = useNavigate();
  const [isAnalyzing, setIsAnalyzing] = useState(true);
  const [aiInsights, setAiInsights] = useState<any>(null);
  const [errorNotice, setErrorNotice] = useState<string | null>(null);
  const [liveStats, setLiveStats] = useState({
    attendance: "...",
    pending: 0,
    tests: 0,
    health: "85%"
  });
  const [touchpoints, setTouchpoints] = useState<any[]>([]);

  // Real-time synchronization for Attendance, Assignments & Touchpoints
  useEffect(() => {
    if (!studentData?.id) return;

    // 1. Live Attendance Sync
    const qAtt = query(collection(db, "attendance"), where("studentId", "==", studentData.id));
    const unsubAtt = onSnapshot(qAtt, (snap) => {
        const records = snap.docs.map(d => d.data());
        const pCount = records.filter(r => r.status === 'present' || r.status === 'late').length;
        const total = records.length;
        const pct = total === 0 ? "100%" : `${Math.round((pCount/total)*100)}%`;
        
        setLiveStats(prev => ({ ...prev, attendance: pct }));
    });

    // 2. Pending Assignments Count (Robust & Aggressive Sync)
    let unsubAssignInner: Unsubscribe | null = null;
    const qEnroll = query(collection(db, "enrollments"), where("studentId", "==", studentData.id));
    const unsubEnroll = onSnapshot(qEnroll, (enrollSnap) => {
        if (unsubAssignInner) unsubAssignInner();

        const classIds = enrollSnap.docs.map(d => d.data().classId).filter(id => !!id);
        const enrolledGrades = enrollSnap.docs.map(d => d.data().className).filter(g => !!g);
        const fallbackGrade = studentData.grade || studentData.class || "8";
        const gradeSearch = enrolledGrades.length > 0 ? enrolledGrades : [fallbackGrade];

        const assignmentsRef = collection(db, "assignments");
        let q;

        if (classIds.length > 0) {
            q = query(assignmentsRef, where("classId", "in", classIds));
        } else {
            q = query(assignmentsRef, where("grade", "in", gradeSearch));
        }

        unsubAssignInner = onSnapshot(q, (aSnap) => {
           let count = aSnap.docs.length;
           if (count === 0 && classIds.length > 0) {
              const fallbackQ = query(assignmentsRef, where("grade", "in", gradeSearch));
              getDocs(fallbackQ).then(fSnap => {
                 setLiveStats(prev => ({ ...prev, pending: fSnap.docs.length }));
              });
           } else {
              setLiveStats(prev => ({ ...prev, pending: count }));
           }
        });
    });

    // 3. Robust Touchpoints Sync (Submissions + Results)
    const qSub = query(collection(db, "submissions"), where("studentId", "==", studentData.id));
    const qRes = query(collection(db, "results"), where("studentId", "==", studentData.id));

    const unsubSub = onSnapshot(qSub, (subSnap) => {
        const subs = subSnap.docs.map(d => ({ 
            id: d.id, 
            type: "submission", 
            title: `Submitted ${d.data().fileName || "Homework"}`,
            time: d.data().timestamp?.toDate() || new Date(),
            rawTime: d.data().timestamp
        })).sort((a,b) => b.time - a.time);
        setTouchpoints(prev => {
           const nonSubs = prev.filter(p => p.type !== "submission");
           return [...subs, ...nonSubs].sort((a,b) => b.time - a.time).slice(0, 5);
        });
    });

    const unsubRes = onSnapshot(qRes, (resSnap) => {
        const results = resSnap.docs.map(d => ({ 
            id: d.id, 
            type: "result", 
            title: `Scored ${d.data().score}% in ${d.data().assignmentTitle || "Assessment"}`,
            time: d.data().timestamp?.toDate() || new Date(),
            rawTime: d.data().timestamp
        })).sort((a,b) => b.time - a.time);
        setTouchpoints(prev => {
            const nonResults = prev.filter(p => p.type !== "result");
            return [...results, ...nonResults].sort((a,b) => b.time - a.time).slice(0, 5);
        });
    });

    return () => {
        unsubAtt();
        unsubEnroll();
        if (unsubAssignInner) unsubAssignInner();
        unsubSub();
        unsubRes();
    };
  }, [studentData?.id, studentData?.grade, studentData?.class]);

  // AI Insight Trigger (Refetch when liveStats change to stay current)
  useEffect(() => {
    if (!studentData?.id || liveStats.attendance === "...") return;

    const fetchAIInsights = async () => {
      setIsAnalyzing(true);
      try {
        const context = {
          child_name: studentData.name || "Aditya",
          attendance: liveStats.attendance,
          academic_health: liveStats.health,
          recent_grade: "A-",
          pending_assignments: liveStats.pending,
          upcoming_tests: liveStats.tests,
          grade: studentData.grade || studentData.class || "8"
        };
        const result = await ParentAIController.getDashboardInsights(context);
        if (result.status === "success") {
          setAiInsights(result.data);
          setErrorNotice(null);
        } else {
          setErrorNotice(result.message);
        }
      } catch (err) {
        console.error("AI Insight error:", err);
      } finally {
        setIsAnalyzing(false);
      }
    };

    fetchAIInsights();
  }, [studentData?.id, liveStats.attendance, liveStats.pending]);

  const getTimeAgo = (date: Date) => {
    const diff = (new Date().getTime() - date.getTime()) / 1000;
    if (diff < 60) return "Just Now";
    if (diff < 3600) return `${Math.floor(diff/60)}M AGO`;
    if (diff < 86400) return `${Math.floor(diff/3600)}H AGO`;
    return `${Math.floor(diff/86400)}D AGO`;
  };

  return (
      <div className="space-y-6 pb-20 animate-in fade-in slide-in-from-bottom-6 duration-700 text-left">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
          <div>
            <h1 className="text-4xl font-black text-slate-900 tracking-tight leading-none mb-2">
              Welcome, {user?.displayName?.split(' ')[0] || "Parent"}! 👋
            </h1>
            <p className="text-slate-400 font-bold uppercase tracking-[0.25em] text-[11px] flex items-center gap-2">
               <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" /> Live Monitoring Enabled for {studentData?.name || "Aditya"}
            </p>
          </div>
          <div className="flex items-center gap-3">
             <div className="px-6 py-3 bg-white border border-slate-100 rounded-2xl shadow-sm flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-indigo-600 animate-bounce" />
                <span className="text-[10px] font-black text-indigo-700 uppercase tracking-widest whitespace-nowrap">Neural Engine Synced</span>
             </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 mt-4">
           <div className="lg:col-span-8 flex flex-col gap-8">
              <div className="bg-gradient-to-br from-[#1e3a8a] to-blue-900 rounded-[3rem] p-10 text-white shadow-2xl relative overflow-hidden group">
                 <div className="absolute top-0 right-0 w-80 h-80 bg-white/5 rounded-full blur-[100px] -mr-32 -mt-32 group-hover:scale-125 transition-transform duration-1000"></div>
                 <div className="relative z-10 text-left">
                    <div className="flex items-center gap-3 mb-6 bg-white/10 w-fit px-4 py-2 rounded-xl border border-white/5">
                       <Rocket className="w-5 h-5 text-blue-200" />
                       <span className="text-[10px] font-black uppercase tracking-[0.2em] text-blue-100">AI Predictive Summary</span>
                    </div>
                    {isAnalyzing ? (
                       <div className="flex items-center gap-4 py-2">
                          <Loader2 className="w-8 h-8 animate-spin text-white opacity-40" />
                          <h2 className="text-2xl font-black opacity-50 italic">Compiling scholarly trajectory...</h2>
                       </div>
                    ) : aiInsights ? (
                       <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-10">
                             <h2 className="text-3xl font-black leading-tight drop-shadow-xl flex-1 italic">
                                "{aiInsights.child_summary_narrative}"
                             </h2>
                             <button onClick={() => navigate('/performance')} className="shrink-0 px-10 py-5 bg-white text-[#1e3a8a] rounded-[2rem] text-[11px] font-black uppercase tracking-widest hover:scale-105 transition-all flex items-center justify-center gap-3 shadow-2xl active:scale-95">
                                Analyze Matrix <ArrowUp className="w-5 h-5 rotate-45" />
                             </button>
                       </div>
                    ) : (
                       <h2 className="text-xl font-bold opacity-80 italic leading-relaxed">
                          "{studentData?.name || "The student"} is successfully enrolled. We are currently processing synchronization logs for this week's narrative."
                       </h2>
                    )}
                 </div>
              </div>

              <div className="bg-white border border-slate-50 rounded-[3.5rem] p-10 shadow-sm flex flex-col xl:flex-row gap-10 hover:shadow-xl transition-all border-l-8 border-l-[#1e3a8a]">
                 <div className="xl:w-1/2 text-left">
                    <div className="flex items-center justify-between mb-8">
                        <div className="flex items-center gap-4">
                           <div className="w-14 h-14 rounded-2xl bg-emerald-50 flex items-center justify-center text-emerald-600 shadow-inner">
                              <CheckCircle className="w-8 h-8" />
                           </div>
                           <h3 className="text-sm font-black text-slate-800 uppercase tracking-widest leading-none">Weekly Success</h3>
                        </div>
                        <button onClick={() => navigate('/attendance')} className="w-10 h-10 rounded-full bg-slate-50 flex items-center justify-center text-slate-300 hover:bg-emerald-50 hover:text-emerald-500 transition-all">
                           <ArrowUp className="w-5 h-5 rotate-45" />
                        </button>
                     </div>
                    <div className="space-y-4">
                       {isAnalyzing ? (
                          [1,2].map(i => <div key={i} className="h-16 bg-slate-50 rounded-3xl animate-pulse" />)
                       ) : aiInsights?.weekly_digest?.highlights?.length > 0 ? (
                             aiInsights.weekly_digest.highlights.map((h: string, i: number) => (
                                <div key={i} className="flex gap-4 p-5 bg-slate-50 rounded-[2rem] border border-slate-100 group hover:bg-white hover:border-emerald-100 transition-all">
                                   <Zap className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5 group-hover:scale-125 transition-transform" />
                                   <p className="text-sm font-bold text-slate-700 leading-snug">{h}</p>
                                </div>
                             ))
                       ) : (
                         <div className="p-10 text-center bg-slate-50/50 rounded-[2.5rem] border-2 border-dashed border-slate-100">
                             <p className="text-[10px] font-black text-slate-300 uppercase tracking-widest leading-relaxed italic">Highlights populate after faculty sync.</p>
                         </div>
                       )}
                    </div>
                 </div>

                 <div className="xl:w-1/2 flex flex-col text-left">
                    <div className="flex items-center justify-between mb-8">
                        <div className="flex items-center gap-4">
                           <div className="w-14 h-14 rounded-2xl bg-indigo-50 flex items-center justify-center text-indigo-600 shadow-inner">
                              <MessageSquare className="w-8 h-8" />
                           </div>
                           <h3 className="text-sm font-black text-slate-800 uppercase tracking-widest">Institutional Note</h3>
                        </div>
                        <button onClick={() => navigate('/teacher-notes')} className="w-10 h-10 rounded-full bg-slate-50 flex items-center justify-center text-slate-300 hover:bg-indigo-50 hover:text-indigo-500 transition-all">
                           <ArrowUp className="w-5 h-5 rotate-45" />
                        </button>
                     </div>
                    <div className="bg-slate-50 p-8 rounded-[2.5rem] flex-1 min-h-[160px] relative overflow-hidden group">
                       <p className="text-base font-bold text-slate-500 leading-relaxed italic border-l-4 border-indigo-400 pl-8 relative z-10 transition-colors group-hover:text-slate-700">
                          {aiInsights?.weekly_digest?.summary || "Direct observations and qualitative analysis from the faculty subdivision will appear here upon completion of the weekly audit."}
                       </p>
                    </div>
                 </div>
              </div>
           </div>

           <div className="lg:col-span-4 flex flex-col">
              <div className="bg-white border border-slate-50 rounded-[3.5rem] p-10 shadow-sm h-full flex flex-col hover:border-indigo-100 transition-all text-left">
                 <div className="flex items-center gap-4 mb-10">
                    <div className="w-14 h-14 rounded-2xl bg-amber-50 flex items-center justify-center text-amber-600 shadow-inner">
                       <BrainCircuit className="w-8 h-8" />
                    </div>
                    <h3 className="text-sm font-black text-slate-800 uppercase tracking-widest leading-none">Parental Intelligence</h3>
                 </div>
                 
                 <div className="space-y-6 flex-1">
                    {isAnalyzing ? (
                       [1,2,3].map(i => <div key={i} className="h-32 bg-slate-50 rounded-[2.5rem] animate-pulse" />)
                    ) : aiInsights?.parenting_tips?.map((tip: any, i: number) => (
                       <div key={i} className="bg-white p-6 rounded-[2.5rem] border border-slate-100 shadow-sm group hover:border-amber-100 hover:shadow-xl transition-all">
                          <div className="flex items-center gap-2 mb-3">
                             <Star className="w-3 h-3 text-amber-500 fill-amber-500 group-hover:scale-125 transition-all" />
                             <h4 className="text-[10px] font-black text-slate-300 uppercase tracking-widest">Growth Vector</h4>
                          </div>
                          <p className="text-sm font-black text-slate-800 leading-tight mb-2 uppercase tracking-tight">{tip.tip}</p>
                          <p className="text-[11px] font-bold text-slate-400 italic leading-snug">{tip.reason}</p>
                       </div>
                    ))}
                    {!isAnalyzing && !aiInsights?.parenting_tips && (
                       <div className="text-center py-20 flex flex-col items-center">
                          <Info className="w-14 h-14 text-slate-100 mb-4" />
                          <p className="text-[11px] font-black text-slate-300 uppercase tracking-widest italic opacity-60">Tips unlock after behavioral sync.</p>
                       </div>
                    )}
                 </div>

                 <button className="mt-10 w-full py-5 bg-slate-900 text-white rounded-[2rem] text-[11px] font-black uppercase tracking-[0.2em] hover:bg-[#1e3a8a] hover:-translate-y-1 transition-all shadow-2xl">
                    Comprehensive Strategy
                 </button>
              </div>
           </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mt-8">
          <StatCard icon={<CheckCircle className="w-6 h-6 text-emerald-500" />} color="emerald" label="Attendance" value={liveStats.attendance} sub="Presence Record" />
          <StatCard icon={<AlertCircle className="w-6 h-6 text-amber-500" />} color="amber" label="Active Tasks" value={liveStats.pending.toString()} sub="Coursework" />
          <StatCard icon={<Calendar className="w-6 h-6 text-blue-500" />} color="blue" label="Upcoming" value={liveStats.tests.toString()} sub="Benchmarks" />
          <StatCard icon={<Star className="w-6 h-6 text-indigo-500" />} color="indigo" label="Academic" value={liveStats.health} sub="Global Metric" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">
          <div className="lg:col-span-3 bg-white border border-slate-50 rounded-[3.5rem] p-10 shadow-sm text-left">
            <div className="flex items-center gap-8 mb-10 border-b border-slate-50 pb-10">
              <div className="w-24 h-24 rounded-[2.5rem] bg-slate-900 flex items-center justify-center text-white font-black text-4xl shadow-2xl shadow-slate-300 relative overflow-hidden group">
                <div className="absolute inset-0 bg-blue-600 translate-y-full group-hover:translate-y-0 transition-transform duration-500"></div>
                <span className="relative z-10">{studentData?.name?.[0] || "S"}</span>
              </div>
              <div className="text-left">
                <h3 className="text-3xl font-black text-slate-900 tracking-tight mb-2">{studentData?.name || "Aditya Verma"}</h3>
                <div className="flex flex-wrap gap-3">
                   <span className="px-4 py-1.5 bg-slate-50 text-slate-400 text-[10px] font-black uppercase tracking-[0.2em] rounded-xl border border-slate-100 shadow-sm">Grade {studentData?.grade || "8"} • Sec A</span>
                   <span className="px-4 py-1.5 bg-indigo-50 text-indigo-500 text-[10px] font-black uppercase tracking-[0.2em] rounded-xl border border-indigo-100 shadow-sm tracking-tighter">Scholastic ID: {studentData?.rollNo || "001"}</span>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-10">
               <div>
                  <p className="text-[10px] font-black text-slate-300 uppercase tracking-widest mb-2">Legal Guardian</p>
                  <p className="text-base font-black text-slate-800">{user?.displayName || "Authorized User"}</p>
               </div>
               <div>
                  <p className="text-[10px] font-black text-slate-300 uppercase tracking-widest mb-2">Academic Session</p>
                  <p className="text-base font-black text-slate-800 italic tracking-tighter">2025-2026 Audit Period</p>
               </div>
            </div>
          </div>

          <div className="lg:col-span-2 bg-[#1e3a8a] rounded-[3.5rem] p-10 shadow-2xl flex flex-col relative overflow-hidden group text-left">
            <div className="absolute -top-10 -right-10 w-40 h-40 bg-white/5 rounded-full blur-3xl group-hover:scale-110 transition-transform duration-700"></div>
            <div className="flex items-center justify-between mb-10">
               <h3 className="text-base font-black text-white leading-none uppercase tracking-[0.2em]">Institutional Event Log</h3>
               <span className="px-3 py-1 bg-white/10 text-white text-[9px] font-black uppercase tracking-widest rounded-lg border border-white/10 shadow-lg">Live</span>
            </div>
            
            <div className="flex-1 space-y-4 pt-4 overflow-y-auto max-h-[300px] custom-scrollbar">
                {touchpoints.length === 0 ? (
                  <div className="flex-1 flex flex-col items-center justify-center text-center p-10 border border-white/5 bg-white/5 rounded-[2.5rem]">
                      <Info className="w-12 h-12 text-blue-200 opacity-20 mb-6 animate-pulse" />
                      <p className="text-[11px] font-black text-blue-100/40 uppercase tracking-[0.3em] leading-relaxed">Intelligence alerts will populate automatically after institutional sync.</p>
                  </div>
                ) : (
                  touchpoints.map((t) => (
                    <div key={t.id} className="p-5 bg-white/5 border border-white/10 rounded-3xl group hover:bg-white/10 transition-all">
                       <div className="flex items-center gap-4">
                          <div className={`w-10 h-10 rounded-2xl flex items-center justify-center ${t.type === 'result' ? 'bg-emerald-400/20 text-emerald-400' : 'bg-blue-400/20 text-blue-400'}`}>
                             {t.type === 'result' ? <TrendingUp className="w-5 h-5"/> : <CheckCircle className="w-5 h-5"/>}
                          </div>
                          <div className="text-left flex-1 min-w-0">
                             <p className="text-[13px] font-black text-white leading-tight truncate">{t.title}</p>
                             <p className="text-[9px] font-black text-blue-300 uppercase tracking-widest mt-1 opacity-60">{getTimeAgo(t.time)}</p>
                          </div>
                       </div>
                    </div>
                  ))
                )}
            </div>
          </div>
        </div>
      </div>
  );
};

const StatCard = ({ icon, color, label, value, sub }: any) => (
  <div className={`bg-white border border-slate-100 rounded-[2.5rem] p-8 shadow-sm hover:translate-y-[-4px] hover:shadow-2xl hover:border-${color}-100 transition-all group text-left`}>
    <div className="flex items-center gap-6 mb-8">
      <div className={`w-14 h-14 rounded-2xl bg-${color}-50 flex items-center justify-center shadow-inner group-hover:bg-${color}-500 transition-colors`}>
        <div className={`text-${color}-600 group-hover:text-white transition-colors`}>{icon}</div>
      </div>
      <div className="text-left">
        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">{label}</p>
        <p className="text-3xl font-black text-slate-900 tracking-tighter leading-none">{value}</p>
      </div>
    </div>
    <div className={`px-4 py-2 rounded-xl bg-${color}-50/50 border border-${color}-100/50 w-fit`}>
       <p className={`text-[10px] font-black uppercase tracking-widest text-${color}-600`}>{sub}</p>
    </div>
  </div>
);

export default DashboardPage;
