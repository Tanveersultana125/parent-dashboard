import { ParentLayout } from "@/components/layout/ParentLayout";
import { CheckCircle, AlertCircle, Calendar, Star, ArrowUp, Clock, CheckSquare } from "lucide-react";

const DashboardPage = () => {
  return (
    <ParentLayout>
      <div className="space-y-6">
        {/* Greeting */}
        <div>
          <h1 className="text-2xl font-bold text-foreground">Good Morning, Rahul! 👋</h1>
          <p className="text-muted-foreground">Here's how Aditya is doing today</p>
        </div>

        {/* Academic Health Card */}
        <div className="bg-card rounded-xl border border-border p-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold text-foreground">Academic Health</h2>
              <p className="text-muted-foreground text-sm">Overall performance indicator</p>
              <div className="mt-3 flex items-center gap-2 text-edu-green text-sm font-medium">
                <ArrowUp className="w-4 h-4" />
                Improved by 5% from last month
              </div>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-4xl font-bold text-edu-green">85%</span>
              <div className="relative w-16 h-16">
                <svg className="w-16 h-16 -rotate-90" viewBox="0 0 36 36">
                  <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="hsl(var(--muted))" strokeWidth="3" />
                  <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="hsl(var(--edu-green))" strokeWidth="3" strokeDasharray="85, 100" />
                </svg>
              </div>
            </div>
          </div>
          <p className="text-sm text-edu-green font-medium mt-1">Good Standing</p>
        </div>

        {/* Stats Row */}
        <div className="grid grid-cols-4 gap-4">
          <StatCard icon={<CheckCircle className="w-5 h-5 text-edu-green" />} iconBg="bg-edu-green-light" label="Attendance" value="94%" sub="On track" subColor="text-edu-green" />
          <StatCard icon={<AlertCircle className="w-5 h-5 text-edu-orange" />} iconBg="bg-edu-orange-light" label="Pending Work" value="2" sub="Due this week" subColor="text-edu-orange" />
          <StatCard icon={<Calendar className="w-5 h-5 text-edu-blue" />} iconBg="bg-edu-blue-light" label="Upcoming Tests" value="3" sub="Next 7 days" subColor="text-muted-foreground" />
          <StatCard icon={<Star className="w-5 h-5 text-edu-green" />} iconBg="bg-edu-green-light" label="Recent Grade" value="A-" sub="Mathematics" subColor="text-edu-green" />
        </div>

        {/* Bottom Row */}
        <div className="grid grid-cols-5 gap-4">
          {/* Student Info */}
          <div className="col-span-3 bg-card rounded-xl border border-border p-6">
            <div className="flex items-center gap-4 mb-4">
              <div className="w-14 h-14 rounded-xl bg-primary flex items-center justify-center text-primary-foreground font-bold text-lg">AS</div>
              <div>
                <h3 className="text-lg font-bold text-foreground">Aditya Sharma</h3>
                <p className="text-sm text-muted-foreground">Grade 8 • Section B • Roll 24</p>
              </div>
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Class Teacher</span>
                <span className="font-semibold text-foreground">Mrs. Priya Patel</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Academic Year</span>
                <span className="font-semibold text-foreground">2025-26</span>
              </div>
            </div>
          </div>

          {/* Recent Alerts */}
          <div className="col-span-2 bg-card rounded-xl border border-border p-6">
            <h3 className="text-lg font-bold text-foreground mb-4">Recent Alerts</h3>
            <div className="space-y-3">
              <div className="flex items-start gap-3 p-3 rounded-lg bg-edu-orange-light">
                <Clock className="w-5 h-5 text-edu-orange mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-foreground">Science assignment due tomorrow</p>
                  <p className="text-xs text-muted-foreground">2 hours ago</p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-3 rounded-lg bg-edu-green-light">
                <CheckSquare className="w-5 h-5 text-edu-green mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-foreground">Great improvement in Mathematics!</p>
                  <p className="text-xs text-muted-foreground">Yesterday</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </ParentLayout>
  );
};

const StatCard = ({ icon, iconBg, label, value, sub, subColor }: {
  icon: React.ReactNode; iconBg: string; label: string; value: string; sub: string; subColor: string;
}) => (
  <div className="bg-card rounded-xl border border-border p-5">
    <div className="flex items-center gap-3 mb-2">
      <div className={`w-10 h-10 rounded-lg ${iconBg} flex items-center justify-center`}>{icon}</div>
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-2xl font-bold text-foreground">{value}</p>
      </div>
    </div>
    <p className={`text-xs font-medium ${subColor}`}>{sub}</p>
  </div>
);

export default DashboardPage;
