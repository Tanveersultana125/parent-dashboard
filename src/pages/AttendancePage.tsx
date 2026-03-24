import { useState, useEffect } from "react";
import { CheckCircle, XCircle, Clock, Calendar as CalendarIcon, ChevronLeft, ChevronRight, FileText, Printer, Plus, Loader2, Info, Sparkles, MapPin, BrainCircuit, GraduationCap } from "lucide-react";
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

  useEffect(() => {
    if (!studentData?.id) return;

    setLoading(true);
    // Real-time synchronization with institutional logs
    const q = query(
      collection(db, "attendance"),
      where("studentId", "==", studentData.id),
      orderBy("date", "desc")
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const logs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setAttendanceLogs(logs);

      // Re-calculate institutional health stats
      const pCount = logs.filter((l: any) => l.status === 'present').length;
      const aCount = logs.filter((l: any) => l.status === 'absent').length;
      const lCount = logs.filter((l: any) => l.status === 'late').length;
      const total = pCount + aCount + lCount;
      const pct = total === 0 ? 100 : Math.round(((pCount + lCount) / total) * 100);

      setStats({
        present: pCount,
        absent: aCount,
        late: lCount,
        percentage: pct
      });
      setLoading(false);
    }, (error) => {
      console.error("Attendance Sync Error:", error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [studentData?.id]);

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
    const log = attendanceLogs.find(l => l.date === dateStr);
    
    if (log) return log.status as DayStatus;
    if (d.getDay() === 0) return "weekend";
    return "empty";
  };

  return (
      <div className="space-y-10 animate-in fade-in slide-in-from-bottom-6 duration-700 pb-20 text-left">
        
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-8 pb-4">
          <div className="space-y-2">
            <h1 className="text-4xl font-black text-slate-900 tracking-tight flex items-center gap-4">
              Attendance Vault <CalendarIcon className="w-10 h-10 text-indigo-600 animate-pulse" />
            </h1>
            <p className="text-slate-400 font-bold uppercase tracking-[0.2em] text-[11px] flex items-center gap-2">
               <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" /> Live Institutional Log Synchronization Active
            </p>
          </div>
          
          <div className="flex gap-4">
             <button className="px-8 py-4 bg-white border border-slate-100 rounded-[2rem] text-[10px] font-black uppercase tracking-widest text-slate-500 hover:border-indigo-600 hover:text-indigo-600 transition-all flex items-center gap-2 shadow-sm">
                <Printer className="w-4 h-4" /> Export Audit Log
             </button>
             <button className="px-8 py-4 bg-slate-950 text-white rounded-[2rem] text-[10px] font-black uppercase tracking-widest shadow-2xl hover:scale-105 transition-all flex items-center gap-2">
                <Plus className="w-4 h-4" /> Request Absence
             </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
           <AttendanceStat label="Sync Health" value={`${stats.percentage}%`} icon={<CheckCircle className="w-5 h-5" />} color="emerald" trend="Optimal" />
           <AttendanceStat label="Days Present" value={stats.present} icon={<FileText className="w-5 h-5" />} color="indigo" trend="Authenticated" />
           <AttendanceStat label="Late Arrivals" value={stats.late} icon={<Clock className="w-5 h-5" />} color="amber" trend="Recorded" />
           <AttendanceStat label="Total Absences" value={stats.absent} icon={<XCircle className="w-5 h-5" />} color="rose" trend="High Priority" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
           <div className="lg:col-span-8">
              <div className="bg-white rounded-[3.5rem] border border-slate-50 p-10 shadow-sm h-full relative overflow-hidden text-left">
                 <div className="flex items-center justify-between mb-10 pb-6 border-b border-slate-50">
                    <div className="flex items-center gap-6">
                       <button onClick={handlePrevMonth} className="w-12 h-12 flex items-center justify-center bg-slate-50 rounded-2xl hover:bg-slate-100 text-slate-400 hover:text-indigo-600 transition-all"><ChevronLeft className="w-6 h-6"/></button>
                       <h3 className="text-2xl font-black text-slate-900 tracking-tight">{selectedDate.toLocaleString('default', { month: 'long', year: 'numeric' })}</h3>
                       <button onClick={handleNextMonth} className="w-12 h-12 flex items-center justify-center bg-slate-50 rounded-2xl hover:bg-slate-100 text-slate-400 hover:text-indigo-600 transition-all"><ChevronRight className="w-6 h-6"/></button>
                    </div>
                    <div className="hidden xl:flex items-center gap-6">
                       <LegendItem color="bg-emerald-500" label="Present" />
                       <LegendItem color="bg-rose-500" label="Absent" />
                       <LegendItem color="bg-amber-500" label="Late" />
                       <LegendItem color="bg-slate-200" label="Empty" />
                    </div>
                 </div>

                 {loading ? (
                    <div className="py-32 flex flex-col items-center justify-center">
                       <Loader2 className="w-14 h-14 text-indigo-600 animate-spin mb-6" />
                       <p className="text-[11px] font-black text-slate-400 uppercase tracking-widest">Accessing Institutional Database...</p>
                    </div>
                 ) : (
                    <div className="grid grid-cols-7 gap-4">
                       {["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"].map(d => (
                         <div key={d} className="text-center text-[10px] font-black text-slate-300 tracking-[0.25em] mb-4">{d}</div>
                       ))}
                       
                       {Array.from({ length: firstDayOfMonth(selectedDate) }).map((_, i) => (
                         <div key={`empty-${i}`} className="h-20 lg:h-32 rounded-[2rem] border border-transparent" />
                       ))}

                       {Array.from({ length: daysInMonth(selectedDate) }).map((_, i) => {
                          const day = i + 1;
                          const status = getDayStatus(day);
                          return (
                            <div key={day} className={`h-20 lg:h-32 rounded-[2.5rem] border flex flex-col items-center justify-center relative group transition-all cursor-default ${
                               status === 'present' ? 'bg-emerald-50 border-emerald-100 shadow-emerald-500/5' :
                               status === 'absent' ? 'bg-rose-50 border-rose-100 shadow-rose-500/5' :
                               status === 'late' ? 'bg-amber-50 border-amber-100 shadow-amber-500/5' :
                               status === 'weekend' ? 'bg-slate-50 border-slate-100 opacity-60' : 'bg-white border-slate-50 hover:border-slate-200'
                            }`}>
                               <span className={`text-base font-black ${status === 'empty' ? 'text-slate-400' : 'text-slate-800'}`}>{day}</span>
                               <div className={`w-2 h-2 rounded-full absolute bottom-4 ${
                                  status === 'present' ? 'bg-emerald-500 shadow-lg shadow-emerald-500/50' :
                                  status === 'absent' ? 'bg-rose-500 shadow-lg shadow-rose-500/50' :
                                  status === 'late' ? 'bg-amber-500 shadow-lg shadow-amber-500/50' : 'hidden'
                               }`} />
                            </div>
                          );
                       })}
                    </div>
                 )}
              </div>
           </div>

           <div className="lg:col-span-4 space-y-10">
              <div className="bg-white rounded-[3.5rem] border border-slate-50 p-10 shadow-sm text-left">
                 <h3 className="text-[11px] font-black text-slate-800 uppercase tracking-[0.2em] mb-10 flex justify-between items-center">
                    Registry Trace Log
                    <FileText className="w-5 h-5 text-slate-300" />
                 </h3>
                 <div className="space-y-6">
                    {attendanceLogs.length === 0 ? (
                        <div className="p-16 text-center border-2 border-dashed border-slate-100 rounded-[2.5rem]">
                            <Info className="w-12 h-12 text-slate-100 mx-auto mb-4" />
                            <p className="text-[10px] font-black text-slate-300 uppercase tracking-widest leading-relaxed italic">History will populate after faculty synchronization.</p>
                        </div>
                    ) : (
                        attendanceLogs.slice(0, 6).map((a, idx) => (
                           <div key={idx} className="flex items-center gap-5 p-5 hover:bg-slate-50 rounded-[2rem] transition-all group">
                              <div className={`w-14 h-14 rounded-2xl flex items-center justify-center text-white text-[10px] font-black shadow-lg ${
                                 a.status === "absent" ? "bg-rose-500" : 
                                 a.status === "late" ? "bg-amber-500" : "bg-emerald-500"
                              }`}>
                                 {a.status?.[0].toUpperCase()}
                              </div>
                              <div className="flex-1 text-left">
                                 <p className="text-sm font-black text-slate-900 group-hover:text-indigo-600 transition-colors uppercase tracking-tight">
                                    {(() => {
                                       const [y, m, dayNum] = a.date.split('-').map(Number);
                                       return new Date(y, m-1, dayNum).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
                                    })()}
                                    {" "} Entry
                                 </p>
                                 <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2 mt-1">
                                    <MapPin className="w-3 h-3"/> {a.className || "Registry"}
                                 </p>
                                 <p className="text-[10px] font-black text-[#1e3a8a] uppercase tracking-widest flex items-center gap-2 mt-0.5 opacity-80">
                                    <GraduationCap className="w-3 h-3"/> {a.teacherName || "Faculty"}
                                 </p>
                              </div>
                           </div>
                        ))
                    )}
                 </div>
              </div>

              <div className="bg-[#1e3a8a] rounded-[3.5rem] p-10 text-white relative overflow-hidden shadow-2xl group text-left h-full flex flex-col">
                 <Sparkles className="absolute -bottom-10 -right-10 w-48 h-48 text-white/5 group-hover:rotate-12 transition-transform duration-1000" />
                 <div className="bg-white/10 w-14 h-14 rounded-2xl flex items-center justify-center mb-10 shadow-inner">
                    <BrainCircuit className="w-8 h-8 text-indigo-200" />
                 </div>
                 <h3 className="text-2xl font-black leading-tight mb-6">Attendance Correlation</h3>
                 <div className="flex-1">
                    {analyzingAi ? (
                       <div className="flex items-center gap-3 animate-pulse">
                          <Loader2 className="w-5 h-5 animate-spin" />
                          <p className="text-xs font-black uppercase tracking-widest text-blue-200">Analyzing Presence Patterns...</p>
                       </div>
                    ) : aiCorrelation ? (
                       <>
                          <p className="text-base font-bold text-blue-100 leading-relaxed italic border-l-4 border-indigo-400 pl-6 mb-8 group-hover:text-white transition-colors">
                             "{aiCorrelation.correlation_narrative}"
                          </p>
                          <div className="space-y-3 mb-10">
                             {aiCorrelation.impact_analysis?.map((point: string, i: number) => (
                                <div key={i} className="flex gap-3 items-start">
                                   <div className="w-1.5 h-1.5 rounded-full bg-indigo-400 mt-1.5 shrink-0" />
                                   <p className="text-[11px] font-bold text-blue-100/70">{point}</p>
                                </div>
                             ))}
                          </div>
                       </>
                    ) : (
                       <p className="text-sm font-bold text-blue-100/70 mb-10 leading-relaxed italic border-l-4 border-indigo-400 pl-6">
                          "Consistent scholars exhibit higher retention rates. Attendance is the fuel for mastery."
                       </p>
                    )}
                 </div>
                 <button className="w-full py-5 bg-white/10 border border-white/20 rounded-2xl text-[10px] font-black uppercase tracking-[0.2em] hover:bg-white hover:text-[#1e3a8a] transition-all shadow-xl mt-auto">
                    {aiCorrelation?.growth_strategy || "View Impact Analysis"}
                 </button>
              </div>
           </div>
        </div>
      </div>
  );
};

const AttendanceStat = ({ label, value, icon, color, trend }: any) => (
   <div className="bg-white rounded-[2.5rem] border border-slate-50 p-8 shadow-sm hover:translate-y-[-4px] transition-all group text-left">
      <div className="flex items-center gap-6 mb-8">
         <div className={`w-14 h-14 rounded-2xl bg-${color}-500 flex items-center justify-center text-white shadow-lg shadow-${color}-200 group-hover:scale-110 transition-transform`}>
            {icon}
         </div>
         <div className="text-left">
            <p className="text-3xl font-black text-slate-900 leading-none">{value}</p>
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-1">{label}</p>
         </div>
      </div>
      <div className="pt-6 border-t border-slate-50 flex items-center justify-between">
         <span className={`text-[11px] font-black text-${color}-600 uppercase tracking-widest`}>{trend}</span>
      </div>
   </div>
);

const LegendItem = ({ color, label }: any) => (
   <div className="flex items-center gap-3">
      <div className={`w-3 h-3 rounded-full ${color} shadow-sm`} />
      <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{label}</span>
   </div>
);

export default AttendancePage;
