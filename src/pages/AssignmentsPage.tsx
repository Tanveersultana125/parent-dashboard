import { useState, useEffect, useRef } from "react";
import { User, Clock, Lightbulb, CheckCircle2, AlertCircle, Loader2, Sparkles, Send, Brain, Info, Download, Upload, FileCheck, X, FileText, Layout } from "lucide-react";
import { ParentAIController } from "../ai/controller/ai-controller";
import { useAuth } from "@/lib/AuthContext";
import { db, storage } from "@/lib/firebase";
import { collection, query, where, onSnapshot, addDoc, serverTimestamp, doc, setDoc, getDocs, Unsubscribe, or } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { toast } from "sonner";

const tabs = ["Active", "Completed", "Overdue"];

const AssignmentsPage = () => {
  const { studentData } = useAuth();
  const [activeTab, setActiveTab] = useState(0);
  const [showAIHint, setShowAIHint] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [aiResponse, setAiResponse] = useState<any>(null);
  const [submittingFile, setSubmittingFile] = useState<string | null>(null);
  
  const [loading, setLoading] = useState(true);
  const [assignments, setAssignments] = useState<any[]>([]);
  const [submissions, setSubmissions] = useState<any[]>([]);
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Real-time synchronization for Assignments & Submissions
  useEffect(() => {
    if (!studentData?.id) return;
    
    setLoading(true);
    let unsubAssignments: Unsubscribe | null = null;

    // 1. Audit Enrollment Registry first
    const qEnroll = query(collection(db, "enrollments"), where("studentId", "==", studentData.id));
    
    const unsubEnroll = onSnapshot(qEnroll, (enrollSnap) => {
        // Clean up any previous assignment listener
        if (unsubAssignments) unsubAssignments();

        const classIds = enrollSnap.docs.map(d => d.data().classId).filter(id => !!id);
        const enrolledGrades = enrollSnap.docs.map(d => d.data().className).filter(g => !!g);
        
        // Comprehensive Query Strategy
        // We look for assignments that match either:
        // A) The specific classId from user's enrollment
        // B) The grade string (fallback for legacy or manual enrollments)
        // C) The student's global grade (last resort fallback)
        
        const fallbackGrade = studentData.grade || studentData.class || "8";
        const gradeSearch = enrolledGrades.length > 0 ? enrolledGrades : [fallbackGrade];

        // Use a broad query to ensure nothing is missed
        const assignmentsRef = collection(db, "assignments");
        let q;

        if (classIds.length > 0) {
            // Priority 1: Match by ID
            q = query(assignmentsRef, where("classId", "in", classIds));
        } else {
            // Priority 2: Match by Grade String
            q = query(assignmentsRef, where("grade", "in", gradeSearch));
        }

        unsubAssignments = onSnapshot(q, (snap) => {
            const fetched = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            
            // Secondary check: If Priority 1 fetched nothing, try Priority 2 manually
            if (fetched.length === 0 && classIds.length > 0) {
               const fallbackQ = query(assignmentsRef, where("grade", "in", gradeSearch));
               getDocs(fallbackQ).then(fSnap => {
                  setAssignments(fSnap.docs.map(d => ({ id: d.id, ...d.data() })));
                  setLoading(false);
               });
            } else {
               setAssignments(fetched);
               setLoading(false);
            }
        }, (err) => {
            console.error("Assignment Sync Error:", err);
            setLoading(false);
        });
    }, (err) => {
        console.error("Enrollment Audit Error:", err);
        setLoading(false);
    });

    // 2. Track Portfolio Submissions
    const qSub = query(collection(db, "submissions"), where("studentId", "==", studentData.id));
    const unsubSub = onSnapshot(qSub, (snapshot) => {
        setSubmissions(snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
    });

    return () => { 
        unsubEnroll(); 
        if (unsubAssignments) unsubAssignments();
        unsubSub(); 
    };
  }, [studentData?.id, studentData?.grade, studentData?.class]);

  const fetchAIHints = async (assignment: any) => {
    setIsAnalyzing(true);
    setShowAIHint(assignment.id);
    setAiResponse(null);
    try {
      const result = await ParentAIController.getAssignmentIntelligence({
        title: assignment.title,
        description: assignment.description,
        type: "hints"
      });
      if (result.status === "success") setAiResponse(result.data);
    } catch (e) {
      console.error(e);
      toast.error("Quantum Link disrupted.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleFileUpload = async (assignmentId: string, file: File) => {
    if (!file) return;
    setSubmittingFile(assignmentId);
    try {
        const sRef = ref(storage, `submissions/${studentData.id}_${assignmentId}_${file.name}`);
        const snap = await uploadBytes(sRef, file);
        const url = await getDownloadURL(snap.ref);

        await addDoc(collection(db, "submissions"), {
            assignmentId,
            studentId: studentData.id,
            studentName: studentData.name,
            fileUrl: url,
            fileName: file.name,
            timestamp: serverTimestamp(),
            status: "Submitted"
        });
        
        toast.success("Homework artifact synchronized successfully!");
    } catch (e) {
        toast.error("Cloud synchronization failed.");
        console.error(e);
    } finally {
        setSubmittingFile(null);
    }
  };

  const getSub = (aId: string) => submissions.find(s => s.assignmentId === aId);

  const filteredAssignments = assignments.filter(a => {
    const sub = getSub(a.id);
    if (activeTab === 1) return !!sub;
    if (activeTab === 2) return false; 
    return !sub;
  });

  return (
      <div className="space-y-8 animate-in fade-in duration-500 pb-20 text-left">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
          <div className="text-left">
            <h1 className="text-4xl font-black text-slate-800 tracking-tight leading-none mb-2">Curriculum Assignments</h1>
            <p className="text-slate-400 font-bold uppercase tracking-[0.2em] text-[11px]">Track submissions & synchronize academic artifacts</p>
          </div>
          <div className="flex bg-slate-100 p-1.5 rounded-2xl border border-slate-200">
            {tabs.map((tab, i) => (
              <button 
                key={tab} 
                onClick={() => setActiveTab(i)}
                className={`px-6 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
                  i === activeTab ? "bg-white text-indigo-600 shadow-sm border border-slate-200" : "text-slate-400"
                }`}
              >
                {tab} {i === 0 && assignments.filter(a => !getSub(a.id)).length > 0 && `(${assignments.filter(a => !getSub(a.id)).length})`}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-8">
          {loading ? (
             <div className="py-24 text-center bg-white border border-dashed border-slate-100 rounded-[3rem]">
                <Loader2 className="w-12 h-12 text-indigo-600 animate-spin mx-auto mb-4" />
                <p className="text-[11px] font-black text-indigo-600 uppercase tracking-widest">Accessing Institutional Curriculums...</p>
             </div>
          ) : filteredAssignments.length === 0 ? (
             <div className="py-32 flex flex-col items-center justify-center bg-white border border-dashed border-slate-200 rounded-[3.5rem] text-center px-10">
                <div className="w-24 h-24 bg-slate-50 border border-slate-100 rounded-[2.5rem] flex items-center justify-center mb-8 shadow-sm">
                    <FileCheck className="w-10 h-10 text-slate-200" />
                </div>
                <h3 className="text-2xl font-black text-slate-800 uppercase tracking-tight mb-3">No Pending Curriculums</h3>
                <p className="text-sm font-bold text-slate-400 max-w-sm leading-relaxed lowercase">Institutional logs will synchronize once faculty publishes new academic evaluations. Current Sync ID: {studentData?.id?.substring(0,8)}</p>
             </div>
          ) : (
            filteredAssignments.map((a) => {
              const mySub = getSub(a.id);
              return (
                <div key={a.id} className="bg-white rounded-[3.5rem] border border-slate-100/50 p-10 shadow-sm hover:shadow-2xl hover:border-indigo-100/50 transition-all relative overflow-hidden group text-left">
                  
                  <div className="flex flex-col lg:flex-row items-start justify-between gap-10">
                    <div className="flex items-start gap-8 flex-1">
                      <div className={`w-20 h-20 rounded-[2rem] bg-slate-900 border border-slate-800 flex items-center justify-center text-4xl italic font-black text-white shrink-0 shadow-2xl group-hover:scale-110 transition-transform`}>
                        {a.title?.charAt(0) || "A"}
                      </div>
                      <div className="text-left flex-1">
                        <div className="flex items-center gap-3 mb-2 flex-wrap">
                           <h3 className="text-2xl font-black text-slate-800 tracking-tight leading-none">{a.title}</h3>
                           {mySub && <span className="bg-emerald-50 text-emerald-600 text-[9px] font-black px-3 py-1 rounded-full uppercase tracking-widest flex items-center gap-1 border border-emerald-100"><CheckCircle2 className="w-3 h-3"/> Synchronized</span>}
                           <div className="flex items-center gap-2 bg-indigo-50 px-3 py-1.5 rounded-full border border-indigo-100">
                               <Layout className="w-3.5 h-3.5 text-indigo-600" />
                               <span className="text-[9px] font-black text-indigo-700 uppercase tracking-widest leading-none">{a.className || a.gradeClass || a.grade}</span>
                           </div>
                        </div>
                        <p className="text-base font-bold text-slate-500 mt-4 leading-relaxed max-w-2xl">{a.description}</p>
                        
                        <div className="flex flex-wrap items-center gap-10 mt-10">
                          <div className="flex items-center gap-4">
                             <div className="w-10 h-10 rounded-2xl bg-slate-50 flex items-center justify-center border border-slate-100"><User className="w-5 h-5 text-[#1e3a8a]" /></div>
                             <div className="text-left">
                                <p className="text-[9px] font-black uppercase tracking-widest text-slate-300">Class Teacher</p>
                                <p className="text-xs font-black text-slate-700">{a.teacherName || "Institutional Faculty"}</p>
                             </div>
                          </div>
                          
                          <div className="flex items-center gap-4">
                             <div className="w-10 h-10 rounded-2xl bg-slate-50 flex items-center justify-center border border-slate-100"><Clock className="w-5 h-5 text-slate-400" /></div>
                             <div className="text-left">
                                <p className="text-[9px] font-black uppercase tracking-widest text-slate-300">Milestone Due</p>
                                <p className="text-xs font-black text-slate-700">March 28, 2026</p>
                             </div>
                          </div>

                          {a.pdfUrl && (
                             <a 
                               href={a.pdfUrl} 
                               target="_blank" 
                               rel="noreferrer"
                               className="flex items-center gap-3 bg-[#1e3a8a] text-white px-6 py-3 rounded-2xl text-[10px] font-black uppercase tracking-[0.2em] hover:bg-slate-800 shadow-xl shadow-blue-900/20 transition-all hover:-translate-y-1"
                             >
                                <Download className="w-4 h-4" /> Download Blueprint
                             </a>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-col sm:flex-row lg:flex-col items-end gap-4 w-full lg:w-48 pt-4">
                      {mySub ? (
                        <div className="w-full bg-emerald-50 border border-emerald-100 p-6 rounded-[2.5rem] text-center shadow-inner">
                           <p className="text-[10px] font-black text-emerald-600 uppercase tracking-widest mb-2">Evidence Uploaded</p>
                           <p className="text-[11px] font-bold text-emerald-700 truncate">{mySub.fileName}</p>
                        </div>
                      ) : (
                        <>
                           <button 
                             onClick={() => fetchAIHints(a)}
                             className="w-full px-8 py-4 bg-white border border-slate-100 text-[#1e3a8a] rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-slate-50 transition-all flex items-center justify-center gap-3 shadow-sm"
                           >
                             <Lightbulb className="w-4 h-4 text-amber-500" /> AI Guidance
                           </button>
                           <label className={`w-full px-8 py-5 bg-slate-900 text-white rounded-[2.5rem] text-[10px] font-black uppercase tracking-[0.2em] hover:bg-slate-800 shadow-2xl shadow-slate-200 transition-all flex items-center justify-center gap-3 cursor-pointer ${submittingFile === a.id ? "opacity-50 pointer-events-none" : ""}`}>
                             {submittingFile === a.id ? <Loader2 className="w-5 h-5 animate-spin" /> : <><Upload className="w-5 h-5" /> Submit Homework</>}
                             <input 
                                type="file" 
                                className="hidden" 
                                accept=".pdf,.jpg,.png"
                                onChange={(e) => handleFileUpload(a.id, e.target.files?.[0]!)}
                             />
                           </label>
                        </>
                      )}
                    </div>
                  </div>

                  {showAIHint === a.id && (
                     <div className="mt-10 pt-10 border-t border-slate-50 animate-in slide-in-from-top-6 duration-500">
                        <div className="bg-[#1e3a8a] rounded-[3.5rem] p-10 text-white relative overflow-hidden lg:max-w-4xl shadow-2xl">
                           <Sparkles className="absolute top-8 right-8 w-16 h-16 text-white/10" />
                           <div className="flex items-center gap-4 mb-8">
                              <Brain className="w-8 h-8 text-indigo-300" />
                              <h4 className="text-[11px] font-black uppercase tracking-[0.4em] text-indigo-200 leading-none">Cognitive Guidance Engine</h4>
                           </div>
                           
                           {isAnalyzing ? (
                              <div className="flex items-center gap-6 py-8">
                                 <Loader2 className="w-10 h-10 animate-spin text-indigo-300" />
                                 <p className="text-lg font-bold animate-pulse">Scanning academic context for strategic hints...</p>
                              </div>
                           ) : (
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                 {aiResponse?.assignment_hints?.map((h: any, i: number) => (
                                    <div key={i} className="flex gap-6 p-6 bg-white/10 border border-white/5 rounded-3xl hover:bg-white/15 transition-all">
                                       <div className="w-10 h-10 rounded-2xl bg-indigo-400/20 flex items-center justify-center font-black text-indigo-200 shrink-0 border border-white/10">{i+1}</div>
                                       <div className="text-left">
                                          <p className="text-sm font-black leading-relaxed">{h.hint}</p>
                                          <p className="text-[10px] font-black text-indigo-300/50 mt-3 uppercase tracking-widest border-t border-white/10 pt-3">🎯 Focus: {h.clue}</p>
                                       </div>
                                    </div>
                                 ))}
                              </div>
                           )}
                        </div>
                     </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
  );
};

export default AssignmentsPage;
