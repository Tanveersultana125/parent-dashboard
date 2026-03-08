import { ParentLayout } from "@/components/layout/ParentLayout";
import { Star, Trophy, Leaf, MessageCircle, Clock, FileText, Info } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

const positiveHighlights = [
  { text: "Helped a classmate understand a difficult math concept", date: "Jan 10, 2026", by: "Mrs. Priya Patel", icon: <Star className="w-4 h-4 text-edu-yellow" /> },
  { text: "Volunteered for class cleanup duty", date: "Jan 5, 2026", by: "Class Monitor", icon: <Leaf className="w-4 h-4 text-edu-green" /> },
  { text: "Asked thoughtful questions during Science discussion", date: "Dec 28, 2025", by: "Mr. Rajesh Kumar", icon: <MessageCircle className="w-4 h-4 text-edu-green" /> },
];

const improvements = [
  { text: "Arrived late to class twice this month", detail: "Jan 20 & 27, 2026", icon: <Clock className="w-4 h-4 text-edu-orange" /> },
  { text: "Forgot to bring homework notebook once", detail: "Jan 8, 2026", icon: <FileText className="w-4 h-4 text-edu-orange" /> },
];

const trendData = [
  { month: "Aug", rating: 3.8 },
  { month: "Sep", rating: 3.9 },
  { month: "Oct", rating: 4.0 },
  { month: "Nov", rating: 4.1 },
  { month: "Dec", rating: 4.0 },
  { month: "Jan", rating: 4.2 },
];

const BehaviourPage = () => {
  return (
    <ParentLayout>
      <div className="space-y-6">
        {/* Rating */}
        <div className="bg-card rounded-xl border border-border p-6 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-foreground">Overall Behavior Rating</h2>
            <p className="text-sm text-muted-foreground">Based on teacher observations this term</p>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-center">
              <p className="text-4xl font-bold text-foreground">4.2</p>
              <p className="text-sm text-muted-foreground">out of 5</p>
            </div>
            <div className="flex gap-1">
              {[1, 2, 3, 4].map((i) => <Star key={i} className="w-6 h-6 fill-edu-yellow text-edu-yellow" />)}
              <Star className="w-6 h-6 text-muted" />
            </div>
          </div>
        </div>

        {/* Highlights & Improvements */}
        <div className="grid grid-cols-2 gap-6">
          <div className="bg-card rounded-xl border border-border p-6">
            <div className="flex items-center gap-2 mb-4">
              <Trophy className="w-5 h-5 text-edu-green" />
              <h3 className="text-lg font-bold text-foreground">Positive Highlights</h3>
            </div>
            <div className="space-y-3">
              {positiveHighlights.map((h) => (
                <div key={h.text} className="p-4 bg-edu-green-light rounded-lg">
                  <div className="flex items-start gap-3">
                    {h.icon}
                    <div>
                      <p className="text-sm font-medium text-foreground">{h.text}</p>
                      <p className="text-xs text-muted-foreground mt-1">{h.date} • {h.by}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-card rounded-xl border border-border p-6">
            <div className="flex items-center gap-2 mb-4">
              <Info className="w-5 h-5 text-edu-orange" />
              <h3 className="text-lg font-bold text-foreground">Areas for Improvement</h3>
            </div>
            <div className="space-y-3">
              {improvements.map((h) => (
                <div key={h.text} className="p-4 bg-edu-orange-light rounded-lg">
                  <div className="flex items-start gap-3">
                    {h.icon}
                    <div>
                      <p className="text-sm font-medium text-foreground">{h.text}</p>
                      <p className="text-xs text-muted-foreground mt-1">{h.detail}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-4 p-4 bg-edu-blue-light rounded-lg flex items-start gap-3">
              <Info className="w-4 h-4 text-edu-blue mt-0.5" />
              <p className="text-sm text-foreground">Overall, Aditya shows good behavior and respect towards teachers and peers.</p>
            </div>
          </div>
        </div>

        {/* Trend */}
        <div className="bg-card rounded-xl border border-border p-6">
          <h3 className="text-lg font-bold text-foreground mb-4">Behavior Trend</h3>
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={trendData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="month" stroke="hsl(var(--muted-foreground))" fontSize={12} />
              <YAxis domain={[3, 5]} stroke="hsl(var(--muted-foreground))" fontSize={12} />
              <Tooltip />
              <Line type="monotone" dataKey="rating" stroke="hsl(var(--edu-green))" strokeWidth={2} dot={{ r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </ParentLayout>
  );
};

export default BehaviourPage;
