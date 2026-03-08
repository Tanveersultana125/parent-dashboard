import { ParentLayout } from "@/components/layout/ParentLayout";
import { Mail, CheckSquare, FileText, Star, CalendarCheck } from "lucide-react";

const MyChildPage = () => {
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
    <ParentLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div />
          <button className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium flex items-center gap-2">
            ✏️ Edit Profile
          </button>
        </div>

        {/* Profile Card */}
        <div className="bg-card rounded-xl border border-border p-6">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-5">
              <div className="w-20 h-20 rounded-2xl bg-primary flex items-center justify-center text-primary-foreground font-bold text-2xl">AS</div>
              <div>
                <h2 className="text-2xl font-bold text-foreground">Aditya Sharma</h2>
                <p className="text-muted-foreground">Grade 8 • Section B • Roll Number 24</p>
              </div>
            </div>
            <div className="flex gap-2">
              <span className="px-3 py-1 bg-edu-green-light text-edu-green rounded-full text-sm font-medium">Active</span>
              <span className="px-3 py-1 bg-edu-blue-light text-edu-blue rounded-full text-sm font-medium border border-edu-blue">2025-26</span>
            </div>
          </div>

          <div className="grid grid-cols-4 gap-4">
            {[
              { label: "Date of Birth", value: "15 March 2012" },
              { label: "Blood Group", value: "O+" },
              { label: "Emergency Contact", value: "+91 98765 43210" },
              { label: "Admission Date", value: "June 2020" },
            ].map((item) => (
              <div key={item.label} className="bg-muted/50 rounded-lg p-4">
                <p className="text-xs text-muted-foreground">{item.label}</p>
                <p className="text-sm font-semibold text-foreground mt-1">{item.value}</p>
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
    </ParentLayout>
  );
};

export default MyChildPage;
