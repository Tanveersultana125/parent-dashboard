 import { useState, useEffect } from "react";
import { 
  AlertCircle, Clock, Trophy, Calendar, CheckCircle, User, Sparkles, Brain, 
  ArrowRight, Loader2, Info, BellRing, ChevronRight, XCircle, Eye, ShieldAlert, Star,
  AlertTriangle, BookOpen, HandHeart, Lightbulb
} from "lucide-react";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { useNavigate } from "react-router-dom";
import { ParentAIController } from "../ai/controller/ai-controller";
import { useAuth } from "@/lib/AuthContext";
import { db } from "@/lib/firebase";
import { collection, query, where, onSnapshot, orderBy, getDocs, addDoc, deleteDoc, serverTimestamp, doc, updateDoc } from "firebase/firestore";
import { toast } from "sonner";

const filterTabs = ["All", "Academic", "Attendance", "Behavior"];

const AlertsPage = () => {
  const { studentData } = useAuth();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState(0);
  const [analyzingId, setAnalyzingId] = useState<string | null>(null);
  const [aiStories, setAiStories] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [alerts, setAlerts] = useState<any[]>([]);

  useEffect(() => {
    if (!studentData?.id) return;

    setLoading(true);
    const qSmart = query(collection(db, "student_smart_alerts"), where("studentId", "==", studentData.id));
    const qDirect = query(collection(db, "attendance"), where("studentId", "==", studentData.id));

    const unsubSmart = onSnapshot(qSmart, (snap) => {
       const smart = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
       setAlerts(prev => {
          const direct = prev.filter(p => (p as any).isSystem);
          return [...direct, ...smart];
       });
       setLoading(false);
    });

    const unsubDirect = onSnapshot(qDirect, (snap) => {
       const direct = snap.docs.map(doc => ({ id: doc.id, ...doc.data(), isSystem: true, type: 'attendance' }));
       setAlerts(prev => {
          const others = prev.filter(p => !(p as any).isSystem || (p as any).type !== 'attendance');
          return [...others, ...direct];
       });
       setLoading(false);
    });

    const qEnroll = query(collection(db, "enrollments"), where("studentId", "==", studentData.id));
    const unsubEnroll = onSnapshot(qEnroll, (snap) => {
       const enrollData = snap.docs.map(doc => ({ id: doc.id, ...doc.data(), isSystem: true, type: 'rating' }));
       setAlerts(prev => {
          const others = prev.filter(p => !(p as any).isSystem || (p as any).type !== 'rating');
          return [...others, ...enrollData];
       });
       setLoading(false);
    });

    const qScores = query(collection(db, "test_scores"), where("studentId", "==", studentData.id));
    const unsubScores = onSnapshot(qScores, (snap) => {
       const scores = snap.docs.map(doc => ({ id: doc.id, ...doc.data(), isSystem: true, type: 'academic' }));
       setAlerts(prev => {
          const others = prev.filter(p => !(p as any).isSystem || (p as any).type !== 'academic');
          return [...others, ...scores];
       });
       setLoading(false);
    });

    const qNotes = query(collection(db, "parent_notes"), where("studentId", "==", studentData.id));
    const unsubNotes = onSnapshot(qNotes, (snap) => {
       const bNotes = snap.docs.map(doc => ({ id: doc.id, ...doc.data(), isSystem: true, type: 'behaviour' }));
       setAlerts(prev => {
          const others = prev.filter(p => !(p as any).isSystem || (p as any).type !== 'behaviour');
          return [...others, ...bNotes];
       });
       setLoading(false);
    });

    const runPulse = async () => {
       const lastPulse = localStorage.getItem(`last_pulse_${studentData.id}`);
       const now = Date.now();
       if (!lastPulse || (now - parseInt(lastPulse) > 1000 * 60 * 60 * 1)) {
          generateAIAlerts();
       }
    };
    runPulse();

    return () => {
       unsubSmart();
       unsubDirect();
       unsubScores();
       unsubNotes();
       unsubEnroll();
    };
  }, [studentData?.id]);

  const markAsRead = async (id: string) => {
      try {
         await updateDoc(doc(db, "student_smart_alerts", id), {
            resolved: true
         });
         toast.success("Notification acknowledged.");
      } catch (e) {
         toast.error("Process failed.");
      }
   };

  const generateAIAlerts = async () => {
      if (!studentData?.id) return;
      setIsRefreshing(true);
      try {
         const studentId = studentData.id;
         const scoresSnap = await getDocs(query(collection(db, "test_scores"), where("studentId", "==", studentId)));
         const attndSnap = await getDocs(query(collection(db, "attendance"), where("studentId", "==", studentId)));
         const notesSnap = await getDocs(query(collection(db, "parent_notes"), where("studentId", "==", studentId)));
         const enrollSnap = await getDocs(query(collection(db, "enrollments"), where("studentId", "==", studentId)));
         
         const scoresData = scoresSnap.docs.map(d => ({...d.data() as any}));
         const context = {
            student_name: studentData.name,
            overall_grade: studentData.avgScorePct || "N/A",
            behaviour_rating: enrollSnap.docs[0]?.data()?.manualBehaviourRating || 5,
            test_performance: scoresData.map(d => ({ test: d.testName, percentage: d.percentage, subject: d.subject })).slice(-10),
            absent_dates: attndSnap.docs.filter(d => (d.data().status || "").toLowerCase() === "absent").map(d => d.data().date).slice(-8),
            teacher_notes: notesSnap.docs.map(d => ({ category: d.data().category, content: d.data().content })).slice(-5),
            attendance_summary: {
               present: attndSnap.docs.filter(d => (d.data().status || "").toLowerCase() === "present").length,
               absent: attndSnap.docs.filter(d => (d.data().status || "").toLowerCase() === "absent").length,
               late: attndSnap.docs.filter(d => (d.data().status || "").toLowerCase() === "late").length,
               percentage: attndSnap.docs.length > 0 
                  ? Math.round((attndSnap.docs.filter(d => (d.data().status || "").toLowerCase() === "present").length / attndSnap.docs.length) * 100) 
                  : 100
            }
         };

         const result = await ParentAIController.generateLiveAlerts(context);
         if (result.status === "success" && result.source !== "cache") {
            const existing = await getDocs(query(collection(db, "student_smart_alerts"), where("studentId", "==", studentData.id), where("resolved", "==", false)));
            for (const d of existing.docs) await deleteDoc(doc(db, "student_smart_alerts", d.id));
            for (const alert of result.data) {
               await addDoc(collection(db, "student_smart_alerts"), {
                  ...alert,
                  studentId: studentData.id,
                  createdAt: serverTimestamp(),
                  resolved: false
               });
            }
            localStorage.setItem(`last_pulse_${studentData.id}`, Date.now().toString());
            toast.success("AI Brain Sync Complete!");
         }
      } catch (e) {
         toast.error("AI Sync Delayed.");
      } finally {
         setIsRefreshing(false);
      }
   };

  const allMergedAlerts = (() => {
    const fallbackTeacher = alerts.find(a => a.studentId === studentData?.id && !a.isSystem)?.teacherName || "Jamaal Bhai";
    const behaviorRating = alerts.find(a => a.manualBehaviourRating !== undefined)?.manualBehaviourRating;

    const directAttendanceAlerts = alerts
      .filter(a => (a.status || "").toLowerCase() === "absent" && a.isSystem && (a as any).type === 'attendance')
      .map(att => ({
        id: `sys_${att.id}`,
        title: "Absence Recorded",
        description: `${studentData?.name || 'Student'} was marked as absent on ${att.date || 'a recent date'}.`,
        category: "Attendance",
        priority: "Critical",
        icon: "Clock",
        createdAt: att.timestamp || att.createdAt,
        teacherName: att.teacherName || fallbackTeacher,
        resolved: att.resolved || false,
        isSystem: true
      }));

    const directAcademicAlerts = alerts
      .filter(a => (a as any).type === 'academic' && a.isSystem)
      .map(score => {
        const pct = score.percentage || 0;
        let priority = "Normal", title = "Result Published", color = "indigo", icon = "Target";
        if (pct >= 85) { priority = "Good News"; title = "Academic Excellence"; color = "emerald"; icon = "Trophy"; }
        else if (pct < 60) { priority = "Critical"; title = "Academic Intervention"; color = "rose"; icon = "AlertCircle"; }
        return {
          id: `sys_score_${score.id}`,
          title, description: `${studentData?.name || 'Student'} achieved ${pct}% in ${score.subject || 'a subject'}.`,
          category: "Academic", priority, icon, color,
          createdAt: score.timestamp || score.createdAt,
          teacherName: score.teacherName || fallbackTeacher,
          resolved: false, isSystem: true
        };
      });

    const directBehaviorAlerts = alerts
      .filter(a => (a as any).type === 'behaviour' && a.isSystem)
      .map(note => {
        const isPositive = (note.category || "").toLowerCase().includes("positive") || (note.category || "").toLowerCase().includes("praise");
        return {
          id: `sys_note_${note.id}`,
          title: isPositive ? "Positive Conduct Observed" : "Behavioral Review Required",
          description: `${studentData?.name || 'Student'}: ${note.content}`,
          category: "Behavior",
          priority: isPositive ? "Good News" : "Critical",
          icon: isPositive ? "Star" : "AlertCircle",
          color: isPositive ? "emerald" : "rose",
          createdAt: note.timestamp || note.createdAt,
          teacherName: note.teacherName || fallbackTeacher,
          resolved: false, isSystem: true, manualBehaviourRating: behaviorRating
        };
      });

    const ratingAlerts = [];
    if (behaviorRating !== undefined && behaviorRating < 3.0) {
      const improvements = alerts
        .filter(a => (a as any).type === 'behaviour' && !((a.category || "").toLowerCase().includes("positive")))
        .map(n => n.content).slice(0, 2).join(", ");
      ratingAlerts.push({
        id: `sys_rating_critical`, title: "Critical Behavioral Review",
        description: `${studentData?.name || 'Student'}'s behavior rating is currently ${behaviorRating}/5. Areas of Improvement: ${improvements || 'General Conduct'}.`,
        category: "Behavior", priority: "Critical", icon: "ShieldAlert", color: "rose",
        createdAt: serverTimestamp(), teacherName: fallbackTeacher, resolved: false, isSystem: true,
        needs_attention: "Discipline & Conduct", manualBehaviourRating: behaviorRating
      });
    }

    const smartAlerts = alerts
      .filter(a => a.studentId === studentData?.id && !a.isSystem && !a.date)
      .map(a => ({ ...a, teacherName: a.teacherName || fallbackTeacher, manualBehaviourRating: behaviorRating }));

    return [...directAttendanceAlerts, ...directAcademicAlerts, ...directBehaviorAlerts, ...ratingAlerts, ...smartAlerts];
  })();

  const getTrendData = () => {
    const rawNotes = alerts.filter(a => a.type === 'behaviour');
    const months: any = {};
    const now = new Date();
    
    // ── Precise Enrollment Start Date ──
    let startDate = new Date(now.getFullYear(), now.getMonth() - 4, 1);
    const rawJoinDate = studentData?.enrolledAt || studentData?.createdAt;
    if (rawJoinDate) {
       const jDate = rawJoinDate.toDate ? rawJoinDate.toDate() : new Date(rawJoinDate);
       startDate = new Date(jDate.getFullYear(), jDate.getMonth(), 1);
       // Optimization: Use a 6-month window for maximum dashboard clarity
       const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);
       if (startDate < sixMonthsAgo) startDate = sixMonthsAgo;
    }
    
    let tempDate = new Date(startDate);
    while (tempDate <= now) {
       const mName = tempDate.toLocaleString('default', { month: 'short' });
       const mYear = tempDate.getFullYear().toString().slice(-2);
       const key = `${mName} ${mYear}`;
       months[key] = { m: mName, key, pos: 0, improv: 0, count: 0, date: new Date(tempDate) };
       tempDate.setMonth(tempDate.getMonth() + 1);
    }
    rawNotes.forEach(n => {
      const date = n.createdAt?.toDate ? n.createdAt.toDate() : new Date();
      const mName = date.toLocaleString('default', { month: 'short' });
      const mYear = date.getFullYear().toString().slice(-2);
      const key = `${mName} ${mYear}`;
      if (months[key]) {
        const isPositive = (n.category || "").toLowerCase().includes("positive");
        if (isPositive) months[key].pos++; else months[key].improv++;
        months[key].count++;
      }
    });
    const behaviorRating = alerts.find(a => a.manualBehaviourRating !== undefined)?.manualBehaviourRating;
    return Object.values(months).map((data: any) => {
       const isCurrentMonth = data.m === now.toLocaleString('default', { month: 'short' }) && data.date?.getFullYear() === now.getFullYear();
       const calculatedScore = data.count === 0 ? 5.0 : Math.min(5.0, Math.max(1.0, 5.0 - (data.improv * 0.3) + (data.pos * 0.1)));
       return { m: data.m, key: data.key, score: isCurrentMonth && behaviorRating !== undefined ? behaviorRating : calculatedScore };
    });
  };

  const trendData = getTrendData();
  const filteredAlerts = allMergedAlerts
    .filter(a => {
      if (a.resolved) return false;
      if (filterTabs[activeTab] === "All") return true;
      return a.category === filterTabs[activeTab];
    })
    .sort((a,b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));

  const getPriorityColor = (p: string) => {
     if (p === 'Critical' || p === 'High Priority' || p === 'Urgent') return 'bg-rose-500';
     if (p === 'Normal' || p === 'Medium Priority') return 'bg-amber-400';
     if (p === 'Good News') return 'bg-emerald-500';
     return 'bg-indigo-500';
  };

  const getTagColor = (p: string) => {
     if (p === 'Critical' || p === 'High Priority' || p === 'Urgent') return 'bg-rose-50 text-rose-600 border-rose-100';
     if (p === 'Normal' || p === 'Medium Priority') return 'bg-amber-50 text-amber-600 border-amber-100';
     if (p === 'Good News') return 'bg-emerald-50 text-emerald-600 border-emerald-100';
     return 'bg-blue-50 text-blue-600 border-blue-100';
  };

  return (
    <div className="space-y-10 animate-in fade-in duration-700 pb-20 font-sans text-left bg-slate-50/30 p-4 md:p-8 rounded-[3rem]">
      <div className="flex flex-col gap-8">
        <div className="flex items-center justify-between">
           <div>
              <h1 className="text-4xl font-black text-slate-800 tracking-tighter italic uppercase underline decoration-indigo-200 decoration-8 underline-offset-8">Notification Hub</h1>
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.4em] mt-3 ml-1 italic leading-none">Automated Institutional Intelligence Stream</p>
           </div>
           <button onClick={generateAIAlerts} disabled={isRefreshing} className="bg-white border border-slate-200 px-6 py-3 rounded-2xl text-[10px] font-black text-indigo-600 uppercase tracking-widest hover:shadow-md transition-all flex items-center gap-3 disabled:opacity-50">
             {isRefreshing ? <Loader2 className="w-4 h-4 animate-spin"/> : <Sparkles className="w-4 h-4"/>} Regenerate Intelligence
           </button>
        </div>
        <div className="flex flex-wrap gap-4 bg-white/50 p-2 rounded-[2rem] border border-slate-100 w-fit">
          {filterTabs.map((tab, i) => (
            <button key={tab} onClick={() => setActiveTab(i)} className={`px-8 py-3.5 rounded-[1.5rem] font-black uppercase tracking-[0.2em] transition-all text-[10px] ${i === activeTab ? "bg-[#1e3a8a] text-white shadow-xl shadow-blue-900/10" : "text-slate-500 hover:bg-white"}`}>
              {tab} ({tab === 'All' ? allMergedAlerts.filter(a => !a.resolved).length : allMergedAlerts.filter(a => a.category === tab && !a.resolved).length})
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-6">
        {loading ? (
            <div className="py-40 text-center flex flex-col items-center justify-center">
              <Loader2 className="w-12 h-12 text-indigo-600 animate-spin mb-4" />
              <p className="text-[11px] font-black text-slate-400 uppercase tracking-widest italic">Decrypting Secure Alerts...</p>
            </div>
        ) : filteredAlerts.length === 0 ? (
            <div className="py-40 bg-white border-2 border-slate-50 rounded-[4rem] text-center flex flex-col items-center">
              <BellRing className="w-10 h-10 text-slate-200 mb-6" />
              <h3 className="text-2xl font-black text-slate-800 tracking-tight mb-2 italic">Hub Status: Clear</h3>
              <p className="text-sm font-bold text-slate-400 uppercase tracking-widest">No active interventions required.</p>
            </div>
        ) : (
          <>
            {filterTabs[activeTab] === "Behavior" && (
               <div className="space-y-6 mb-10 overflow-hidden animate-in slide-in-from-top-4 duration-500">
                  <div className="bg-white border-2 border-slate-50 rounded-[3rem] p-10 shadow-sm">
                     <div className="flex items-center justify-between mb-10">
                        <div>
                           <h2 className="text-2xl font-black text-slate-800 tracking-tight italic">Behavior Trend</h2>
                           <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-2 italic leading-none whitespace-nowrap">Monthly Accountability Projection</p>
                        </div>
                        <Brain className="w-6 h-6 text-indigo-600" />
                     </div>
                     <div className="h-[200px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                           <AreaChart data={trendData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                              <defs><linearGradient id="colorScoreAlerts" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#10b981" stopOpacity={0.2}/><stop offset="95%" stopColor="#10b981" stopOpacity={0}/></linearGradient></defs>
                              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                              <XAxis dataKey="m" axisLine={false} tickLine={false} tick={{ fontSize: 13, fontWeight: 900, fill: '#cbd5e1' }} dy={10} />
                              <YAxis domain={[1, 5]} axisLine={false} tickLine={false} tick={{ fontSize: 13, fontWeight: 900, fill: '#cbd5e1' }} dx={-10} />
                              <Tooltip cursor={{ stroke: '#10b981', strokeWidth: 2 }} contentStyle={{ borderRadius: '1rem', border: 'none', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)', fontWeight: '900', textTransform: 'uppercase', fontSize: '10px' }} />
                              <Area type="monotone" dataKey="score" stroke="#10b981" fillOpacity={1} fill="url(#colorScoreAlerts)" strokeWidth={4} dot={{ r: 6, fill: '#10b981', strokeWidth: 3, stroke: '#fff' }} activeDot={{ r: 8, strokeWidth: 0, fill: '#10b981' }} />
                           </AreaChart>
                        </ResponsiveContainer>
                     </div>
                  </div>

                  <div className="bg-white border-2 border-slate-50 rounded-[3rem] p-10 shadow-sm">
                     <div className="flex items-center gap-3 mb-8">
                        <AlertTriangle className="w-5 h-5 text-amber-500" />
                        <h2 className="text-xl font-black text-slate-800 tracking-tight italic">Areas for Improvement</h2>
                     </div>
                     <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {alerts
                          .filter(a => 
                             a.type === 'behaviour' && 
                             ((a.category || "").toLowerCase().includes("improv") || (a.category || "").toLowerCase().includes("needs") || (a.content || "").toLowerCase().includes("improve")) &&
                             !((a.category || "").toLowerCase().includes("positive") || (a.category || "").toLowerCase().includes("praise"))
                          )
                          .slice(0, 4)
                          .map((note, idx) => (
                           <div key={idx} className="bg-white border-2 border-amber-400/30 rounded-3xl p-8 flex gap-6 transition-all hover:bg-amber-50/20 group">
                              <div className="w-12 h-12 bg-white border-2 border-amber-100 rounded-2xl flex items-center justify-center text-amber-500 shrink-0 shadow-sm group-hover:scale-110 transition-transform">
                                 {idx % 2 === 0 ? <Clock className="w-6 h-6" /> : <BookOpen className="w-6 h-6" />}
                              </div>
                              <div className="space-y-3">
                                 <p className="text-[17px] font-black text-slate-700 italic tracking-tight leading-tight">{note.content}</p>
                                 <div className="flex flex-wrap items-center gap-3 text-[10px] font-black text-slate-400 uppercase tracking-widest italic">
                                    <span>{note.createdAt?.toDate?.() ? note.createdAt.toDate().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Recent'}</span>
                                    <span className="w-1 h-1 rounded-full bg-slate-200" />
                                    <span className="text-slate-300">{note.teacherName || 'Jamaal Bhai'}</span>
                                 </div>
                              </div>
                           </div>
                        ))}
                     </div>
                  </div>
                  <div className="pt-4 pb-2 border-b border-dashed border-slate-200"><p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.5em] italic">Historical Intervention Timeline</p></div>
               </div>
            )}

            {filteredAlerts.map((alert) => (
              <div key={alert.id} className={`bg-white rounded-3xl border-2 border-slate-50 shadow-sm hover:shadow-xl transition-all relative overflow-hidden flex flex-col md:flex-row group ${alert.resolved ? 'hidden' : ''}`}>
                <div className={`w-1.5 shrink-0 ${getPriorityColor(alert.priority)}`} />
                <div className="flex-1 p-8 flex flex-col md:flex-row items-center gap-8">
                   <div className={`w-16 h-16 shrink-0 rounded-2xl flex items-center justify-center border ${alert.category === 'Attendance' ? 'bg-amber-50 border-amber-100 text-amber-500' : alert.priority === 'Good News' ? 'bg-emerald-50 border-emerald-100 text-emerald-500' : alert.priority === 'Critical' && alert.category === 'Behavior' ? 'bg-rose-500/10 border-rose-500/20 text-rose-500' : 'bg-slate-50 border-slate-100 text-slate-400'}`}>
                      {alert.category === 'Attendance' ? <Clock className="w-7 h-7" /> : alert.priority === 'Good News' ? <Trophy className="w-7 h-7" /> : alert.category === 'Behavior' && alert.priority === 'Critical' ? <ShieldAlert className="w-7 h-7" /> : <AlertCircle className="w-7 h-7" />}
                   </div>
                   <div className="flex-1 space-y-3 text-center md:text-left">
                      <div className="flex flex-wrap items-center justify-center md:justify-start gap-4 mb-1">
                         <h3 className="text-2xl font-black text-slate-800 tracking-tighter italic leading-none">{alert.title}</h3>
                         <div className={`px-4 py-1.5 rounded-xl text-[9px] font-black uppercase tracking-widest border ${getTagColor(alert.priority)}`}>{alert.priority}</div>
                         <div className="px-4 py-1.5 rounded-xl bg-indigo-50 border border-indigo-100 text-indigo-600 text-[9px] font-black uppercase tracking-widest">{alert.category}</div>
                      </div>
                      <p className="text-base font-bold text-slate-500 leading-relaxed italic max-w-2xl">{alert.description}</p>
                      {alert.needs_attention && (
                         <div className={`flex items-center gap-3 ${alert.priority === 'Critical' && alert.category === 'Behavior' ? 'bg-rose-500/10 border-rose-500/20 shadow-lg shadow-rose-900/10' : 'bg-rose-50 border border-rose-100'} px-5 py-2 rounded-2xl w-fit`}>
                            <span className={`text-[9px] font-black ${alert.priority === 'Critical' && alert.category === 'Behavior' ? 'text-rose-400' : 'text-rose-500'} uppercase tracking-widest leading-none`}>Focus Area:</span>
                            <span className={`text-sm font-black ${alert.priority === 'Critical' && alert.category === 'Behavior' ? 'text-rose-100' : 'text-rose-700'} italic`}>{alert.needs_attention}</span>
                         </div>
                      )}
                      {alert.category === 'Behavior' && alert.priority === 'Critical' && (
                        <div className="mt-4 p-6 rounded-[2rem] bg-rose-500/5 border border-rose-500/10 relative overflow-hidden backdrop-blur-xl">
                           <div className="flex items-center justify-between mb-4">
                              <div><p className="text-[10px] font-black uppercase tracking-widest text-rose-500/60 italic mb-1">Accountability Score</p>
                                 <div className="flex items-center gap-1.5 bg-rose-500/20 px-3 py-1.5 rounded-xl border border-rose-500/20">
                                    {[...Array(5)].map((_, i) => (<Star key={i} className={`w-3.5 h-3.5 ${i < Math.floor(alert.manualBehaviourRating || 0) ? "text-rose-500 fill-rose-500" : "text-rose-500/20"}`} />))}
                                    <span className="ml-2 text-[12px] font-black text-rose-300 italic">{(alert.manualBehaviourRating || 0).toFixed(1)}/5.0</span>
                                 </div>
                              </div>
                           </div>
                           <div className="space-y-3">
                              <p className="text-[10px] font-black uppercase tracking-widest text-rose-500/40 font-bold">Diagnostic Areas for Improvement</p>
                              <div className="flex flex-wrap gap-2.5 pt-1">
                                 {(alert.description.includes("Improvement:") ? alert.description.split("Improvement:")[1] : alert.description).split(",").map((point, i) => (
                                    <div key={i} className="flex items-center gap-1.5 bg-rose-500/10 px-3 py-1.5 rounded-xl border border-rose-500/20">
                                       <XCircle className="w-3 h-3 text-rose-400" /><span className="text-[11px] font-black text-rose-200 lowercase italic tracking-tight">{point.trim().replace(".", "")}</span>
                                    </div>
                                 ))}
                              </div>
                           </div>
                        </div>
                      )}
                      <div className="flex flex-wrap items-center justify-center md:justify-start gap-6 pt-2">
                         <div className="flex items-center gap-2 text-[10px] font-black text-slate-400 uppercase tracking-widest italic"><Calendar className="w-3.5 h-3.5" /> {alert.createdAt?.toDate?.() ? alert.createdAt.toDate().toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Recent'}</div>
                         <div className="flex items-center gap-2 text-[10px] font-black text-indigo-400 uppercase tracking-widest italic"><User className="w-3.5 h-3.5" /> {alert.teacherName || "Institutional Faculty"}</div>
                      </div>
                   </div>
                   <div className="flex flex-col gap-3 min-w-[200px]">
                      <div className="flex gap-3">
                         <button onClick={() => navigate("/teacher-notes")} className="flex-1 bg-[#1e3a8a] text-white py-4 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-slate-900 transition-all flex items-center justify-center gap-2 shadow-lg shadow-blue-900/10 group-active:scale-95">Message</button>
                         <button onClick={() => markAsRead(alert.id)} className="flex-1 bg-white border border-slate-200 text-slate-400 py-4 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-slate-50 hover:text-slate-600 transition-all flex items-center justify-center gap-2 group-active:scale-95">Dismiss</button>
                      </div>
                   </div>
                </div>
              </div>
            ))}
          </>
        )}
      </div>

      {filterTabs[activeTab] === "All" && (
        <div className="fixed bottom-10 right-10 flex flex-col gap-4 pointer-events-none opacity-50 hidden lg:flex">
           {[{ label: 'Critical Alert', color: 'bg-rose-500' }, { label: 'Standard Alert', color: 'bg-amber-400' }, { label: 'Good News', color: 'bg-emerald-500' }].map(ind => (
              <div key={ind.label} className="flex items-center justify-end gap-3"><span className="text-[8px] font-black uppercase tracking-widest text-slate-400">{ind.label}</span><div className={`w-3 h-3 rounded-full ${ind.color}`} /></div>
           ))}
        </div>
      )}
    </div>
  );
};
export default AlertsPage;
