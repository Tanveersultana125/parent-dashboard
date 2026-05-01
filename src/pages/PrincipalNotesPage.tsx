import { useState, useEffect, useRef, useMemo } from "react";
import { Loader2, Send, CheckCheck, School, Mail, MessageSquare, Smile, Shield, ChevronLeft } from "lucide-react";
import { db } from "../lib/firebase";
import { scopedQuery } from "../lib/scopedQuery";
import { subscribePerStudent } from "../lib/perStudentQuery";
import { collection, where, onSnapshot, addDoc, serverTimestamp, updateDoc, doc } from "firebase/firestore";
import { useAuth } from "../lib/AuthContext";
import { useIsMobile } from "@/hooks/use-mobile";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

const PrincipalNotesPage = () => {
  const { studentData } = useAuth();
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const [allMessages, setAllMessages]       = useState<any[]>([]);
  const [loading, setLoading]               = useState(true);
  const [messageContent, setMessageContent] = useState("");
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!studentData?.id) return;
    setLoading(true);
    // Dual-query (studentId + studentEmail) — see lib/perStudentQuery.ts
    const unsub = subscribePerStudent({
      collection: "principal_to_parent_notes",
      student: studentData,
      onChange: async (docs) => {
        const data = docs.map(d => ({ id: d.id, ...d.data() })) as any[];
        data.sort((a, b) => (a.timestamp?.toMillis?.() || 0) - (b.timestamp?.toMillis?.() || 0));
        setAllMessages(data);
        setLoading(false);
        // mark unread principal messages as read
        for (const d of docs) {
          const dd = d.data();
          if (dd.read === false && dd.from === "principal") {
            try { await updateDoc(doc(db, "principal_to_parent_notes", d.id), { read: true }); } catch { /* silent */ }
          }
        }
      },
    });
    return () => unsub();
  }, [studentData?.id, studentData?.schoolId, studentData?.email]);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [allMessages]);

  const stats = useMemo(() => ({
    total:  allMessages.length,
    unread: allMessages.filter(m => m.read === false && m.from === "principal").length,
  }), [allMessages]);

  const handleSend = async () => {
    if (!messageContent.trim()) return;
    const content = messageContent.trim();
    if (!studentData?.schoolId) {
      toast.error("Your school context is missing. Please sign in again.");
      return;
    }
    if (!studentData.id) {
      toast.error("We couldn't identify your student record. Please sign in again.");
      return;
    }
    // Without a prior principal message in this thread we have no principalId
    // to address. The server rule accepts the write but the note becomes
    // unaddressable (principal's inbox query filters by principalId). Surface
    // this explicitly instead of creating orphaned records.
    const principalId = allMessages[0]?.principalId;
    if (!principalId) {
      toast.error("No principal is assigned to your school yet. Please check back later.");
      return;
    }
    setMessageContent("");
    try {
      await addDoc(collection(db, "principal_to_parent_notes"), {
        principalId,
        principalName: allMessages[0]?.principalName || "Principal",
        studentId:     studentData.id,
        studentName:   studentData.name || "",
        parentName:    `Parent of ${studentData.name || "Student"}`,
        className:     studentData.className || "",
        message: content,
        from: "parent",
        timestamp: serverTimestamp(),
        schoolId: studentData.schoolId,
        branchId: studentData.branchId || "",
        read: false,
      });
    } catch (err: any) {
      console.error("[PrincipalNotes] send failed:", err?.code, err?.message || err);
      // Keep the message content so the parent can retry. Never leak Firebase
      // internals (rule names, deploy hints) to the UI — that jargon helps
      // nobody and looks like a crash report to non-technical users.
      toast.error(err?.code === "permission-denied"
        ? "This message couldn't be sent. Please contact your school if this continues."
        : "Couldn't send the message. Please check your connection and try again.");
      setMessageContent(content);
    }
  };

  const fmtTime = (ts: any) =>
    new Date(ts?.toDate?.() || Date.now()).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  const fmtDate = (ts: any) => {
    const d = ts?.toDate?.() || new Date();
    const today = new Date();
    if (d.toDateString() === today.toDateString()) return "Today";
    const y = new Date(today); y.setDate(today.getDate() - 1);
    if (d.toDateString() === y.toDateString()) return "Yesterday";
    return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  };

  const groupedMessages = useMemo(() => {
    const groups: { date: string; messages: any[] }[] = [];
    allMessages.forEach(msg => {
      const label = fmtDate(msg.timestamp);
      const last  = groups[groups.length - 1];
      if (last && last.date === label) last.messages.push(msg);
      else groups.push({ date: label, messages: [msg] });
    });
    return groups;
  }, [allMessages]);

  const principalName = allMessages[0]?.principalName || "Principal";

  // ═══════════════════════════════════════════════════════════════
  // MOBILE — WhatsApp UI (Principal Chat — full bleed)
  // ═══════════════════════════════════════════════════════════════
  if (isMobile) {
    const WA_GREEN = "#00A884";
    const WA_HEADER_BG = "#F0F2F5";
    const WA_CHAT_BG = "#EFEAE2";
    const WA_BUBBLE_OUT = "#D9FDD3";
    const WA_TICK_READ = "#53BDEB";
    const WA_T1 = "#111B21", WA_T3 = "#667781";
    const FONT = "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif";

    return (
      <div className="flex-1 flex flex-col -mx-3 -mt-3 md:mx-0 md:mt-0 mb-[calc(-88px-env(safe-area-inset-bottom)-1rem)] md:mb-0 pb-[calc(88px+env(safe-area-inset-bottom)+0.5rem)] md:pb-0 animate-in fade-in duration-500"
        style={{ background: WA_CHAT_BG, fontFamily: FONT }}>
        <style>{`.pn-scroll::-webkit-scrollbar{display:none}`}</style>

        {/* WA-style green chat header */}
        <div className="flex items-center gap-3 px-3 py-[10px] shrink-0"
          style={{ background: WA_GREEN, color: "#fff" }}>
          <button onClick={() => navigate(-1)}
            className="w-8 h-8 flex items-center justify-center active:scale-90 shrink-0"
            aria-label="Back">
            <ChevronLeft className="w-[22px] h-[22px] text-white" strokeWidth={2.5} />
          </button>
          <div className="w-10 h-10 rounded-full flex items-center justify-center text-white shrink-0"
            style={{ background: "rgba(255,255,255,0.22)", border: "1.5px solid rgba(255,255,255,0.30)" }}>
            <School className="w-[20px] h-[20px]" strokeWidth={2.1} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[16px] font-semibold text-white truncate" style={{ letterSpacing: "-0.1px" }}>{principalName}</div>
            <div className="text-[12px] truncate" style={{ color: "rgba(255,255,255,0.78)" }}>
              School Administration · online
            </div>
          </div>
          <div className="flex items-center gap-[3px] px-[10px] py-[5px] rounded-full shrink-0"
            style={{ background: "rgba(255,255,255,0.18)" }}>
            <Shield className="w-[11px] h-[11px] text-white" strokeWidth={2.5} />
            <span className="text-[10px] font-semibold text-white tracking-[0.04em]">Official</span>
          </div>
        </div>

        {/* Chat scroll area — WA wallpaper */}
        <div className="pn-scroll flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-3 py-3 flex flex-col"
          style={{
            background: WA_CHAT_BG,
            backgroundImage: "radial-gradient(circle at 1px 1px, rgba(11,20,26,0.05) 1px, transparent 0)",
            backgroundSize: "22px 22px",
            scrollbarWidth: "none",
          }}>
          {loading ? (
            <div className="flex-1 flex items-center justify-center">
              <Loader2 className="w-6 h-6 animate-spin" style={{ color: WA_GREEN }} />
            </div>
          ) : groupedMessages.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 py-8">
              <div className="w-[60px] h-[60px] rounded-full flex items-center justify-center"
                style={{ background: "rgba(0,168,132,0.10)" }}>
                <School className="w-[26px] h-[26px]" style={{ color: WA_GREEN, opacity: 0.7 }} strokeWidth={2.1} />
              </div>
              <div className="text-[15px] font-semibold text-center" style={{ color: WA_T1 }}>No messages from Principal yet</div>
              <div className="text-[12px] text-center max-w-[230px] leading-[1.5]" style={{ color: WA_T3 }}>
                Messages from your school principal will appear here
              </div>
            </div>
          ) : groupedMessages.map(group => (
            <div key={group.date}>
              <div className="flex justify-center my-3">
                <span className="px-[10px] py-[4px] rounded-[6px] text-[11px] font-medium"
                  style={{ background: "#FFFFFF", color: WA_T3, boxShadow: "0 1px 1px rgba(11,20,26,0.08)" }}>
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
                        boxShadow: "0 1px 1px rgba(11,20,26,0.08)",
                      }}>
                      <div className="text-[14px] leading-[1.4] whitespace-pre-wrap break-words pr-[58px]" style={{ color: WA_T1 }}>{n.message}</div>
                      <div className="absolute right-[8px] bottom-[4px] flex items-center gap-[3px]">
                        <span className="text-[10px]" style={{ color: WA_T3 }}>{fmtTime(n.timestamp)}</span>
                        <CheckCheck className="w-[14px] h-[14px]" style={{ color: WA_TICK_READ }} />
                      </div>
                    </div>
                  </div>
                ) : (
                  <div key={n.id} className="flex justify-start mb-[3px]">
                    <div className="max-w-[78%] px-[9px] py-[6px] relative"
                      style={{
                        background: "#fff",
                        borderRadius: "8px 8px 8px 0",
                        boxShadow: "0 1px 1px rgba(11,20,26,0.08)",
                      }}>
                      <div className="text-[14px] leading-[1.4] whitespace-pre-wrap break-words pr-[44px]" style={{ color: WA_T1 }}>{n.message}</div>
                      <div className="absolute right-[8px] bottom-[4px]">
                        <span className="text-[10px]" style={{ color: WA_T3 }}>{fmtTime(n.timestamp)}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
          <div ref={chatEndRef} />
        </div>

        {/* WA reply bar */}
        <div className="px-2 py-[7px] flex items-end gap-[6px] shrink-0" style={{ background: WA_HEADER_BG }}>
          <div className="flex-1 flex items-center gap-1 px-3 py-[8px] rounded-[24px] bg-white">
            <button className="w-7 h-7 flex items-center justify-center active:scale-90 shrink-0" aria-label="Emoji">
              <Smile className="w-[22px] h-[22px]" style={{ color: WA_T3 }} strokeWidth={1.8} />
            </button>
            <input
              type="text"
              value={messageContent}
              onChange={e => setMessageContent(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
              placeholder="Reply to principal"
              className="flex-1 min-w-0 px-2 text-[15px] outline-none bg-transparent"
              style={{ color: WA_T1, fontFamily: FONT }}
            />
          </div>
          <button onClick={handleSend} disabled={!messageContent.trim()}
            className="w-11 h-11 rounded-full flex items-center justify-center active:scale-90 shrink-0 disabled:opacity-50"
            style={{ background: WA_GREEN }}
            aria-label="Send">
            <Send className="w-[18px] h-[18px] text-white" strokeWidth={2.4} fill="#fff" />
          </button>
        </div>
      </div>
    );
  }

  /* ═══════════════════════════════════════════════════════════════
     DESKTOP — Bright Blue Apple UI
     ═══════════════════════════════════════════════════════════════ */
  const B1 = "#0055FF", B2 = "#1166FF", B3 = "#2277FF";
  const BG_D = "#EEF4FF";
  const T1 = "#001040", T3 = "#5070B0", T4 = "#99AACC";
  const ORANGE = "#FF8800", GREEN = "#00C853", RED = "#FF3355";
  const BLUE_BDR = "rgba(0,85,255,0.12)";
  const SH_D = "0 0 0 0.5px rgba(0,85,255,0.08), 0 2px 8px rgba(0,85,255,0.09), 0 10px 28px rgba(0,85,255,0.11)";
  const SH_LG_D = "0 0 0 0.5px rgba(0,85,255,0.10), 0 4px 16px rgba(0,85,255,0.12), 0 18px 44px rgba(0,85,255,0.14)";
  const FONT_D = "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif";

  // ── WhatsApp Web palette (used inside the chat card) ──
  const WA_GREEN = "#00A884", WA_GREEN_DEEP = "#008069";
  const WA_HEADER_BG = "#F0F2F5";
  const WA_CHAT_BG = "#EFEAE2";
  const WA_BUBBLE_OUT = "#D9FDD3";
  const WA_TICK_READ = "#53BDEB";
  const WA_SEP = "#E9EDEF";
  const WA_T1 = "#111B21", WA_T3 = "#667781";

  return (
    <div className="animate-in fade-in duration-500 -m-4 sm:-m-6 md:-m-8 min-h-[calc(100vh-64px)]"
      style={{ fontFamily: FONT_D, background: BG_D }}>
      <div className="w-full px-6 pt-8 pb-12">

        {/* ── Toolbar ── */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.12em] mb-1 flex items-center gap-[7px]" style={{ color: T4 }}>
              <span className="w-[6px] h-[6px] rounded-full animate-pulse" style={{ background: GREEN, boxShadow: "0 0 0 3px rgba(0,200,83,0.2)" }} />
              Parent Dashboard · Principal
            </div>
            <h1 className="text-[32px] font-bold leading-none" style={{ color: T1, letterSpacing: "-0.8px" }}>Principal Messages</h1>
            <div className="text-[13px] font-normal mt-[6px]" style={{ color: T3 }}>Official communication from school administration</div>
          </div>
          <div className="flex items-center gap-[10px]">
            <div className="px-[14px] py-[8px] rounded-full text-[12px] font-bold flex items-center gap-[6px]"
              style={{ background: "rgba(0,85,255,0.08)", color: B1, border: `0.5px solid ${BLUE_BDR}` }}>
              <Shield className="w-[12px] h-[12px]" strokeWidth={2.5} />
              Official
            </div>
            <div className="w-10 h-10 rounded-full flex items-center justify-center text-[14px] font-bold text-white"
              style={{ background: `linear-gradient(140deg, ${B1}, ${B2})`, boxShadow: "0 3px 12px rgba(0,85,255,0.36), 0 0 0 2px rgba(255,255,255,0.8)" }}>
              {(studentData?.name?.[0] || "S").toUpperCase()}
            </div>
          </div>
        </div>

        {/* ── Stat strip ── */}
        <div className="grid grid-cols-2 gap-4 mb-5">
          {[
            { label: "Total Messages", val: stats.total, color: B1, icon: MessageSquare, grad: `linear-gradient(135deg, ${B1}, ${B3})`, sh: "0 3px 10px rgba(0,85,255,0.28)", glow: "rgba(0,85,255,0.08)" },
            { label: "Unread from Principal", val: stats.unread, color: ORANGE, icon: Mail, grad: `linear-gradient(135deg, ${ORANGE}, #FFCC22)`, sh: "0 3px 10px rgba(255,136,0,0.28)", glow: "rgba(255,136,0,0.08)" },
          ].map(({ label, val, color, icon: Icon, grad, sh, glow }) => (
            <div key={label} className="bg-white rounded-[22px] px-6 py-5 relative overflow-hidden"
              style={{ boxShadow: SH_D, border: "0.5px solid rgba(0,85,255,0.10)" }}>
              <div className="absolute -top-[20px] -right-[20px] w-[120px] h-[120px] rounded-full pointer-events-none"
                style={{ background: `radial-gradient(circle, ${glow} 0%, transparent 70%)` }} />
              <div className="flex items-center justify-between mb-3 relative">
                <span className="text-[10px] font-bold uppercase tracking-[0.12em]" style={{ color: T4 }}>{label}</span>
                <div className="w-10 h-10 rounded-[12px] flex items-center justify-center"
                  style={{ background: grad, boxShadow: sh }}>
                  <Icon className="w-[18px] h-[18px] text-white" strokeWidth={2.3} />
                </div>
              </div>
              <div className="text-[34px] font-bold leading-none relative" style={{ color, letterSpacing: "-1px" }}>{val}</div>
            </div>
          ))}
        </div>

        {/* ── Main chat card — WhatsApp Web style ── */}
        <div className="rounded-[14px] overflow-hidden flex flex-col bg-white"
          style={{ boxShadow: SH_LG_D, border: `1px solid ${WA_SEP}`, height: "calc(100vh - 320px)", minHeight: 560 }}>

          {/* WA-style chat header */}
          <div className="px-4 py-[10px] flex items-center gap-3 shrink-0"
            style={{ background: WA_HEADER_BG, borderBottom: `1px solid ${WA_SEP}` }}>
            <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0"
              style={{ background: `linear-gradient(135deg, ${B1}, ${B3})`, color: "#fff", boxShadow: "0 2px 6px rgba(0,85,255,0.22)" }}>
              <School className="w-5 h-5" strokeWidth={2.1} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[16px] font-medium leading-tight" style={{ color: WA_T1, letterSpacing: "-0.1px" }}>{principalName}</div>
              <div className="text-[12px] mt-[2px]" style={{ color: WA_T3 }}>
                School Administration · online
              </div>
            </div>
            <div className="flex items-center gap-[5px] px-[10px] py-[6px] rounded-full"
              style={{ background: "rgba(0,168,132,0.10)", color: WA_GREEN_DEEP }}>
              <Shield className="w-[12px] h-[12px]" strokeWidth={2.5} />
              <span className="text-[11px] font-semibold tracking-[0.04em]">Official</span>
            </div>
          </div>

          {/* Messages — WA wallpaper */}
          <div className="flex-1 overflow-y-auto no-sb px-[60px] py-4 flex flex-col"
            style={{
              background: WA_CHAT_BG,
              backgroundImage: "radial-gradient(circle at 1px 1px, rgba(11,20,26,0.05) 1px, transparent 0)",
              backgroundSize: "22px 22px",
            }}>
            <style>{`.no-sb::-webkit-scrollbar{display:none}`}</style>
            {loading ? (
              <div className="flex-1 flex items-center justify-center">
                <Loader2 className="w-8 h-8 animate-spin" style={{ color: WA_GREEN }} />
              </div>
            ) : allMessages.length === 0 ? (
              <div className="flex-1 flex items-center justify-center text-center">
                <div className="px-10 py-8 rounded-[8px]"
                  style={{ background: "rgba(255,255,255,0.94)", boxShadow: "0 1px 3px rgba(11,20,26,0.10)" }}>
                  <div className="w-[64px] h-[64px] rounded-full flex items-center justify-center mx-auto mb-4"
                    style={{ background: "rgba(0,168,132,0.10)" }}>
                    <School className="w-8 h-8" style={{ color: WA_GREEN, opacity: 0.7 }} strokeWidth={2.2} />
                  </div>
                  <div className="text-[17px] font-semibold mb-1" style={{ color: WA_T1, letterSpacing: "-0.2px" }}>No messages yet</div>
                  <div className="text-[13px] max-w-[300px] leading-[1.5]" style={{ color: WA_T3 }}>
                    Messages from your school principal will appear here. Official notices and announcements will be delivered directly to this inbox.
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
                          style={{ color: WA_T1 }}>{n.message}</p>
                        <div className="absolute right-[8px] bottom-[4px] flex items-center gap-[3px]">
                          <span className="text-[11px]" style={{ color: WA_T3 }}>{fmtTime(n.timestamp)}</span>
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

          {/* WA reply bar */}
          <div className="flex items-end gap-2 px-4 py-[10px] shrink-0" style={{ background: WA_HEADER_BG }}>
            <button className="w-10 h-10 rounded-full flex items-center justify-center transition-colors hover:bg-[rgba(11,20,26,0.06)]">
              <Smile className="w-[22px] h-[22px]" style={{ color: WA_T3 }} strokeWidth={1.8} />
            </button>
            <div className="flex-1 rounded-[8px] flex items-center min-h-[42px] px-4 py-2 bg-white">
              <textarea rows={1} value={messageContent}
                onChange={e => setMessageContent(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                placeholder="Reply to principal"
                className="flex-1 bg-transparent border-none focus:ring-0 text-[14px] resize-none outline-none leading-relaxed"
                style={{ fontFamily: FONT_D, color: WA_T1 }} />
            </div>
            <button onClick={handleSend} disabled={!messageContent.trim()}
              className="w-11 h-11 rounded-full flex items-center justify-center transition-transform hover:scale-105 disabled:opacity-40"
              style={{ background: WA_GREEN }}>
              <Send className="w-[18px] h-[18px] text-white" strokeWidth={2.3} fill="#fff" />
            </button>
          </div>
        </div>

        {/* Info card */}
        <div className="mt-5 bg-white rounded-[18px] p-5 flex items-start gap-3"
          style={{ boxShadow: SH_D, border: "0.5px solid rgba(0,85,255,0.10)" }}>
          <div className="w-10 h-10 rounded-[12px] flex items-center justify-center shrink-0"
            style={{ background: `linear-gradient(135deg, ${B1}, ${B2})`, boxShadow: "0 3px 10px rgba(0,85,255,0.28)" }}>
            <Shield className="w-5 h-5 text-white" strokeWidth={2.3} />
          </div>
          <div>
            <div className="text-[13px] font-bold mb-[3px]" style={{ color: T1, letterSpacing: "-0.2px" }}>Official Communication Channel</div>
            <div className="text-[11px] leading-[1.55]" style={{ color: T3 }}>
              All messages here are from your school's administration. Please reply professionally — this conversation is archived for school records.
              {!allMessages[0]?.principalId && <> You can reply once the principal has sent the first message.</>}
            </div>
          </div>
          {stats.unread > 0 && (
            <div className="px-[10px] py-[5px] rounded-full text-[11px] font-bold shrink-0"
              style={{ background: "rgba(255,51,85,0.10)", color: RED, border: "0.5px solid rgba(255,51,85,0.22)" }}>
              {stats.unread} new
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default PrincipalNotesPage;
