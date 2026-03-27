import { useState, useEffect, useRef } from "react";
import { User, Clock, Lightbulb, CheckCircle2, AlertCircle, Loader2, Sparkles, Send, Brain, Info, Download, Upload, FileCheck, X, FileText, Layout, MessageCircle, Bot, ChevronRight, Wand2 } from "lucide-react";
import { ParentAIController } from "../ai/controller/ai-controller";
import { useAuth } from "@/lib/AuthContext";
import { db, storage } from "@/lib/firebase";
import { collection, query, where, onSnapshot, addDoc, serverTimestamp, doc, setDoc, getDocs, Unsubscribe, or } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";

const tabs = ["Active", "Completed", "Overdue"];

const AssignmentsPage = () => {
  const { studentData } = useAuth();
  const [activeTab, setActiveTab] = useState(0);
  const [showAIHint, setShowAIHint] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [aiResponse, setAiResponse] = useState<any>(null);
  const [submittingFile, setSubmittingFile] = useState<string | null>(null);
  
  // AI Tutor States
  const [isTutorOpen, setIsTutorOpen] = useState(false);
  const [currentAssignment, setCurrentAssignment] = useState<any>(null);
  const [tutorMessages, setTutorMessages] = useState<any[]>([]);
  const [userQuery, setUserQuery] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  
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

  const extractTextFromPDF = async (url: string): Promise<string> => {
    try {
      const pdf = await (window as any).pdfjsLib.getDocument(url).promise;
      let text = "";
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        text += content.items.map((item: any) => item.str).join(" ") + "\n";
      }
      return text;
    } catch (e) {
      console.error("PDF Extraction failed:", e);
      return "";
    }
  };

  const openAITutor = async (assignment: any) => {
    setCurrentAssignment(assignment);
    setIsTutorOpen(true);
    setTutorMessages([]);
    setIsTyping(true);

    try {
      let fileContent = "";
      if (assignment.pdfUrl) {
        toast.info("AI is analyzing file content...");
        console.log("Analyzing PDF:", assignment.pdfUrl);
        fileContent = await extractTextFromPDF(assignment.pdfUrl);
        console.log("Extracted Content Length:", fileContent.length);
        if (fileContent.length === 0) {
           console.warn("No text extracted from PDF. Check CORS or file readability.");
        }
      }

      const result = await ParentAIController.getAssignmentIntelligence({
        title: assignment.title,
        description: assignment.description,
        pdfUrl: assignment.pdfUrl,
        fileContent: fileContent,
        type: "tutor_init"
      });
      console.log("AI result:", result);

      if (result.status === "success") {
        setTutorMessages([{
          role: "assistant",
          content: result.data.tutor_analysis,
          plan: result.data.action_plan,
          hints: result.data.assignment_hints,
          points: result.data.discussion_points
        }]);
      }
    } catch (e) {
      toast.error("Tutor connection failed.");
    } finally {
      setIsTyping(false);
    }
  };

  const handleTutorSubmit = async () => {
    if (!userQuery.trim() || isTyping) return;
    
    const userMsg = userQuery;
    setUserQuery("");
    setTutorMessages(prev => [...prev, { role: "user", content: userMsg }]);
    setIsTyping(true);

    try {
      const result = await ParentAIController.getAssignmentIntelligence({
        title: currentAssignment.title,
        description: currentAssignment.description,
        question: userMsg,
        type: "chat"
      });

      if (result.status === "success") {
        setTutorMessages(prev => [...prev, { 
          role: "assistant", 
          content: result.data.response || result.data.tutor_analysis,
          hints: result.data.assignment_hints
        }]);
      }
    } catch (e) {
      toast.error("AI is busy right now.");
    } finally {
      setIsTyping(false);
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
                             onClick={() => openAITutor(a)}
                             className="w-full px-8 py-4 bg-white border border-slate-100 text-[#1e3a8a] rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-slate-50 transition-all flex items-center justify-center gap-3 shadow-sm group-hover:border-indigo-200"
                           >
                             <Bot className="w-4 h-4 text-indigo-500 animate-pulse" /> AI Tutor Guidance
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
                </div>
              )
            })
          )}
        </div>

        {/* AI TUTOR SHEET */}
        <Sheet open={isTutorOpen} onOpenChange={setIsTutorOpen}>
          <SheetContent side="right" className="w-full sm:max-w-xl p-0 border-l border-slate-100 bg-white">
            <div className="h-full flex flex-col">
               <div className="bg-[#1e3a8a] p-8 text-white relative overflow-hidden">
                  <div className="absolute top-0 right-0 p-10 opacity-10">
                    <Brain className="w-40 h-40" />
                  </div>
                  <SheetHeader className="text-left relative z-10">
                    <SheetTitle className="text-white text-3xl font-black italic tracking-tighter uppercase mb-2">EduIntellect AI Tutor</SheetTitle>
                    <SheetDescription className="text-blue-100 font-bold uppercase tracking-widest text-[10px]">Active Academic Coaching Mode • Real-time Sync</SheetDescription>
                  </SheetHeader>
               </div>

               <ScrollArea className="flex-1 p-8">
                  <div className="space-y-12 pb-20">
                    {tutorMessages.map((msg, i) => (
                      <div key={i} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                        <div className={`max-w-[85%] rounded-[2.5rem] p-8 ${msg.role === 'user' ? 'bg-indigo-600 text-white shadow-xl' : 'bg-slate-50 border border-slate-100'}`}>
                          <p className={`text-base font-bold leading-relaxed ${msg.role === 'user' ? 'text-white' : 'text-slate-700'}`}>{msg.content}</p>
                          
                          {msg.plan && (
                            <div className="mt-8 space-y-4">
                              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 mb-4 border-l-4 border-indigo-400 pl-4">Suggested Action Plan</p>
                              {msg.plan.map((p: any, j: number) => (
                                <div key={j} className="flex gap-4 p-4 bg-white rounded-2xl border border-slate-100">
                                  <div className="w-8 h-8 rounded-full bg-indigo-50 flex items-center justify-center font-black text-xs text-indigo-600 border border-indigo-100 shrink-0">{j+1}</div>
                                  <div>
                                    <p className="text-sm font-black text-slate-800">{p.task}</p>
                                    <p className="text-[11px] font-bold text-slate-400 italic mt-1">{p.motivation}</p>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}

                          {msg.hints && (
                            <div className="mt-8 space-y-4">
                              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-amber-600 mb-4 border-l-4 border-amber-400 pl-4">Strategic Hints</p>
                              {msg.hints.map((h: any, j: number) => (
                                <div key={j} className="p-5 bg-amber-50/50 rounded-2xl border border-amber-100">
                                  <p className="text-[10px] font-black text-amber-500 uppercase tracking-widest leading-none mb-3">{h.step}</p>
                                  <p className="text-sm font-black text-slate-700 leading-relaxed mb-3">"{h.hint}"</p>
                                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-tighter">🎯 Focus: {h.clue}</p>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                    {isTyping && (
                      <div className="flex items-center gap-4 bg-slate-50 w-fit p-6 rounded-[2rem] border border-slate-100">
                        <Loader2 className="w-6 h-6 animate-spin text-indigo-600" />
                        <span className="text-sm font-black text-slate-400 uppercase tracking-widest animate-pulse">Neural engine thinking...</span>
                      </div>
                    )}
                  </div>
               </ScrollArea>

               <div className="p-8 border-t border-slate-100 bg-slate-50/50">
                  <div className="flex items-center gap-4 bg-white p-2 rounded-[2.5rem] border border-slate-200 shadow-sm focus-within:ring-4 focus-within:ring-indigo-100 transition-all">
                    <Textarea 
                      placeholder="Ask the Tutor anything about this assignment..." 
                      className="flex-1 min-h-[50px] max-h-[150px] border-none focus-visible:ring-0 text-sm font-bold bg-transparent px-6 py-4"
                      value={userQuery}
                      onChange={(e) => setUserQuery(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), handleTutorSubmit())}
                    />
                    <Button 
                      onClick={handleTutorSubmit}
                      disabled={isTyping}
                      className="w-14 h-14 rounded-full bg-[#1e3a8a] text-white hover:bg-slate-900 shadow-xl"
                    >
                      <Send className="w-6 h-6" />
                    </Button>
                  </div>
               </div>
            </div>
          </SheetContent>
        </Sheet>
      </div>
  );
};


export default AssignmentsPage;
