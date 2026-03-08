import { ParentLayout } from "@/components/layout/ParentLayout";
import { useState } from "react";
import { AlertCircle, Clock, Trophy, Calendar, CheckCircle, User } from "lucide-react";

const filterTabs = ["All (5)", "Academic (2)", "Attendance (1)", "General (2)"];

const alerts = [
  {
    title: "Assignment Due Tomorrow",
    description: "Science Project - Photosynthesis is due tomorrow (Jan 31, 2026). Please ensure Aditya submits it on time.",
    priority: "High Priority",
    priorityColor: "text-edu-red bg-edu-red-light",
    category: "Academic",
    categoryColor: "bg-muted text-foreground",
    icon: <AlertCircle className="w-5 h-5 text-edu-red" />,
    borderColor: "border-l-edu-red",
    meta: [
      { icon: <Clock className="w-3 h-3" />, text: "Due in 18 hours" },
      { icon: <User className="w-3 h-3" />, text: "Mr. Rajesh Kumar" },
    ],
    actions: [
      { label: "View Details", variant: "primary" },
      { label: "Dismiss", variant: "outline" },
    ],
  },
  {
    title: "Late Arrival Recorded",
    description: "Aditya arrived 15 minutes late to school on January 27, 2026.",
    priority: "Medium Priority",
    priorityColor: "text-edu-orange bg-edu-orange-light",
    category: "Attendance",
    categoryColor: "bg-edu-blue-light text-edu-blue",
    icon: <Clock className="w-5 h-5 text-edu-orange" />,
    borderColor: "border-l-edu-orange",
    meta: [
      { icon: <Calendar className="w-3 h-3" />, text: "Jan 27, 2026" },
      { icon: <Clock className="w-3 h-3" />, text: "Arrived at 9:15 AM" },
    ],
    actions: [
      { label: "Acknowledge", variant: "outline" },
    ],
  },
  {
    title: "Great Improvement in Mathematics!",
    description: "Aditya's Mathematics test score improved from 78% to 92%. Congratulations!",
    priority: "Good News",
    priorityColor: "text-edu-green bg-edu-green-light",
    category: "Academic",
    categoryColor: "bg-muted text-foreground",
    icon: <Trophy className="w-5 h-5 text-edu-green" />,
    borderColor: "border-l-edu-green",
    meta: [
      { icon: <Calendar className="w-3 h-3" />, text: "Jan 15, 2026" },
      { icon: <User className="w-3 h-3" />, text: "Mrs. Priya Patel" },
    ],
    actions: [
      { label: "View Details", variant: "success" },
    ],
  },
  {
    title: "Parent-Teacher Meeting",
    description: "Quarterly parent-teacher meeting scheduled for January 25, 2026 at 10:00 AM.",
    priority: "",
    priorityColor: "",
    category: "General",
    categoryColor: "bg-muted text-foreground",
    icon: <Calendar className="w-5 h-5 text-edu-blue" />,
    borderColor: "border-l-edu-blue",
    meta: [
      { icon: <Calendar className="w-3 h-3" />, text: "Jan 25, 2026" },
      { icon: <Clock className="w-3 h-3" />, text: "10:00 AM" },
    ],
    actions: [
      { label: "Confirm", variant: "primary" },
      { label: "Reschedule", variant: "outline" },
    ],
  },
];

const AlertsPage = () => {
  const [activeTab, setActiveTab] = useState(0);

  return (
    <ParentLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex gap-3">
            {filterTabs.map((tab, i) => (
              <button key={tab} onClick={() => setActiveTab(i)}
                className={`px-5 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  i === activeTab ? "bg-primary text-primary-foreground" : "bg-card border border-border text-foreground hover:bg-muted"
                }`}>{tab}</button>
            ))}
          </div>
          <button className="flex items-center gap-2 px-4 py-2 border border-border rounded-lg text-sm font-medium text-foreground hover:bg-muted">
            <CheckCircle className="w-4 h-4" /> Mark All Read
          </button>
        </div>

        <div className="space-y-4">
          {alerts.map((alert) => (
            <div key={alert.title} className={`bg-card rounded-xl border border-border border-l-4 ${alert.borderColor} p-6 flex items-start justify-between`}>
              <div className="flex items-start gap-4">
                <div className="mt-1">{alert.icon}</div>
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="text-lg font-bold text-foreground">{alert.title}</h3>
                    {alert.priority && <span className={`px-2 py-0.5 rounded text-xs font-semibold ${alert.priorityColor}`}>{alert.priority}</span>}
                    <span className={`px-2 py-0.5 rounded text-xs font-semibold ${alert.categoryColor}`}>{alert.category}</span>
                  </div>
                  <p className="text-sm text-muted-foreground">{alert.description}</p>
                  <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                    {alert.meta.map((m, i) => (
                      <span key={i} className="flex items-center gap-1">{m.icon}{m.text}</span>
                    ))}
                  </div>
                </div>
              </div>
              <div className="flex flex-col gap-2 flex-shrink-0">
                {alert.actions.map((a) => (
                  <button key={a.label} className={`px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap ${
                    a.variant === "primary" ? "bg-primary text-primary-foreground" :
                    a.variant === "success" ? "bg-edu-green text-primary-foreground" :
                    "bg-card border border-border text-foreground hover:bg-muted"
                  }`}>{a.label}</button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </ParentLayout>
  );
};

export default AlertsPage;
