import { useLocation, Link } from "react-router-dom";
import { useAuth } from "../../lib/AuthContext";
import {
  Home, User, TrendingUp, CalendarCheck, ClipboardList,
  FileText, Brain, SmilePlus, StickyNote,
  Bell, Settings, GraduationCap, LogOut, CalendarDays, School, X,
  Sparkles, Library, Award, LifeBuoy
} from "lucide-react";

interface ParentSidebarProps {
  open: boolean;
  onClose: () => void;
}

const navItems: { title: string; path: string; icon: any; badge?: string | number }[] = [
  { title: "Dashboard", path: "/", icon: Home },
  { title: "My Child", path: "/my-child", icon: User },
  { title: "Classes", path: "/classes", icon: GraduationCap },
  { title: "Timetable", path: "/timetable", icon: CalendarDays },
  { title: "Performance", path: "/performance", icon: TrendingUp },
  { title: "Attendance", path: "/attendance", icon: CalendarCheck },
  { title: "Assignments", path: "/assignments", icon: ClipboardList },
  { title: "Tests & Exams", path: "/tests", icon: FileText },
  { title: "Exam Structure", path: "/exam-structure", icon: Award },
  { title: "Syllabus", path: "/syllabus", icon: Library },
  { title: "Concept Strengths", path: "/concepts", icon: Brain },
  { title: "AI Practice", path: "/ai-practice", icon: Sparkles },
  { title: "Behaviour", path: "/behaviour", icon: SmilePlus },
  { title: "Teacher Notes", path: "/teacher-notes", icon: StickyNote },
  { title: "Principal Notes", path: "/principal-notes", icon: School },
  { title: "Reports", path: "/reports", icon: FileText },
  { title: "Alumni", path: "/alumni", icon: Award },
  { title: "Alerts", path: "/alerts", icon: Bell },
  { title: "Help & Support", path: "/help", icon: LifeBuoy },
  { title: "Settings", path: "/settings", icon: Settings },
];

export const ParentSidebar = ({ open, onClose }: ParentSidebarProps) => {
  const location = useLocation();
  const { studentData, user, logout } = useAuth();

  return (
    <aside
      className={`fixed left-[10px] top-[10px] bottom-[10px] w-[280px] flex flex-col z-[110] rounded-[16px] overflow-hidden shadow-[0_10px_40px_rgba(23,12,121,0.10),0_4px_12px_rgba(0,0,0,0.06)] transition-transform duration-300 ease-in-out ${
        open ? "translate-x-0" : "-translate-x-[110%]"
      } lg:translate-x-0`}
      style={{ background: "#FAF7F0", border: "0.5px solid rgba(23,12,121,0.10)" }}
    >
      {/* Logo + close button (mobile) */}
      <div className="flex items-center gap-3 px-6 py-5">
        <img
          src="/edullent-icon.png"
          alt="Edullent"
          className="w-8 h-8 rounded-lg object-contain flex-shrink-0"
          draggable={false}
        />
        <div className="flex flex-col leading-none flex-1 min-w-0">
          <span className="font-bold text-lg tracking-wide uppercase" style={{ color: "#170C79" }}>EDULLENT</span>
          <span className="text-[10px] font-bold uppercase tracking-widest mt-1" style={{ color: "#7A85B8" }}>Parent Portal</span>
        </div>
        {/* Close button — mobile only */}
        <button
          onClick={onClose}
          className="lg:hidden w-8 h-8 rounded-full flex items-center justify-center transition-all flex-shrink-0 hover:bg-[rgba(23,12,121,0.08)]"
          style={{ color: "#7A85B8" }}
          aria-label="Close menu"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-2 space-y-1 overflow-auto">
        {navItems.map((item) => {
          const isActive = location.pathname === item.path;
          return (
            <Link
              key={item.path}
              to={item.path}
              onClick={onClose}
              className={`flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-all relative ${
                isActive ? "shadow-md" : "hover:bg-[rgba(23,12,121,0.06)]"
              }`}
              style={isActive
                ? { background: "#170C79", color: "#FFFFFF" }
                : { color: "#3B4A8A" }
              }
            >
              <item.icon className="w-5 h-5 flex-shrink-0" />
              <span>{item.title}</span>
              {item.badge && (
                <span className="absolute right-3 min-w-[20px] h-5 flex items-center justify-center rounded-full text-xs font-bold bg-red-500 text-white">
                  {item.badge}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* Profile & Logout */}
      <div className="p-4 space-y-3" style={{ borderTop: "0.5px solid rgba(23,12,121,0.08)" }}>
        <div className="flex items-center gap-3 px-2">
          <div className="w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-black shadow-lg flex-shrink-0"
            style={{ background: "#170C79" }}>
            {studentData?.name?.[0] || user?.displayName?.[0] || "P"}
          </div>
          <div className="overflow-hidden">
            <p className="text-sm font-bold truncate" style={{ color: "#170C79" }}>{studentData?.name || user?.displayName || "Parent"}</p>
            <p className="text-[10px] font-medium uppercase tracking-wider truncate" style={{ color: "#7A85B8" }}>
              {studentData?.className || "General"} | ID: {studentData?.rollNo || studentData?.id?.slice(-5) || "PENDING"}
            </p>
          </div>
        </div>
        <button
          onClick={logout}
          className="w-full h-12 flex items-center gap-3 px-4 rounded-xl text-sm font-bold transition-all group text-rose-600 hover:bg-rose-500 hover:text-white"
        >
          <LogOut className="w-5 h-5 group-hover:scale-110 transition-transform" />
          <span>Sign Out</span>
        </button>
      </div>
    </aside>
  );
};
