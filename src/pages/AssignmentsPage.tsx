import { ParentLayout } from "@/components/layout/ParentLayout";
import { useState } from "react";
import { User, Clock } from "lucide-react";

const tabs = ["Pending (2)", "Completed (28)", "Overdue (0)"];

const assignments = [
  {
    title: "Science Project - Photosynthesis",
    description: "Create a presentation explaining the process of photosynthesis with diagrams",
    teacher: "Mr. Rajesh Kumar",
    due: "Due Tomorrow",
    dueColor: "text-edu-red",
    icon: "🔬",
    iconBg: "bg-edu-orange-light",
  },
  {
    title: "English Essay - My Favorite Book",
    description: "Write a 500-word essay about your favorite book and why you like it",
    teacher: "Ms. Sunita Gupta",
    due: "Due in 3 days",
    dueColor: "text-edu-orange",
    icon: "📝",
    iconBg: "bg-edu-blue-light",
  },
];

const AssignmentsPage = () => {
  const [activeTab, setActiveTab] = useState(0);

  return (
    <ParentLayout>
      <div className="space-y-6">
        {/* Tabs */}
        <div className="flex gap-3">
          {tabs.map((tab, i) => (
            <button key={tab} onClick={() => setActiveTab(i)}
              className={`px-5 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                i === activeTab ? "bg-primary text-primary-foreground" : "bg-card border border-border text-foreground hover:bg-muted"
              }`}>{tab}</button>
          ))}
        </div>

        {/* Assignment Cards */}
        <div className="space-y-4">
          {assignments.map((a) => (
            <div key={a.title} className="bg-card rounded-xl border border-border p-6 flex items-start justify-between">
              <div className="flex items-start gap-4">
                <div className={`w-12 h-12 rounded-xl ${a.iconBg} flex items-center justify-center text-xl`}>{a.icon}</div>
                <div>
                  <h3 className="text-lg font-semibold text-foreground">{a.title}</h3>
                  <p className="text-sm text-muted-foreground mt-1">{a.description}</p>
                  <div className="flex items-center gap-4 mt-2 text-sm">
                    <span className="flex items-center gap-1 text-muted-foreground"><User className="w-3 h-3" />{a.teacher}</span>
                    <span className={`flex items-center gap-1 font-medium ${a.dueColor}`}><Clock className="w-3 h-3" />{a.due}</span>
                  </div>
                </div>
              </div>
              <div className="flex flex-col items-end gap-2">
                <span className="px-3 py-1 bg-edu-orange-light text-edu-orange rounded-full text-xs font-semibold">Pending</span>
                <button className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium">Mark Done</button>
              </div>
            </div>
          ))}
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: "Completion Rate", value: "93%", progress: 93, color: "bg-edu-green" },
            { label: "On-Time Submission", value: "96%", progress: 96, color: "bg-edu-green" },
            { label: "Average Score", value: "82%", progress: 82, color: "bg-primary" },
          ].map((s) => (
            <div key={s.label} className="bg-card rounded-xl border border-border p-5">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm text-muted-foreground">{s.label}</span>
                <span className="text-lg font-bold text-foreground">{s.value}</span>
              </div>
              <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                <div className={`h-full rounded-full ${s.color}`} style={{ width: `${s.progress}%` }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </ParentLayout>
  );
};

export default AssignmentsPage;
