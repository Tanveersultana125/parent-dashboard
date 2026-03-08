import { ParentLayout } from "@/components/layout/ParentLayout";
import { useState } from "react";
import { CheckCircle, AlertCircle, XCircle, Lightbulb } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";

const subjectTabs = ["Mathematics", "Science", "English"];

const mathData = {
  strong: [
    { topic: "Algebraic Expressions", score: 92 },
    { topic: "Linear Equations", score: 88 },
    { topic: "Number Systems", score: 90 },
  ],
  developing: [
    { topic: "Statistics", score: 76 },
    { topic: "Probability", score: 74 },
  ],
  needsWork: [
    { topic: "Trigonometry", score: 68 },
  ],
};

const chartData = [
  { month: "Jun", algebra: 70, geometry: 65, trigonometry: 60 },
  { month: "Jul", algebra: 74, geometry: 68, trigonometry: 62 },
  { month: "Aug", algebra: 78, geometry: 72, trigonometry: 64 },
  { month: "Sep", algebra: 82, geometry: 76, trigonometry: 66 },
  { month: "Oct", algebra: 85, geometry: 80, trigonometry: 65 },
  { month: "Nov", algebra: 88, geometry: 82, trigonometry: 67 },
  { month: "Dec", algebra: 90, geometry: 85, trigonometry: 66 },
  { month: "Jan", algebra: 92, geometry: 88, trigonometry: 68 },
];

const ConceptStrengthsPage = () => {
  const [activeTab, setActiveTab] = useState(0);

  const getBarColor = (score: number) => {
    if (score >= 85) return "bg-edu-green";
    if (score >= 70) return "bg-edu-orange";
    return "bg-edu-red";
  };

  return (
    <ParentLayout>
      <div className="space-y-6">
        {/* Subject Tabs */}
        <div className="flex gap-3">
          {subjectTabs.map((tab, i) => (
            <button key={tab} onClick={() => setActiveTab(i)}
              className={`px-5 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                i === activeTab ? "bg-primary text-primary-foreground" : "bg-card border border-border text-foreground hover:bg-muted"
              }`}>{tab}</button>
          ))}
        </div>

        {/* Strength Categories */}
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-card rounded-xl border border-border p-5">
            <div className="flex items-center gap-2 mb-4">
              <CheckCircle className="w-5 h-5 text-edu-green" />
              <h3 className="text-lg font-bold text-foreground">Strong</h3>
            </div>
            <div className="space-y-3">
              {mathData.strong.map((t) => (
                <div key={t.topic} className="p-3 bg-edu-green-light rounded-lg">
                  <div className="flex justify-between text-sm mb-2">
                    <span className="font-medium text-foreground">{t.topic}</span>
                    <span className="font-bold text-edu-green">{t.score}%</span>
                  </div>
                  <div className="w-full h-1.5 bg-muted rounded-full"><div className={`h-full rounded-full ${getBarColor(t.score)}`} style={{ width: `${t.score}%` }} /></div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-card rounded-xl border border-border p-5">
            <div className="flex items-center gap-2 mb-4">
              <AlertCircle className="w-5 h-5 text-edu-orange" />
              <h3 className="text-lg font-bold text-foreground">Developing</h3>
            </div>
            <div className="space-y-3">
              {mathData.developing.map((t) => (
                <div key={t.topic} className="p-3 bg-edu-orange-light rounded-lg">
                  <div className="flex justify-between text-sm mb-2">
                    <span className="font-medium text-foreground">{t.topic}</span>
                    <span className="font-bold text-edu-orange">{t.score}%</span>
                  </div>
                  <div className="w-full h-1.5 bg-muted rounded-full"><div className={`h-full rounded-full ${getBarColor(t.score)}`} style={{ width: `${t.score}%` }} /></div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-card rounded-xl border border-border p-5">
            <div className="flex items-center gap-2 mb-4">
              <XCircle className="w-5 h-5 text-edu-red" />
              <h3 className="text-lg font-bold text-foreground">Needs Work</h3>
            </div>
            <div className="space-y-3">
              {mathData.needsWork.map((t) => (
                <div key={t.topic} className="p-3 bg-edu-red-light rounded-lg">
                  <div className="flex justify-between text-sm mb-2">
                    <span className="font-medium text-foreground">{t.topic}</span>
                    <span className="font-bold text-edu-red">{t.score}%</span>
                  </div>
                  <div className="w-full h-1.5 bg-muted rounded-full"><div className={`h-full rounded-full ${getBarColor(t.score)}`} style={{ width: `${t.score}%` }} /></div>
                </div>
              ))}
            </div>
            <div className="mt-4 p-3 bg-edu-yellow-light rounded-lg">
              <div className="flex items-center gap-2 mb-1">
                <Lightbulb className="w-4 h-4 text-edu-yellow" />
                <span className="text-sm font-semibold text-foreground">Recommended Focus</span>
              </div>
              <p className="text-xs text-muted-foreground">Spend extra time on trigonometric identities and practice problems.</p>
            </div>
          </div>
        </div>

        {/* Mastery Chart */}
        <div className="bg-card rounded-xl border border-border p-6">
          <h3 className="text-lg font-bold text-foreground mb-4">Concept Mastery Progress</h3>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="month" stroke="hsl(var(--muted-foreground))" fontSize={12} />
              <YAxis domain={[50, 100]} stroke="hsl(var(--muted-foreground))" fontSize={12} />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="algebra" stroke="hsl(var(--edu-green))" name="Algebra" strokeWidth={2} dot={{ r: 4 }} />
              <Line type="monotone" dataKey="geometry" stroke="hsl(var(--edu-blue))" name="Geometry" strokeWidth={2} dot={{ r: 4 }} />
              <Line type="monotone" dataKey="trigonometry" stroke="hsl(var(--edu-red))" name="Trigonometry" strokeWidth={2} dot={{ r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </ParentLayout>
  );
};

export default ConceptStrengthsPage;
