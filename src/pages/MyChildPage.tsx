import React, { useState, useEffect } from "react";
import { 
  User, Calendar, HeartPulse, Phone, Clock, GraduationCap, 
  Mail, MessageSquare, CheckCircle, FileText, Star, Edit, ChevronRight, Users, X, Save, Loader2
} from "lucide-react";
import { useAuth } from "../lib/AuthContext";
import { db } from "../lib/firebase";
import { collection, query, where, onSnapshot, getDocs, doc, updateDoc } from "firebase/firestore";
import { toast } from "sonner";

const MyChildPage = () => {
  const { studentData } = useAuth();
  
  // Real-time states
  const [teachers, setTeachers] = useState<any[]>([]);
  const [enrollmentInfo, setEnrollmentInfo] = useState({
    className: "N/A",
    rollNo: "N/A"
  });
  const [overview, setOverview] = useState({
    attendance: "0%",
    assignments: "0/0",
    testsTaken: 0,
    avgGrade: "N/A"
  });
  const [loading, setLoading] = useState(true);

  // Edit State
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [formData, setFormData] = useState({
    dob: "",
    bloodGroup: "",
    parentPhone: "",
    emergencyContact: "",
    admissionDate: ""
  });

  useEffect(() => {
    if (!studentData?.id) return;
    setLoading(true);

    // Initial Form Data Sync
    setFormData({
        dob: studentData.dob || "",
        bloodGroup: studentData.bloodGroup || "",
        parentPhone: studentData.parentPhone || "",
        emergencyContact: studentData.emergencyContact || "",
        admissionDate: studentData.admissionDate || ""
    });
    
    // 1. Fetch Teachers & Enrollment Info
    const qEnroll = query(collection(db, "enrollments"), where("studentId", "==", studentData.id));
    const unsubEnroll = onSnapshot(qEnroll, (snap) => {
        if (!snap.empty) {
            const first = snap.docs[0].data();
            setEnrollmentInfo({
                className: first.className || "N/A",
                rollNo: first.rollNo || "N/A"
            });
        }

        const data = snap.docs.map(d => ({
            id: d.id,
            name: d.data().teacherName || "Institutional Faculty",
            subject: d.data().subject || d.data().className || "Curriculum",
            teacherId: d.data().teacherId,
            initials: (d.data().teacherName || "F").split(' ').map((n: string) => n[0]).join('').toUpperCase().substring(0, 2)
        }));
        setTeachers(data);
    });

    // 2. Performance & Term Overview
    const qAtt = query(collection(db, "attendance"), where("studentId", "==", studentData.id));
    const unsubAtt = onSnapshot(qAtt, (snap) => {
        const records = snap.docs.map(d => d.data());
        const present = records.filter(r => r.status === 'present' || r.status === 'late').length;
        const total = records.length;
        setOverview(prev => ({ ...prev, attendance: total === 0 ? "100%" : `${Math.round((present/total)*100)}%` }));
    });

    const qAssign = query(collection(db, "assignments"));
    const unsubAssign = onSnapshot(qAssign, async (aSnap) => {
        const enrollmentsSnap = await getDocs(qEnroll);
        const myClassIds = new Set(enrollmentsSnap.docs.map(d => d.data().classId));
        const myAssignments = aSnap.docs.filter(d => myClassIds.has(d.data().classId));
        const totalA = myAssignments.length;

        const qSubs = query(collection(db, "submissions"), where("studentId", "==", studentData.id));
        const subSnap = await getDocs(qSubs);
        const completedA = subSnap.docs.length;
        setOverview(prev => ({ ...prev, assignments: `${completedA}/${totalA}` }));
    });

    const qRes = query(collection(db, "results"), where("studentId", "==", studentData.id));
    const unsubRes = onSnapshot(qRes, (snap) => {
        const results = snap.docs.map(d => d.data());
        const count = results.length;
        const avg = count > 0 ? results.reduce((acc, curr) => acc + (parseFloat(curr.score) || 0), 0) / count : 0;
        const getGradeLetter = (s: number) => s >= 90 ? "A+" : s >= 80 ? "A" : s >= 70 ? "B+" : s >= 60 ? "B" : "C";
        setOverview(prev => ({ ...prev, testsTaken: count, avgGrade: count > 0 ? getGradeLetter(avg) : "N/A" }));
    });

    setLoading(false);
    return () => { unsubEnroll(); unsubAtt(); unsubAssign(); unsubRes(); };
  }, [studentData?.id, studentData]);

  const handleSaveProfile = async () => {
     if (!studentData?.id) return;
     setIsSaving(true);
     try {
        await updateDoc(doc(db, "students", studentData.id), formData);
        toast.success("Identity Trace Synchronized Successfully.");
        setIsEditModalOpen(false);
     } catch (e) {
        toast.error("Registry Connection Failure.");
        console.error(e);
     } finally {
        setIsSaving(false);
     }
  };

  const teacherColors = ["bg-[#1e3a8a]", "bg-emerald-600", "bg-orange-500", "bg-indigo-600"];

  return (
    <div className="animate-in fade-in duration-700 pb-20 text-left font-sans">
      
      {/* ── HEADER BREADCRUMB ── */}
      <div className="flex justify-between items-center mb-10 px-4">
          <p className="text-[10px] font-black text-slate-900 uppercase tracking-[0.3em] opacity-80 italic">RESULT OF CLICK: "MY CHILD"</p>
          <button 
             onClick={() => setIsEditModalOpen(true)}
             className="flex items-center gap-2 px-5 py-2.5 bg-slate-900 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-slate-800 transition-all shadow-lg active:scale-95">
             <Edit size={14} /> Edit Profile
          </button>
      </div>

      {/* ── PROFILE CARD ── */}
      <div className="bg-white border border-slate-100 rounded-[3rem] p-10 mb-10 shadow-sm relative group overflow-hidden">
         <div className="absolute top-0 right-0 p-10 opacity-[0.03] scale-150 rotate-12 transition-transform duration-1000 group-hover:rotate-0">
            <User className="w-64 h-64 text-[#1e3a8a]" />
         </div>

         <div className="flex flex-col lg:flex-row items-center gap-10 relative z-10 border-b border-slate-50 pb-10 mb-10">
            <div className="w-36 h-36 rounded-[3rem] bg-[#1e3a8a] text-white flex items-center justify-center text-5xl font-black italic shadow-2xl group-hover:rotate-3 transition-transform">
               {studentData?.name?.[0] || 'A'}
            </div>
            
            <div className="flex-1 text-center lg:text-left">
               <div className="flex flex-col lg:flex-row lg:items-center gap-4 mb-4">
                  <h1 className="text-5xl font-black text-slate-900 tracking-tighter uppercase italic">{studentData?.name}</h1>
                  <div className="flex justify-center items-center gap-2">
                     <span className="px-5 py-1.5 bg-emerald-50 text-emerald-600 text-[10px] font-black uppercase tracking-widest rounded-full border border-emerald-100">Active</span>
                     <span className="px-5 py-1.5 bg-indigo-50 text-indigo-600 text-[10px] font-black uppercase tracking-widest rounded-full border border-indigo-100">2025-26</span>
                  </div>
               </div>
               <p className="text-xl font-bold text-slate-400 capitalize">
                  Class {enrollmentInfo.className} • Roll Number {enrollmentInfo.rollNo || "N/A"}
               </p>
            </div>
         </div>

         <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-10 relative z-10">
            <InfoBlock label="Date of Birth" value={studentData?.dob || "15 March 2012"} icon={Calendar} />
            <InfoBlock label="Blood Group" value={studentData?.bloodGroup || "O+"} icon={HeartPulse} />
            <InfoBlock label="Emergency Contact" value={studentData?.parentPhone || studentData?.emergencyContact || "+91 98765 43210"} icon={Phone} />
            <InfoBlock label="Admission Date" value={studentData?.admissionDate || "June 2020"} icon={Clock} />
         </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
         <div className="lg:col-span-7 bg-white border border-slate-100 rounded-[3rem] p-10 shadow-sm overflow-hidden flex flex-col">
            <h3 className="text-2xl font-black text-slate-800 mb-10 tracking-tight">Teachers</h3>
            <div className="space-y-6 flex-1 max-h-[400px] overflow-y-auto no-scrollbar pr-2">
               {teachers.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center py-20 opacity-30">
                     <Users size={48} className="mb-4" />
                     <p className="text-[11px] font-black uppercase tracking-widest italic">Synchronizing Faculty List...</p>
                  </div>
               ) : (
                  teachers.map((t, idx) => (
                     <div key={idx} className="p-6 bg-slate-50/50 border border-slate-100 rounded-3xl flex items-center justify-between group hover:bg-white hover:shadow-xl transition-all">
                        <div className="flex items-center gap-6">
                           <div className={`w-14 h-14 rounded-2xl ${teacherColors[idx % teacherColors.length]} flex items-center justify-center text-white text-xl font-black italic shadow-lg group-hover:rotate-6 transition-transform`}>{t.initials}</div>
                           <div>
                              <h4 className="text-lg font-black text-slate-800 tracking-tight uppercase leading-none mb-1">{t.name}</h4>
                              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{t.subject}</p>
                           </div>
                        </div>
                        <button className="w-12 h-12 rounded-2xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 hover:bg-[#1e3a8a] hover:text-white transition-all shadow-sm">
                           <MessageSquare size={18} />
                        </button>
                     </div>
                  ))
               )}
            </div>
         </div>
         <div className="lg:col-span-5 bg-white border border-slate-100 rounded-[3rem] p-10 shadow-sm flex flex-col">
            <h3 className="text-2xl font-black text-slate-800 mb-10 tracking-tight">This Term Overview</h3>
            <div className="space-y-8 flex-1 flex flex-col justify-center">
               <OverviewRow icon={Calendar} label="Attendance" value={overview.attendance} color="emerald" />
               <OverviewRow icon={CheckCircle} label="Assignments" value={overview.assignments} color="indigo" />
               <OverviewRow icon={FileText} label="Tests Taken" value={overview.testsTaken.toString()} color="amber" />
               <OverviewRow icon={Star} label="Average Grade" value={overview.avgGrade} color="emerald" />
            </div>
         </div>
      </div>

      {/* ── EDIT MODAL ── */}
      {isEditModalOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 sm:p-10">
             <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-md animate-in fade-in duration-300" onClick={() => setIsEditModalOpen(false)} />
             <div className="bg-white rounded-[3.5rem] w-full max-w-2xl shadow-2xl relative z-10 overflow-hidden animate-in zoom-in-95 duration-300">
                <div className="p-10 border-b border-slate-50 bg-slate-50/50 flex justify-between items-center">
                   <div>
                      <h2 className="text-3xl font-black text-slate-900 tracking-tighter leading-none italic uppercase">Update Identity</h2>
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.3em] mt-2">Institutional Sync Gateway</p>
                   </div>
                   <button onClick={() => setIsEditModalOpen(false)} className="w-12 h-12 rounded-2xl bg-white border border-slate-100 flex items-center justify-center text-slate-300 hover:text-slate-600 transition-all hover:rotate-90">
                      <X size={20} />
                   </button>
                </div>
                
                <div className="p-10 grid grid-cols-1 md:grid-cols-2 gap-8">
                   <EditInput label="Date of Birth" value={formData.dob} onChange={(v) => setFormData({...formData, dob:v})} placeholder="e.g., 15 March 2012" />
                   <EditInput label="Blood Group" value={formData.bloodGroup} onChange={(v) => setFormData({...formData, bloodGroup:v})} placeholder="e.g., O+" />
                   <EditInput label="Parent Contact" value={formData.parentPhone} onChange={(v) => setFormData({...formData, parentPhone:v})} placeholder="e.g., +91 98765..." />
                   <EditInput label="Admission Date" value={formData.admissionDate} onChange={(v) => setFormData({...formData, admissionDate:v})} placeholder="e.g., June 2020" />
                </div>

                <div className="p-10 bg-slate-50/50 flex flex-col sm:flex-row gap-4">
                   <button 
                      onClick={() => setIsEditModalOpen(false)}
                      className="flex-1 h-16 bg-white border border-slate-200 text-slate-400 rounded-2xl text-[11px] font-black uppercase tracking-widest hover:bg-slate-50 transition-all">
                      Discard Changes
                   </button>
                   <button 
                      onClick={handleSaveProfile}
                      disabled={isSaving}
                      className="flex-[2] h-16 bg-[#1e3a8a] text-white rounded-2xl text-[11px] font-black uppercase tracking-widest shadow-2xl shadow-blue-900/30 hover:scale-[1.02] active:scale-95 transition-all flex items-center justify-center gap-3">
                      {isSaving ? <Loader2 className="animate-spin" size={18} /> : <Save size={18} />}
                      Verify & Synchronize
                   </button>
                </div>
             </div>
          </div>
      )}
    </div>
  );
};

const IdentityBit = ({ label, value, icon: Icon }: any) => (
   <div className="text-left group/bit">
      <div className="flex items-center gap-2 mb-2">
         <Icon size={12} className="text-slate-300 group-hover/bit:text-[#1e3a8a] transition-colors" />
         <p className="text-[9px] font-black text-slate-300 uppercase tracking-widest leading-none">{label}</p>
      </div>
      <p className="text-base font-black text-slate-800 tracking-tight italic uppercase">{value || 'N/A'}</p>
   </div>
);

const InfoBlock = ({ label, value, icon: Icon }: any) => (
   <div className="p-6 bg-slate-50 rounded-[2rem] border border-slate-100 flex-1 hover:bg-white hover:shadow-xl transition-all group/info">
      <div className="flex items-center gap-3 mb-2">
         <Icon size={14} className="text-slate-300 group-hover/info:text-[#1e3a8a] transition-colors" />
         <span className="text-[9px] font-black text-slate-300 uppercase tracking-widest leading-none">{label}</span>
      </div>
      <p className="text-base font-black text-slate-800 tracking-tight">{value}</p>
   </div>
);

const OverviewRow = ({ icon: Icon, label, value, color }: any) => {
   const colors = {
      emerald: "bg-emerald-50 text-emerald-500",
      indigo: "bg-indigo-50 text-indigo-500",
      amber: "bg-amber-50 text-amber-500"
   };
   const colorClass = colors[color as keyof typeof colors] || colors.indigo;
   return (
      <div className="flex items-center justify-between p-4 hover:bg-slate-50 rounded-[2rem] transition-all group/row">
         <div className="flex items-center gap-6">
            <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${colorClass} shadow-inner group-hover/row:scale-110 transition-transform`}>
               <Icon size={20} />
            </div>
            <span className="text-base font-bold text-slate-500 italic uppercase tracking-tighter">{label}</span>
         </div>
         <span className={`text-2xl font-black ${color === 'emerald' ? 'text-emerald-500' : (color === 'amber' ? 'text-amber-500' : 'text-[#1e3a8a]')} tracking-tighter`}>{value}</span>
      </div>
   );
};

const EditInput = ({ label, value, onChange, placeholder }: any) => (
   <div className="space-y-3">
      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">{label}</label>
      <input 
         type="text" 
         value={value} 
         onChange={(e) => onChange(e.target.value)}
         placeholder={placeholder}
         className="w-full h-14 bg-white border border-slate-100 rounded-2xl px-6 text-sm font-bold text-slate-800 focus:ring-4 focus:ring-blue-50 focus:border-[#1e3a8a] transition-all outline-none italic placeholder:text-slate-200"
      />
   </div>
);

export default MyChildPage;
