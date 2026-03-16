import { Mail, CheckSquare, FileText, Star, CalendarCheck } from "lucide-react";
import { useAuth } from "../lib/AuthContext";
import { useNavigate } from "react-router-dom";

const MyChildPage = () => {
  const { studentData, user } = useAuth();
  const navigate = useNavigate();
  
  const teachers = [
    { initials: "PP", name: "Mrs. Priya Patel", subject: "Class Teacher • Mathematics", color: "bg-primary" },
    { initials: "RK", name: "Mr. Rajesh Kumar", subject: "Science", color: "bg-edu-green" },
    { initials: "SG", name: "Ms. Sunita Gupta", subject: "English", color: "bg-edu-orange" },
  ];

  const overview = [
    { icon: <CalendarCheck className="w-5 h-5 text-edu-green" />, bg: "bg-edu-green-light", label: "Attendance", value: "94%" },
    { icon: <FileText className="w-5 h-5 text-edu-blue" />, bg: "bg-edu-blue-light", label: "Assignments", value: "28/30" },
    { icon: <FileText className="w-5 h-5 text-edu-orange" />, bg: "bg-edu-orange-light", label: "Tests Taken", value: "12" },
    { icon: <Star className="w-5 h-5 text-edu-yellow" />, bg: "bg-edu-yellow-light", label: "Average Grade", value: "B+" },
  ];

  return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div />
          <button 
            onClick={() => navigate('/settings')}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium flex items-center gap-2 hover:opacity-90 transition-opacity"
          >
            ✏️ Edit Profile
          </button>
        </div>

        {/* Profile Card */}
        <div className="bg-card rounded-xl border border-border p-6 shadow-sm">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-5">
              <div className="w-20 h-20 rounded-2xl bg-primary flex items-center justify-center text-primary-foreground font-bold text-2xl shadow-lg">
                {studentData?.name?.[0] || user?.displayName?.[0] || "S"}
              </div>
              <div>
                <h2 className="text-2xl font-bold text-foreground">{studentData?.name || user?.displayName || "Student Name"}</h2>
                <p className="text-muted-foreground font-medium uppercase tracking-tight text-sm">
                  {studentData?.grade || "N/A"} • Roll Number {studentData?.rollNo || "N/A"}
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <span className="px-3 py-1 bg-edu-green/10 text-edu-green border border-edu-green/20 rounded-full text-xs font-bold uppercase tracking-widest">Active</span>
              <span className="px-3 py-1 bg-edu-blue/10 text-edu-blue border border-edu-blue/20 rounded-full text-xs font-bold tracking-widest uppercase">2025-26</span>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: "Email Address", value: studentData?.email || user?.email },
              { label: "Blood Group", value: studentData?.bloodGroup || "O+" },
              { label: "Phone Number", value: studentData?.phone || "N/A" },
              { label: "Branch", value: studentData?.branch || "N/A" },
            ].map((item) => (
              <div key={item.label} className="bg-muted/30 rounded-xl p-4 border border-border/50">
                <p className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">{item.label}</p>
                <p className="text-sm font-bold text-foreground mt-1 truncate">{item.value}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Teachers & Overview */}
        <div className="grid grid-cols-2 gap-6">
          <div className="bg-card rounded-xl border border-border p-6">
            <h3 className="text-lg font-bold text-foreground mb-4">Teachers</h3>
            <div className="space-y-4">
              {teachers.map((t) => (
                <div key={t.initials} className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-full ${t.color} flex items-center justify-center text-primary-foreground text-sm font-bold`}>{t.initials}</div>
                    <div>
                      <p className="text-sm font-semibold text-foreground">{t.name}</p>
                      <p className="text-xs text-muted-foreground">{t.subject}</p>
                    </div>
                  </div>
                  <button className="p-2 rounded-lg hover:bg-muted transition-colors">
                    <Mail className="w-4 h-4 text-muted-foreground" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-card rounded-xl border border-border p-6">
            <h3 className="text-lg font-bold text-foreground mb-4">This Term Overview</h3>
            <div className="space-y-4">
              {overview.map((item) => (
                <div key={item.label} className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-lg ${item.bg} flex items-center justify-center`}>{item.icon}</div>
                    <span className="text-sm text-foreground">{item.label}</span>
                  </div>
                  <span className="text-lg font-bold text-edu-green">{item.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
  );
};

export default MyChildPage;
