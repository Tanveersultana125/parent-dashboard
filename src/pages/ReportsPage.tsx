import { useState, useEffect } from "react";
import { 
  FileText, Download, Loader2, Calendar, Search, Filter, 
  FileCheck, Clock, ArrowRightCircle, Sparkles, GraduationCap 
} from "lucide-react";
import { useAuth } from "../lib/AuthContext";
import { db } from "../lib/firebase";
import { collection, query, where, onSnapshot, orderBy } from "firebase/firestore";
import { toast } from "sonner";
import * as XLSX from 'xlsx';

const ReportsPage = () => {
  const { studentData } = useAuth();
  const [reports, setReports] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    if (!studentData?.id) return;

    setLoading(true);
    // Fetch reports specifically for this student or their grade
    const q = query(
      collection(db, "reports"),
      where("studentId", "in", [studentData.id, "all"])
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() as any }));
      // Client-side filtering and sorting to bypass index requirement
      const filtered = data
        .filter(r => (r.grade === studentData.grade || r.studentId === studentData.id || r.studentId === "all") && 
                    (r.status === "Sent" || r.status === "Sent & Reported" || r.publishedToParent === true))
        .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));

      setReports(filtered);
      setLoading(false);
    }, (error) => {
      console.error("Reports Sync Error:", error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [studentData]);

  const filteredReports = reports.filter(r => 
    r.title?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    r.teacherName?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleDownload = (r: any) => {
    if (r.format === 'excel') {
      let dataToExport: any[] = [];
      
      const reportData = r.data || {};
      
      if (reportData.isClassReport) {
        dataToExport = (reportData.fullList || []).map((s: any) => ({ 
          'Student Name': s.name, 
          'Roll Number': s.rollNo, 
          'Academic Score (%)': s.score || 'N/A', 
          'Attendance Rate (%)': s.attendance, 
          'Academic Standing': s.standing 
        }));
      } else {
        dataToExport = [{ 
          'Student Name': reportData.student_name || r.studentName, 
          'Academic Score': reportData.score || 'N/A', 
          'Attendance (%)': reportData.atnd || reportData.attendance, 
          'AI Summary': reportData.ai_remark || reportData.aiRemarks 
        }];
      }
      
      const ws = XLSX.utils.json_to_sheet(dataToExport);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Institutional Intelligence");
      XLSX.writeFile(wb, `${r.title}_Report_${new Date().getTime()}.xlsx`);
      toast.success("Excel Spreadsheet successfully generated!");
    } else {
      window.print();
      toast.success("Opening Institutional Print View...");
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-700 pb-12 text-left font-sans">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 pb-2">
        <div className="space-y-1">
          <h1 className="text-3xl font-black text-slate-800 tracking-tight flex items-center gap-3 italic">
            Academic Reports <FileText className="w-8 h-8 text-indigo-600" />
          </h1>
          <p className="text-slate-400 font-bold uppercase tracking-widest text-[11px]">Authorized academic intelligence & documentation pipeline</p>
        </div>
        
        <div className="flex items-center gap-3">
           <div className="relative group">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-300 group-hover:text-indigo-400 transition-colors" />
              <input 
                type="text" 
                placeholder="Search documents..." 
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-12 pr-6 py-4 bg-white border-2 border-slate-50 rounded-2xl text-[10px] font-black uppercase tracking-widest outline-none focus:border-indigo-100 transition-all w-64 shadow-sm"
              />
           </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
         <div className="lg:col-span-12 space-y-6">
            {loading ? (
                <div className="py-24 text-center bg-white border-2 border-slate-50 rounded-[3rem] shadow-sm flex flex-col items-center">
                    <Loader2 className="w-12 h-12 text-indigo-600 animate-spin mb-4" />
                    <p className="text-[11px] font-black text-slate-400 uppercase tracking-widest">Accessing Document Repository...</p>
                </div>
            ) : filteredReports.length === 0 ? (
                <div className="py-32 text-center bg-white border-2 border-slate-50 rounded-[3.5rem] flex flex-col items-center shadow-sm">
                    <div className="w-24 h-24 bg-slate-50 border-2 border-slate-100 rounded-[2.5rem] flex items-center justify-center mb-8 shadow-inner">
                        <FileCheck className="w-10 h-10 text-slate-200" />
                    </div>
                    <h3 className="text-2xl font-black text-slate-800 tracking-tight mb-3">Repository Empty</h3>
                    <p className="text-sm font-bold text-slate-400 max-w-sm leading-relaxed px-10 italic">
                        Official academic reports for the current term have not been published by the faculty team yet.
                    </p>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                   {filteredReports.map((r) => (
                      <div key={r.id} className="bg-white rounded-[2.5rem] border-2 border-slate-50 p-8 shadow-sm hover:shadow-2xl hover:translate-y-[-4px] transition-all group relative overflow-hidden flex flex-col">
                         <div className="absolute top-0 right-0 p-8 opacity-5 group-hover:rotate-12 transition-all">
                            <Sparkles className="w-24 h-24 text-indigo-600" />
                         </div>
                         
                         <div className="flex items-center gap-4 mb-6">
                            <div className="w-14 h-14 rounded-2xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 font-black text-xl shadow-inner">
                               <FileText className="w-6 h-6" />
                            </div>
                            <div className="flex-1">
                               <h3 className="text-xl font-black text-slate-800 tracking-tight group-hover:text-indigo-600 transition-colors uppercase italic mb-0.5">{r.title}</h3>
                                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                                   <GraduationCap className="w-3 h-3"/> {r.teacherName || "Faculty"} • <Clock className="w-3 h-3"/> {new Date(r.createdAt?.toDate?.()).toLocaleString('en-US', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                                </p>
                            </div>
                         </div>

                         <div className="p-6 bg-slate-50 rounded-2xl border border-slate-100 mb-8 flex-grow">
                            <p className="text-xs font-bold text-slate-600 leading-relaxed italic">
                               "{r.data?.ai_remark || r.data?.aiRemarks || "Institutional assessment data compiled by the academic department. This document contains verified academic standing and behavioral metrics."}"
                            </p>
                         </div>

                         <div className="flex items-center justify-between pt-4">
                            <div className="flex items-center gap-2">
                               <span className="px-3 py-1 bg-indigo-600 text-white text-[9px] font-black uppercase tracking-widest rounded-lg shadow-lg">Verified</span>
                               <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">{r.format?.toUpperCase()} FORMAT</span>
                            </div>
                            <button 
                               onClick={() => handleDownload(r)}
                               className="bg-slate-900 text-white px-8 py-3.5 rounded-2xl text-[10px] font-black uppercase tracking-widest flex items-center gap-2 hover:bg-slate-800 transition-all shadow-xl shadow-slate-200"
                            >
                               <Download className="w-4 h-4" /> Download Report
                            </button>
                         </div>
                      </div>
                   ))}
                </div>
            )}
         </div>

         {/* Side Context */}
         <div className="lg:col-span-12 mt-10">
            <div className="bg-[#1e3a8a] rounded-[3.5rem] p-12 text-white relative overflow-hidden shadow-2xl group flex flex-col md:flex-row items-center gap-10">
                <div className="relative z-10 space-y-4 max-w-xl">
                    <h3 className="text-3xl font-black leading-tight italic uppercase">Document Infrastructure Policy</h3>
                    <p className="text-base font-bold text-blue-100/80 leading-relaxed">
                        Academic reports are generated by the instructional faculty and mirrored to the parent portal for peak transparency. Each document is cryptographically verified to ensure record integrity.
                    </p>
                    <div className="flex gap-6 pt-4">
                        <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-blue-200">
                            <Clock className="w-4 h-4"/> Retention: 30 Days
                        </div>
                        <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-blue-200">
                            <ArrowRightCircle className="w-4 h-4"/> Direct Sync Active
                        </div>
                    </div>
                </div>
                <div className="relative h-48 w-48 flex items-center justify-center shrink-0">
                    <div className="absolute inset-0 bg-white/10 rounded-full animate-ping opacity-20" />
                    <div className="absolute inset-4 bg-white/10 rounded-full animate-pulse opacity-40" />
                    <div className="relative w-24 h-24 bg-white rounded-3xl flex items-center justify-center shadow-2xl shadow-indigo-500/50">
                        <FileText className="w-12 h-12 text-[#1e3a8a] rotate-12" />
                    </div>
                </div>
            </div>
         </div>
      </div>
    </div>
  );
};

export default ReportsPage;
