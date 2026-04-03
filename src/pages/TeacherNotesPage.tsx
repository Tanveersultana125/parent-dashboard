import { useState, useEffect, useRef, useMemo } from "react";
import {
  Loader2, Send, CheckCheck, MessageSquare, Mail, Search, Smile,
  ChevronLeft, GraduationCap, Plus, X, Star
} from "lucide-react";
import { db } from "../lib/firebase";
import {
  collection, query, where, onSnapshot, addDoc, serverTimestamp, getDocs,
  updateDoc, doc
} from "firebase/firestore";
import { useAuth } from "../lib/AuthContext";
import { toast } from "sonner";
import { useLocation } from "react-router-dom";

const TeacherNotesPage = () => {
  const { studentData } = useAuth();
  const location = useLocation();
  const [selectedTeacher, setSelectedTeacher]     = useState<any>(null);
  const [allNotes, setAllNotes]                   = useState<any[]>([]);
  const [loading, setLoading]                     = useState(true);
  const [searchQuery, setSearchQuery]             = useState("");
  const [messageContent, setMessageContent]       = useState("");
  const [showNewChat, setShowNewChat]             = useState(false);
  const [availableTeachers, setAvailableTeachers] = useState<any[]>([]);

  // Rate Teacher state
  const [showRateModal, setShowRateModal]           = useState(false);
  const [ratingValue, setRatingValue]               = useState(0);
  const [hoverRating, setHoverRating]               = useState(0);
  const [reviewText, setReviewText]                 = useState("");
  const [isSubmittingReview, setIsSubmittingReview] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Fetch all parent_notes for this student (multi-stream)
  useEffect(() => {
    if (!studentData?.id) return;
    setLoading(true);
    const sEmail = studentData.email?.toLowerCase() || "";
    const sId    = studentData.id;

    const process = (snapArray: any[]) => {
      const combined = snapArray.flatMap(s =>
        (s?.docs || []).map((d: any) => ({ id: d.id, ...d.data() }))
      );
      const seen = new Set<string>();
      const data = combined.filter(d => { if (seen.has(d.id)) return false; seen.add(d.id); return true; });
      data.sort((a: any, b: any) => (a.createdAt?.toMillis?.() || 0) - (b.createdAt?.toMillis?.() || 0));
      setAllNotes(data);
      setLoading(false);
    };

    let s1: any = [], s2: any = [];
    const u1 = onSnapshot(query(collection(db, "parent_notes"), where("studentId",    "==", sId)),    snap => { s1 = snap; process([s1, s2]); });
    const u2 = onSnapshot(query(collection(db, "parent_notes"), where("studentEmail", "==", sEmail)), snap => { s2 = snap; process([s1, s2]); });
    return () => { u1(); u2(); };
  }, [studentData?.id]);

  // Fetch available teachers for "New Message"
  useEffect(() => {
    if (!studentData?.classId) return;
    const fetchTeachers = async () => {
      try {
        const snap = await getDocs(query(collection(db, "teaching_assignments"), where("classId", "==", studentData.classId)));
        const ids  = snap.docs.map(d => d.data().teacherId).filter(Boolean);
        if (!ids.length) return;
        const tSnap = await getDocs(query(collection(db, "teachers"), where("__name__", "in", ids.slice(0, 10))));
        setAvailableTeachers(tSnap.docs.map(d => ({ id: d.id, ...d.data() })));
      } catch { /* silent */ }
    };
    fetchTeachers();
  }, [studentData?.classId]);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [allNotes, selectedTeacher]);

  // Mark unread teacher messages as read when conversation is opened
  useEffect(() => {
    if (!selectedTeacher) return;
    allNotes.forEach(n => {
      if (n.teacherId === selectedTeacher.teacherId && n.from === "teacher" && n.read !== true) {
        updateDoc(doc(db, "parent_notes", n.id), { read: true }).catch(() => {});
      }
    });
  }, [selectedTeacher?.teacherId]);

  // Build teacher conversation list
  const teacherConversations = useMemo(() => {
    const map = new Map<string, any>();
    [...allNotes].reverse().forEach(n => {
      if (n.teacherId && !map.has(n.teacherId)) {
        map.set(n.teacherId, {
          teacherId:   n.teacherId,
          teacherName: n.teacherName || "Teacher",
          subject:     n.subject     || "",
          lastMessage: n,
        });
      }
    });
    return Array.from(map.values())
      .filter(t => t.teacherName.toLowerCase().includes(searchQuery.toLowerCase()))
      .sort((a, b) => (b.lastMessage.createdAt?.toMillis?.() || 0) - (a.lastMessage.createdAt?.toMillis?.() || 0));
  }, [allNotes, searchQuery]);

  // Auto-select teacher from navigation state
  useEffect(() => {
    if (location.state?.teacherId && teacherConversations.length > 0) {
      const match = teacherConversations.find(t => t.teacherId === location.state.teacherId);
      if (match) setSelectedTeacher(match);
    }
  }, [location.state, teacherConversations]);

  const unreadCounts = useMemo(() => {
    const map = new Map<string, number>();
    allNotes.forEach(n => {
      if (n.from === "teacher" && n.teacherId && n.read !== true) {
        map.set(n.teacherId, (map.get(n.teacherId) || 0) + 1);
      }
    });
    return map;
  }, [allNotes]);

  const chatMessages = useMemo(() =>
    selectedTeacher ? allNotes.filter(n => n.teacherId === selectedTeacher.teacherId) : []
  , [allNotes, selectedTeacher]);

  const stats = useMemo(() => ({
    total:    allNotes.length,
    teachers: teacherConversations.length,
    unread:   allNotes.filter(n => n.from === "teacher").length,
  }), [allNotes, teacherConversations]);

  const handleSend = async () => {
    if (!selectedTeacher || !messageContent.trim()) return;
    const content = messageContent.trim();
    setMessageContent("");
    try {
      await addDoc(collection(db, "parent_notes"), {
        teacherId:   selectedTeacher.teacherId,
        teacherName: selectedTeacher.teacherName,
        studentId:   studentData?.id   || "",
        studentEmail: studentData?.email?.toLowerCase() || "",
        studentName: studentData?.name || "",
        parentName:  `Parent of ${studentData?.name || "Student"}`,
        subject:     selectedTeacher.subject || "",
        content, from: "parent", status: "Sent",
        createdAt: serverTimestamp(),
      });
    } catch { toast.error("Failed to send."); setMessageContent(content); }
  };

  const handleSubmitReview = async () => {
    if (!selectedTeacher || ratingValue === 0) return;
    setIsSubmittingReview(true);
    try {
      await addDoc(collection(db, "teacher_reviews"), {
        teacherId:   selectedTeacher.teacherId,
        teacherName: selectedTeacher.teacherName,
        studentId:   studentData?.id   || "",
        studentName: studentData?.name || "",
        parentName:  `Parent of ${studentData?.name || "Student"}`,
        schoolId:    studentData?.schoolId || "",
        branchId:    studentData?.branchId || "",
        rating: ratingValue, review: reviewText.trim(),
        createdAt: serverTimestamp(),
      });
      toast.success("Review submitted!");
      setShowRateModal(false); setRatingValue(0); setReviewText("");
    } catch { toast.error("Failed to submit review."); }
    finally { setIsSubmittingReview(false); }
  };

  const fmtTime = (ts: any) =>
    new Date(ts?.toDate?.() || Date.now()).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  const fmtDate = (ts: any) => {
    const d     = ts?.toDate?.() || new Date();
    const today = new Date();
    if (d.toDateString() === today.toDateString()) return "Today";
    const y = new Date(today); y.setDate(today.getDate() - 1);
    if (d.toDateString() === y.toDateString()) return "Yesterday";
    return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  };

  const groupedMessages = useMemo(() => {
    const groups: { date: string; messages: any[] }[] = [];
    chatMessages.forEach(msg => {
      const label = fmtDate(msg.createdAt);
      const last  = groups[groups.length - 1];
      if (last && last.date === label) last.messages.push(msg);
      else groups.push({ date: label, messages: [msg] });
    });
    return groups;
  }, [chatMessages]);

  return (
    <div className="h-screen flex flex-col -mt-6" style={{ fontFamily: "'Montserrat', sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800;900&display=swap');
        .wa-scroll::-webkit-scrollbar { width: 6px; }
        .wa-scroll::-webkit-scrollbar-thumb { background: #c8b89a; border-radius: 4px; }
        .wa-input::-webkit-scrollbar { display: none; }
        .no-sb::-webkit-scrollbar { display: none; }
        .bubble-sent { border-radius: 8px 0 8px 8px; position: relative; }
        .bubble-sent::before { content:''; position:absolute; top:0; right:-8px; width:0; height:0; border:8px solid transparent; border-top-color:#00a884; border-right:0; }
        .bubble-recv { border-radius: 0 8px 8px 8px; position: relative; }
        .bubble-recv::before { content:''; position:absolute; top:0; left:-8px; width:0; height:0; border:8px solid transparent; border-top-color:#ffffff; border-left:0; }
        .wa-bg { background-color:#efeae2; }
      `}</style>

      {/* Stat strip */}
      <div className="flex gap-3 px-4 py-3 bg-white border-b border-gray-200 shrink-0">
        {[
          { label: "Total Messages", val: stats.total,    icon: MessageSquare, color: "text-teal-500" },
          { label: "Teacher Msgs",   val: stats.unread,   icon: Mail,          color: "text-amber-500" },
          { label: "Teachers",       val: stats.teachers, icon: GraduationCap, color: "text-blue-500" },
        ].map(s => (
          <div key={s.label} className="flex items-center gap-3 bg-gray-50 rounded-xl px-4 py-3 flex-1 border border-gray-100">
            <s.icon className={`w-5 h-5 ${s.color} shrink-0`} />
            <div>
              <p className="text-xs font-semibold text-gray-400">{s.label}</p>
              <p className="text-xl font-black text-gray-800">{s.val}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Main layout */}
      <div className="flex flex-1 overflow-hidden">

        {/* Left sidebar */}
        <div className={`w-[360px] shrink-0 flex flex-col border-r border-gray-200 bg-white ${selectedTeacher ? "hidden md:flex" : "flex"}`}>
          {/* Header */}
          <div className="flex items-center gap-2 px-4 py-3 bg-[#00a884] shrink-0">
            <GraduationCap className="w-5 h-5 text-white" />
            <p className="text-white font-bold text-sm flex-1">Teacher Messages</p>
          </div>

          {/* Search + New */}
          <div className="px-3 py-2 bg-[#f0f2f5] shrink-0 flex flex-col gap-2">
            <div className="flex items-center gap-2 bg-white rounded-full px-4 py-2">
              <Search className="w-4 h-4 text-gray-400 shrink-0" />
              <input
                type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search teachers..."
                className="flex-1 bg-transparent text-sm outline-none text-gray-700 placeholder:text-gray-400"
                style={{ fontFamily: "'Montserrat', sans-serif" }}
              />
            </div>
            <button
              onClick={() => setShowNewChat(true)}
              className="w-full flex items-center justify-center gap-2 py-2 bg-[#00a884] text-white rounded-full text-sm font-semibold hover:bg-emerald-600 transition-colors"
            >
              <Plus className="w-4 h-4" /> New Message
            </button>
          </div>

          {/* New chat modal overlay */}
          {showNewChat && (
            <div className="absolute inset-y-0 left-0 w-[360px] bg-white z-50 flex flex-col border-r border-gray-200">
              <div className="flex items-center gap-3 px-4 py-3 bg-[#00a884]">
                <button onClick={() => setShowNewChat(false)} className="text-white">
                  <ChevronLeft className="w-5 h-5" />
                </button>
                <p className="text-white font-bold text-sm">Select Teacher</p>
              </div>
              <div className="flex-1 overflow-y-auto no-sb">
                {availableTeachers.length === 0 ? (
                  <p className="text-center text-xs text-gray-400 py-12 font-semibold">No class teachers found</p>
                ) : availableTeachers.map(t => (
                  <button key={t.id} onClick={() => {
                    setSelectedTeacher({ teacherId: t.id, teacherName: t.name, subject: t.subject || "General" });
                    setShowNewChat(false);
                  }} className="w-full flex items-center gap-3 px-4 py-3 border-b border-gray-100 hover:bg-gray-50 transition-colors">
                    <div className="w-12 h-12 rounded-full bg-[#00a884] flex items-center justify-center text-white text-sm font-bold shrink-0">
                      {t.name?.substring(0, 2).toUpperCase()}
                    </div>
                    <div className="text-left">
                      <p className="text-sm font-semibold text-gray-900">{t.name}</p>
                      <p className="text-xs text-teal-600">{t.subject || "Teacher"}</p>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Conversation list */}
          <div className="flex-1 overflow-y-auto no-sb">
            {loading ? (
              <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-gray-300" /></div>
            ) : teacherConversations.length === 0 ? (
              <p className="text-center text-xs text-gray-400 py-12 font-semibold px-4">No conversations yet. Tap "New Message" to start.</p>
            ) : teacherConversations.map(t => {
              const unread = unreadCounts.get(t.teacherId) || 0;
              const active = selectedTeacher?.teacherId === t.teacherId;
              return (
                <button key={t.teacherId} onClick={() => setSelectedTeacher(t)}
                  className={`w-full flex items-center gap-3 px-4 py-3 border-b border-gray-100 hover:bg-gray-50 transition-colors ${active ? "bg-[#f0f2f5]" : ""}`}>
                  <div className="w-12 h-12 rounded-full bg-[#00a884] flex items-center justify-center text-white text-sm font-bold shrink-0">
                    {t.teacherName?.substring(0, 2).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0 text-left">
                    <div className="flex justify-between items-center">
                      <p className="text-sm font-semibold text-gray-900 truncate">{t.teacherName}</p>
                      <span className="text-[11px] text-gray-400 shrink-0 ml-2">{fmtTime(t.lastMessage.createdAt)}</span>
                    </div>
                    <div className="flex justify-between items-center mt-0.5">
                      <p className="text-xs text-gray-500 truncate">
                        {t.lastMessage.from === "parent" ? "✓ " : ""}{t.lastMessage.content}
                      </p>
                      {unread > 0 && (
                        <span className="ml-2 min-w-[20px] h-5 rounded-full bg-[#25d366] text-white text-[10px] font-bold flex items-center justify-center px-1 shrink-0">
                          {unread}
                        </span>
                      )}
                    </div>
                    {t.subject && <p className="text-[11px] text-teal-600 mt-0.5">{t.subject}</p>}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Right — chat panel */}
        <div className={`flex-1 flex flex-col overflow-hidden ${!selectedTeacher ? "hidden md:flex" : "flex"}`}>
          {selectedTeacher ? (
            <>
              {/* Chat header */}
              <div className="flex items-center gap-3 px-4 py-2 bg-[#00a884] shrink-0">
                <button onClick={() => setSelectedTeacher(null)} className="md:hidden p-1 text-white">
                  <ChevronLeft className="w-5 h-5" />
                </button>
                <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center text-white text-sm font-bold shrink-0">
                  {selectedTeacher.teacherName?.substring(0, 2).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-white font-semibold text-sm leading-none">{selectedTeacher.teacherName}</p>
                  <p className="text-teal-100 text-xs mt-0.5 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse inline-block" />
                    {selectedTeacher.subject || "Teacher"}
                  </p>
                </div>
                <button
                  onClick={() => setShowRateModal(true)}
                  className="flex items-center gap-1 bg-white/20 hover:bg-white/30 transition-colors px-3 py-1.5 rounded-full text-white text-xs font-semibold"
                >
                  <Star className="w-3.5 h-3.5 fill-white" /> Rate
                </button>
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto wa-scroll wa-bg px-4 py-4 flex flex-col gap-1">
                {groupedMessages.length === 0 ? (
                  <div className="flex-1 flex items-center justify-center">
                    <div className="bg-white/80 rounded-lg px-8 py-6 shadow-sm text-center">
                      <GraduationCap className="w-10 h-10 text-gray-200 mx-auto mb-3" />
                      <p className="text-sm font-semibold text-gray-500">No messages yet</p>
                      <p className="text-xs text-gray-400 mt-1">Start the conversation with the teacher</p>
                    </div>
                  </div>
                ) : groupedMessages.map(group => (
                  <div key={group.date}>
                    <div className="flex justify-center my-3">
                      <span className="bg-white/90 text-gray-500 text-[11px] font-medium px-3 py-1 rounded-full shadow-sm">{group.date}</span>
                    </div>
                    {group.messages.map(n => {
                      const isParent = n.from === "parent";
                      return (
                        <div key={n.id} className={`flex mb-1 ${isParent ? "justify-end" : "justify-start"}`}>
                          {!isParent && (
                            <div className="w-7 h-7 rounded-full bg-[#00a884] flex items-center justify-center text-white text-[10px] font-bold mr-1 mt-1 shrink-0">
                              {selectedTeacher.teacherName?.substring(0, 1).toUpperCase()}
                            </div>
                          )}
                          <div className={`max-w-[70%] px-3 py-2 shadow-sm ${isParent ? "bubble-sent text-white" : "bubble-recv bg-white"}`}
                            style={isParent ? { backgroundColor: "#00a884" } : {}}>
                            {!isParent && (
                              <p className="text-[11px] font-semibold text-[#00a884] mb-1">{selectedTeacher.teacherName}</p>
                            )}
                            <p className={`text-sm whitespace-pre-wrap leading-relaxed ${isParent ? "text-white" : "text-gray-800"}`}>{n.content}</p>
                            <div className="flex items-center justify-end gap-1 mt-1">
                              <span className={`text-[11px] ${isParent ? "text-teal-100" : "text-gray-400"}`}>{fmtTime(n.createdAt)}</span>
                              {isParent && <CheckCheck className="w-4 h-4 text-white/70" />}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ))}
                <div ref={chatEndRef} />
              </div>

              {/* Input */}
              <div className="flex items-center gap-2 px-3 py-2 bg-[#f0f2f5] shrink-0">
                <button className="w-10 h-10 flex items-center justify-center text-gray-500 hover:bg-gray-200 rounded-full transition-colors">
                  <Smile className="w-6 h-6" />
                </button>
                <div className="flex-1 bg-white rounded-full px-4 py-2 flex items-center min-h-[42px]">
                  <textarea
                    rows={1} value={messageContent}
                    onChange={e => setMessageContent(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                    placeholder="Message teacher..."
                    className="flex-1 bg-transparent border-none focus:ring-0 text-sm text-gray-800 resize-none wa-input outline-none placeholder:text-gray-400 leading-relaxed"
                    style={{ fontFamily: "'Montserrat', sans-serif" }}
                  />
                </div>
                <button
                  onClick={handleSend}
                  disabled={!messageContent.trim()}
                  className={`w-10 h-10 rounded-full flex items-center justify-center transition-all shrink-0 ${messageContent.trim() ? "text-white" : "bg-gray-300 text-gray-400"}`}
                  style={messageContent.trim() ? { backgroundColor: "#00a884" } : {}}
                >
                  <Send className="w-5 h-5" />
                </button>
              </div>
            </>
          ) : (
            /* No teacher selected */
            <div className="flex-1 wa-bg flex flex-col items-center justify-center text-center">
              <div className="bg-white/80 rounded-xl px-12 py-10 shadow-sm">
                <GraduationCap className="w-14 h-14 text-gray-200 mx-auto mb-4" />
                <p className="text-sm font-semibold text-gray-600">Select a teacher to start messaging</p>
                <p className="text-xs text-gray-400 mt-1">All teacher conversations appear here</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Rate Teacher Modal */}
      {showRateModal && selectedTeacher && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-8 w-full max-w-sm shadow-2xl">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h3 className="text-lg font-black text-gray-900">Rate Teacher</h3>
                <p className="text-sm text-teal-600 font-medium mt-0.5">{selectedTeacher.teacherName}</p>
              </div>
              <button onClick={() => { setShowRateModal(false); setRatingValue(0); setReviewText(""); }}
                className="w-9 h-9 rounded-full bg-gray-100 flex items-center justify-center hover:bg-gray-200 transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="text-center mb-6">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">Your Rating</p>
              <div className="flex justify-center gap-2">
                {[1, 2, 3, 4, 5].map(star => (
                  <button key={star}
                    onMouseEnter={() => setHoverRating(star)}
                    onMouseLeave={() => setHoverRating(0)}
                    onClick={() => setRatingValue(star)}
                    className="transition-transform hover:scale-125 active:scale-90">
                    <Star size={36} className={`transition-colors ${star <= (hoverRating || ratingValue) ? "fill-amber-400 text-amber-400" : "text-gray-200"}`} />
                  </button>
                ))}
              </div>
              {ratingValue > 0 && (
                <p className="text-sm font-bold text-amber-600 mt-2">
                  {["", "Poor", "Fair", "Good", "Very Good", "Excellent"][ratingValue]}
                </p>
              )}
            </div>

            <div className="mb-5">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-2">Review (Optional)</p>
              <textarea rows={3} value={reviewText} onChange={e => setReviewText(e.target.value)}
                placeholder="Share your experience..."
                className="w-full px-4 py-3 bg-gray-50 border border-gray-100 rounded-xl text-sm resize-none focus:outline-none focus:ring-2 focus:ring-teal-500/20 placeholder:text-gray-300"
                style={{ fontFamily: "'Montserrat', sans-serif" }}
              />
            </div>

            <button onClick={handleSubmitReview} disabled={ratingValue === 0 || isSubmittingReview}
              className="w-full h-12 rounded-xl text-white font-bold text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              style={{ backgroundColor: "#00a884" }}>
              {isSubmittingReview ? <><Loader2 className="w-4 h-4 animate-spin" /> Submitting…</> : <><Star className="w-4 h-4 fill-white" /> Submit Review</>}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default TeacherNotesPage;
