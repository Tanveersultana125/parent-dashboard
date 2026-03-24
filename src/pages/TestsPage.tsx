import { useState, useEffect } from "react";
import { 
  Calendar, CheckCircle, Clock, ChevronRight, Filter, 
  Sparkles, BrainCircuit, Rocket, Zap, Info, Loader2,
  Award, BarChart3, TrendingUp
} from "lucide-react";
import { useAuth } from "@/lib/AuthContext";
import { db } from "@/lib/firebase";
import { collection, query, where, onSnapshot } from "firebase/firestore";

const TestsPage = () => {
  const { studentData } = useAuth();
  const [loading, setLoading] = useState(true);
  const [testResults, setTestResults] = useState<any[]>([]);

  useEffect(() => {
    if (!studentData?.id) return;

    setLoading(true);
    // Fetch live scores from the universal test_scores matrix
    const q = query(
      collection(db, "test_scores"),
      where("studentId", "==", studentData.id)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const results = snapshot.docs.map(d => ({id: d.id, ...d.data()}));
      
      // Sort by latest timestamp
      results.sort((a: any, b: any) => {
         const dA = a.timestamp?.toDate() || 0;
         const dB = b.timestamp?.toDate() || 0;
         return dB - dA;
      });

      setTestResults(results);
      setLoading(false);
    }, (error) => {
      console.error("Grades Sync Error:", error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [studentData]);

  const totalPoints = testResults.reduce((sum, t) => sum + (t.score || 0), 0);
  const maxPointsPossible = testResults.reduce((sum, t) => sum + (t.maxScore || 0), 0);

  return (
      <div className="space-y-8 animate-in fade-in duration-700 pb-12">
        
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-3xl font-black text-slate-800 tracking-tight">Assessment Roster</h1>
            <p className="text-slate-400 font-bold uppercase tracking-widest text-[11px]">Comprehensive breakdown of tests, quizzes & term marks</p>
          </div>
          <div className="flex items-center gap-3">
             <button className="px-6 py-3 bg-white border-2 border-slate-50 rounded-2xl text-[10px] font-black uppercase tracking-widest text-slate-600 hover:border-indigo-100 transition-all shadow-sm">
                Schedule View
             </button>
             <button className="px-6 py-3 bg-indigo-600 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-indigo-700 transition-all shadow-xl shadow-indigo-100 flex items-center gap-2">
                <Rocket className="w-4 h-4" /> Syllabus Audit
             </button>
          </div>
        </div>

        {!loading && testResults.length === 0 ? (
            <div className="bg-gradient-to-br from-indigo-600 to-blue-700 rounded-[2.5rem] p-10 text-white shadow-2xl relative overflow-hidden group">
                 <div className="absolute top-0 right-0 p-10 opacity-10 group-hover:scale-110 transition-transform">
                    <Calendar className="w-40 h-40" />
                 </div>
                 <div className="relative z-10 max-w-2xl">
                    <div className="flex items-center gap-3 mb-6">
                       <span className="px-4 py-1.5 bg-white/20 backdrop-blur-md rounded-full text-[10px] font-black uppercase tracking-widest border border-white/30">Awaiting Schedule Sync</span>
                    </div>
                    <h2 className="text-4xl font-black tracking-tight mb-4 lowercase leading-tight">
                       The assessment features will work automatically as soon as the term schedule is digitized.
                    </h2>
                    <p className="text-indigo-100 font-bold text-lg leading-relaxed opacity-80 mb-8">
                       Stay tuned for upcoming unit tests and quiz alerts. AI will analyze performance patterns as real data becomes available.
                    </p>
                 </div>
            </div>
        ) : (
            <div className="bg-gradient-to-br from-indigo-600 to-blue-700 rounded-[2.5rem] p-10 text-white shadow-2xl relative overflow-hidden group">
                <Sparkles className="absolute -right-8 -bottom-8 w-64 h-64 text-white/5 group-hover:rotate-12 transition-transform" />
                <div className="relative z-10">
                    <h2 className="text-3xl font-black mb-4">Latest Achievement Sweep</h2>
                    <p className="text-indigo-100 font-bold opacity-80 mb-6 max-w-lg">
                        {studentData?.name}'s academic trajectory is being monitored by our AI engine. {testResults.length} assessments officially scored.
                    </p>
                    <div className="flex gap-4">
                        <div className="px-6 py-4 bg-white/10 rounded-2xl border border-white/20">
                            <p className="text-[10px] font-black uppercase tracking-widest opacity-60 mb-1">Accumulated Points</p>
                            <p className="text-2xl font-black">{totalPoints} <span className="text-sm text-indigo-200">/ {maxPointsPossible}</span></p>
                        </div>
                    </div>
                </div>
            </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
           {/* Recent Tests List */}
           <div className="lg:col-span-8 space-y-6">
              <div className="flex items-center justify-between px-2">
                 <h3 className="text-sm font-black text-slate-800 uppercase tracking-widest flex items-center gap-3">
                    <BarChart3 className="w-5 h-5 text-indigo-500" /> Recent Assessment History
                 </h3>
                 <button className="text-[10px] font-black text-indigo-600 uppercase tracking-widest flex items-center gap-1">
                    Export Transcripts <ChevronRight className="w-3 h-3" />
                 </button>
              </div>

              {loading ? (
                  <div className="py-24 text-center bg-white border-2 border-slate-50 rounded-[2.5rem]">
                      <Loader2 className="w-12 h-12 text-indigo-600 animate-spin mx-auto mb-4" />
                      <p className="text-sm font-black text-indigo-600 uppercase tracking-widest">Compiling academic records...</p>
                  </div>
              ) : testResults.length === 0 ? (
                  <div className="py-24 text-center bg-white border-2 border-slate-50 rounded-[2.5rem] flex flex-col items-center">
                      <div className="w-20 h-20 bg-slate-50 border-2 border-slate-100 rounded-[2rem] flex items-center justify-center mb-6 shadow-sm">
                          <Award className="w-9 h-9 text-slate-200" />
                      </div>
                      <h3 className="text-xl font-black text-slate-800 uppercase tracking-tight mb-2">Academic Clean Slate</h3>
                      <p className="text-sm font-bold text-slate-400 max-w-sm leading-relaxed px-10">
                          The feature will work automatically after {studentData?.name || "the student"} completes an official assessment or quiz.
                      </p>
                  </div>
              ) : (
                  <div className="space-y-4">
                    {testResults.map((test) => (
                      <div 
                        key={test.id}
                        className="bg-white rounded-[2rem] border-2 border-slate-50 p-6 flex flex-col md:flex-row md:items-center justify-between gap-6 hover:shadow-xl hover:border-indigo-100 transition-all group"
                      >
                         <div className="flex items-center gap-5">
                            <div className="w-14 h-14 rounded-2xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 shadow-sm transition-transform group-hover:scale-110">
                               <CheckCircle className="w-6 h-6" />
                            </div>
                            <div>
                               <h4 className="text-lg font-black text-slate-800 leading-tight mb-1">{test.testName}</h4>
                               <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                                  {test.timestamp?.toDate().toLocaleDateString() || "Recent"} • Verified
                               </p>
                            </div>
                         </div>
                         <div className="flex items-center gap-6">
                            <div className="text-right">
                               <p className="text-2xl font-black text-slate-800 tracking-tighter">
                                  {test.isAbsent ? "ABSENT" : `${test.score}/${test.maxScore}`}
                               </p>
                               {!test.isAbsent && (
                                  <p className="text-[10px] font-black text-emerald-500 uppercase tracking-widest">
                                     {test.percentage?.toFixed(0)}% • Grade {test.grade}
                                  </p>
                               )}
                            </div>
                         </div>
                      </div>
                    ))}
                  </div>
              )}
           </div>

           {/* Performance Radar Mini */}
           <div className="lg:col-span-4 space-y-8">
              <div className="bg-white rounded-[2.5rem] border-2 border-slate-50 p-8 shadow-sm">
                 <h3 className="text-sm font-black text-slate-800 uppercase tracking-widest mb-8 flex items-center gap-2">
                    <TrendingUp className="w-5 h-5 text-emerald-500" /> Topic Mastery Audit
                 </h3>
                 <div className="space-y-8">
                    {testResults.length === 0 ? (
                        <div className="p-8 text-center border-2 border-dashed border-slate-50 rounded-3xl">
                             <Info className="w-8 h-8 text-slate-200 mx-auto mb-4" />
                             <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-relaxed">AI analysis will populate after real-time data sync.</p>
                        </div>
                    ) : (
                        testResults.slice(0, 3).map((topic, i) => (
                           <div key={i} className="space-y-3">
                              <div className="flex items-center justify-between">
                                 <p className="text-[11px] font-black text-slate-700 uppercase tracking-widest truncate mr-4">{topic.testName}</p>
                                 <span className="text-xs font-black text-indigo-600">{topic.percentage?.toFixed(0) || 0}%</span>
                              </div>
                              <div className="w-full h-2.5 bg-slate-50 rounded-full overflow-hidden border border-slate-100">
                                 <div className="h-full bg-indigo-600 rounded-full" style={{ width: `${topic.percentage || 0}%` }} />
                              </div>
                           </div>
                        ))
                    )}
                 </div>
                 <button className="w-full py-4 mt-10 bg-slate-50 hover:bg-slate-100 text-slate-500 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all">
                    Full Analytic Report
                 </button>
              </div>

              <div className="bg-slate-900 rounded-[2.5rem] p-8 text-white relative overflow-hidden shadow-2xl">
                 <BrainCircuit className="absolute -bottom-6 -right-6 w-32 h-32 text-white/5" />
                 <h4 className="text-[10px] font-black uppercase tracking-widest text-[#6366f1] mb-6 flex items-center gap-2">
                    <Sparkles className="w-4 h-4" /> Preparation AI
                 </h4>
                 <h3 className="text-lg font-black leading-tight mb-6">Upcoming Test? AI can build a revision schedule.</h3>
                 <button className="w-full py-4 bg-white/10 border border-white/20 rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-white/20 transition-all flex items-center justify-center gap-2">
                    <Zap className="w-4 h-4 text-emerald-400" /> Generate Revision Loop
                 </button>
              </div>
           </div>
        </div>
      </div>
  );
};

export default TestsPage;
