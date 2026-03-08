import { ParentLayout } from "@/components/layout/ParentLayout";
import { ArrowUp, ArrowDown, Minus } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";

const subjects = [
  { name: "Mathematics", grade: "A-", progress: 85, trend: "Improving", trendDir: "up", color: "bg-edu-green" },
  { name: "Science", grade: "B+", progress: 78, trend: "Improving", trendDir: "up", color: "bg-edu-green" },
  { name: "English", grade: "B", progress: 72, trend: "Stable", trendDir: "stable", color: "bg-edu-orange" },
  { name: "Social Studies", grade: "C+", progress: 68, trend: "Needs Attention", trendDir: "down", color: "bg-edu-red" },
  { name: "Computer Science", grade: "A", progress: 92, trend: "Excellent", trendDir: "up", color: "bg-edu-green" },
  { name: "Art & Craft", grade: "A+", progress: 95, trend: "Outstanding", trendDir: "up", color: "bg-edu-green" },
];

const trendData = [
  { month: "Jun", math: 70, science: 68, english: 65 },
  { month: "Jul", math: 72, science: 70, english: 68 },
  { month: "Aug", math: 74, science: 72, english: 70 },
  { month: "Sep", math: 76, science: 74, english: 71 },
  { month: "Oct", math: 80, science: 76, english: 72 },
  { month: "Nov", math: 82, science: 77, english: 72 },
  { month: "Dec", math: 84, science: 78, english: 73 },
  { month: "Jan", math: 85, science: 78, english: 72 },
];

const PerformancePage = () => {
  return (
    <ParentLayout>
      <div className="space-y-6">
        {/* Overall Performance */}
        <div className="bg-card rounded-xl border border-border p-6 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-foreground">Overall Performance</h2>
            <p className="text-sm text-muted-foreground">Based on all assessments this term</p>
          </div>
          <div className="flex items-center gap-8">
            <div className="text-center">
              <p className="text-5xl font-bold text-foreground">B+</p>
              <p className="text-sm text-muted-foreground">Current Grade</p>
            </div>
            <div className="h-12 w-px bg-border" />
            <div className="text-center">
              <p className="text-3xl font-bold text-foreground">78%</p>
              <p className="text-sm text-muted-foreground">Average Score</p>
            </div>
            <div className="h-12 w-px bg-border" />
            <div className="flex items-center gap-2">
              <ArrowUp className="w-5 h-5 text-edu-green" />
              <span className="text-2xl font-bold text-edu-green">+8%</span>
              <span className="text-sm text-muted-foreground">vs last term</span>
            </div>
          </div>
        </div>

        {/* Subject Cards */}
        <div className="grid grid-cols-3 gap-4">
          {subjects.map((s) => (
            <div key={s.name} className="bg-card rounded-xl border border-border p-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-foreground">{s.name}</h3>
                <span className={`px-2 py-0.5 rounded text-xs font-bold ${
                  s.grade.startsWith("A") ? "bg-edu-green-light text-edu-green" :
                  s.grade.startsWith("B") ? "bg-edu-blue-light text-edu-blue" :
                  "bg-edu-orange-light text-edu-orange"
                }`}>{s.grade}</span>
              </div>
              <div className="flex items-center justify-between text-sm mb-2">
                <span className="text-muted-foreground">Progress</span>
                <span className="font-semibold text-foreground">{s.progress}%</span>
              </div>
              <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                <div className={`h-full rounded-full ${s.color}`} style={{ width: `${s.progress}%` }} />
              </div>
              <div className="flex items-center gap-1 mt-2 text-xs font-medium">
                {s.trendDir === "up" && <ArrowUp className="w-3 h-3 text-edu-green" />}
                {s.trendDir === "down" && <ArrowDown className="w-3 h-3 text-edu-red" />}
                {s.trendDir === "stable" && <Minus className="w-3 h-3 text-muted-foreground" />}
                <span className={
                  s.trendDir === "up" ? "text-edu-green" :
                  s.trendDir === "down" ? "text-edu-red" : "text-muted-foreground"
                }>{s.trend}</span>
              </div>
            </div>
          ))}
        </div>

        {/* Performance Trend */}
        <div className="bg-card rounded-xl border border-border p-6">
          <h3 className="text-lg font-bold text-foreground mb-4">Performance Trend</h3>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={trendData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="month" stroke="hsl(var(--muted-foreground))" fontSize={12} />
              <YAxis domain={[60, 100]} stroke="hsl(var(--muted-foreground))" fontSize={12} />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="math" stroke="hsl(var(--edu-green))" name="Mathematics" strokeWidth={2} dot={{ r: 4 }} />
              <Line type="monotone" dataKey="science" stroke="hsl(var(--edu-blue))" name="Science" strokeWidth={2} dot={{ r: 4 }} />
              <Line type="monotone" dataKey="english" stroke="hsl(var(--edu-orange))" name="English" strokeWidth={2} dot={{ r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </ParentLayout>
  );
};

export default PerformancePage;
