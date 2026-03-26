import React, { useState, useEffect } from "react";
import { 
  CheckCircle, AlertCircle, XCircle, Lightbulb, Sparkles, 
  Calendar, BookOpen, PenTool, HelpCircle, Camera, Loader2,
  ChevronRight, Brain, Zap, PlayCircle, PlusCircle, Info, Rocket, 
  Target, TrendingUp, Users, Activity, Star, ArrowUpRight, GraduationCap
} from "lucide-react";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { ParentAIController } from "../ai/controller/ai-controller";
import { useAuth } from "@/lib/AuthContext";
import { db } from "@/lib/firebase";
import { collection, query, where, getDocs, onSnapshot } from "firebase/firestore";

const ConceptStrengthsPage = () => {
  const { studentData } = useAuth();
  const [activeTab, setActiveTab] = useState(0);
  const [isAnalyzing, setIsAnalyzing] = useState(true);
  const [intelligence, setIntelligence] = useState<any>(null);
  const [masteryData, setMasteryData] = useState<{strong: any[], needsWork: any[]}>({ strong: [], needsWork: [] });
  const [loading, setLoading] = useState(true);
  
  const subjectTabs = ["Mathematics", "Science", "English", "History", "Physics"];

  useEffect(() => {
    if (!studentData?.id) return;

    const syncMastery = async () => {
      setLoading(true);
      try {
        // 1. Get Enrollments to find Class IDs
        const qEnroll = query(collection(db, "enrollments"), where("studentId", "==", studentData.id));
        const enrollSnap = await getDocs(qEnroll);
        const classIds = enrollSnap.docs.map(d => d.data().classId).filter(id => !!id);
        const classMap = new Map(enrollSnap.docs.map(d => [d.data().classId, d.data().className]));

        if (classIds.length === 0) {
          setLoading(false);
          return;
        }

        // 2. Fetch all tests for these classes
        const qTests = query(collection(db, "tests_registry"), where("classId", "in", classIds));
        const testsSnap = await getDocs(qTests);
        const allTests = testsSnap.docs.map(d => ({ id: d.id, ...d.data() } as any));

        // 3. Fetch student's scores
        const qScores = query(collection(db, "test_scores"), where("studentId", "==", studentData.id));
        const scoresSnap = await getDocs(qScores);
        const studentScores = scoresSnap.docs.map(d => d.data());

        // 4. Calculate Topic Averages filtered by Subject
        const currentSubject = subjectTabs[activeTab].toLowerCase();
        const relevantTests = allTests.filter(t => {
            const className = (classMap.get(t.classId) || "").toLowerCase();
            return className.includes(currentSubject) || (t.subject && t.subject.toLowerCase().includes(currentSubject));
        });

        const topicScoresMap = new Map<string, { total: number, count: number }>();
        
        relevantTests.forEach(test => {
            const scoreDoc = studentScores.find(s => s.testId === test.id);
            if (!scoreDoc || scoreDoc.score === null) return;

            const pct = scoreDoc.percentage || (scoreDoc.score / (scoreDoc.maxScore || 100)) * 100;
            
            if (test.topics && Array.isArray(test.topics)) {
                test.topics.forEach((topic: string) => {
                    const existing = topicScoresMap.get(topic) || { total: 0, count: 0 };
                    topicScoresMap.set(topic, { total: existing.total + pct, count: existing.count + 1 });
                });
            }
        });

        const topicsArray = Array.from(topicScoresMap.entries()).map(([topic, data]) => ({
            topic,
            score: Math.round(data.total / data.count)
        }));

        setMasteryData({
            strong: topicsArray.filter(t => t.score >= 80).sort((a,b) => b.score - a.score),
            needsWork: topicsArray.filter(t => t.score < 80).sort((a,b) => a.score - b.score)
        });

      } catch (e) {
        console.error("Mastery Sync Error", e);
      } finally {
        setLoading(false);
      }
    };

    syncMastery();
  }, [studentData?.id, activeTab]);

  useEffect(() => {
    if (loading || (masteryData.strong.length === 0 && masteryData.needsWork.length === 0)) {
        setIsAnalyzing(false);
        return;
    }
    
    const fetchIntelligence = async () => {
      setIsAnalyzing(true);
      try {
        const payload = {
          student_name: studentData?.name || "Scholar",
          subject: subjectTabs[activeTab],
          strengths: masteryData.strong,
          weaknesses: masteryData.needsWork,
          upcoming_test: "Curriculum expansion in progress"
        };
        const result = await ParentAIController.getConceptIntelligence(payload);
        if (result.status === "success") setIntelligence(result.data);
      } catch (e) {
        console.error(e);
      } finally {
        setIsAnalyzing(false);
      }
    };
    fetchIntelligence();
  }, [loading, masteryData, activeTab, studentData?.id]);

  const chartData = [
    { month: "PHASE 1", val: 65 },
    { month: "PHASE 2", val: 72 },
    { month: "PHASE 3", val: 78 },
    { month: "CURRENT", val: masteryData.strong.length > 0 ? masteryData.strong[0].score : 70 }
  ];

  return (
    <div className="animate-in fade-in slide-in-from-bottom-10 duration-1000 pb-24 text-left font-sans">
      
      {/* ─── HEADER & NAV ─── */}
      <div className="flex flex-col md:flex-row items-center justify-between gap-10 mb-20 px-4">
        <div className="text-left w-full md:w-auto">
           <div className="flex items-center gap-4 mb-6">
              <div className="w-12 h-12 rounded-[1.5rem] bg-[#1e3a8a] flex items-center justify-center text-white shadow-xl shadow-blue-200">
                 <Brain size={26} />
              </div>
              <div>
                 <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.4em] mb-1">Concept Mastery Hub</p>
                 <div className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse border-2 border-white shadow-[0_0_10px_rgba(16,185,129,0.5)]" />
                    <p className="text-xs font-black text-slate-500 uppercase tracking-widest leading-none">Neural Insights Live</p>
                 </div>
              </div>
           </div>
           <h1 className="text-6xl font-black text-slate-900 tracking-tighter leading-none mb-4">Mastery Matrix</h1>
           <p className="text-xl font-bold text-slate-400 italic">Identifying knowledge gaps and accelerating learning potential via AI.</p>
        </div>
        
        <div className="flex bg-[#f1f5f9] p-2 rounded-[2.5rem] border border-slate-200 w-fit overflow-x-auto no-scrollbar max-w-full">
          {subjectTabs.map((tab, i) => (
            <button 
              key={tab} 
              onClick={() => setActiveTab(i)}
              className={`px-10 py-5 rounded-[2rem] text-[11px] font-black uppercase tracking-[0.2em] transition-all whitespace-nowrap ${
                i === activeTab 
                ? "bg-white text-[#1e3a8a] shadow-xl border border-slate-200 scale-105 z-10" 
                : "text-slate-400 hover:text-slate-600"
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
          <div className="py-40 flex flex-col items-center justify-center">
              <Loader2 className="w-16 h-16 text-[#1e3a8a] animate-spin mb-8" />
              <p className="text-sm font-black text-[#1e3a8a] uppercase tracking-widest">Scanning Mastery Registry...</p>
          </div>
      ) : (
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 px-2">
         
         {/* LEFT: MASTER STUDY PLAN & ANALYTICS */}
         <div className="lg:col-span-8 flex flex-col gap-12">
            
            {/* AI STUDY PLAN CARD */}
            <div className="bg-white border border-slate-100 rounded-[4.5rem] p-12 shadow-sm relative overflow-hidden group hover:shadow-2xl transition-all">
               <div className="absolute top-0 right-0 p-12 opacity-5 scale-150 rotate-12">
                  <Calendar className="w-48 h-48 text-[#1e3a8a]" />
               </div>
               
               <div className="relative z-10">
                  <div className="flex items-center gap-4 mb-10">
                     <div className="w-14 h-14 rounded-[2rem] bg-indigo-50 flex items-center justify-center text-[#1e3a8a] shadow-inner">
                        <Zap size={28} />
                     </div>
                     <h3 className="text-sm font-black text-slate-800 uppercase tracking-widest leading-none">Mastery Acceleration Plan</h3>
                  </div>

                  {isAnalyzing ? (
                     <div className="space-y-6">
                        <div className="h-12 bg-slate-50 rounded-2xl animate-pulse" />
                        <div className="h-32 bg-slate-50 rounded-2xl animate-pulse" />
                     </div>
                  ) : intelligence?.study_plan?.schedule ? (
                     <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                        {intelligence?.study_plan?.schedule?.slice(0, 4).map((item: any, idx: number) => (
                           <div key={idx} className="p-8 bg-slate-50 rounded-[2.5rem] border border-slate-100 group/plan hover:bg-white hover:shadow-xl transition-all">
                              <p className="text-[10px] font-black text-indigo-400 uppercase tracking-[0.3em] mb-2 italic">{item.day}</p>
                              <h4 className="text-xl font-black text-slate-900 tracking-tighter mb-4 italic uppercase">{item.task}</h4>
                              <p className="text-[10px] font-bold text-slate-400 leading-relaxed uppercase tracking-widest flex items-center gap-2">
                                 <Info size={12} className="text-[#1e3a8a]" /> {item.reason}
                              </p>
                           </div>
                        ))}
                     </div>
                  ) : (
                    <div className="py-20 text-center opacity-30">
                        <Rocket size={48} className="mx-auto mb-6" />
                        <p className="text-xs font-black uppercase tracking-widest">Complete more assessments to unlock AI strategy rounting.</p>
                    </div>
                  )}
                  
                  <button className="h-20 w-fit px-12 mt-12 bg-slate-900 text-white rounded-[2.5rem] text-[11px] font-black uppercase tracking-[0.3em] shadow-2xl shadow-slate-900/40 hover:scale-[1.05] transition-all flex items-center gap-4">
                     Download High-Priority Roster <ArrowUpRight size={18} />
                  </button>
               </div>
            </div>

            {/* ANALYTICS CHART */}
            <div className="bg-white border border-slate-100 rounded-[4rem] p-12 shadow-sm">
               <div className="flex items-center justify-between mb-12">
                  <h3 className="text-sm font-black text-slate-800 uppercase tracking-widest leading-none">Chronological Trajectory</h3>
                  <div className="flex gap-8">
                     <div className="flex items-center gap-3"><div className="w-3 h-3 rounded-full bg-emerald-500" /><span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Mastery Index</span></div>
                  </div>
               </div>
               <div className="h-[400px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                     <AreaChart data={chartData}>
                        <defs>
                           <linearGradient id="colorA" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#1e3a8a" stopOpacity={0.1}/><stop offset="95%" stopColor="#1e3a8a" stopOpacity={0}/></linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                        <XAxis dataKey="month" axisLine={false} tickLine={false} fontSize={10} fontWeight="black" stroke="#94a3b8" dy={10} />
                        <YAxis axisLine={false} tickLine={false} fontSize={10} fontWeight="black" stroke="#94a3b8" domain={[0, 100]} />
                        <Tooltip contentStyle={{ borderRadius: '2rem', border: 'none', fontWeight: 'black' }} />
                        <Area type="monotone" dataKey="val" stroke="#1e3a8a" fillOpacity={1} fill="url(#colorA)" strokeWidth={4} />
                     </AreaChart>
                  </ResponsiveContainer>
               </div>
            </div>
         </div>

         {/* RIGHT SIDE: EXPLAINER & DOUBT SOLVER */}
         <div className="lg:col-span-4 flex flex-col gap-12 text-left">
            <div className="bg-gradient-to-br from-indigo-700 to-[#1e3a8a] rounded-[4.5rem] p-12 text-white shadow-2xl relative overflow-hidden group">
               <PlayCircle className="absolute -bottom-12 -right-12 w-48 h-48 text-white/5 group-hover:scale-110 transition-transform duration-1000" />
               <div className="flex items-center gap-4 mb-10 relative z-10">
                  <BookOpen className="w-6 h-6 text-indigo-300" />
                  <h3 className="text-[10px] font-black uppercase tracking-[0.3em] text-indigo-200">Concept Explainer</h3>
               </div>
               <h3 className="text-3xl font-black leading-[1.1] tracking-tighter mb-8 italic relative z-10">Frictionless analogies for complex topics.</h3>
               <div className="relative z-10">
                  <input type="text" placeholder="e.g. Try 'Photosynthesis'..." className="w-full h-16 bg-white/10 border border-white/20 rounded-[1.8rem] px-8 py-2 text-sm placeholder:text-white/30 focus:outline-none focus:bg-white/20 focus:ring-4 ring-white/10 transition-all font-bold" />
                  <button className="absolute right-3 top-3 h-10 px-6 bg-white text-[#1e3a8a] rounded-2xl text-[10px] font-black uppercase tracking-widest shadow-xl">Inquire</button>
               </div>
            </div>

            <div className="bg-white border border-slate-100 rounded-[4.5rem] p-12 shadow-sm relative overflow-hidden group">
               <div className="flex items-center gap-4 mb-10">
                  <div className="w-12 h-12 rounded-[1.5rem] bg-rose-50 flex items-center justify-center text-rose-500 shadow-inner">
                     <AlertCircle size={24} />
                  </div>
                  <h3 className="text-sm font-black text-slate-800 uppercase tracking-widest leading-none">Critical Focus</h3>
               </div>
               
               <div className="space-y-6">
                  {masteryData.needsWork.length > 0 ? masteryData.needsWork.map((t) => (
                    <div key={t.topic} className="p-8 bg-slate-50 rounded-[2.5rem] border border-slate-50 group/item hover:bg-white hover:shadow-xl transition-all">
                       <div className="flex justify-between items-center mb-4">
                          <h4 className="text-base font-black text-slate-900 tracking-tight italic uppercase">{t.topic}</h4>
                           <span className={`text-sm font-black italic ${t.score < 50 ? 'text-rose-500' : 'text-amber-500'}`}>{t.score}%</span>
                       </div>
                       <div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden">
                          <div className={`h-full ${t.score < 50 ? 'bg-rose-500' : 'bg-amber-400'}`} style={{width: `${t.score}%`}} />
                       </div>
                       <button className="mt-6 flex items-center gap-2 text-[9px] font-black uppercase text-indigo-600 tracking-widest opacity-0 group-hover/item:opacity-100 transition-opacity">
                          <PlusCircle size={14} /> Commit Practice Drill
                       </button>
                    </div>
                  )) : (
                    <div className="py-20 text-center opacity-20 italic">
                        <CheckCircle size={40} className="mx-auto mb-4" />
                        <p className="text-[10px] font-black uppercase tracking-widest">No critical failures detected.</p>
                    </div>
                  )}
               </div>
               
               <div className="mt-10 p-8 bg-amber-50 rounded-[2.5rem] border border-amber-100 italic relative overflow-hidden group/tip">
                  <div className="absolute top-0 right-0 p-4 opacity-5"><Lightbulb size={40}/></div>
                  <p className="relative z-10 text-[11px] font-bold text-amber-900/70 leading-relaxed uppercase tracking-widest">
                     Strategic Insight: {intelligence?.concept_explainer?.explanation || "Logical foundational shifts are required in weak areas to secure upcoming curriculum milestones."}
                  </p>
               </div>
            </div>

            <div className="bg-slate-900 rounded-[4.5rem] p-12 text-white shadow-2xl relative overflow-hidden group">
               <Rocket className="absolute -bottom-6 -right-6 w-32 h-32 text-white/5" />
               <div className="flex items-center gap-4 mb-10 relative z-10">
                  <Camera className="w-6 h-6 text-[#1e3a8a] animate-pulse" />
                  <h3 className="text-[10px] font-black uppercase tracking-[0.3em] text-indigo-400">Tactical Doubts</h3>
               </div>
               <div className="h-40 bg-white/5 border-2 border-dashed border-white/10 rounded-[2.5rem] flex flex-col items-center justify-center group-hover:bg-white/10 transition-all relative z-10">
                  <PlusCircle size={32} className="text-white/20 mb-4" />
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Snap & Resolve Doubt</p>
               </div>
            </div>
         </div>

      </div>
      )}
    </div>
  );
};

export default ConceptStrengthsPage;
