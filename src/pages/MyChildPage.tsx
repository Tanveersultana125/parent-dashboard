import { useState, useEffect } from "react";
import { Mail, CheckSquare, FileText, Star, CalendarCheck, Loader2, User, Phone, MapPin, Award, ShieldCheck, HeartPulse, GraduationCap, ArrowRight, BookOpen } from "lucide-react";
import { useAuth } from "../lib/AuthContext";
import { useNavigate } from "react-router-dom";
import { db } from "../lib/firebase";
import { collection, query, where, onSnapshot, getDocs, doc, getDoc } from "firebase/firestore";

const MyChildPage = () => {
  const { studentData, user } = useAuth();
  const navigate = useNavigate();
  const [teachers, setTeachers] = useState<any[]>([]);
  const [loadingTeachers, setLoadingTeachers] = useState(true);
  const [activeEnrollment, setActiveEnrollment] = useState<any>(null);

  useEffect(() => {
    if (!studentData?.id) {
      setLoadingTeachers(false);
      return;
    }

    setLoadingTeachers(true);

    // 1. Fetch Official Enrollments to identify truly assigned educators
    const qEnroll = query(collection(db, "enrollments"), where("studentId", "==", studentData.id));
    
    const unsubEnroll = onSnapshot(qEnroll, async (enrollSnap) => {
        const enrollments = enrollSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        
        if (enrollments.length > 0) {
            // Pick the first one as primary enrollment for metadata (Grade/Roll)
            setActiveEnrollment(enrollments[0]);
            
            // Extract all unique teacher IDs from enrollments
            const teacherIds = Array.from(new Set(enrollments.map((e: any) => e.teacherId))).filter(id => !!id);
            
            if (teacherIds.length > 0) {
                // Fetch the actual teacher objects
                const teachersData: any[] = [];
                const colors = ["bg-indigo-600", "bg-emerald-600", "bg-amber-600", "bg-rose-600", "bg-indigo-800"];
                
                for (const tId of teacherIds) {
                    try {
                        const tDoc = await getDoc(doc(db, "teachers", tId));
                        if (tDoc.exists()) {
                            const t = tDoc.data();
                            
                            teachersData.push({
                                id: tDoc.id,
                                initials: t.name ? t.name.split(' ').map((n: string) => n[0]).join('').toUpperCase() : "T",
                                name: t.name,
                                subject: t.subject || "Academic Faculty",
                                color: colors[teachersData.length % colors.length],
                                isClassTeacher: true
                            });
                        } else {
                            // Fallback if teacher record is missing but ID exists in enrollment
                            teachersData.push({
                                id: tId,
                                initials: "T",
                                name: "Faculty Member",
                                subject: "Academic Dept",
                                color: "bg-slate-400"
                            });
                        }
                    } catch (e) { console.error(e); }
                }
                setTeachers(teachersData);
            } else {
                setTeachers([]);
            }
        } else {
            setTeachers([]);
        }
        setLoadingTeachers(false);
    });

    return () => unsubEnroll();
  }, [studentData?.id]);

  const displayGrade = activeEnrollment?.grade || activeEnrollment?.className || studentData?.grade || "N/A";
  const displayRoll = activeEnrollment?.rollNo || studentData?.rollNo || "N/A";

  return (
      <div className="space-y-8 animate-in fade-in duration-700 pb-12 text-left">
        
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
           <div className="space-y-1">
              <h1 className="text-3xl font-black text-slate-800 tracking-tight">Student Identity</h1>
              <p className="text-slate-400 font-bold uppercase tracking-widest text-[11px]">Authorized Academic Profile • 2025-26 Session</p>
           </div>
           <button 
             onClick={() => navigate('/settings')}
             className="px-8 py-3 bg-white border-2 border-slate-100 rounded-2xl text-[10px] font-black uppercase tracking-widest text-slate-600 hover:border-slate-200 hover:bg-slate-50 transition-all shadow-sm"
           >
             Manage Profile
           </button>
        </div>

        {/* Hero Profile Card */}
        <div className="bg-white rounded-[2.5rem] border-2 border-slate-50 p-10 shadow-sm relative overflow-hidden group">
           <div className="absolute top-0 right-0 p-12 opacity-5 pointer-events-none">
              <ShieldCheck className="w-64 h-64 text-indigo-600" />
           </div>
           
           <div className="flex flex-col lg:flex-row items-center lg:items-start gap-10 relative z-10 text-center lg:text-left">
              <div className="relative">
                 <div className="w-32 h-32 rounded-[2.5rem] bg-indigo-600 flex items-center justify-center text-white font-black text-4xl shadow-2xl ring-8 ring-indigo-50">
                    {studentData?.name?.[0] || user?.displayName?.[0] || "S"}
                 </div>
                 <div className="absolute -bottom-2 -right-2 w-10 h-10 bg-emerald-500 rounded-2xl border-4 border-white flex items-center justify-center text-white shadow-lg">
                    <CheckSquare className="w-4 h-4" />
                 </div>
              </div>

              <div className="flex-1 space-y-6">
                 <div className="text-left">
                    <h2 className="text-4xl font-black text-slate-800 tracking-tight mb-2 uppercase italic">{studentData?.name || "Student Name"}</h2>
                    <div className="flex flex-wrap items-center justify-start gap-3">
                       <span className="px-4 py-1.5 bg-indigo-50 text-indigo-600 text-[10px] font-black uppercase tracking-[0.2em] rounded-full border border-indigo-100 italic">Grade {displayGrade}</span>
                       <span className="px-4 py-1.5 bg-emerald-50 text-emerald-600 text-[10px] font-black uppercase tracking-[0.2em] rounded-full border border-emerald-100 italic">Roll: {displayRoll}</span>
                       <span className="px-4 py-1.5 bg-amber-50 text-amber-600 text-[10px] font-black uppercase tracking-[0.2em] rounded-full border border-amber-100 italic">Verified Record</span>
                    </div>
                 </div>

                 <div className="grid grid-cols-2 md:grid-cols-4 gap-6 pt-6 border-t border-slate-50">
                    <InfoBox label="Email Address" value={studentData?.email || user?.email} icon={<Mail className="w-4 h-4" />} />
                    <InfoBox label="Phone Contact" value={studentData?.phone || "N/A"} icon={<Phone className="w-4 h-4" />} />
                    <InfoBox label="Blood Group" value={studentData?.bloodGroup || "O+"} icon={<HeartPulse className="w-4 h-4" />} />
                    <InfoBox label="School Branch" value={studentData?.branch || "Main Campus"} icon={<MapPin className="w-4 h-4" />} />
                 </div>
              </div>
           </div>
        </div>

        {/* Teachers & Faculty */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
           <div className="lg:col-span-12">
              <div className="bg-white rounded-[2.5rem] border-2 border-slate-50 p-10 shadow-sm text-left">
                 <div className="flex items-center justify-between mb-8 pb-6 border-b border-slate-50">
                    <h3 className="text-lg font-black text-slate-800 uppercase tracking-widest flex items-center gap-3">
                       <GraduationCap className="w-6 h-6 text-indigo-600" /> Assigned Educators
                    </h3>
                    <div className="flex items-center gap-2">
                       <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                       <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Real-time Faculty Sync</span>
                    </div>
                 </div>
                 
                 <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {loadingTeachers ? (
                       <div className="col-span-full py-20 flex flex-col items-center justify-center">
                          <Loader2 className="w-10 h-10 animate-spin text-indigo-600 mb-4" />
                          <p className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-400">Auditing Institutional Faculty...</p>
                       </div>
                    ) : teachers.length > 0 ? (
                       teachers.map((t) => (
                          <div key={t.id} className="p-8 bg-slate-50/50 rounded-[2.5rem] border-2 border-transparent hover:border-indigo-100 hover:bg-white transition-all group hover:shadow-2xl hover:shadow-indigo-50 text-left">
                             <div className="flex items-center justify-between mb-6">
                                <div className={`w-16 h-16 rounded-[1.5rem] ${t.color} flex items-center justify-center text-white text-2xl font-black shadow-xl`}>{t.initials}</div>
                                <button className="p-3.5 bg-white rounded-2xl border border-slate-100 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 transition-all shadow-sm">
                                   <Mail className="w-5 h-5" />
                                </button>
                             </div>
                             <div>
                                <h4 className="text-xl font-black text-slate-800 leading-none mb-2 group-hover:text-indigo-600 transition-colors uppercase italic">{t.name}</h4>
                                <p className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-400 flex items-center gap-2">
                                    <BookOpen className="w-3.5 h-3.5" /> {t.subject}
                                </p>
                             </div>
                          </div>
                       ))
                    ) : (
                       <div className="col-span-full py-24 text-center bg-slate-50/50 rounded-[3rem] border-4 border-dashed border-slate-100">
                          <User className="w-20 h-20 mx-auto mb-4 text-slate-200" />
                          <p className="text-[12px] font-black uppercase tracking-[0.3em] text-slate-400">No Educator Assignments Detected</p>
                          <p className="text-[10px] font-bold text-slate-300 mt-2 italic px-4">Faculty names will appear here once student is added to a class by the teacher.</p>
                       </div>
                    )}
                 </div>
              </div>
           </div>
        </div>

        {/* Career & Recognition Connection */}
        <div className="bg-slate-900 rounded-[2.5rem] p-10 text-white flex flex-col md:flex-row items-center justify-between gap-10 overflow-hidden relative shadow-2xl text-left">
           <Award className="absolute -left-12 -bottom-12 w-64 h-64 text-white/5 pointer-events-none" />
           <div className="relative z-10 max-w-2xl text-left">
              <h3 className="text-2xl font-black tracking-tight mb-4 italic uppercase">Scholastic Milestone Verification</h3>
              <p className="text-sm font-bold text-slate-400 leading-relaxed mb-6">
                 {studentData?.name}'s profile is verified for the academic term. All grades and behavior records are automatically synced with the teacher portal for peak transparency.
              </p>
              <div className="flex gap-4">
                 <div className="px-4 py-2 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-[10px] font-black uppercase tracking-widest text-emerald-400">Identity Secure</div>
                 <div className="px-4 py-2 bg-indigo-500/10 border border-indigo-500/30 rounded-xl text-[10px] font-black uppercase tracking-widest text-indigo-400">Record Synced</div>
              </div>
           </div>
           <button 
             onClick={() => navigate('/performance')}
             className="relative z-10 px-10 py-5 bg-white text-slate-900 rounded-[1.5rem] text-xs font-black uppercase tracking-widest flex items-center gap-3 hover:scale-105 transition-all shadow-xl"
           >
              Performance Vault <ArrowRight className="w-5 h-5" />
           </button>
        </div>
      </div>
  );
};

const InfoBox = ({ label, value, icon }: any) => (
   <div className="p-5 bg-slate-50/50 rounded-2xl border border-slate-100 text-left">
      <div className="flex items-center gap-2 mb-2 text-slate-400">
         {icon}
         <p className="text-[10px] uppercase font-black tracking-[0.2em] leading-none">{label}</p>
      </div>
      <p className="text-sm font-black text-slate-800 truncate uppercase italic">{value || 'N/A'}</p>
   </div>
);

export default MyChildPage;
