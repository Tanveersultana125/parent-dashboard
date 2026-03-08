import { ParentLayout } from "@/components/layout/ParentLayout";
import { Calendar } from "lucide-react";

const upcoming = [
  { name: "Mathematics Unit Test", date: "Feb 5, 2026", days: "12 days", icon: "📐", color: "bg-edu-blue-light" },
  { name: "Science Quiz", date: "Feb 8, 2026", days: "15 days", icon: "🔬", color: "bg-edu-orange-light" },
  { name: "English Literature Test", date: "Feb 12, 2026", days: "19 days", icon: "📚", color: "bg-edu-green-light" },
];

const recent = [
  { name: "Mathematics Unit Test 4", date: "Jan 15, 2026", score: "92/100", scoreColor: "text-edu-green" },
  { name: "Science Lab Practical", date: "Jan 10, 2026", score: "88/100", scoreColor: "text-edu-green" },
  { name: "English Grammar Test", date: "Jan 5, 2026", score: "76/100", scoreColor: "text-edu-orange" },
];

const grades = [
  { label: "A Grade", value: 4, color: "bg-edu-green-light", textColor: "text-edu-green" },
  { label: "B Grade", value: 5, color: "bg-edu-blue-light", textColor: "text-edu-blue" },
  { label: "C Grade", value: 3, color: "bg-edu-orange-light", textColor: "text-edu-orange" },
  { label: "Below C", value: 0, color: "bg-edu-red-light", textColor: "text-edu-red" },
];

const TestsPage = () => {
  return (
    <ParentLayout>
      <div className="space-y-6">
        {/* Featured Banner */}
        <div className="bg-gradient-to-r from-primary to-edu-blue rounded-xl p-6 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-primary-foreground/20 flex items-center justify-center">
              <Calendar className="w-6 h-6 text-primary-foreground" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-primary-foreground">Upcoming: Mathematics Unit Test</h2>
              <p className="text-primary-foreground/80 text-sm">February 5, 2026 • 9:00 AM</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-4xl font-bold text-primary-foreground">12</p>
            <p className="text-primary-foreground/80 text-sm">Days Left</p>
          </div>
        </div>

        {/* Upcoming & Recent */}
        <div className="grid grid-cols-2 gap-6">
          <div className="bg-card rounded-xl border border-border p-6">
            <h3 className="text-lg font-bold text-foreground mb-4">Upcoming Tests</h3>
            <div className="space-y-4">
              {upcoming.map((t) => (
                <div key={t.name} className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-lg ${t.color} flex items-center justify-center text-lg`}>{t.icon}</div>
                    <div>
                      <p className="text-sm font-semibold text-foreground">{t.name}</p>
                      <p className="text-xs text-muted-foreground">{t.date}</p>
                    </div>
                  </div>
                  <span className="px-3 py-1 bg-muted rounded-full text-xs font-medium text-muted-foreground">{t.days}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-card rounded-xl border border-border p-6">
            <h3 className="text-lg font-bold text-foreground mb-4">Recent Results</h3>
            <div className="space-y-4">
              {recent.map((r) => (
                <div key={r.name} className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-edu-green-light flex items-center justify-center text-lg">✅</div>
                    <div>
                      <p className="text-sm font-semibold text-foreground">{r.name}</p>
                      <p className="text-xs text-muted-foreground">{r.date}</p>
                    </div>
                  </div>
                  <span className={`text-sm font-bold ${r.scoreColor}`}>{r.score}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Term Performance */}
        <div className="bg-card rounded-xl border border-border p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-bold text-foreground">This Term Performance</h3>
            <span className="text-sm text-muted-foreground">12 tests taken</span>
          </div>
          <div className="grid grid-cols-4 gap-4">
            {grades.map((g) => (
              <div key={g.label} className={`${g.color} rounded-xl p-6 text-center`}>
                <p className={`text-3xl font-bold ${g.textColor}`}>{g.value}</p>
                <p className="text-sm text-muted-foreground mt-1">{g.label}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </ParentLayout>
  );
};

export default TestsPage;
