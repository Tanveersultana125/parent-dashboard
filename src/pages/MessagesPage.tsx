import { ParentLayout } from "@/components/layout/ParentLayout";
import { useState } from "react";
import { Phone, Video, MoreVertical, Paperclip, Smile, Send } from "lucide-react";

const conversations = [
  { initials: "PP", name: "Mrs. Priya Patel", preview: "Thank you for your response...", time: "2h ago", color: "bg-primary", unread: true },
  { initials: "RK", name: "Mr. Rajesh Kumar", preview: "The Science project guidelines...", time: "1d ago", color: "bg-edu-green", unread: false },
  { initials: "SG", name: "Ms. Sunita Gupta", preview: "Aditya's essay was well written...", time: "2d ago", color: "bg-edu-orange", unread: false },
  { initials: "AD", name: "Admin Office", preview: "Fee payment reminder for Q4...", time: "3d ago", color: "bg-muted-foreground", unread: false },
];

const chatMessages = [
  { from: "teacher", initials: "PP", text: "Hello Mr. Sharma, I wanted to share some good news about Aditya's recent performance in Mathematics. He's been doing exceptionally well!", time: "Jan 15, 10:30 AM" },
  { from: "parent", text: "That's wonderful to hear! Thank you for letting me know. What specifically has improved?", time: "Jan 15, 11:00 AM" },
  { from: "teacher", initials: "PP", text: "His test scores have improved from 78% to 92%, and he's much more confident in class. He's been helping other students too!", time: "Jan 15, 11:15 AM" },
  { from: "parent", text: "That's fantastic! We're so proud of him. Thank you for your guidance.", time: "Jan 15, 11:30 AM" },
  { from: "teacher", initials: "PP", text: "Thank you for your response. Keep encouraging him at home!", time: "Jan 15, 11:45 AM" },
];

const MessagesPage = () => {
  const [activeChat, setActiveChat] = useState(0);

  return (
    <ParentLayout>
      <div className="flex items-center justify-between mb-6">
        <div />
        <button className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium">+ New Message</button>
      </div>
      <div className="grid grid-cols-5 gap-0 h-[calc(100vh-180px)] bg-card rounded-xl border border-border overflow-hidden">
        {/* Conversations List */}
        <div className="col-span-2 border-r border-border">
          <div className="p-4 border-b border-border">
            <h3 className="text-lg font-bold text-foreground">Conversations</h3>
          </div>
          <div className="overflow-auto">
            {conversations.map((c, i) => (
              <button key={c.name} onClick={() => setActiveChat(i)}
                className={`w-full flex items-center gap-3 p-4 text-left transition-colors border-l-4 ${
                  i === activeChat ? "bg-muted border-l-primary" : "border-l-transparent hover:bg-muted/50"
                }`}>
                <div className={`w-10 h-10 rounded-full ${c.color} flex items-center justify-center text-primary-foreground text-sm font-bold flex-shrink-0`}>{c.initials}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold text-foreground">{c.name}</p>
                    <span className="text-xs text-muted-foreground">{c.time}</span>
                  </div>
                  <p className="text-xs text-muted-foreground truncate">{c.preview}</p>
                </div>
                {c.unread && <span className="w-2.5 h-2.5 rounded-full bg-edu-red flex-shrink-0" />}
              </button>
            ))}
          </div>
        </div>

        {/* Chat Area */}
        <div className="col-span-3 flex flex-col">
          {/* Chat Header */}
          <div className="p-4 border-b border-border flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-sm font-bold">PP</div>
              <div>
                <p className="text-sm font-bold text-foreground">Mrs. Priya Patel</p>
                <p className="text-xs text-muted-foreground">Mathematics Teacher • Class 8B</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button className="p-2 rounded-lg hover:bg-muted"><Phone className="w-4 h-4 text-muted-foreground" /></button>
              <button className="p-2 rounded-lg hover:bg-muted"><Video className="w-4 h-4 text-muted-foreground" /></button>
              <button className="p-2 rounded-lg hover:bg-muted"><MoreVertical className="w-4 h-4 text-muted-foreground" /></button>
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-auto p-4 space-y-4">
            {chatMessages.map((msg, i) => (
              <div key={i} className={`flex ${msg.from === "parent" ? "justify-end" : "justify-start"}`}>
                <div className={`flex items-end gap-2 max-w-[70%] ${msg.from === "parent" ? "flex-row-reverse" : ""}`}>
                  {msg.from === "teacher" && (
                    <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-xs font-bold flex-shrink-0">{msg.initials}</div>
                  )}
                  <div>
                    <div className={`p-3 rounded-xl text-sm ${
                      msg.from === "parent"
                        ? "bg-primary text-primary-foreground rounded-br-sm"
                        : "bg-muted text-foreground rounded-bl-sm"
                    }`}>{msg.text}</div>
                    <p className={`text-[10px] text-muted-foreground mt-1 ${msg.from === "parent" ? "text-right" : ""}`}>{msg.time}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Input */}
          <div className="p-4 border-t border-border flex items-center gap-3">
            <button className="p-2 rounded-lg hover:bg-muted"><Paperclip className="w-4 h-4 text-muted-foreground" /></button>
            <input type="text" placeholder="Type a message..." className="flex-1 bg-muted rounded-lg px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-ring" />
            <button className="p-2 rounded-lg hover:bg-muted"><Smile className="w-4 h-4 text-muted-foreground" /></button>
            <button className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium flex items-center gap-2">
              <Send className="w-4 h-4" /> Send
            </button>
          </div>
        </div>
      </div>
    </ParentLayout>
  );
};

export default MessagesPage;
