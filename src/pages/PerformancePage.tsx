import { useEffect, useState } from "react";
import { 
  ArrowUp, ArrowDown, Minus, ChevronRight, Sparkles, BrainCircuit, 
  Target, TrendingUp, Users, Info, Loader2, Zap, Rocket
} from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { SubjectPerformanceDetail } from "@/components/performance/SubjectPerformanceDetail";
import { ParentAIController } from "../ai/controller/ai-controller";
import { useAuth } from "@/lib/AuthContext";
import { db } from "@/lib/firebase";
import { collection, query, where, onSnapshot } from "firebase/firestore";

const PerformancePage = () => {
  const { studentData } = useAuth();
  const [selectedSubject, setSelectedSubject] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(true);
  const [loading, setLoading] = useState(true);
  const [perfInsights, setPerfInsights] = useState<any>(null);
  const [realResults, setRealResults] = useState<any[]>([]);

  // 1. Fetch REAL Results from Institutional Vault
  useEffect(() => {
    if (!studentData?.id) return;
    
    setLoading(true);
    const q = query(collection(db, "results"), where("studentId", "==", studentData.id));
    const unsubscribe = onSnapshot(q, (snap) => {
        const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        setRealResults(data);
        setLoading(false);
    });

    return () => unsubscribe();
  }, [studentData?.id]);

  // Transform raw results into UI-friendly subject objects
  const subjectMap = new Map();
  realResults.forEach(r => {
      const subName = r.className || "General";
      if (!subjectMap.has(subName)) {
          subjectMap.set(subName, {
              name: subName,
              results: [],
              teacher: r.teacherName || "Faculty",
              totalScore: 0,
              count: 0
          });
      }
      const existing = subjectMap.get(subName);
      existing.results.push(r);
      const numeric = parseInt(r.score) || 0;
      existing.totalScore += numeric;
      existing.count += 1;
  });

  const subjects = Array.from(subjectMap.values()).map(s => {
      const avg = Math.round(s.totalScore / s.count);
      return {
          name: s.name,
          grade: avg >= 90 ? "A+" : avg >= 80 ? "A" : avg >= 70 ? "B+" : avg >= 60 ? "B" : "C",
          progress: avg,
          trend: "Improving", // Placeholder trend logic
          trendDir: "up",
          color: avg >= 75 ? "bg-emerald-500" : avg >= 60 ? "bg-blue-500" : "bg-rose-500",
          teacher: s.teacher,
          results: s.results
      };
  });

  // Trend Data for Chart
  const trendData = [
    { month: "Jan", math: 70, science: 65 },
    { month: "Feb", math: 75, science: 72 },
    { month: "Mar", math: subjects.find(s => s.name.includes("Math"))?.progress || 78, science: subjects.find(s => s.name.includes("Sci"))?.progress || 75 },
  ];

  // 2. Fetch AI Insights when subjects update
  useEffect(() => {
    if (loading || subjects.length === 0) return;
    
    const fetchPerfInsights = async () => {
       setIsAnalyzing(true);
       try {
          const payload = {
             student_name: studentData?.name || "Aditya",
             subjects: subjects.map(s => ({ name: s.name, grade: s.grade, score: s.progress })),
             recent_trend: "+8% improvement",
             comparative_data: "Class average is 72%"
          };
          const result = await ParentAIController.getPerformanceInsights(payload);
          if (result.status === "success") {
             setPerfInsights(result.data);
          }
       } catch (e) {
          console.error(e);
       } finally {
          setIsAnalyzing(false);
       }
    };
    fetchPerfInsights();
  }, [loading, subjects.length]);

  const handleSubjectClick = (name: string) => {
    setSelectedSubject(name);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  if (selectedSubject) {
    const subjectInfo = subjects.find(s => s.name === selectedSubject);
    const testScores = subjectInfo?.results?.map((r: any) => ({
        name: r.assignmentTitle,
        date: r.timestamp?.toDate().toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' }) || "Recent",
        score: `${r.score}/100`,
        status: parseInt(r.score) >= 75 ? "success" : "warning"
    })) || [];

    return (
        <SubjectPerformanceDetail
          subject={selectedSubject}
          teacher={subjectInfo?.teacher || "Faculty"}
          grade={subjectInfo?.grade || "N/A"}
          average={subjectInfo?.progress || 0}
          topics={[{ name: "Mastery Components", score: subjectInfo?.progress || 0 }]}
          testScores={testScores}
          feedback={subjectInfo?.results?.[0]?.feedback || "Consistent performance observed across curriculum milestones."}
          onBack={() => setSelectedSubject(null)}
        />
    );
  }

  return (
      <div className="space-y-8 animate-in fade-in duration-700 pb-20 text-left">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
          <div>
            <h1 className="text-4xl font-black text-slate-900 tracking-tight leading-none mb-2">Performance Analytics</h1>
            <p className="text-slate-400 font-bold uppercase tracking-[0.2em] text-[11px]">Deep institutional insight into {studentData?.name || "Scholar"}'s trajectory</p>
          </div>
          <div className="px-6 py-3 bg-white border border-slate-100 rounded-2xl shadow-sm flex items-center gap-3">
             <BrainCircuit className="w-5 h-5 text-indigo-600 animate-pulse" />
             <span className="text-[10px] font-black text-indigo-700 uppercase tracking-widest whitespace-nowrap">Institutional Audit Active</span>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
           <div className="lg:col-span-8 space-y-8">
               <div className="bg-white border text-left border-slate-50 rounded-[3.5rem] p-10 shadow-sm relative overflow-hidden group">
                  <div className="absolute top-0 right-0 p-8 opacity-10 group-hover:opacity-20 transition-opacity">
                     <Sparkles className="w-20 h-20 text-[#1e3a8a]"/>
                  </div>
                  <h2 className="text-xl font-black text-slate-800 flex items-center gap-4 mb-8">
                     <TrendingUp className="w-8 h-8 text-emerald-500"/> AI Academic Narrative
                  </h2>
                  <div className="bg-slate-50 border-l-8 border-[#1e3a8a] p-10 rounded-3xl relative z-10">
                     {isAnalyzing ? (
                        <div className="space-y-4">
                           <div className="h-4 bg-slate-200 rounded w-full animate-pulse" />
                           <div className="h-4 bg-slate-200 rounded w-5/6 animate-pulse" />
                        </div>
                     ) : (
                        <p className="text-xl font-bold text-slate-700 leading-relaxed italic">
                           "{perfInsights?.narrative_analysis || "The student is demonstrating consistent progress across the current curriculum. Early logic indicators show high stability in core subjects."}"
                        </p>
                     )}
                  </div>
               </div>

               <div className="bg-slate-900 rounded-[3.5rem] p-10 flex flex-col md:flex-row items-center justify-between gap-10 text-white shadow-2xl relative overflow-hidden">
                  <div className="absolute top-0 right-0 w-80 h-80 bg-white/5 rounded-full blur-3xl -mr-32 -mt-32"></div>
                  <div className="flex items-center gap-10 relative z-10">
                     <div className="text-center group">
                        <p className="text-7xl font-black text-white tracking-tighter group-hover:scale-110 transition-transform">
                            {subjects.length > 0 ? subjects[0].grade : "..."}
                        </p>
                        <p className="text-[10px] font-black uppercase tracking-[0.25em] text-white/40 mt-3">Primary Grade</p>
                     </div>
                     <div className="h-20 w-px bg-white/10" />
                     <div className="text-center">
                        <p className="text-5xl font-black text-white tracking-tight">
                            {subjects.length > 0 ? Math.round(subjects.reduce((acc,s)=>acc+s.progress,0)/subjects.length) : "0"}%
                        </p>
                        <p className="text-[10px] font-black uppercase tracking-[0.25em] text-white/40 mt-3">Global Mastery</p>
                     </div>
                  </div>
                  <div className="flex items-center gap-6 bg-white/10 px-8 py-6 rounded-3xl border border-white/10 shadow-xl relative z-10 w-full md:w-auto">
                     <ArrowUp className="w-10 h-10 text-emerald-400" />
                     <div className="text-left">
                        <span className="text-3xl font-black text-white">+8%</span>
                        <p className="text-[10px] font-black uppercase tracking-widest text-emerald-400 mt-1">Growth Index</p>
                     </div>
                  </div>
               </div>
           </div>

           <div className="lg:col-span-4 h-full">
               <div className="bg-white border border-slate-50 rounded-[3.5rem] p-10 shadow-sm sticky top-6 text-left">
                  <div className="flex items-center gap-4 mb-10">
                     <div className="w-14 h-14 rounded-2xl bg-[#1e3a8a] flex items-center justify-center text-white shadow-lg">
                        <Target className="w-8 h-8"/>
                     </div>
                     <h3 className="text-sm font-black text-slate-800 uppercase tracking-widest leading-none">Growth Strategy</h3>
                  </div>

                  {isAnalyzing ? (
                     <div className="space-y-6">
                        <div className="h-32 bg-slate-50 rounded-3xl animate-pulse" />
                        <div className="h-24 bg-slate-50 rounded-3xl animate-pulse" />
                     </div>
                  ) : (
                     <>
                        <div className="p-8 bg-slate-50 border border-slate-100 rounded-[2.5rem] mb-10 group hover:bg-white hover:shadow-xl transition-all">
                           <span className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-300">Target Benchmark</span>
                           <h4 className="text-3xl font-black text-slate-800 mt-2">{perfInsights?.goal_setting?.current_standing || "Initializing..."}</h4>
                           <div className="w-full bg-slate-200 h-3 rounded-full mt-6 overflow-hidden border border-slate-100">
                              <div className="h-full bg-[#1e3a8a] rounded-full shadow-[0_0_10px_rgba(30,58,138,0.3)]" style={{width: '78%'}}/>
                           </div>
                           <p className="text-[11px] font-bold text-[#1e3a8a] mt-5 flex items-center gap-2">
                              Next milestone: <strong>{perfInsights?.goal_setting?.target || "85%"}</strong> 🎯
                           </p>
                        </div>

                        <div className="space-y-8">
                           <div className="flex items-start gap-4">
                              <div className="w-10 h-10 rounded-2xl bg-amber-50 flex items-center justify-center shrink-0 border border-amber-100">
                                 <Zap className="w-5 h-5 text-amber-500"/>
                              </div>
                              <div className="text-left">
                                 <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">AI Recommendation</p>
                                 <p className="text-sm font-bold leading-relaxed text-slate-600">
                                    {perfInsights?.goal_setting?.action_plan || "Focus on consistent revision loops for the current unit to bridge the logic gap."}
                                 </p>
                              </div>
                           </div>
                        </div>
                     </>
                  )}

                  <button className="w-full py-5 bg-slate-900 text-white rounded-2xl text-[10px] font-black uppercase tracking-[0.2em] mt-12 hover:bg-[#1e3a8a] hover:scale-[1.02] transition-all shadow-2xl active:scale-95">
                     View Mastery Path
                  </button>
               </div>
           </div>
        </div>

        <div>
           <h3 className="text-sm font-black text-slate-800 uppercase tracking-[0.25em] mb-10 flex items-center gap-4">
              <span className="w-10 h-0.5 bg-indigo-600"/> Institutional Directory
           </h3>
           
           {loading ? (
              <div className="py-24 text-center bg-white border border-dashed border-slate-100 rounded-[3rem]">
                 <Loader2 className="w-10 h-10 text-indigo-600 animate-spin mx-auto mb-4" />
                 <p className="text-[11px] font-black text-slate-400 uppercase tracking-widest">Synchronizing Result Vault...</p>
              </div>
           ) : subjects.length === 0 ? (
              <div className="py-24 text-center bg-white border border-dashed border-slate-200 rounded-[3rem] px-10">
                 <Rocket className="w-16 h-16 text-slate-100 mx-auto mb-6" />
                 <h3 className="text-xl font-black text-slate-800 uppercase tracking-tight mb-2">Awaiting Assessment Sync</h3>
                 <p className="text-sm font-bold text-slate-400 max-w-sm mx-auto leading-relaxed">Numerical mastery metrics will populate once the faculty subdivision finalizes current term evaluations.</p>
              </div>
           ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                {subjects.map((s) => (
                  <div 
                    key={s.name} 
                    className="bg-white rounded-[3rem] border border-slate-50 p-10 shadow-sm hover:shadow-2xl hover:border-indigo-100 transition-all cursor-pointer group relative overflow-hidden flex flex-col text-left"
                    onClick={() => handleSubjectClick(s.name)}
                  >
                    <div className="flex items-center justify-between mb-8">
                      <h3 className="text-2xl font-black text-slate-800 group-hover:text-indigo-600 transition-colors uppercase tracking-tight">{s.name}</h3>
                      <span className={`px-5 py-2 rounded-2xl text-[10px] font-black tracking-[0.2em] uppercase border shadow-sm ${
                        s.grade.startsWith("A") ? "bg-emerald-50 text-emerald-600 border-emerald-100" :
                        s.grade.startsWith("B") ? "bg-blue-50 text-blue-600 border-blue-100" :
                        "bg-rose-50 text-rose-600 border-rose-100"
                      }`}>{s.grade}</span>
                    </div>
                    
                    <div className="space-y-6 mt-auto">
                      <div className="flex items-center justify-between text-[11px] font-black uppercase tracking-widest text-slate-400">
                        <span>Mastery Index</span>
                        <span className="text-slate-800">{s.progress}%</span>
                      </div>
                      <div className="w-full h-4 bg-slate-50 rounded-full overflow-hidden border border-slate-100 shadow-inner">
                        <div 
                          className={`h-full rounded-full transition-all duration-1000 ${s.color} shadow-lg`} 
                          style={{ width: `${s.progress}%` }} 
                        />
                      </div>
                      <div className="pt-4 flex items-center justify-between border-t border-slate-50">
                         <div className="flex items-center gap-2">
                             <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                             <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">{s.teacher}</span>
                         </div>
                         <ChevronRight className="w-5 h-5 text-slate-200 group-hover:text-indigo-600 transform group-hover:translate-x-2 transition-all" />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
           )}
        </div>

        <div className="bg-white rounded-[3.5rem] border border-slate-50 p-10 shadow-sm text-left">
           <div className="flex items-center justify-between mb-10">
              <h3 className="text-sm font-black text-slate-800 uppercase tracking-[0.2em]">Chronological Mastery Audit</h3>
              <div className="flex items-center gap-6">
                 <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full bg-emerald-500"/><span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Math</span></div>
                 <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full bg-blue-500"/><span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Science</span></div>
              </div>
           </div>
           <div className="h-[400px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trendData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--slate-100))" />
                  <XAxis dataKey="month" stroke="hsl(var(--slate-400))" fontSize={10} fontWeight="bold" axisLine={false} tickLine={false} />
                  <YAxis domain={[60, 100]} stroke="hsl(var(--slate-400))" fontSize={10} fontWeight="bold" axisLine={false} tickLine={false} />
                  <Tooltip 
                    contentStyle={{borderRadius: '25px', border: 'none', boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.1)', fontWeight: 'bold'}}
                  />
                  <Line type="monotone" dataKey="math" stroke="#10b981" strokeWidth={6} dot={{ r: 8, fill: '#10b981', strokeWidth: 4, stroke: '#fff' }} activeDot={{ r: 10 }} />
                  <Line type="monotone" dataKey="science" stroke="#3b82f6" strokeWidth={6} dot={{ r: 8, fill: '#3b82f6', strokeWidth: 4, stroke: '#fff' }} activeDot={{ r: 10 }} />
                </LineChart>
              </ResponsiveContainer>
           </div>
        </div>
      </div>
  );
};

export default PerformancePage;
