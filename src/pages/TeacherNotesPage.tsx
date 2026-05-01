import { useState, useEffect, useRef, useMemo } from "react";
import {
  Loader2, Send, CheckCheck, MessageSquare, Mail, Search, Smile,
  ChevronLeft, GraduationCap, Plus, X, Star, Paperclip,
  Phone, MoreVertical, Clock, Sparkles, Bell,
  MessagesSquare, MailOpen, Users,
} from "lucide-react";
import { db } from "../lib/firebase";
import { scopedQuery } from "../lib/scopedQuery";
import { subscribePerStudent } from "../lib/perStudentQuery";
import {
  collection, where, onSnapshot, addDoc, serverTimestamp, getDocs,
  updateDoc, doc
} from "firebase/firestore";
import { useAuth } from "../lib/AuthContext";
import { useIsMobile } from "@/hooks/use-mobile";
import { toast } from "sonner";
import { useLocation } from "react-router-dom";

const TeacherNotesPage = () => {
  const { studentData } = useAuth();
  const isMobile = useIsMobile();
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

  // Fetch all parent_notes for this student.
  // Dual-query pattern (studentId + studentEmail) — teacher writes don't always
  // carry the canonical studentId. See lib/perStudentQuery.ts.
  useEffect(() => {
    if (!studentData?.id) return;
    setLoading(true);

    const u1 = subscribePerStudent({
      collection: "parent_notes",
      student: studentData,
      onChange: (docs) => {
        const data = docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .sort((a: any, b: any) => (a.createdAt?.toMillis?.() || 0) - (b.createdAt?.toMillis?.() || 0));
        setAllNotes(data);
        setLoading(false);
      },
      onError: (err) => {
        console.error("[TeacherNotes] listener error:", err);
        setAllNotes([]);
        setLoading(false);
      },
    });
    return () => u1();
  }, [studentData?.id, studentData?.schoolId, studentData?.email]);

  // Fetch available teachers for "New Message"
  useEffect(() => {
    if (!studentData?.classId) return;
    const schoolId = studentData.schoolId;
    const fetchTeachers = async () => {
      try {
        const taQ = scopedQuery("teaching_assignments", schoolId, where("classId", "==", studentData.classId));
        const snap = await getDocs(taQ);
        const ids  = snap.docs.map(d => d.data().teacherId).filter(Boolean);
        if (!ids.length) return;
        const tQ = scopedQuery("teachers", schoolId, where("__name__", "in", ids.slice(0, 10)));
        const tSnap = await getDocs(tQ);
        setAvailableTeachers(tSnap.docs.map(d => ({ id: d.id, ...d.data() })));
      } catch (err) {
        // Don't silently hide a permission-denied — support needs the signal
        // to debug "New Message" button showing an empty teachers list.
        console.error("[TeacherNotes] available-teachers fetch error:", err);
      }
    };
    fetchTeachers();
  }, [studentData?.classId, studentData?.schoolId]);

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
    unread:   allNotes.filter(n => n.from === "teacher" && n.read !== true).length,
  }), [allNotes, teacherConversations]);

  const handleSend = async () => {
    if (!selectedTeacher || !messageContent.trim()) return;
    const content = messageContent.trim();
    if (!studentData?.schoolId) {
      toast.error("Cannot send: missing school context. Please re-login.");
      return;
    }
    setMessageContent("");
    try {
      await addDoc(collection(db, "parent_notes"), {
        teacherId:    selectedTeacher.teacherId,
        teacherName:  selectedTeacher.teacherName,
        studentId:    studentData.id   || "",
        studentEmail: studentData.email?.toLowerCase() || "",
        studentName:  studentData.name || "",
        parentName:   `Parent of ${studentData.name || "Student"}`,
        subject:      selectedTeacher.subject || "",
        // schoolId is REQUIRED by the parent_notes Firestore rule
        // (hasSchoolId() && writingToOwnSchool()). Without it, addDoc
        // is rejected as "Missing or insufficient permissions".
        schoolId:     studentData.schoolId,
        branchId:     studentData.branchId || "",
        content,
        from:         "parent",
        status:       "Sent",
        read:         false,
        createdAt:    serverTimestamp(),
      });
    } catch (err: any) {
      console.error("[TeacherNotes] send failed:", err?.code, err?.message || err);
      // Preserve the drafted content so the parent can retry without re-typing,
      // and translate Firebase error codes into actionable, non-jargon copy.
      toast.error(err?.code === "permission-denied"
        ? "This message couldn't be sent. Please contact your school if this continues."
        : "Couldn't send the message. Please check your connection and try again.");
      setMessageContent(content);
    }
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

  // ═══════════════════════════════════════════════════════════════
  // MOBILE — Blue Premium UI (Messages Home / Select Teacher / Chat)
  // ═══════════════════════════════════════════════════════════════
  if (isMobile) {
    // ── WhatsApp palette ──
    const B1 = "#00A884", B2 = "#008069", B3 = "#25D366";   // green primary / deep / bright
    const BG = "#FFFFFF", BG2 = "#F5F6F6", BG3 = "#EFEAE2", CARD = "#FFFFFF"; // page / hover / chat-bg / surface
    const T1 = "#111B21", T2 = "#3B4A54", T3 = "#667781", T4 = "#8696A0";
    const ORANGE = "#FF8800", GOLD = "#FFAA00", GREEN = "#25D366", RED = "#FF3355";
    const SEP = "#E9EDEF";
    const SH    = "0 1px 2px rgba(11,20,26,0.08)";
    const SH_LG = "0 2px 6px rgba(11,20,26,0.10), 0 1px 2px rgba(11,20,26,0.06)";
    const SH_BTN = "0 4px 12px rgba(0,168,132,0.32), 0 1px 3px rgba(0,168,132,0.18)";
    const FONT = "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif";
    const WA_HEADER_BG = "#F0F2F5";
    const WA_BUBBLE_OUT = "#D9FDD3";
    const WA_TICK_READ = "#53BDEB";

    const avatarChar = (studentData?.name?.[0] || "S").toUpperCase();

    // Per-teacher avatar palette (cycled by first char of name)
    const teacherGrads = [
      { bg: "linear-gradient(135deg, #00C853, #22EE66)", sh: "0 3px 10px rgba(0,200,83,0.24)", tagBg: "rgba(0,85,255,0.10)", tagBdr: "rgba(0,85,255,0.16)", tagFg: B1 },
      { bg: "linear-gradient(135deg, #FF8800, #FFCC22)", sh: "0 3px 10px rgba(255,136,0,0.24)", tagBg: "rgba(255,136,0,0.10)", tagBdr: "rgba(255,136,0,0.22)", tagFg: "#884400" },
      { bg: `linear-gradient(135deg, ${B1}, ${B3})`,     sh: "0 3px 10px rgba(0,85,255,0.24)",  tagBg: "rgba(0,85,255,0.10)", tagBdr: "rgba(0,85,255,0.16)", tagFg: B1 },
      { bg: "linear-gradient(135deg, #8844CC, #BB77FF)", sh: "0 3px 10px rgba(136,68,204,0.24)", tagBg: "rgba(136,68,204,0.10)", tagBdr: "rgba(136,68,204,0.22)", tagFg: "#6622AA" },
    ];
    const gradIdx  = (name?: string) => ((name?.charCodeAt(0) || 0) % teacherGrads.length + teacherGrads.length) % teacherGrads.length;
    const gradFor  = (name?: string) => teacherGrads[gradIdx(name)].bg;
    const gradSet  = (name?: string) => teacherGrads[gradIdx(name)];

    // Merge conversations with available teachers — show teachers without any messages too
    const mergedConversations = (() => {
      const map = new Map<string, any>(teacherConversations.map(t => [t.teacherId, t]));
      availableTeachers.forEach((t: any) => {
        if (!map.has(t.id)) {
          map.set(t.id, {
            teacherId:   t.id,
            teacherName: t.name,
            subject:     t.subject || "General",
            lastMessage: null,
          });
        }
      });
      return Array.from(map.values())
        .filter(t => (t.teacherName || "").toLowerCase().includes(searchQuery.toLowerCase()))
        .sort((a, b) => {
          const am = a.lastMessage?.createdAt?.toMillis?.() || 0;
          const bm = b.lastMessage?.createdAt?.toMillis?.() || 0;
          return bm - am;
        });
    })();

    const startChatWith = (t: any) => {
      setSelectedTeacher({
        teacherId:   t.teacherId,
        teacherName: t.teacherName,
        subject:     t.subject || "General",
      });
    };

    // Shared rate modal (rendered alongside chat view)
    const rateModalMobile = showRateModal && selectedTeacher && (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,16,64,0.55)", fontFamily: FONT }}>
        <div className="bg-white rounded-[26px] p-6 w-full max-w-sm" style={{ boxShadow: "0 24px 60px rgba(0,20,80,0.30)" }}>
          <div className="flex items-center justify-between mb-5">
            <div>
              <h3 className="text-[17px] font-bold" style={{ color: T1, letterSpacing: "-0.3px" }}>Rate Teacher</h3>
              <p className="text-[13px] font-semibold mt-[2px]" style={{ color: B1 }}>{selectedTeacher.teacherName}</p>
            </div>
            <button onClick={() => { setShowRateModal(false); setRatingValue(0); setReviewText(""); }}
              className="w-9 h-9 rounded-full flex items-center justify-center active:scale-95"
              style={{ background: BG, border: "0.5px solid rgba(0,85,255,0.12)" }}>
              <X className="w-4 h-4" style={{ color: T3 }} />
            </button>
          </div>
          <div className="text-center mb-5">
            <p className="text-[10px] font-bold uppercase tracking-[0.15em] mb-3" style={{ color: T4 }}>Your Rating</p>
            <div className="flex justify-center gap-2">
              {[1, 2, 3, 4, 5].map(star => (
                <button key={star}
                  onMouseEnter={() => setHoverRating(star)}
                  onMouseLeave={() => setHoverRating(0)}
                  onClick={() => setRatingValue(star)}
                  className="transition-transform active:scale-90">
                  <Star size={34} style={{
                    fill: star <= (hoverRating || ratingValue) ? GOLD : "transparent",
                    color: star <= (hoverRating || ratingValue) ? GOLD : BG2,
                  }} />
                </button>
              ))}
            </div>
            {ratingValue > 0 && (
              <p className="text-[13px] font-bold mt-2" style={{ color: GOLD }}>
                {["", "Poor", "Fair", "Good", "Very Good", "Excellent"][ratingValue]}
              </p>
            )}
          </div>
          <div className="mb-4">
            <p className="text-[10px] font-bold uppercase tracking-[0.15em] mb-2" style={{ color: T4 }}>Review (Optional)</p>
            <textarea rows={3} value={reviewText} onChange={e => setReviewText(e.target.value)}
              placeholder="Share your experience..."
              className="w-full px-4 py-3 rounded-[14px] text-[13px] resize-none outline-none"
              style={{ background: BG, border: "0.5px solid rgba(0,85,255,0.12)", color: T1, fontFamily: FONT }} />
          </div>
          <button onClick={handleSubmitReview} disabled={ratingValue === 0 || isSubmittingReview}
            className="w-full h-12 rounded-[16px] text-white font-bold text-[14px] flex items-center justify-center gap-2 active:scale-[0.97] disabled:opacity-50"
            style={{ background: `linear-gradient(135deg, ${B1}, ${B2})`, boxShadow: SH_BTN }}>
            {isSubmittingReview ? <><Loader2 className="w-4 h-4 animate-spin" /> Submitting…</> : <><Star className="w-4 h-4 fill-white" /> Submit Review</>}
          </button>
        </div>
      </div>
    );

    // ── Compact stat row (shared between home + chat) ──
    const statRow = (compact: boolean) => (
      <div className="flex rounded-[20px] overflow-hidden"
        style={{ background: CARD, boxShadow: SH_LG, border: "0.5px solid rgba(0,85,255,0.10)" }}>
        {[
          { ico: <MessageSquare className="w-[13px] h-[13px]" style={{ color: B1 }} strokeWidth={2.4} />, bg: "rgba(0,85,255,0.10)", bdr: "rgba(0,85,255,0.18)", label: "Total\nMessages", val: stats.total },
          { ico: <Mail className="w-[13px] h-[13px]" style={{ color: ORANGE }} strokeWidth={2.4} />, bg: "rgba(255,136,0,0.10)", bdr: "rgba(255,136,0,0.22)", label: "Teacher\nMsgs", val: stats.unread },
          { ico: <GraduationCap className="w-[13px] h-[13px]" style={{ color: "rgba(0,85,255,0.7)" }} strokeWidth={2.4} />, bg: "rgba(0,85,255,0.08)", bdr: "rgba(0,85,255,0.16)", label: "Teachers", val: stats.teachers },
        ].map((s, i, arr) => (
          <div key={i} className="flex-1 px-3 flex flex-col relative"
            style={{
              paddingTop: compact ? 12 : 14, paddingBottom: compact ? 12 : 14,
              gap: compact ? 4 : 5,
              borderRight: i < arr.length - 1 ? "0.5px solid rgba(0,85,255,0.10)" : undefined,
            }}>
            <div className="w-[26px] h-[26px] rounded-[8px] flex items-center justify-center"
              style={{ background: s.bg, border: `0.5px solid ${s.bdr}`, marginBottom: compact ? 2 : 3 }}>
              {s.ico}
            </div>
            <div className="font-bold uppercase tracking-[0.07em] leading-[1.3] whitespace-pre-line"
              style={{ color: T4, fontSize: compact ? 8 : 9 }}>
              {s.label}
            </div>
            <div className="font-bold leading-none" style={{ color: T1, letterSpacing: "-0.6px", fontSize: compact ? 18 : 22 }}>{s.val}</div>
          </div>
        ))}
      </div>
    );

    // WhatsApp-style green app bar (used on home + select-teacher)
    const compactHeader = (
      <div className="flex items-center justify-between px-5 py-3"
        style={{ background: B1, color: "#fff" }}>
        <div className="text-[20px] font-semibold" style={{ letterSpacing: "-0.2px" }}>Chats</div>
        <div className="flex items-center gap-[18px]">
          <Search className="w-[19px] h-[19px]" style={{ color: "#fff" }} strokeWidth={2.2} />
          <MoreVertical className="w-[19px] h-[19px]" style={{ color: "#fff" }} strokeWidth={2.2} />
        </div>
      </div>
    );
    void avatarChar;

    // ── CHAT VIEW ──────────────────────────────────────────────────
    if (selectedTeacher) {
      return (
        <>
          <div
            className="flex-1 flex flex-col -m-3 md:m-0 mb-[calc(-88px-env(safe-area-inset-bottom)-1rem)] md:mb-0 pb-[calc(88px+env(safe-area-inset-bottom)+0.5rem)] md:pb-0 animate-in fade-in duration-500"
            style={{ background: BG3, fontFamily: FONT }}
          >

            {/* WhatsApp-style chat header */}
            <div className="flex items-center gap-3 px-3 py-[10px] shrink-0"
              style={{ background: B1, color: "#fff" }}>
              <button onClick={() => setSelectedTeacher(null)}
                className="w-8 h-8 flex items-center justify-center active:scale-90 shrink-0">
                <ChevronLeft className="w-[22px] h-[22px] text-white" strokeWidth={2.5} />
              </button>
              <div className="w-10 h-10 rounded-full flex items-center justify-center text-white text-[14px] font-bold shrink-0"
                style={{ background: gradFor(selectedTeacher.teacherName) }}>
                {selectedTeacher.teacherName?.substring(0, 2).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[16px] font-semibold text-white truncate" style={{ letterSpacing: "-0.1px" }}>
                  {selectedTeacher.teacherName}
                </div>
                <div className="text-[12px] truncate" style={{ color: "rgba(255,255,255,0.78)" }}>
                  {selectedTeacher.subject || "Teacher"} · online
                </div>
              </div>
              <button onClick={() => setShowRateModal(true)}
                className="flex items-center gap-[4px] px-[10px] py-[6px] rounded-full text-[12px] font-semibold text-white active:scale-95 shrink-0"
                style={{ background: "rgba(255,255,255,0.18)" }}>
                <Star size={12} fill="#FFD700" color="#FFD700" />
                Rate
              </button>
            </div>

            {/* Messages area — WhatsApp chat bg */}
            <div className="flex-1 min-h-0 overflow-y-auto no-sb px-3 py-3 flex flex-col gap-1"
              style={{
                background: BG3,
                backgroundImage: "radial-gradient(circle at 1px 1px, rgba(11,20,26,0.05) 1px, transparent 0)",
                backgroundSize: "22px 22px",
              }}>
              {loading ? (
                <div className="flex-1 flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin" style={{ color: B1 }} /></div>
              ) : groupedMessages.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center gap-3 py-8">
                  <div className="w-[60px] h-[60px] rounded-full flex items-center justify-center"
                    style={{ background: "rgba(0,168,132,0.10)" }}>
                    <GraduationCap className="w-[26px] h-[26px]" style={{ color: B1, opacity: 0.55 }} strokeWidth={2.1} />
                  </div>
                  <div className="text-[15px] font-semibold" style={{ color: T1 }}>No messages yet</div>
                  <div className="text-[12px] text-center max-w-[220px] leading-[1.5]" style={{ color: T3 }}>
                    Start the conversation with your teacher
                  </div>
                </div>
              ) : groupedMessages.map(group => (
                <div key={group.date}>
                  <div className="flex justify-center my-3">
                    <span className="text-[11px] font-medium px-[10px] py-[4px] rounded-[6px]"
                      style={{ background: "#FFFFFF", color: T3, boxShadow: SH }}>
                      {group.date}
                    </span>
                  </div>
                  {group.messages.map(n => {
                    const isParent = n.from === "parent";
                    return isParent ? (
                      <div key={n.id} className="flex justify-end mb-[3px]">
                        <div className="max-w-[78%] px-[9px] py-[6px] relative"
                          style={{
                            background: WA_BUBBLE_OUT,
                            borderRadius: "8px 8px 0 8px",
                            boxShadow: SH,
                          }}>
                          <div className="text-[14px] leading-[1.4] whitespace-pre-wrap break-words pr-[58px]" style={{ color: T1 }}>{n.content}</div>
                          <div className="absolute right-[8px] bottom-[4px] flex items-center gap-[3px]">
                            <span className="text-[10px]" style={{ color: T3 }}>{fmtTime(n.createdAt)}</span>
                            <CheckCheck className="w-[14px] h-[14px]" style={{ color: WA_TICK_READ }} />
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div key={n.id} className="flex justify-start mb-[3px]">
                        <div className="max-w-[78%] px-[9px] py-[6px] relative"
                          style={{
                            background: CARD,
                            borderRadius: "8px 8px 8px 0",
                            boxShadow: SH,
                          }}>
                          <div className="text-[14px] leading-[1.4] whitespace-pre-wrap break-words pr-[44px]" style={{ color: T1 }}>{n.content}</div>
                          <div className="absolute right-[8px] bottom-[4px]">
                            <span className="text-[10px]" style={{ color: T3 }}>{fmtTime(n.createdAt)}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>

            {/* Input bar — WhatsApp style */}
            <div className="px-2 py-[7px] flex items-end gap-[6px] shrink-0"
              style={{ background: WA_HEADER_BG }}>
              <div className="flex-1 flex items-center gap-1 px-3 py-[8px] rounded-[24px]"
                style={{ background: "#fff" }}>
                <button className="w-7 h-7 flex items-center justify-center active:scale-90 shrink-0">
                  <Smile className="w-[22px] h-[22px]" style={{ color: T3 }} strokeWidth={1.8} />
                </button>
                <input
                  type="text"
                  value={messageContent}
                  onChange={e => setMessageContent(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                  placeholder="Message"
                  className="flex-1 min-w-0 px-2 text-[15px] outline-none bg-transparent"
                  style={{ color: T1, fontFamily: FONT }}
                />
                <button className="w-7 h-7 flex items-center justify-center active:scale-90 shrink-0">
                  <Paperclip className="w-[20px] h-[20px]" style={{ color: T3 }} strokeWidth={2} />
                </button>
              </div>
              <button onClick={handleSend} disabled={!messageContent.trim()}
                className="w-11 h-11 rounded-full flex items-center justify-center active:scale-90 shrink-0 disabled:opacity-50"
                style={{ background: B1 }}>
                <Send className="w-[18px] h-[18px] text-white" strokeWidth={2.4} fill="#fff" />
              </button>
            </div>
          </div>
          {rateModalMobile}
        </>
      );
    }

    // ── SELECT TEACHER VIEW ──────────────────────────────────────
    if (showNewChat) {
      const filteredTeachers = availableTeachers.filter(t =>
        (t.name || "").toLowerCase().includes(searchQuery.toLowerCase())
      );
      return (
        <div className="-mx-3 -mt-3 md:mx-0 md:mt-0 animate-in fade-in duration-500"
          style={{ background: BG, minHeight: "100vh", fontFamily: FONT }}>

          {/* WhatsApp green header — Select contact */}
          <div className="flex items-center gap-4 px-3 py-3" style={{ background: B1 }}>
            <button onClick={() => setShowNewChat(false)}
              className="w-9 h-9 flex items-center justify-center active:scale-90">
              <ChevronLeft className="w-[22px] h-[22px] text-white" strokeWidth={2.5} />
            </button>
            <div className="flex-1 min-w-0">
              <div className="text-[18px] font-semibold text-white leading-tight">Select contact</div>
              <div className="text-[12px]" style={{ color: "rgba(255,255,255,0.78)" }}>{availableTeachers.length} teachers</div>
            </div>
            <Search className="w-[19px] h-[19px] text-white" strokeWidth={2.2} />
            <MoreVertical className="w-[19px] h-[19px] text-white" strokeWidth={2.2} />
          </div>

          {/* Search bar (WhatsApp style — embedded below header) */}
          <div className="px-3 py-2" style={{ background: BG }}>
            <div className="flex items-center gap-3 px-3 py-[8px] rounded-[24px]"
              style={{ background: WA_HEADER_BG }}>
              <Search className="w-[16px] h-[16px]" style={{ color: T3 }} strokeWidth={2.2} />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search name or number"
                className="flex-1 min-w-0 text-[14px] outline-none bg-transparent"
                style={{ color: T1, fontFamily: FONT }}
              />
            </div>
          </div>

          {/* Section label */}
          <div className="px-5 pt-2 pb-1 text-[13px] font-medium" style={{ color: B1 }}>
            Contacts on EduIntellect
          </div>

          {/* Teacher list — flat */}
          <div style={{ background: BG }}>
            {filteredTeachers.length === 0 ? (
              <div className="px-5 py-10 text-center text-[13px]" style={{ color: T3 }}>
                {availableTeachers.length === 0 ? "No class teachers found" : "No teachers match your search"}
              </div>
            ) : (
              filteredTeachers.map((t: any) => (
                <div key={t.id} onClick={() => {
                  setSelectedTeacher({ teacherId: t.id, teacherName: t.name, subject: t.subject || "General" });
                  setShowNewChat(false);
                }}
                  className="flex items-center gap-[14px] px-4 py-[10px] cursor-pointer active:bg-[#F5F6F6] transition-colors">
                  <div className="w-[48px] h-[48px] rounded-full flex items-center justify-center text-white text-[16px] font-semibold shrink-0"
                    style={{ background: gradFor(t.name) }}>
                    {t.name?.substring(0, 2).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[16px] font-medium truncate" style={{ color: T1 }}>{t.name}</div>
                    <div className="text-[13px] truncate" style={{ color: T3 }}>{t.subject || "Teacher"}</div>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="h-4" />
        </div>
      );
    }

    // ── HOME VIEW ─────────────────────────────────────────────────
    const filteredConvs = teacherConversations;
    return (
      <div className="-mx-3 -mt-3 md:mx-0 md:mt-0 animate-in fade-in duration-500"
        style={{ background: BG, minHeight: "100vh", fontFamily: FONT }}>

        {compactHeader}

        {/* Stat row */}
        <div className="mx-5 mt-[14px]">{statRow(false)}</div>

        {/* Hero banner */}
        <div className="mx-5 mt-3 rounded-[22px] px-5 py-4 flex items-center gap-3 relative overflow-hidden"
          style={{ background: `linear-gradient(135deg, ${B1} 0%, ${B2} 50%, ${B3} 100%)`, boxShadow: SH_BTN }}>
          <div className="absolute -top-[30px] -right-[20px] w-[130px] h-[130px] rounded-full pointer-events-none"
            style={{ background: "radial-gradient(circle, rgba(255,255,255,0.14) 0%, transparent 65%)" }} />
          <div className="w-[42px] h-[42px] rounded-[14px] flex items-center justify-center shrink-0 relative z-10"
            style={{ background: "rgba(255,255,255,0.20)", border: "0.5px solid rgba(255,255,255,0.28)" }}>
            <GraduationCap className="w-[22px] h-[22px] text-white" strokeWidth={2.2} />
          </div>
          <div className="relative z-10">
            <div className="text-[17px] font-bold text-white mb-[2px]" style={{ letterSpacing: "-0.3px" }}>Teacher Messages</div>
            <div className="text-[11px] font-normal" style={{ color: "rgba(255,255,255,0.65)" }}>Direct communication with your teachers</div>
          </div>
        </div>

        {/* Search */}
        <div className="mx-5 mt-3 relative">
          <div className="absolute left-[14px] top-1/2 -translate-y-1/2 pointer-events-none">
            <Search className="w-[15px] h-[15px]" style={{ color: "rgba(0,85,255,0.42)" }} strokeWidth={2.2} />
          </div>
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search teachers..."
            className="w-full pl-[42px] pr-4 py-3 rounded-[15px] text-[13px] outline-none"
            style={{ background: CARD, border: "0.5px solid rgba(0,85,255,0.12)", color: T1, boxShadow: SH, fontFamily: FONT }}
          />
        </div>

        {/* New Message btn */}
        <button onClick={() => setShowNewChat(true)}
          className="mx-5 mt-[10px] w-[calc(100%-40px)] h-[50px] rounded-[16px] flex items-center justify-center gap-2 text-[15px] font-bold text-white active:scale-[0.97] relative overflow-hidden"
          style={{ background: `linear-gradient(135deg, ${B1}, ${B2})`, boxShadow: SH_BTN, letterSpacing: "-0.1px" }}>
          <div className="absolute inset-0 pointer-events-none" style={{ background: "linear-gradient(135deg, rgba(255,255,255,0.14) 0%, transparent 52%)" }} />
          <Plus className="w-4 h-4 relative z-10" strokeWidth={2.5} />
          <span className="relative z-10">New Message</span>
        </button>

        {/* Conversation list OR empty state */}
        {loading ? (
          <div className="flex justify-center mt-5"><Loader2 className="w-6 h-6 animate-spin" style={{ color: B1 }} /></div>
        ) : filteredConvs.length > 0 ? (
          <div className="mx-5 mt-3 rounded-[22px] overflow-hidden"
            style={{ background: CARD, boxShadow: SH_LG, border: "0.5px solid rgba(0,85,255,0.10)" }}>
            <div className="px-[18px] pt-[14px] pb-[10px] flex items-center justify-between"
              style={{ borderBottom: "0.5px solid rgba(0,85,255,0.07)" }}>
              <div className="text-[14px] font-bold" style={{ color: T1, letterSpacing: "-0.2px" }}>Conversations</div>
              <div className="px-[9px] py-[3px] rounded-full text-[10px] font-bold"
                style={{ background: "rgba(0,85,255,0.10)", color: B1, border: "0.5px solid rgba(0,85,255,0.18)" }}>
                {filteredConvs.length} active
              </div>
            </div>
            {filteredConvs.map((t, i, arr) => {
              const unread = unreadCounts.get(t.teacherId) || 0;
              return (
                <div key={t.teacherId} onClick={() => setSelectedTeacher(t)}
                  className="flex items-center gap-[13px] px-[18px] py-[14px] cursor-pointer active:bg-[rgba(0,85,255,0.04)] transition-colors"
                  style={i < arr.length - 1 ? { borderBottom: "0.5px solid rgba(0,85,255,0.07)" } : {}}>
                  <div className="w-[46px] h-[46px] rounded-[15px] flex items-center justify-center text-white text-[16px] font-bold shrink-0"
                    style={{ background: gradFor(t.teacherName), boxShadow: "0 3px 10px rgba(0,85,255,0.26)" }}>
                    {t.teacherName?.substring(0, 2).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[14px] font-bold truncate" style={{ color: T1, letterSpacing: "-0.2px" }}>{t.teacherName}</div>
                    <div className="text-[12px] font-normal truncate" style={{ color: T3 }}>
                      {t.lastMessage.from === "parent" ? "✓ " : ""}{t.lastMessage.content}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-[5px] shrink-0">
                    <div className="text-[10px] font-semibold" style={{ color: T4 }}>{fmtTime(t.lastMessage.createdAt)}</div>
                    {unread > 0 && (
                      <div className="min-w-[20px] h-[20px] rounded-full flex items-center justify-center text-[10px] font-bold text-white px-[5px]"
                        style={{ background: `linear-gradient(135deg, ${B1}, ${B2})`, boxShadow: "0 2px 6px rgba(0,85,255,0.30)" }}>
                        {unread}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="mx-5 mt-3 rounded-[22px] px-5 py-8 flex flex-col items-center gap-[10px] relative overflow-hidden"
            style={{ background: CARD, boxShadow: SH_LG, border: "0.5px solid rgba(0,85,255,0.10)" }}>
            <div className="absolute -top-10 -right-7 w-[150px] h-[150px] rounded-full pointer-events-none"
              style={{ background: "radial-gradient(circle, rgba(0,85,255,0.05) 0%, transparent 70%)" }} />
            <div className="w-16 h-16 rounded-[22px] flex items-center justify-center mb-[6px] relative z-10"
              style={{ background: `linear-gradient(135deg, ${B1}, ${B2})`, boxShadow: `${SH_BTN}, 0 0 0 10px rgba(0,85,255,0.07)` }}>
              <MessageSquare className="w-[30px] h-[30px]" style={{ color: "rgba(255,255,255,0.95)" }} strokeWidth={2.1} />
            </div>
            <div className="text-[17px] font-bold text-center relative z-10" style={{ color: T1, letterSpacing: "-0.3px" }}>No conversations yet</div>
            <div className="text-[12px] text-center max-w-[210px] leading-[1.6] font-normal relative z-10" style={{ color: T3 }}>
              Tap <strong style={{ color: B1, fontWeight: 700 }}>New Message</strong> to start a direct chat with your teacher.
            </div>
          </div>
        )}

        <div className="h-4" />
      </div>
    );
  }

  /* ═══════════════════════════════════════════════════════════════
     DESKTOP — Bright Blue Apple UI
     ═══════════════════════════════════════════════════════════════ */
  const B1 = "#0055FF", B2 = "#1166FF", B3 = "#2277FF";
  const BG_D = "#EEF4FF", BG2_D = "#E0ECFF";
  const T1 = "#001040", T3 = "#5070B0", T4 = "#99AACC";
  const ORANGE = "#FF8800", GOLD = "#FFAA00", GREEN = "#00C853", RED = "#FF3355";
  const BLUE_BDR = "rgba(0,85,255,0.12)";
  const SH_D = "0 0 0 0.5px rgba(0,85,255,0.08), 0 2px 8px rgba(0,85,255,0.09), 0 10px 28px rgba(0,85,255,0.11)";
  const SH_LG_D = "0 0 0 0.5px rgba(0,85,255,0.10), 0 4px 16px rgba(0,85,255,0.12), 0 18px 44px rgba(0,85,255,0.14)";
  const SH_BTN_D = "0 6px 22px rgba(0,85,255,0.42), 0 2px 6px rgba(0,85,255,0.22)";
  const FONT_D = "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif";

  // ── WhatsApp Web palette (used inside the chat container) ──
  const WA_GREEN = "#00A884", WA_GREEN_DEEP = "#008069";
  const WA_HEADER_BG = "#F0F2F5";
  const WA_CHAT_BG = "#EFEAE2";
  const WA_BUBBLE_OUT = "#D9FDD3";
  const WA_TICK_READ = "#53BDEB";
  const WA_SEP = "#E9EDEF";
  const WA_T1 = "#111B21", WA_T2 = "#3B4A54", WA_T3 = "#667781";

  const teacherGradsD = [
    { bg: `linear-gradient(135deg, ${GREEN}, #22EE66)`, sh: "0 3px 10px rgba(0,200,83,0.26)" },
    { bg: `linear-gradient(135deg, ${ORANGE}, #FFCC22)`, sh: "0 3px 10px rgba(255,136,0,0.26)" },
    { bg: `linear-gradient(135deg, ${B1}, ${B3})`, sh: "0 3px 10px rgba(0,85,255,0.26)" },
    { bg: "linear-gradient(135deg, #8844CC, #BB77FF)", sh: "0 3px 10px rgba(136,68,204,0.26)" },
  ];
  const gradForName = (name?: string) => teacherGradsD[((name?.charCodeAt(0) || 0) % teacherGradsD.length + teacherGradsD.length) % teacherGradsD.length];

  const mergedConversationsD = (() => {
    const map = new Map<string, any>(teacherConversations.map(t => [t.teacherId, t]));
    availableTeachers.forEach((t: any) => {
      if (!map.has(t.id)) {
        map.set(t.id, { teacherId: t.id, teacherName: t.name, subject: t.subject || "General", lastMessage: null });
      }
    });
    return Array.from(map.values())
      .filter(t => (t.teacherName || "").toLowerCase().includes(searchQuery.toLowerCase()))
      .sort((a, b) => (b.lastMessage?.createdAt?.toMillis?.() || 0) - (a.lastMessage?.createdAt?.toMillis?.() || 0));
  })();

  return (
    <div className="animate-in fade-in duration-500 -m-4 sm:-m-6 md:-m-8 min-h-[calc(100vh-64px)]"
      style={{ fontFamily: FONT_D, background: BG_D }}>
      <div className="w-full px-6 pt-8 pb-12">

        {/* ── Toolbar ── */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.12em] mb-1 flex items-center gap-[7px]" style={{ color: T4 }}>
              <span className="w-[6px] h-[6px] rounded-full animate-pulse" style={{ background: GREEN, boxShadow: "0 0 0 3px rgba(0,200,83,0.2)" }} />
              Parent Dashboard · Teacher Messages
            </div>
            <h1 className="text-[32px] font-bold leading-none" style={{ color: T1, letterSpacing: "-0.8px" }}>Teacher Notes &amp; Chat</h1>
            <div className="text-[13px] font-normal mt-[6px]" style={{ color: T3 }}>Direct messages with your child's teachers</div>
          </div>
          <div className="flex items-center gap-[10px]">
            <button onClick={() => setShowNewChat(true)}
              className="px-4 py-[10px] rounded-[14px] text-[13px] font-bold text-white flex items-center gap-2 transition-transform hover:scale-[1.02]"
              style={{ background: `linear-gradient(135deg, ${B1}, ${B2})`, boxShadow: SH_BTN_D, letterSpacing: "-0.1px" }}>
              <Plus className="w-4 h-4" strokeWidth={2.5} /> New Message
            </button>
            <div className="w-10 h-10 rounded-full flex items-center justify-center relative"
              style={{ background: "#fff", border: `0.5px solid ${BLUE_BDR}`, boxShadow: SH_D }}>
              <Bell className="w-4 h-4" style={{ color: "rgba(0,85,255,0.60)" }} strokeWidth={1.8} />
              {stats.unread > 0 && <span className="absolute top-[1px] right-[1px] w-2 h-2 rounded-full" style={{ background: RED, border: "1.5px solid white" }} />}
            </div>
            <div className="w-10 h-10 rounded-full flex items-center justify-center text-[14px] font-bold text-white"
              style={{ background: `linear-gradient(140deg, ${B1}, ${B2})`, boxShadow: "0 3px 12px rgba(0,85,255,0.36), 0 0 0 2px rgba(255,255,255,0.8)" }}>
              {(studentData?.name?.[0] || "S").toUpperCase()}
            </div>
          </div>
        </div>

        {/* ── Stat strip ── */}
        <div className="grid grid-cols-3 gap-4 mb-5">
          {[
            { label: "Total Messages", val: stats.total, color: B1, icon: MessageSquare, decorIcon: MessagesSquare, cardBg: "linear-gradient(135deg, rgba(0,85,255,0.10) 0%, rgba(0,85,255,0.03) 100%)", cardBdr: "rgba(0,85,255,0.20)", iconBoxBg: "rgba(0,85,255,0.14)", iconBoxBdr: "rgba(0,85,255,0.28)" },
            { label: "Unread", val: stats.unread, color: ORANGE, icon: Mail, decorIcon: MailOpen, cardBg: "linear-gradient(135deg, rgba(255,136,0,0.13) 0%, rgba(255,136,0,0.04) 100%)", cardBdr: "rgba(255,136,0,0.22)", iconBoxBg: "rgba(255,136,0,0.18)", iconBoxBdr: "rgba(255,136,0,0.32)" },
            { label: "Teachers", val: stats.teachers, color: GREEN, icon: GraduationCap, decorIcon: Users, cardBg: "linear-gradient(135deg, rgba(0,200,83,0.13) 0%, rgba(0,200,83,0.04) 100%)", cardBdr: "rgba(0,200,83,0.20)", iconBoxBg: "rgba(0,200,83,0.18)", iconBoxBdr: "rgba(0,200,83,0.30)" },
          ].map(({ label, val, color, icon: Icon, decorIcon: DecorIcon, cardBg, cardBdr, iconBoxBg, iconBoxBdr }) => (
            <div key={label} className="rounded-[22px] px-6 py-5 relative overflow-hidden"
              style={{ background: cardBg, boxShadow: SH_D, border: `0.5px solid ${cardBdr}` }}>
              <div className="absolute pointer-events-none" style={{ bottom: 14, right: 14 }}>
                <DecorIcon style={{ width: 80, height: 80, color, opacity: 0.20, strokeWidth: 1.6 }} />
              </div>
              <div className="flex items-center justify-between mb-3 relative">
                <span className="text-[10px] font-bold uppercase tracking-[0.12em]" style={{ color: T4 }}>{label}</span>
                <div className="w-10 h-10 rounded-[12px] flex items-center justify-center"
                  style={{ background: iconBoxBg, border: `0.5px solid ${iconBoxBdr}` }}>
                  <Icon className="w-[18px] h-[18px]" style={{ color }} strokeWidth={2.3} />
                </div>
              </div>
              <div className="text-[34px] font-bold leading-none relative" style={{ color, letterSpacing: "-1px" }}>{val}</div>
            </div>
          ))}
        </div>

        {/* ── Main chat layout — WhatsApp Web style ── */}
        <div className="rounded-[14px] overflow-hidden flex flex-col bg-white"
          style={{ boxShadow: SH_LG_D, border: `1px solid ${WA_SEP}`, height: "calc(100vh - 320px)", minHeight: 560 }}>
          <div className="flex flex-1 overflow-hidden">

            {/* ── Left sidebar: conversations ── */}
            <div className="w-[360px] shrink-0 flex flex-col relative bg-white" style={{ borderRight: `1px solid ${WA_SEP}` }}>
              {/* WA-style green-gray app bar */}
              <div className="flex items-center justify-between px-4 py-3 shrink-0"
                style={{ background: WA_HEADER_BG, borderBottom: `1px solid ${WA_SEP}` }}>
                <div className="text-[16px] font-medium" style={{ color: WA_T1, letterSpacing: "-0.1px" }}>Chats</div>
                <div className="flex items-center gap-1">
                  <button onClick={() => setShowNewChat(true)}
                    className="w-9 h-9 rounded-full flex items-center justify-center transition-colors hover:bg-[rgba(11,20,26,0.06)]"
                    title="New message">
                    <Plus className="w-[18px] h-[18px]" style={{ color: WA_T2 }} strokeWidth={2.2} />
                  </button>
                  <button className="w-9 h-9 rounded-full flex items-center justify-center transition-colors hover:bg-[rgba(11,20,26,0.06)]">
                    <MoreVertical className="w-[18px] h-[18px]" style={{ color: WA_T2 }} strokeWidth={2.2} />
                  </button>
                </div>
              </div>

              {/* Search bar (WA pill) */}
              <div className="px-3 py-2 shrink-0 bg-white">
                <div className="flex items-center gap-3 rounded-[8px] px-3 py-[7px]" style={{ background: WA_HEADER_BG }}>
                  <Search className="w-[15px] h-[15px]" style={{ color: WA_T3 }} strokeWidth={2.3} />
                  <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                    placeholder="Search or start new chat"
                    className="flex-1 min-w-0 bg-transparent text-[13px] outline-none"
                    style={{ color: WA_T1, fontFamily: FONT_D }} />
                </div>
              </div>

              {/* New chat overlay */}
              {showNewChat && (
                <div className="absolute inset-0 bg-white z-20 flex flex-col">
                  <div className="px-4 py-[14px] flex items-center gap-3 shrink-0" style={{ background: WA_GREEN }}>
                    <button onClick={() => setShowNewChat(false)}
                      className="w-9 h-9 rounded-full flex items-center justify-center hover:bg-[rgba(255,255,255,0.12)]">
                      <ChevronLeft className="w-[20px] h-[20px] text-white" strokeWidth={2.5} />
                    </button>
                    <span className="text-[15px] font-medium text-white">New chat</span>
                  </div>
                  <div className="flex-1 overflow-y-auto no-sb">
                    {availableTeachers.length === 0 ? (
                      <div className="py-12 text-center text-[12px]" style={{ color: WA_T3 }}>No class teachers found</div>
                    ) : availableTeachers.map(t => {
                      const g = gradForName(t.name);
                      return (
                        <button key={t.id} onClick={() => {
                          setSelectedTeacher({ teacherId: t.id, teacherName: t.name, subject: t.subject || "General" });
                          setShowNewChat(false);
                        }}
                          className="w-full flex items-center gap-3 px-4 py-[10px] transition-colors hover:bg-[#F5F6F6]">
                          <div className="w-12 h-12 rounded-full flex items-center justify-center text-white text-[14px] font-semibold shrink-0"
                            style={{ background: g.bg }}>
                            {t.name?.substring(0, 2).toUpperCase()}
                          </div>
                          <div className="text-left">
                            <div className="text-[15px] font-medium" style={{ color: WA_T1 }}>{t.name}</div>
                            <div className="text-[12px] mt-[2px]" style={{ color: WA_T3 }}>{t.subject || "Teacher"}</div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Conversation list */}
              <div className="flex-1 overflow-y-auto no-sb">
                {loading ? (
                  <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin" style={{ color: WA_GREEN }} /></div>
                ) : mergedConversationsD.length === 0 ? (
                  <div className="py-12 px-5 text-center text-[12px]" style={{ color: WA_T3 }}>
                    No conversations yet. Click <strong style={{ color: WA_GREEN }}>+</strong> to start.
                  </div>
                ) : mergedConversationsD.map(t => {
                  const unread = unreadCounts.get(t.teacherId) || 0;
                  const active = selectedTeacher?.teacherId === t.teacherId;
                  const g = gradForName(t.teacherName);
                  return (
                    <button key={t.teacherId} onClick={() => setSelectedTeacher(t)}
                      className="w-full flex items-center gap-3 pl-[15px] pr-3 py-[10px] transition-colors hover:bg-[#F5F6F6]"
                      style={{ background: active ? "#F0F2F5" : "transparent" }}>
                      <div className="w-12 h-12 rounded-full flex items-center justify-center text-white text-[14px] font-semibold shrink-0"
                        style={{ background: g.bg }}>
                        {t.teacherName?.substring(0, 2).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0 text-left" style={{ borderTop: `1px solid ${WA_SEP}`, paddingTop: 10, paddingBottom: 10, marginTop: -10, marginBottom: -10 }}>
                        <div className="flex justify-between items-center">
                          <span className="text-[15px] font-medium truncate" style={{ color: WA_T1 }}>{t.teacherName}</span>
                          {t.lastMessage && (
                            <span className="text-[11.5px] shrink-0 ml-2" style={{ color: unread > 0 ? WA_GREEN : WA_T3 }}>
                              {fmtTime(t.lastMessage.createdAt)}
                            </span>
                          )}
                        </div>
                        <div className="flex justify-between items-center mt-[2px]">
                          <span className="text-[13px] truncate flex items-center gap-1 min-w-0" style={{ color: WA_T3 }}>
                            {t.lastMessage?.from === "parent" && <CheckCheck className="w-[14px] h-[14px] shrink-0" style={{ color: WA_TICK_READ }} strokeWidth={2.2} />}
                            <span className="truncate">{t.lastMessage ? t.lastMessage.content : (t.subject || "Start conversation")}</span>
                          </span>
                          {unread > 0 && (
                            <span className="ml-2 min-w-[20px] h-5 rounded-full text-white text-[11px] font-semibold flex items-center justify-center px-[6px] shrink-0"
                              style={{ background: WA_GREEN }}>
                              {unread}
                            </span>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* ── Right: chat panel ── */}
            <div className="flex-1 flex flex-col overflow-hidden" style={{ background: WA_CHAT_BG }}>
              {selectedTeacher ? (
                <>
                  {/* Chat header (WA gray) */}
                  <div className="flex items-center gap-3 px-4 py-[10px] shrink-0"
                    style={{ background: WA_HEADER_BG, borderBottom: `1px solid ${WA_SEP}` }}>
                    <div className="w-10 h-10 rounded-full flex items-center justify-center text-white text-[13px] font-semibold shrink-0"
                      style={{ background: gradForName(selectedTeacher.teacherName).bg }}>
                      {selectedTeacher.teacherName?.substring(0, 2).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[16px] font-medium leading-tight" style={{ color: WA_T1, letterSpacing: "-0.1px" }}>{selectedTeacher.teacherName}</div>
                      <div className="text-[12px] mt-[2px]" style={{ color: WA_T3 }}>
                        {selectedTeacher.subject || "Teacher"} · online
                      </div>
                    </div>
                    <button onClick={() => setShowRateModal(true)}
                      className="flex items-center gap-[5px] px-3 py-[7px] rounded-full text-[12px] font-medium transition-colors hover:bg-[rgba(11,20,26,0.06)]"
                      style={{ color: WA_T2 }}>
                      <Star className="w-[14px] h-[14px]" style={{ fill: GOLD, color: GOLD }} strokeWidth={2} /> Rate
                    </button>
                    <button className="w-9 h-9 rounded-full flex items-center justify-center transition-colors hover:bg-[rgba(11,20,26,0.06)]">
                      <Phone className="w-[18px] h-[18px]" style={{ color: WA_T2 }} strokeWidth={2} />
                    </button>
                    <button className="w-9 h-9 rounded-full flex items-center justify-center transition-colors hover:bg-[rgba(11,20,26,0.06)]">
                      <Search className="w-[18px] h-[18px]" style={{ color: WA_T2 }} strokeWidth={2} />
                    </button>
                    <button className="w-9 h-9 rounded-full flex items-center justify-center transition-colors hover:bg-[rgba(11,20,26,0.06)]">
                      <MoreVertical className="w-[18px] h-[18px]" style={{ color: WA_T2 }} strokeWidth={2} />
                    </button>
                  </div>

                  {/* Messages — WA chat wallpaper */}
                  <div className="flex-1 overflow-y-auto no-sb px-[60px] py-4 flex flex-col"
                    style={{
                      background: WA_CHAT_BG,
                      backgroundImage: "radial-gradient(circle at 1px 1px, rgba(11,20,26,0.05) 1px, transparent 0)",
                      backgroundSize: "22px 22px",
                    }}>
                    {groupedMessages.length === 0 ? (
                      <div className="flex-1 flex items-center justify-center">
                        <div className="text-center px-8 py-6 rounded-[8px]"
                          style={{ background: "rgba(255,255,255,0.94)", boxShadow: "0 1px 3px rgba(11,20,26,0.10)" }}>
                          <div className="w-[60px] h-[60px] rounded-full flex items-center justify-center mx-auto mb-3"
                            style={{ background: "rgba(0,168,132,0.10)" }}>
                            <GraduationCap className="w-7 h-7" style={{ color: WA_GREEN, opacity: 0.7 }} strokeWidth={2.2} />
                          </div>
                          <div className="text-[15px] font-semibold mb-1" style={{ color: WA_T1 }}>No messages yet</div>
                          <div className="text-[13px] max-w-[260px] leading-[1.5]" style={{ color: WA_T3 }}>
                            Start the conversation with <strong>{selectedTeacher.teacherName}</strong>.
                          </div>
                        </div>
                      </div>
                    ) : groupedMessages.map(group => (
                      <div key={group.date}>
                        <div className="flex justify-center my-3">
                          <span className="px-[10px] py-[4px] rounded-[6px] text-[11.5px] font-medium"
                            style={{ background: "#FFFFFF", color: WA_T3, boxShadow: "0 1px 1px rgba(11,20,26,0.08)" }}>
                            {group.date}
                          </span>
                        </div>
                        {group.messages.map(n => {
                          const isParent = n.from === "parent";
                          return (
                            <div key={n.id} className={`flex mb-[3px] ${isParent ? "justify-end" : "justify-start"}`}>
                              <div className="max-w-[65%] px-[9px] py-[6px] relative"
                                style={isParent ? {
                                  background: WA_BUBBLE_OUT,
                                  borderRadius: "8px 8px 0 8px",
                                  boxShadow: "0 1px 1px rgba(11,20,26,0.08)",
                                } : {
                                  background: "#fff",
                                  borderRadius: "8px 8px 8px 0",
                                  boxShadow: "0 1px 1px rgba(11,20,26,0.08)",
                                }}>
                                <p className={`text-[14.2px] whitespace-pre-wrap leading-[1.4] ${isParent ? "pr-[58px]" : "pr-[44px]"}`}
                                  style={{ color: WA_T1 }}>{n.content}</p>
                                <div className="absolute right-[8px] bottom-[4px] flex items-center gap-[3px]">
                                  <span className="text-[11px]" style={{ color: WA_T3 }}>{fmtTime(n.createdAt)}</span>
                                  {isParent && <CheckCheck className="w-[15px] h-[15px]" style={{ color: WA_TICK_READ }} strokeWidth={2.2} />}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ))}
                    <div ref={chatEndRef} />
                  </div>

                  {/* Input bar (WA gray with white pill input + green send) */}
                  <div className="flex items-end gap-2 px-4 py-[10px] shrink-0" style={{ background: WA_HEADER_BG }}>
                    <button className="w-10 h-10 rounded-full flex items-center justify-center transition-colors hover:bg-[rgba(11,20,26,0.06)]">
                      <Smile className="w-[22px] h-[22px]" style={{ color: WA_T2 }} strokeWidth={1.8} />
                    </button>
                    <button className="w-10 h-10 rounded-full flex items-center justify-center transition-colors hover:bg-[rgba(11,20,26,0.06)]">
                      <Paperclip className="w-[20px] h-[20px]" style={{ color: WA_T2 }} strokeWidth={2} />
                    </button>
                    <div className="flex-1 rounded-[8px] flex items-center min-h-[42px] px-4 py-2 bg-white">
                      <textarea rows={1} value={messageContent}
                        onChange={e => setMessageContent(e.target.value)}
                        onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                        placeholder="Type a message"
                        className="flex-1 bg-transparent border-none focus:ring-0 text-[14px] resize-none outline-none leading-relaxed"
                        style={{ fontFamily: FONT_D, color: WA_T1 }} />
                      <button title="AI assist" className="w-7 h-7 flex items-center justify-center">
                        <Sparkles className="w-[16px] h-[16px]" style={{ color: WA_GREEN }} strokeWidth={2} />
                      </button>
                    </div>
                    <button onClick={handleSend} disabled={!messageContent.trim()}
                      className="w-11 h-11 rounded-full flex items-center justify-center transition-transform hover:scale-105 disabled:opacity-40"
                      style={{ background: WA_GREEN }}>
                      <Send className="w-[18px] h-[18px] text-white" strokeWidth={2.3} fill="#fff" />
                    </button>
                  </div>
                </>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center text-center p-10"
                  style={{ background: WA_CHAT_BG }}>
                  <div className="max-w-md text-center">
                    <div className="w-[120px] h-[120px] rounded-full flex items-center justify-center mx-auto mb-6"
                      style={{ background: "rgba(0,168,132,0.10)" }}>
                      <GraduationCap className="w-14 h-14" style={{ color: WA_GREEN, opacity: 0.6 }} strokeWidth={1.8} />
                    </div>
                    <div className="text-[28px] font-light mb-3" style={{ color: WA_T2, letterSpacing: "-0.4px" }}>Teacher Notes Web</div>
                    <div className="text-[13.5px] leading-[1.6]" style={{ color: WA_T3 }}>
                      Select a teacher from the sidebar to start messaging or review past conversations. You can also <strong style={{ color: WA_GREEN_DEEP }}>Rate</strong> a teacher from their chat.
                    </div>
                    <div className="mt-6 flex justify-center gap-2">
                      <div className="flex items-center gap-[5px] px-3 py-[5px] rounded-full text-[11px] font-semibold"
                        style={{ background: "rgba(0,168,132,0.10)", color: WA_GREEN_DEEP }}>
                        <MessageSquare className="w-[11px] h-[11px]" strokeWidth={2.3} /> {stats.total} msgs
                      </div>
                      <div className="flex items-center gap-[5px] px-3 py-[5px] rounded-full text-[11px] font-semibold"
                        style={{ background: "rgba(0,168,132,0.10)", color: WA_GREEN_DEEP }}>
                        <GraduationCap className="w-[11px] h-[11px]" strokeWidth={2.3} /> {stats.teachers} teachers
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Rate Teacher Modal */}
      {showRateModal && selectedTeacher && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,16,64,0.55)", fontFamily: FONT_D, backdropFilter: "blur(4px)" }}>
          <div className="bg-white rounded-[26px] p-8 w-full max-w-md relative overflow-hidden"
            style={{ boxShadow: "0 24px 60px rgba(0,20,80,0.30)" }}>
            <div className="absolute -top-[40px] -right-[30px] w-[180px] h-[180px] rounded-full pointer-events-none"
              style={{ background: "radial-gradient(circle, rgba(255,170,0,0.08) 0%, transparent 70%)" }} />
            <div className="flex items-center justify-between mb-6 relative z-10">
              <div>
                <div className="text-[19px] font-bold" style={{ color: T1, letterSpacing: "-0.3px" }}>Rate Teacher</div>
                <div className="text-[13px] font-semibold mt-[3px]" style={{ color: B1 }}>{selectedTeacher.teacherName}</div>
              </div>
              <button onClick={() => { setShowRateModal(false); setRatingValue(0); setReviewText(""); }}
                className="w-9 h-9 rounded-full flex items-center justify-center transition-transform hover:scale-105"
                style={{ background: BG_D, border: `0.5px solid ${BLUE_BDR}` }}>
                <X className="w-4 h-4" style={{ color: T3 }} />
              </button>
            </div>
            <div className="text-center mb-6 relative z-10">
              <div className="text-[10px] font-bold uppercase tracking-[0.15em] mb-3" style={{ color: T4 }}>Your Rating</div>
              <div className="flex justify-center gap-2">
                {[1, 2, 3, 4, 5].map(star => (
                  <button key={star}
                    onMouseEnter={() => setHoverRating(star)}
                    onMouseLeave={() => setHoverRating(0)}
                    onClick={() => setRatingValue(star)}
                    className="transition-transform hover:scale-125 active:scale-90">
                    <Star size={38} style={{
                      fill: star <= (hoverRating || ratingValue) ? GOLD : "transparent",
                      color: star <= (hoverRating || ratingValue) ? GOLD : BG2_D,
                    }} />
                  </button>
                ))}
              </div>
              {ratingValue > 0 && (
                <div className="text-[14px] font-bold mt-3" style={{ color: GOLD }}>
                  {["", "Poor", "Fair", "Good", "Very Good", "Excellent"][ratingValue]}
                </div>
              )}
            </div>
            <div className="mb-5 relative z-10">
              <div className="text-[10px] font-bold uppercase tracking-[0.15em] mb-2" style={{ color: T4 }}>Review (Optional)</div>
              <textarea rows={4} value={reviewText} onChange={e => setReviewText(e.target.value)}
                placeholder="Share your experience…"
                className="w-full px-4 py-3 rounded-[14px] text-[13px] resize-none outline-none"
                style={{ background: BG_D, border: `0.5px solid ${BLUE_BDR}`, color: T1, fontFamily: FONT_D }} />
            </div>
            <button onClick={handleSubmitReview} disabled={ratingValue === 0 || isSubmittingReview}
              className="w-full h-12 rounded-[14px] text-white font-bold text-[14px] flex items-center justify-center gap-2 transition-transform hover:scale-[1.01] disabled:opacity-50 relative z-10"
              style={{ background: `linear-gradient(135deg, ${B1}, ${B2})`, boxShadow: SH_BTN_D, letterSpacing: "-0.1px" }}>
              {isSubmittingReview ? <><Loader2 className="w-4 h-4 animate-spin" /> Submitting…</> : <><Star className="w-4 h-4 fill-white" /> Submit Review</>}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default TeacherNotesPage;
