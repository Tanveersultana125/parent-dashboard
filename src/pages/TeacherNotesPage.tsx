import { ParentLayout } from "@/components/layout/ParentLayout";
import { ThumbsUp, Info, AlertTriangle, User, BookOpen, Calendar } from "lucide-react";

const notes = [
  {
    title: "Excellent Progress in Mathematics!",
    type: "Academic",
    typeColor: "bg-edu-green-light text-edu-green",
    icon: <ThumbsUp className="w-5 h-5 text-edu-green" />,
    iconBg: "bg-edu-green-light",
    teacher: "Mrs. Priya Patel",
    subject: "Mathematics",
    date: "Jan 15, 2026",
    body: "Aditya has shown remarkable improvement in Algebra this month. His test score improved from 78% to 92%, and he's been actively participating in class discussions. Keep encouraging him at home!",
    actions: [
      { label: "Reply", variant: "primary" },
      { label: "Acknowledge", variant: "outline" },
    ],
  },
  {
    title: "Parent-Teacher Meeting Reminder",
    type: "General",
    typeColor: "bg-edu-blue-light text-edu-blue",
    icon: <Info className="w-5 h-5 text-edu-blue" />,
    iconBg: "bg-edu-blue-light",
    teacher: "Mrs. Priya Patel",
    subject: "Class Teacher",
    date: "Jan 12, 2026",
    body: "This is a reminder that the quarterly parent-teacher meeting is scheduled for January 25, 2026, at 10:00 AM. Please confirm your attendance through the portal.",
    actions: [
      { label: "Confirm Attendance", variant: "primary" },
      { label: "Request Different Time", variant: "outline" },
    ],
  },
  {
    title: "Friendly Reminder About Punctuality",
    type: "Behavioral",
    typeColor: "bg-edu-orange-light text-edu-orange",
    icon: <AlertTriangle className="w-5 h-5 text-edu-orange" />,
    iconBg: "bg-edu-orange-light",
    teacher: "Mr. Rajesh Kumar",
    subject: "Science",
    date: "Jan 8, 2026",
    body: "Aditya has been arriving a few minutes late to Science class recently. While it's not a major concern, arriving on time helps him settle in better. A gentle reminder at home would be helpful.",
    actions: [
      { label: "Reply", variant: "primary" },
      { label: "Acknowledge", variant: "outline" },
    ],
  },
];

const TeacherNotesPage = () => {
  return (
    <ParentLayout>
      <div className="space-y-6">
        {notes.map((note) => (
          <div key={note.title} className="bg-card rounded-xl border border-border p-6">
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-start gap-4">
                <div className={`w-10 h-10 rounded-xl ${note.iconBg} flex items-center justify-center`}>{note.icon}</div>
                <div>
                  <h3 className="text-lg font-bold text-foreground">{note.title}</h3>
                  <div className="flex items-center gap-3 text-sm text-muted-foreground mt-1">
                    <span className="flex items-center gap-1"><User className="w-3 h-3" />{note.teacher}</span>
                    <span className="flex items-center gap-1"><BookOpen className="w-3 h-3" />{note.subject}</span>
                    <span className="flex items-center gap-1"><Calendar className="w-3 h-3" />{note.date}</span>
                  </div>
                </div>
              </div>
              <span className={`px-3 py-1 rounded-full text-xs font-semibold ${note.typeColor}`}>{note.type}</span>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed mb-4 ml-14">{note.body}</p>
            <div className="flex gap-3 ml-14">
              {note.actions.map((a) => (
                <button key={a.label} className={`px-4 py-2 rounded-lg text-sm font-medium ${
                  a.variant === "primary"
                    ? "bg-primary text-primary-foreground"
                    : "bg-card border border-border text-foreground hover:bg-muted"
                }`}>{a.label}</button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </ParentLayout>
  );
};

export default TeacherNotesPage;
