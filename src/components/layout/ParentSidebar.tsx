import { useLocation, Link } from "react-router-dom";
import { useAuth } from "../../lib/AuthContext";
import {
  Home, User, TrendingUp, CalendarCheck, ClipboardList,
  FileText, Brain, SmilePlus, StickyNote,
  Bell, Settings, GraduationCap, LogOut, CreditCard, CalendarDays, School
} from "lucide-react";

const navItems = [
  { title: "Dashboard", path: "/", icon: Home },
  { title: "My Child", path: "/my-child", icon: User },
  { title: "Classes", path: "/classes", icon: GraduationCap },
  { title: "Timetable", path: "/timetable", icon: CalendarDays },
  { title: "Performance", path: "/performance", icon: TrendingUp },
  { title: "Attendance", path: "/attendance", icon: CalendarCheck },
  { title: "Assignments", path: "/assignments", icon: ClipboardList },
  { title: "Tests & Exams", path: "/tests", icon: FileText },
  { title: "Concept Strengths", path: "/concepts", icon: Brain },
  { title: "Behaviour", path: "/behaviour", icon: SmilePlus },
  { title: "Teacher Notes", path: "/teacher-notes", icon: StickyNote },
  { title: "Principal Notes", path: "/principal-notes", icon: School },
  { title: "Fee Status", path: "/fees", icon: CreditCard },
  { title: "Reports", path: "/reports", icon: FileText },
  { title: "Alerts", path: "/alerts", icon: Bell, badge: 3 },
  { title: "Settings", path: "/settings", icon: Settings },
];

export const ParentSidebar = () => {
  const location = useLocation();
  const { studentData, user, logout } = useAuth();

  return (
    <aside className="fixed left-0 top-0 h-screen w-[280px] bg-primary flex flex-col z-50">
      {/* Logo */}
      <div className="flex items-center gap-3 px-6 py-5">
        <div className="w-8 h-8 bg-primary-foreground rounded-lg flex items-center justify-center">
          <GraduationCap className="w-5 h-5 text-primary" />
        </div>
        <div className="flex flex-col leading-none">
          <span className="text-primary-foreground font-bold text-lg tracking-wide uppercase">EDUINTELLECT</span>
          <span className="text-[10px] font-bold text-primary-foreground/60 uppercase tracking-widest mt-1">Parent Portal</span>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-2 space-y-1 overflow-auto">
        {navItems.map((item) => {
          const isActive = location.pathname === item.path;
          return (
            <Link
              key={item.path}
              to={item.path}
              className={`flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-all relative ${
                isActive
                  ? "bg-primary-foreground text-primary shadow-md"
                  : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              }`}
            >
              <item.icon className="w-5 h-5 flex-shrink-0" />
              <span>{item.title}</span>
              {item.badge && (
                <span className={`absolute right-3 min-w-[20px] h-5 flex items-center justify-center rounded-full text-xs font-bold ${
                  isActive ? "bg-red-500 text-white" : "bg-red-500 text-white"
                }`}>
                  {item.badge}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* Profile & Logout */}
      <div className="p-4 border-t border-primary-foreground/10 space-y-3">
        <div className="flex items-center gap-3 px-2">
          <div className="w-9 h-9 rounded-full bg-primary-foreground flex items-center justify-center text-primary text-sm font-black shadow-lg">
            {studentData?.name?.[0] || user?.displayName?.[0] || "P"}
          </div>
          <div className="overflow-hidden">
            <p className="text-sm font-bold text-primary-foreground truncate">{studentData?.name || user?.displayName || "Parent"}</p>
            <p className="text-[10px] font-medium text-primary-foreground/60 uppercase tracking-wider truncate">
              {studentData?.className || "General"} | ID: {studentData?.rollNo || studentData?.id?.slice(-5) || "PENDING"}
            </p>
          </div>
        </div>
        <button 
          onClick={logout}
          className="w-full h-12 flex items-center gap-3 px-4 rounded-xl text-sm font-bold text-rose-200 hover:bg-rose-500 hover:text-white transition-all group"
        >
          <LogOut className="w-5 h-5 group-hover:scale-110 transition-transform" />
          <span>Sign Out</span>
        </button>
      </div>
    </aside>
  );
};
