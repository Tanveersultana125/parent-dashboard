import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/AuthContext";
import { 
  CheckCircle, AlertCircle, Calendar, Star, ArrowUp, Clock, CheckSquare, 
  Sparkles, BrainCircuit, Rocket, Zap, MessageSquare, Loader2, Info, Layout, TrendingUp,
  User, ShieldCheck, Activity, Bell, GraduationCap, ChevronRight, MoreVertical
} from "lucide-react";
import { ParentAIController } from "../ai/controller/ai-controller";
import { db } from "@/lib/firebase";
import { collection, query, where, onSnapshot, getDocs, limit, orderBy, Timestamp } from "firebase/firestore";

const DashboardPage = () => {
  const { studentData, user } = useAuth();
  const navigate = useNavigate();
  const [isAnalyzing, setIsAnalyzing] = useState(true);
  const [aiInsights, setAiInsights] = useState<any>(null);
  const [liveStats, setLiveStats] = useState({
    attendance: "...",
    pending: 0,
    tests: 0,
    avgScore: "0%",
    recentGrade: "N/A",
    recentSubject: "General",
    scoreTrend: "improved" as "improved" | "declined" | "stable",
    trendPct: "5%"
  });
  const [recentEvents, setRecentEvents] = useState<any[]>([]);
  const [recentAlerts, setRecentAlerts] = useState<any[]>([]);
  const [teacherInfo, setTeacherInfo] = useState({ name: "...", id: "" });
  const [studentMeta, setStudentMeta] = useState({ className: "...", rollNo: "..." });
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  // ─── DATA SYNCHRONIZATION ───
  useEffect(() => {
    if (!studentData?.id) return;

    // 1. Live Attendance
    const qAtt = query(collection(db, "attendance"), where("studentId", "==", studentData.id));
    const unsubAtt = onSnapshot(qAtt, (snap) => {
        const records = snap.docs.map(d => d.data());
        const pCount = records.filter(r => r.status === 'present' || r.status === 'late').length;
        const total = records.length;
        setLiveStats(prev => ({ ...prev, attendance: total === 0 ? "100%" : `${Math.round((pCount/total)*100)}%` }));
    });

    // 2. Pending Tasks (Assignments & Submissions comparison)
    const qEnroll = query(collection(db, "enrollments"), where("studentId", "==", studentData.id));
    const unsubTasks = onSnapshot(qEnroll, async (enrollSnap) => {
        const classIds = enrollSnap.docs.map(d => d.data().classId).filter(id => !!id);
        
        // Update Teacher & Student Meta while we are here
        if (enrollSnap.docs.length > 0) {
            const first = enrollSnap.docs[0].data();
            setTeacherInfo({ name: first.teacherName || "Institutional Faculty", id: first.teacherId || "" });
            setStudentMeta({ 
              className: first.className || studentData?.grade || "Institutional Grade", 
              rollNo: first.rollNo || studentData?.rollNo || "000" 
            });
        }

        if (classIds.length > 0) {
            // Pending Assignments
            const qAssign = query(collection(db, "assignments"), where("classId", "in", classIds));
            const aSnap = await getDocs(qAssign);
            const assignments = aSnap.docs.map(d => d.id);
            
            const qSubs = query(collection(db, "submissions"), where("studentId", "==", studentData.id));
            const sSnap = await getDocs(qSubs);
            const submittedIds = new Set(sSnap.docs.map(d => d.data().assignmentId));
            
            const pending = assignments.filter(id => !submittedIds.has(id)).length;
            setLiveStats(prev => ({ ...prev, pending }));

            // Upcoming Tests (Next 7 days)
            const today = new Date().toISOString().split('T')[0];
            const nextWeek = new Date();
            nextWeek.setDate(nextWeek.getDate() + 7);
            const nextWeekStr = nextWeek.toISOString().split('T')[0];

            const qTests = query(
              collection(db, "tests_registry"), 
              where("classId", "in", classIds),
              where("date", ">=", today),
              where("date", "<=", nextWeekStr)
            );
            const tSnap = await getDocs(qTests);
            setLiveStats(prev => ({ ...prev, tests: tSnap.docs.length }));
        }
    });

    // 3. Performance Aggregation
    const qRes = query(collection(db, "results"), where("studentId", "==", studentData.id), orderBy("timestamp", "desc"));
    const unsubRes = onSnapshot(qRes, (snap) => {
        const results = snap.docs.map(d => d.data());
        if (results.length > 0) {
           const avg = results.reduce((acc, curr) => acc + (parseFloat(curr.score) || 0), 0) / results.length;
           const latest = results[0];
           
           const getGrade = (s: number) => s >= 90 ? "A+" : s >= 80 ? "A" : s >= 70 ? "A-" : s >= 60 ? "B" : "C";
           
           setLiveStats(prev => ({ 
             ...prev, 
             avgScore: `${Math.round(avg)}%`,
             recentGrade: getGrade(parseFloat(latest.score) || 0),
             recentSubject: latest.className || latest.subject || "Mathematics"
           }));
        }
        
        // Populate Recent Events Log
        const events = snap.docs.map(d => ({
           id: d.id,
           type: 'result',
           title: `Performance Logged: ${d.data().assignmentTitle || 'Assessment'}`,
           value: `${d.data().score}%`,
           time: d.data()?.timestamp?.toDate() || new Date(),
           color: 'text-emerald-500'
        }));
        setRecentEvents(events.slice(0, 5));
    });

    // 4. Recent Alerts (Risks)
    const qRisks = query(collection(db, "risks"), where("studentId", "==", studentData.id), orderBy("timestamp", "desc"), limit(2));
    const unsubRisks = onSnapshot(qRisks, (snap) => {
        let alerts = snap.docs.map(d => ({
            id: d.id,
            title: d.data().issue || "Standard Alert",
            time: d.data().timestamp?.toDate() || new Date(),
            type: d.data().severity === 'Critical' ? 'urgent' : 'normal'
        }));

        // ── Institutional Smart Diagnostics (Inject systemic alerts if triggers met) ──
        const pAtt = parseInt(liveStats.attendance.replace('%', ''));
        const pAvg = parseInt(liveStats.avgScore.replace('%', ''));

        if (pAtt < 80 && !alerts.find(a => a.id === 'sys_att')) {
           alerts = [{
              id: 'sys_att',
              title: `Critical Attendance Dropout: ${pAtt}%`,
              time: new Date(),
              type: 'urgent'
           }, ...alerts];
        } else if (pAvg < 60 && !alerts.find(a => a.id === 'sys_perf')) {
           alerts = [{
              id: 'sys_perf',
              title: `Academic Mastery Deficit: ${pAvg}%`,
              time: new Date(),
              type: 'urgent'
           }, ...alerts];
        }

        setRecentAlerts(alerts.slice(0, 2));
    });

    return () => {
      unsubAtt();
      unsubTasks();
      unsubRes();
      unsubRisks();
    };
  }, [studentData?.id]);

  // ─── AI INSIGHTS ENGINE ───
  useEffect(() => {
    if (!studentData?.id || liveStats.attendance === "...") return;

    const fetchAI = async () => {
      setIsAnalyzing(true);
      try {
        const context = {
          child_name: studentData.name,
          attendance: liveStats.attendance,
          avg_score: liveStats.avgScore,
          pending: liveStats.pending,
          grade: studentData.grade || "8"
        };
        const result = await ParentAIController.getDashboardInsights(context);
        if (result.status === "success") setAiInsights(result.data);
      } catch (e) {
        console.error("AI Sync Failure", e);
      } finally {
        setIsAnalyzing(false);
      }
    };
    fetchAI();
  }, [studentData?.id, liveStats.attendance, liveStats.pending]);

  if (studentData?.status === "Invited") return (
     <div className="h-[80vh] flex flex-col items-center justify-center p-10 text-center">
        <Rocket className="w-20 h-20 text-[#1e3a8a] animate-bounce mb-8" />
        <h1 className="text-4xl font-black text-slate-900 mb-4 tracking-tighter">Identity Matrix Detected</h1>
        <p className="text-lg font-bold text-slate-400 max-w-md mx-auto italic">Your institutional access is being provisioned. Please wait for the final synchronization cycle.</p>
        <div className="mt-10 flex gap-4 animate-pulse uppercase font-black text-[10px] text-slate-300 tracking-[0.3em]">
           <span>Encrypting</span> • <span>Syncing</span> • <span>Finalizing</span>
        </div>
     </div>
  );

  return (
    <div className="animate-in fade-in slide-in-from-bottom-10 duration-1000 pb-24 text-left font-sans">
      
      {/* ─── RESULT OF CLICK LABEL (As in screenshot) ─── */}
      <div className="flex justify-between items-center mb-8 px-4">
          <p className="text-[10px] font-black text-slate-900 uppercase tracking-[0.2em] opacity-80 italic">RESULT OF CLICK: "DASHBOARD"</p>
          <div className="flex items-center gap-4">
             <button className="w-10 h-10 rounded-full hover:bg-slate-50 flex items-center justify-center relative">
                <Bell className="w-5 h-5 text-slate-600"/>
                <div className="absolute top-2 right-2 w-2 h-2 bg-rose-500 rounded-full border-2 border-white" />
             </button>
             <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-[#1e3a8a] text-white flex items-center justify-center text-xs font-black">{user?.displayName?.substring(0,2).toUpperCase() || 'RS'}</div>
                <div className="text-left hidden sm:block">
                   <p className="text-[11px] font-black text-slate-900 leading-none mb-1">{user?.displayName || "Rahul Sharma"}</p>
                   <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest leading-none">Parent</p>
                </div>
             </div>
          </div>
      </div>

      {/* ─── WELCOME SECTION ─── */}
      <div className="mb-12 px-4">
         <h1 className="text-4xl font-black text-slate-900 tracking-tight leading-none mb-2">Good {currentTime.getHours() < 12 ? 'Morning' : currentTime.getHours() < 17 ? 'Afternoon' : 'Evening'}, {user?.displayName?.split(' ')[0] || "Rahul"}! 🖐️</h1>
         <p className="text-lg font-bold text-slate-400 italic">Here's how {studentData?.name?.split(' ')[0] || "Aditya"} is doing today</p>
      </div>

      {/* ─── MAIN CARDS GRID ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 px-2 mb-12">
         
         {/* ACADEMIC HEALTH CARD (Big Card) */}
         <div className="lg:col-span-12 bg-white border border-slate-100 rounded-[2.5rem] p-10 flex flex-col md:flex-row items-center justify-between shadow-sm hover:shadow-xl transition-all group overflow-hidden relative">
            <div className="absolute -top-10 -right-10 w-64 h-64 bg-slate-50 rounded-full blur-3xl opacity-50 group-hover:scale-125 transition-transform" />
            <div className="text-left relative z-10 w-full md:w-auto">
               <h3 className="text-2xl font-black text-slate-800 mb-2 tracking-tight">Academic Health</h3>
               <p className="text-sm font-bold text-slate-400 mb-8">Overall performance indicator</p>
               <div className="flex items-center gap-3 text-emerald-500 font-bold">
                  <ArrowUp className="w-5 h-5" /> 
                  <span className="text-base uppercase tracking-tighter">Improved by {liveStats.trendPct} from last month</span>
               </div>
            </div>
            
            <div className="flex items-center gap-8 mt-10 md:mt-0 relative z-10">
               <div className="text-right">
                  <h2 className="text-6xl font-black text-emerald-500 leading-none">{liveStats.avgScore}</h2>
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-2">{parseInt(liveStats.avgScore) >= 80 ? 'Good Standing' : 'Evaluation Pending'}</p>
               </div>
               <div className="w-24 h-24 rounded-full border-[10px] border-slate-100 border-t-emerald-500 rotate-[45deg] flex items-center justify-center relative">
                  <div className="absolute w-20 h-20 rounded-full border-2 border-slate-50" />
               </div>
            </div>
         </div>

         {/* 4 SMALL STAT CARDS */}
         <div className="lg:col-span-12 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">
            <StatSmallCard icon={CheckCircle} color="emerald" label="Attendance" value={liveStats.attendance} tag="On track" />
            <StatSmallCard icon={AlertCircle} color="amber" label="Pending Work" value={liveStats.pending.toString()} tag="Due this week" />
            <StatSmallCard icon={Calendar} color="indigo" label="Upcoming Tests" value={liveStats.tests.toString()} tag="Next 7 days" />
            <StatSmallCard icon={Star} color="emerald" label="Recent Grade" value={liveStats.recentGrade} tag={liveStats.recentSubject} />
         </div>

         {/* PROFILE SECTION & ALERTS */}
         <div className="lg:col-span-8">
            <div className="bg-white border border-slate-100 rounded-[2.5rem] p-10 flex flex-col md:flex-row items-center gap-12 shadow-sm relative overflow-hidden group">
               <div className="w-32 h-32 rounded-[2.5rem] bg-[#1e3a8a] flex items-center justify-center text-white text-4xl font-black italic shadow-2xl group-hover:rotate-6 transition-transform">
                  {studentData?.name?.[0] || 'A'}
               </div>
               <div className="flex-1 text-left">
                  <h2 className="text-4xl font-black text-slate-800 tracking-tighter mb-2 italic uppercase">{studentData?.name}</h2>
                  <p className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-10">Class: {studentMeta.className} • Roll: {studentMeta.rollNo}</p>
                  
                  <div className="grid grid-cols-2 gap-10">
                     <div className="space-y-1">
                        <p className="text-[10px] font-black text-slate-300 uppercase tracking-widest">Class Teacher</p>
                        <p className="text-base font-black text-slate-800">{teacherInfo.name}</p>
                     </div>
                     <div className="space-y-1">
                        <p className="text-[10px] font-black text-slate-300 uppercase tracking-widest">Academic Year</p>
                        <p className="text-base font-black text-slate-800 italic">2025-26</p>
                     </div>
                  </div>
               </div>
            </div>
         </div>

         <div className="lg:col-span-4">
            <div className="bg-white border border-slate-100 rounded-[2.5rem] p-10 h-full shadow-sm flex flex-col">
               <h3 className="text-xl font-black text-slate-800 mb-8 tracking-tight text-left">Recent Alerts</h3>
               <div className="space-y-4 flex-1">
                  {recentAlerts.length > 0 ? recentAlerts.map(alert => (
                    <div key={alert.id} className={`p-6 rounded-2xl border text-left ${alert.type === 'urgent' ? 'bg-amber-50 border-amber-100' : 'bg-emerald-50 border-emerald-100'}`}>
                       <div className="flex items-start gap-4">
                          <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${alert.type === 'urgent' ? 'bg-amber-500 text-white' : 'bg-emerald-500 text-white'}`}>
                             {alert.type === 'urgent' ? <Clock size={20}/> : <CheckCircle size={20}/>}
                          </div>
                          <div>
                             <p className="text-sm font-black text-slate-900 leading-tight mb-1">{alert.title}</p>
                             <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{alert.time.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})} • {alert.time.toLocaleDateString()}</p>
                          </div>
                       </div>
                    </div>
                  )) : (
                    <div className="flex-1 flex flex-col items-center justify-center opacity-20 py-10">
                       <ShieldCheck size={48} className="mb-4" />
                       <p className="text-[10px] font-black uppercase tracking-widest">No Alerts Flagged</p>
                    </div>
                  )}
               </div>
            </div>
         </div>

      </div>

      {/* ─── AI INSIGHTS NARRATIVE (Institutional Bottom) ─── */}
      <div className="px-2">
         <div className="bg-slate-900 rounded-[3rem] p-10 text-white relative overflow-hidden group hover:shadow-2xl hover:shadow-blue-900/20 transition-all">
            <div className="absolute top-0 right-0 p-10 opacity-5 scale-150 rotate-12 transition-transform duration-1000 group-hover:rotate-0">
               <BrainCircuit className="w-64 h-64 text-white" />
            </div>
            <div className="relative z-10">
               <div className="flex items-center gap-4 mb-8 bg-white/10 w-fit px-6 py-2.5 rounded-full border border-white/5">
                  <Sparkles className="w-5 h-5 text-amber-400" />
                  <span className="text-[10px] font-black uppercase tracking-[0.3em]">Institutional AI Synthesis</span>
               </div>
               <h2 className="text-3xl font-black text-left leading-[1.2] italic max-w-4xl tracking-tighter">
                  "{aiInsights?.child_summary_narrative || `${studentData?.name} is successfully fulfilling all institutional requirements. A detailed academic narrative will populate as soon as the next audit cycle is finalized.`}"
               </h2>
               <div className="mt-10 flex gap-10 border-t border-white/10 pt-8">
                  <div>
                     <p className="text-[9px] font-black text-blue-300 uppercase tracking-[0.2em] mb-2 leading-none">Status</p>
                     <p className="text-sm font-black text-white italic uppercase tracking-tighter">High Stability Matrix</p>
                  </div>
                  <div>
                     <p className="text-[9px] font-black text-blue-300 uppercase tracking-[0.2em] mb-2 leading-none">Peer Rank</p>
                     <p className="text-sm font-black text-white italic uppercase tracking-tighter">Upper Quartile</p>
                  </div>
               </div>
            </div>
         </div>
      </div>
    </div>
  );
};

const StatSmallCard = ({ icon: Icon, color, label, value, tag }: any) => {
   const colorClasses = {
      emerald: "bg-emerald-50 text-emerald-500 border-emerald-100",
      amber: "bg-amber-50 text-amber-500 border-amber-100",
      indigo: "bg-indigo-50 text-indigo-500 border-indigo-100",
      rose: "bg-rose-50 text-rose-500 border-rose-100",
   };
   
   const classes = colorClasses[color as keyof typeof colorClasses] || colorClasses.emerald;
   
   return (
      <div className="bg-white border border-slate-100 rounded-[2.5rem] p-8 shadow-sm flex flex-col items-start gap-6 hover:shadow-lg transition-all group">
         <div className={`w-12 h-12 rounded-2xl flex items-center justify-center border shadow-inner ${classes}`}>
            <Icon size={24} />
         </div>
         <div className="text-left w-full">
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">{label}</p>
            <h4 className="text-4xl font-black text-slate-800 leading-none mb-4">{value}</h4>
            <p className={`text-[11px] font-bold uppercase tracking-tighter italic ${color === 'amber' ? 'text-amber-500' : 'text-emerald-500'}`}>{tag}</p>
         </div>
      </div>
   );
};

const FileText = (props:any) => <CheckSquare {...props} />;

export default DashboardPage;
