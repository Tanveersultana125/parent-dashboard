import React, { useState, useEffect } from "react";
import { 
  CheckCircle, XCircle, Clock, Calendar as CalendarIcon, ChevronLeft, ChevronRight, 
  FileText, Printer, Plus, Loader2, Info, Sparkles, MapPin, BrainCircuit, 
  GraduationCap, Activity, TrendingUp, Filter, ArrowUpRight
} from "lucide-react";
import { useAuth } from "@/lib/AuthContext";
import { db } from "@/lib/firebase";
import { collection, query, where, onSnapshot, orderBy } from "firebase/firestore";
import { ParentAIController } from "../ai/controller/ai-controller";

type DayStatus = "present" | "absent" | "late" | "weekend" | "holiday" | "empty";

const AttendancePage = () => {
  const { studentData } = useAuth();
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [attendanceLogs, setAttendanceLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    present: 0,
    absent: 0,
    late: 0,
    percentage: 0
  });
  const [aiCorrelation, setAiCorrelation] = useState<any>(null);
  const [analyzingAi, setAnalyzingAi] = useState(false);

  // ─── DATA SYNCHRONIZATION ───
  useEffect(() => {
    if (!studentData?.id) return;

    setLoading(true);
    // Fetch by Student ID
    const qById = query(
      collection(db, "attendance"),
      where("studentId", "==", studentData.id)
    );

    // Fetch by Student Email (resilient mapping)
    const qByEmail = query(
        collection(db, "attendance"),
        where("studentEmail", "==", studentData.email)
    );

    const unsubById = onSnapshot(qById, (snap1) => {
        const logs1 = snap1.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        
        onSnapshot(qByEmail, (snap2) => {
            const logs2 = snap2.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            
            // Deduplicate and sort
            const combined = [...logs1, ...logs2];
            const uniqueLogs = Array.from(new Map(combined.map(item => [item.id, item])).values())
                .sort((a: any, b: any) => b.date.localeCompare(a.date));

            setAttendanceLogs(uniqueLogs);

            // Institutional Health calculation
            const pCount = uniqueLogs.filter((l: any) => l.status === 'present').length;
            const aCount = uniqueLogs.filter((l: any) => l.status === 'absent').length;
            const lCount = uniqueLogs.filter((l: any) => l.status === 'late').length;
            const total = pCount + aCount + lCount;
            const pct = total === 0 ? 100 : Math.round(((pCount + lCount) / total) * 100);

            setStats({
                present: pCount,
                absent: aCount,
                late: lCount,
                percentage: pct
            });
            setLoading(false);
        });
    });

    return () => unsubById();
  }, [studentData?.id, studentData?.email]);

  // ─── AI CORRELATION ENGINE ───
  useEffect(() => {
    if (loading || !studentData?.id || attendanceLogs.length === 0) return;
    
    const fetchAiAnalytic = async () => {
      setAnalyzingAi(true);
      const res = await ParentAIController.getAttendanceInsights({
        student_name: studentData.name,
        attendance_rate: `${stats.percentage}%`,
        late_days: stats.late,
        absent_days: stats.absent
      });
      if (res.status === "success") setAiCorrelation(res.data);
      setAnalyzingAi(false);
    };
    fetchAiAnalytic();
  }, [loading, studentData?.id, stats.percentage]);

  const daysInMonth = (date: Date) => new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  const firstDayOfMonth = (date: Date) => new Date(date.getFullYear(), date.getMonth(), 1).getDay();

  const handlePrevMonth = () => setSelectedDate(new Date(selectedDate.getFullYear(), selectedDate.getMonth() - 1));
  const handleNextMonth = () => setSelectedDate(new Date(selectedDate.getFullYear(), selectedDate.getMonth() + 1));

  const getDayStatus = (day: number): DayStatus => {
    const d = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), day);
    const dateStr = d.toLocaleDateString('en-CA');
    
    // Find ALL logs for this specific date
    const logsForDay = attendanceLogs.filter(l => l.date === dateStr);
    
    if (logsForDay.length === 0) {
        if (d.getDay() === 0) return "weekend";
        return "empty";
    }

    // Priority System: Absent > Late > Present
    const hasAbsent = logsForDay.some(l => l.status === "absent");
    if (hasAbsent) return "absent";

    const hasLate = logsForDay.some(l => l.status === "late");
    if (hasLate) return "late";

    const hasPresent = logsForDay.some(l => l.status === "present");
    if (hasPresent) return "present";

    return "empty";
  };

  return (
    <div className="animate-in fade-in slide-in-from-bottom-10 duration-1000 pb-24 text-left font-sans">
      
      {/* ─── HEADER ─── */}
      <div className="flex flex-col md:flex-row items-center justify-between gap-10 mb-20 px-4">
        <div className="text-left w-full md:w-auto">
           <div className="flex items-center gap-4 mb-6">
              <div className="w-12 h-12 rounded-[1.5rem] bg-[#1e3a8a] flex items-center justify-center text-white shadow-xl shadow-blue-200">
                 <CalendarIcon size={26} />
              </div>
              <div>
                 <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.4em] mb-1">Presence Registry Vault</p>
                 <div className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse border-2 border-white shadow-[0_0_10px_rgba(16,185,129,0.5)]" />
                    <p className="text-xs font-black text-slate-500 uppercase tracking-widest leading-none">Institutional Sync Live</p>
                 </div>
              </div>
           </div>
           <h1 className="text-6xl font-black text-slate-900 tracking-tighter leading-none mb-4">Attendance Audit</h1>
           <p className="text-xl font-bold text-slate-400 italic">Historical presence logs and predictive impact analysis.</p>
        </div>
        
        <div className="flex items-center gap-6 w-full md:w-auto">
           <button className="h-20 px-10 bg-white border border-slate-100 rounded-[2.5rem] flex items-center gap-4 text-[11px] font-black text-slate-700 uppercase tracking-widest shadow-sm hover:shadow-2xl transition-all">
              <Printer size={20} className="text-[#1e3a8a]"/> Export Audit
           </button>
           <button className="h-20 px-10 bg-[#1e3a8a] text-white rounded-[2.5rem] flex items-center gap-4 text-[11px] font-black uppercase tracking-widest shadow-2xl shadow-blue-900/40 hover:scale-105 active:scale-95 transition-all">
              <Plus size={20} /> Request Leave
           </button>
        </div>
      </div>

      {/* ─── KPI SUMMARY ─── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8 mb-20 px-2">
         <AttendanceKPI label="Overall Presence" value={`${stats.percentage}%`} icon={Activity} color="emerald" tag={stats.percentage >= 85 ? "Good Standing" : "At Risk"} />
         <AttendanceKPI label="Days Present" value={stats.present} icon={CheckCircle} color="indigo" tag="Registry" />
         <AttendanceKPI label="Days Absent" value={stats.absent} icon={XCircle} color="rose" tag="Critical" />
         <AttendanceKPI label="Days Late" value={stats.late} icon={Clock} color="amber" tag="Warnings" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 px-2">
         
         {/* LEFT: CALENDAR MATRIX */}
         <div className="lg:col-span-8">
            <div className="bg-white border border-slate-100 rounded-[4rem] p-12 shadow-sm relative overflow-hidden group hover:shadow-2xl transition-all">
               <div className="flex flex-col md:flex-row items-center justify-between mb-16 pb-8 border-b border-slate-50 gap-6">
                  <div className="flex items-center gap-10">
                     <div className="flex items-center gap-4">
                        <button onClick={handlePrevMonth} className="w-14 h-14 flex items-center justify-center bg-slate-50 rounded-[1.5rem] hover:bg-[#1e3a8a] hover:text-white transition-all shadow-inner"><ChevronLeft /></button>
                        <h2 className="text-3xl font-black text-slate-900 tracking-tighter min-w-[200px] text-center uppercase italic">{selectedDate.toLocaleString('default', { month: 'long', year: 'numeric' })}</h2>
                        <button onClick={handleNextMonth} className="w-14 h-14 flex items-center justify-center bg-slate-50 rounded-[1.5rem] hover:bg-[#1e3a8a] hover:text-white transition-all shadow-inner"><ChevronRight /></button>
                     </div>
                  </div>
                  <div className="flex items-center gap-8 bg-slate-50 px-8 py-3 rounded-full border border-slate-100">
                     <Legend color="bg-emerald-500" label="Present" />
                     <Legend color="bg-rose-500" label="Absent" />
                     <Legend color="bg-amber-500" label="Late" />
                  </div>
               </div>

               {loading ? (
                  <div className="py-40 flex flex-col items-center justify-center">
                     <Loader2 className="w-16 h-16 text-indigo-200 animate-spin mb-8" />
                     <p className="text-[11px] font-black text-slate-400 uppercase tracking-widest">Accessing Institutional Roster...</p>
                  </div>
               ) : (
                  <div className="grid grid-cols-7 gap-4">
                     {["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"].map(d => (
                       <div key={d} className="text-center text-[11px] font-black text-slate-300 tracking-[0.3em] mb-4">{d}</div>
                     ))}
                     
                     {Array.from({ length: firstDayOfMonth(selectedDate) }).map((_, i) => (
                       <div key={`e-${i}`} className="aspect-square rounded-[1.5rem]" />
                     ))}

                     {Array.from({ length: daysInMonth(selectedDate) }).map((_, i) => {
                        const day = i + 1;
                        const status = getDayStatus(day);
                        return (
                          <div key={day} className={`aspect-square rounded-[1.5rem] border flex flex-col items-center justify-center relative transition-all cursor-pointer shadow-sm ${
                             status === 'present' ? 'bg-emerald-500 border-emerald-600 text-white' :
                             status === 'absent' ? 'bg-rose-500 border-rose-600 text-white' :
                             status === 'late' ? 'bg-amber-500 border-amber-600 text-white' :
                             status === 'weekend' ? 'bg-slate-50 opacity-20 border-slate-100' : 'bg-white border-slate-100 hover:bg-slate-50'
                          }`}>
                             <span className={`text-2xl font-black italic`}>{day}</span>
                          </div>
                        );
                     })}
                  </div>
               )}
            </div>
         </div>

         {/* RIGHT: TRACE LOG & AI INFERENCE */}
         <div className="lg:col-span-4 flex flex-col gap-10">
            {/* RECENT ABSENCES/LATES */}
            <div className="bg-white border border-slate-100 rounded-[4rem] p-12 shadow-sm flex flex-col relative overflow-hidden group hover:shadow-xl transition-all">
               <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.4em] mb-10 border-l-4 border-rose-400 pl-6 leading-none italic">Recent Deviations</h3>

               <div className="space-y-4 flex-1">
                  {attendanceLogs.filter(a => a.status !== 'present').length === 0 ? (
                     <div className="h-full flex flex-col items-center justify-center text-center opacity-30 py-10 px-6">
                        <CheckCircle className="w-12 h-12 mb-6 text-emerald-500" />
                        <p className="text-[10px] font-black uppercase tracking-[0.15em] leading-relaxed">Systematic Perfect Attendance Logged.</p>
                     </div>
                  ) : (
                     attendanceLogs
                      .filter(a => a.status !== 'present')
                      .slice(0, 4)
                      .map((a, idx) => (
                        <div key={idx} className={`p-6 border rounded-[2.5rem] transition-all flex items-center gap-5 ${
                           a.status === 'absent' ? 'bg-rose-50 border-rose-100' : 'bg-amber-50 border-amber-100'
                        }`}>
                           <div className={`w-12 h-12 rounded-2xl flex items-center justify-center text-white shadow-xl ${
                              a.status === 'absent' ? 'bg-rose-500' : 'bg-amber-500'
                           }`}>
                              {a.status === 'absent' ? <XCircle size={20} /> : <Clock size={20} />}
                           </div>
                           <div className="flex-1">
                              <p className="text-lg font-black text-slate-800 tracking-tighter uppercase italic leading-none mb-1">
                                 {new Date(a.date).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })}
                              </p>
                              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                                 {a.note || `Reason: Institutional ${a.status.toUpperCase()}`}
                              </p>
                           </div>
                        </div>
                      ))
                  )}
               </div>
            </div>

            {/* ATTENDANCE POLICY */}
            <div className="bg-indigo-50 border border-indigo-100 rounded-[3.5rem] p-10 hover:bg-white hover:shadow-xl transition-all relative overflow-hidden group">
                <div className="absolute -bottom-6 -right-6 opacity-5 group-hover:rotate-12 transition-transform">
                   <Info size={100} />
                </div>
                <h4 className="text-[10px] font-black text-indigo-400 uppercase tracking-[0.4em] mb-4 italic">Institutional Policy</h4>
                <p className="text-slate-600 text-sm font-bold leading-relaxed mb-6">
                   Minimum <span className="text-[#10b981] font-black">85% attendance</span> required for comprehensive exam eligibility. 
                </p>
                <div className={`flex items-center gap-3 p-4 rounded-2xl border ${
                    stats.percentage >= 85 ? 'bg-emerald-50 border-emerald-100 text-emerald-700' : 'bg-rose-50 border-rose-100 text-rose-700'
                }`}>
                   {stats.percentage >= 85 ? <CheckCircle size={16} /> : <Info size={16} />}
                   <span className="text-[10px] font-black uppercase tracking-widest">
                      {studentData?.name || "Student"} is {stats.percentage >= 85 ? 'above threshold' : 'below requirement'}
                   </span>
                </div>
            </div>

            {/* AI INFERENCE */}
            <div className="bg-slate-900 rounded-[4rem] p-12 text-white shadow-2xl relative overflow-hidden group">
               <div className="absolute top-0 right-0 p-12 opacity-5 scale-150">
                  <BrainCircuit className="w-24 h-24 text-white" />
               </div>
               
               <div className="relative z-10">
                  <div className="flex items-center gap-4 mb-10">
                     <Sparkles className="w-6 h-6 text-amber-500 animate-pulse" />
                     <h3 className="text-[10px] font-black text-white/50 uppercase tracking-widest leading-none italic">Inference Engine</h3>
                  </div>

                  {analyzingAi ? (
                     <div className="space-y-4">
                        <div className="h-8 bg-white/5 rounded-xl animate-pulse" />
                        <div className="h-16 bg-white/5 rounded-xl animate-pulse" />
                     </div>
                  ) : (
                     <div className="space-y-6">
                        <p className="text-lg font-black italic tracking-tighter leading-tight border-l-4 border-white/20 pl-6">
                           "{aiCorrelation?.correlation_narrative || "Systematic presence detected. Learning pulse is consistent."}"
                        </p>
                        <div className="flex items-center gap-4 pt-4">
                           <div className="w-12 h-12 rounded-2xl bg-white/10 flex items-center justify-center text-amber-400 shadow-inner">
                              <TrendingUp size={24} />
                           </div>
                           <div>
                              <p className="text-[9px] font-black text-white/30 uppercase tracking-widest leading-none mb-1">Growth Mitigation</p>
                              <p className="text-xs font-black text-white uppercase tracking-tighter italic">{aiCorrelation?.growth_strategy || "Maintain Baseline Rhythm"}</p>
                           </div>
                        </div>
                     </div>
                  )}
               </div>
             </div>
          </div>
       </div>
    </div>
  );
};

const AttendanceKPI = ({ label, value, icon: Icon, color, tag }: any) => (
  <div className="bg-white border border-slate-100 p-10 rounded-[3.5rem] shadow-sm hover:translate-y-[-8px] hover:shadow-2xl transition-all group relative overflow-hidden text-left font-sans">
    <div className={`absolute -top-10 -right-10 w-32 h-32 bg-${color}-50 rounded-full blur-2xl group-hover:blur-3xl transition-all`} />
    <div className="flex items-center justify-between mb-10 relative z-10">
      <div className={`w-16 h-16 rounded-[1.8rem] bg-slate-50 flex items-center justify-center text-slate-400 group-hover:bg-[#1e3a8a] group-hover:text-white transition-all shadow-inner`}>
        <Icon size={30} />
      </div>
      <div className="px-5 py-2 rounded-full text-[9px] font-black uppercase tracking-[0.25em] border border-slate-50 bg-slate-50 text-slate-400 shadow-sm italic">
        {tag}
      </div>
    </div>
    <div className="relative z-10">
      <h2 className="text-6xl font-black tracking-tighter mb-2 text-slate-900 leading-none">{value}</h2>
      <p className="text-sm font-black text-slate-400 uppercase tracking-[0.4em]">{label}</p>
    </div>
  </div>
);

const Legend = ({ color, label }: any) => (
   <div className="flex items-center gap-3">
      <div className={`w-4 h-4 rounded-full ${color} shadow-lg`} />
      <span className="text-[11px] font-black text-slate-400 uppercase tracking-widest tabular-nums">{label}</span>
   </div>
);

export default AttendancePage;
