import { useState, useEffect } from "react";
import { db } from "../lib/firebase";
import { collection, query, where, getDocs } from "firebase/firestore";
import { useAuth } from "../lib/AuthContext";
import { CalendarDays, Clock, BookOpen, Loader2, User } from "lucide-react";

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const SUBJECT_COLORS = [
  "bg-blue-50 text-blue-700 border-blue-200",
  "bg-emerald-50 text-emerald-700 border-emerald-200",
  "bg-purple-50 text-purple-700 border-purple-200",
  "bg-amber-50 text-amber-700 border-amber-200",
  "bg-rose-50 text-rose-700 border-rose-200",
  "bg-indigo-50 text-indigo-700 border-indigo-200",
  "bg-teal-50 text-teal-700 border-teal-200",
  "bg-orange-50 text-orange-700 border-orange-200",
];

const TimetablePage = () => {
  const { studentData } = useAuth();
  const [timetable, setTimetable] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDay, setSelectedDay] = useState(() => {
    const today = new Date().getDay();
    // 0=Sun, 1=Mon...6=Sat — map to our DAYS array (0=Mon)
    return today === 0 ? 0 : Math.min(today - 1, 5);
  });

  const subjectColorMap = new Map<string, string>();
  let colorIdx = 0;
  const getSubjectColor = (subject: string) => {
    if (!subjectColorMap.has(subject)) {
      subjectColorMap.set(subject, SUBJECT_COLORS[colorIdx % SUBJECT_COLORS.length]);
      colorIdx++;
    }
    return subjectColorMap.get(subject)!;
  };

  useEffect(() => {
    if (!studentData?.classId && !studentData?.id) return;
    setLoading(true);

    const fetchTimetable = async () => {
      try {
        const classId = studentData.classId;
        const schoolId = studentData.schoolId;
        if (!classId || !schoolId) {
          setLoading(false);
          return;
        }

        // Try timetable collection first
        const tSnap = await getDocs(query(
          collection(db, "timetable"),
          where("schoolId", "==", schoolId),
          where("classId", "==", classId),
        ));
        if (!tSnap.empty) {
          const data = tSnap.docs.map(d => ({ id: d.id, ...d.data() }));
          setTimetable(data);
          setLoading(false);
          return;
        }

        // Fallback: build from teaching_assignments (teachers + subjects per class)
        const taSnap = await getDocs(query(
          collection(db, "teaching_assignments"),
          where("schoolId", "==", schoolId),
          where("classId", "==", classId),
        ));
        if (!taSnap.empty) {
          const teachers = taSnap.docs.map(d => d.data());
          // Build a simple view showing each teacher's subject
          const slots = teachers.map((t: any, i: number) => ({
            subject: t.subject || t.subjectId || "Subject",
            teacherName: t.teacherName || "Teacher",
            day: DAYS[i % 5],
            time: `${8 + i}:00 - ${9 + i}:00`,
            period: i + 1
          }));
          setTimetable(slots);
        }
      } catch { /* silently fail */ } finally {
        setLoading(false);
      }
    };

    fetchTimetable();
  }, [studentData?.classId, studentData?.id]);

  const today = DAYS[selectedDay];
  const todaySlots = timetable.filter((t: any) =>
    (t.day || "").toLowerCase() === today.toLowerCase()
  ).sort((a: any, b: any) => (a.period || 0) - (b.period || 0));

  return (
    <div className="space-y-8 pb-10">
      {/* Header */}
      <div className="bg-gradient-to-br from-purple-600 to-indigo-700 rounded-[2rem] md:rounded-[3rem] p-6 sm:p-8 md:p-12 text-white relative overflow-hidden">
        <div className="absolute top-0 right-0 opacity-10 scale-150"><CalendarDays size={200} /></div>
        <div className="relative z-10">
          <p className="text-[10px] font-black uppercase tracking-[0.4em] text-purple-200 mb-3">Weekly Schedule</p>
          <h1 className="text-4xl font-black tracking-tighter mb-2">Timetable</h1>
          <p className="text-purple-200 text-sm font-bold">{studentData?.name} · {studentData?.className || "Class"}</p>
        </div>
      </div>

      {/* Day Selector */}
      <div className="flex gap-3 overflow-x-auto pb-2">
        {DAYS.map((day, i) => {
          const isToday = new Date().getDay() - 1 === i;
          return (
            <button
              key={day}
              onClick={() => setSelectedDay(i)}
              className={`flex flex-col items-center px-5 py-4 rounded-[1.5rem] font-black transition-all shrink-0 border ${
                selectedDay === i
                  ? "bg-[#1e294b] text-white border-[#1e294b] shadow-xl shadow-slate-900/20"
                  : isToday
                  ? "bg-purple-50 text-purple-700 border-purple-200"
                  : "bg-white text-slate-400 border-slate-100 hover:bg-slate-50"
              }`}
            >
              <span className="text-[10px] uppercase tracking-widest mb-1">{DAY_SHORT[i]}</span>
              {isToday && <span className="text-[8px] uppercase tracking-widest font-black text-purple-500">Today</span>}
            </button>
          );
        })}
      </div>

      {/* Schedule for selected day */}
      <div className="bg-white rounded-[1.5rem] md:rounded-[2.5rem] border border-slate-100 shadow-sm overflow-hidden">
        <div className="px-4 sm:px-6 md:px-10 py-4 md:py-7 border-b border-slate-100 flex items-center justify-between">
          <h2 className="text-lg md:text-xl font-black text-slate-900 uppercase tracking-tighter">{DAYS[selectedDay]}</h2>
          <span className="text-[10px] font-black text-slate-300 uppercase tracking-widest">{todaySlots.length} Periods</span>
        </div>

        {loading ? (
          <div className="py-24 flex flex-col items-center justify-center">
            <Loader2 className="w-8 h-8 text-purple-600 animate-spin mb-4" />
            <p className="text-sm font-bold text-slate-400 uppercase tracking-widest">Loading schedule...</p>
          </div>
        ) : timetable.length === 0 ? (
          <div className="py-24 flex flex-col items-center justify-center text-center px-10">
            <div className="w-20 h-20 rounded-[2rem] bg-slate-50 flex items-center justify-center mb-6">
              <CalendarDays className="w-10 h-10 text-slate-200" />
            </div>
            <p className="text-lg font-black text-slate-300 uppercase tracking-widest">No timetable yet</p>
            <p className="text-xs font-bold text-slate-300 mt-2">Your school has not set up the timetable.</p>
          </div>
        ) : todaySlots.length === 0 ? (
          <div className="py-24 flex flex-col items-center justify-center text-center px-10">
            <div className="w-20 h-20 rounded-[2rem] bg-emerald-50 flex items-center justify-center mb-6">
              <CalendarDays className="w-10 h-10 text-emerald-300" />
            </div>
            <p className="text-lg font-black text-slate-400 uppercase tracking-widest">No classes today</p>
            <p className="text-xs font-bold text-slate-300 mt-2">Enjoy your day off!</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-50">
            {todaySlots.map((slot: any, i: number) => {
              const colorClass = getSubjectColor(slot.subject);
              return (
                <div key={slot.id || i} className="px-4 sm:px-6 md:px-10 py-4 md:py-6 flex items-center gap-3 md:gap-6 hover:bg-slate-50/50 transition-all">
                  <div className="text-center w-10 md:w-16 shrink-0">
                    <p className="text-xl md:text-2xl font-black text-slate-200">{String(slot.period || i + 1).padStart(2, '0')}</p>
                    <p className="text-[8px] md:text-[9px] font-black text-slate-300 uppercase tracking-widest hidden sm:block">Period</p>
                  </div>
                  <div className={`w-10 h-10 md:w-14 md:h-14 rounded-[1rem] md:rounded-[1.5rem] flex items-center justify-center border shrink-0 ${colorClass}`}>
                    <BookOpen className="w-5 h-5 md:w-6 md:h-6" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-black text-slate-900 text-base md:text-xl uppercase tracking-tight leading-none mb-1 md:mb-2 truncate">{slot.subject}</p>
                    <div className="flex flex-wrap items-center gap-2 md:gap-4">
                      {slot.teacherName && (
                        <span className="flex items-center gap-1 text-xs font-bold text-slate-400">
                          <User className="w-3 h-3 md:w-3.5 md:h-3.5" /> <span className="truncate max-w-[100px] md:max-w-none">{slot.teacherName}</span>
                        </span>
                      )}
                      {slot.time && (
                        <span className="flex items-center gap-1 text-xs font-bold text-slate-400">
                          <Clock className="w-3 h-3 md:w-3.5 md:h-3.5" /> {slot.time}
                        </span>
                      )}
                      {slot.room && (
                        <span className="text-xs font-bold text-slate-400 hidden sm:block">Room {slot.room}</span>
                      )}
                    </div>
                  </div>
                  <div className={`px-2 py-1 md:px-4 md:py-2 rounded-lg md:rounded-xl text-[9px] md:text-[10px] font-black uppercase tracking-widest border ${colorClass} shrink-0`}>
                    {slot.subject?.substring(0, 3)}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default TimetablePage;
