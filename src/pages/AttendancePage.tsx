import { ParentLayout } from "@/components/layout/ParentLayout";
import { CheckCircle, XCircle, Clock, CheckSquare } from "lucide-react";

type DayStatus = "present" | "absent" | "late" | "weekend" | "empty";

const calendarDays: { day: number | null; status: DayStatus }[][] = [
  [null, null, null, { day: 1, status: "present" }, { day: 2, status: "present" }, { day: 3, status: "present" }, { day: 4, status: "weekend" }].map((d, i) => d ? { day: d.day, status: d.status } : { day: [29, 30, 31][i] || null, status: "empty" as DayStatus }),
  [{ day: 5, status: "weekend" }, { day: 6, status: "present" }, { day: 7, status: "present" }, { day: 8, status: "present" }, { day: 9, status: "present" }, { day: 10, status: "present" }, { day: 11, status: "weekend" }],
  [{ day: 12, status: "weekend" }, { day: 13, status: "present" }, { day: 14, status: "present" }, { day: 15, status: "present" }, { day: 16, status: "absent" }, { day: 17, status: "present" }, { day: 18, status: "weekend" }],
  [{ day: 19, status: "weekend" }, { day: 20, status: "late" }, { day: 21, status: "present" }, { day: 22, status: "present" }, { day: 23, status: "present" }, { day: 24, status: "present" }, { day: 25, status: "weekend" }],
  [{ day: 26, status: "weekend" }, { day: 27, status: "late" }, { day: 28, status: "present" }, { day: 29, status: "present" }, { day: 30, status: "present" }, { day: 31, status: "present" }, null].map((d) => d || { day: null, status: "empty" as DayStatus }),
];

const absences = [
  { date: "January 16, 2026", type: "Absent" as const, detail: "Reason: Fever" },
  { date: "January 20, 2026", type: "Late" as const, detail: "Arrived at 9:30 AM" },
  { date: "January 27, 2026", type: "Late" as const, detail: "Arrived at 9:15 AM" },
];

const AttendancePage = () => {
  return (
    <ParentLayout>
      <div className="space-y-6">
        {/* Stats */}
        <div className="grid grid-cols-4 gap-4">
          <StatBox icon={<CheckCircle className="w-5 h-5 text-edu-green" />} bg="bg-edu-green-light" value="94%" label="Overall" sub="Good Standing" subColor="text-edu-green" />
          <StatBox icon={<CheckSquare className="w-5 h-5 text-edu-green" />} bg="bg-edu-green-light" value="18" label="Present" sub="This month" subColor="text-muted-foreground" />
          <StatBox icon={<XCircle className="w-5 h-5 text-edu-red" />} bg="bg-edu-red-light" value="1" label="Absent" sub="This month" subColor="text-muted-foreground" />
          <StatBox icon={<Clock className="w-5 h-5 text-edu-orange" />} bg="bg-edu-orange-light" value="2" label="Late" sub="This month" subColor="text-muted-foreground" />
        </div>

        <div className="grid grid-cols-5 gap-6">
          {/* Calendar */}
          <div className="col-span-3 bg-card rounded-xl border border-border p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-foreground">January 2026</h3>
              <div className="flex items-center gap-4 text-xs">
                <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-edu-green" /> Present</span>
                <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-edu-red" /> Absent</span>
                <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-edu-orange" /> Late</span>
              </div>
            </div>
            <div className="grid grid-cols-7 gap-2 text-center text-xs font-medium text-muted-foreground mb-2">
              {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => <div key={d}>{d}</div>)}
            </div>
            {calendarDays.map((week, wi) => (
              <div key={wi} className="grid grid-cols-7 gap-2 mb-2">
                {week.map((d, di) => (
                  <div key={di} className={`h-10 rounded-lg flex items-center justify-center text-sm font-medium ${
                    !d.day ? "" :
                    d.status === "present" ? "bg-edu-green text-primary-foreground" :
                    d.status === "absent" ? "bg-edu-red text-primary-foreground" :
                    d.status === "late" ? "bg-edu-orange text-primary-foreground" :
                    "text-muted-foreground"
                  }`}>
                    {d.day || ""}
                  </div>
                ))}
              </div>
            ))}
          </div>

          {/* Right Column */}
          <div className="col-span-2 space-y-4">
            <div className="bg-card rounded-xl border border-border p-6">
              <h3 className="text-lg font-bold text-foreground mb-4">Recent Absences</h3>
              <div className="space-y-3">
                {absences.map((a) => (
                  <div key={a.date} className={`p-3 rounded-lg ${a.type === "Absent" ? "bg-edu-red-light" : "bg-edu-orange-light"}`}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {a.type === "Absent" ? <XCircle className="w-4 h-4 text-edu-red" /> : <Clock className="w-4 h-4 text-edu-orange" />}
                        <div>
                          <p className="text-sm font-medium text-foreground">{a.date}</p>
                          <p className="text-xs text-muted-foreground">{a.detail}</p>
                        </div>
                      </div>
                      <span className={`px-2 py-0.5 rounded text-xs font-semibold ${a.type === "Absent" ? "bg-edu-red text-primary-foreground" : "bg-edu-orange text-primary-foreground"}`}>{a.type}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-edu-yellow-light rounded-xl border border-border p-6">
              <h3 className="text-lg font-bold text-foreground mb-2">Attendance Policy</h3>
              <p className="text-sm text-muted-foreground">Minimum 85% attendance required for exam eligibility.</p>
              <div className="flex items-center gap-2 mt-3 text-sm font-medium text-edu-green">
                <CheckCircle className="w-4 h-4" />
                Aditya is above the threshold
              </div>
            </div>
          </div>
        </div>
      </div>
    </ParentLayout>
  );
};

const StatBox = ({ icon, bg, value, label, sub, subColor }: {
  icon: React.ReactNode; bg: string; value: string; label: string; sub: string; subColor: string;
}) => (
  <div className="bg-card rounded-xl border border-border p-5">
    <div className="flex items-center gap-3 mb-1">
      <div className={`w-10 h-10 rounded-lg ${bg} flex items-center justify-center`}>{icon}</div>
      <div>
        <p className="text-2xl font-bold text-foreground">{value}</p>
        <p className="text-xs text-muted-foreground">{label}</p>
      </div>
    </div>
    <p className={`text-xs font-medium ${subColor}`}>{sub}</p>
  </div>
);

export default AttendancePage;
