import { useEffect, useState } from "react";
import { useLocation, Link } from "react-router-dom";
import { useAuth } from "@/lib/AuthContext";
import { subscribePerStudent } from "@/lib/perStudentQuery";

interface MobileBottomNavProps {
  onMenuClick?: () => void;
}

const bottomNavItems = [
  { key: "Home",     label: "Home",     path: "/" },
  { key: "Tests",    label: "Tests",    path: "/tests" },
  { key: "Progress", label: "Progress", path: "/performance" },
  { key: "Alerts",   label: "Alerts",   path: "/alerts" },
  { key: "Messages", label: "Messages", path: "/teacher-notes" },
];

// ── Indigo theme ──
const IND      = "#30306E";
const INACTIVE = "rgba(48,48,110,0.26)";
const INACTIVE_LBL = "rgba(48,48,110,0.25)";

const NavIcons: Record<string, (props: { active: boolean }) => JSX.Element> = {
  Home: ({ active }) => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      {active ? (
        <>
          <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" fill={IND} />
          <polyline points="9 22 9 12 15 12 15 22" stroke={IND} strokeWidth="1.5" strokeLinecap="round" fill="none" />
        </>
      ) : (
        <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" stroke={INACTIVE} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      )}
    </svg>
  ),
  Tests: ({ active }) => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={active ? IND : INACTIVE} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  ),
  Progress: ({ active }) => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={active ? IND : INACTIVE} strokeWidth="1.7" strokeLinecap="round">
      <line x1="18" y1="20" x2="18" y2="10" />
      <line x1="12" y1="20" x2="12" y2="4" />
      <line x1="6" y1="20" x2="6" y2="14" />
    </svg>
  ),
  Alerts: ({ active }) => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={active ? IND : INACTIVE} strokeWidth="1.7" strokeLinecap="round">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  ),
  Messages: ({ active }) => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={active ? IND : INACTIVE} strokeWidth="1.7" strokeLinecap="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  ),
};

export const MobileBottomNav = (_props: MobileBottomNavProps) => {
  const location = useLocation();
  const { studentData } = useAuth();
  const [alertsCount, setAlertsCount] = useState(0);

  useEffect(() => {
    if (!studentData?.id) return;
    const u = subscribePerStudent({
      collection: "risks",
      student: studentData,
      onChange: (docs) => setAlertsCount(docs.length),
      onError: () => setAlertsCount(0),
    });
    return () => u();
  }, [studentData?.id, studentData?.schoolId, studentData?.email]);

  return (
    <nav
      className="fixed left-0 right-0 lg:hidden z-[100] flex justify-center px-3 pointer-events-none"
      style={{
        bottom: "calc(env(safe-area-inset-bottom) + 12px)",
        fontFamily: "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif",
      }}
    >
      <div
        className="flex items-center justify-around w-full max-w-[440px] pointer-events-auto"
        style={{
          height: 68,
          padding: "0 6px",
          borderRadius: 28,
          background: "rgba(255,255,255,0.62)",
          WebkitBackdropFilter: "saturate(220%) blur(28px)",
          backdropFilter: "saturate(220%) blur(28px)",
          border: "0.5px solid rgba(255,255,255,0.85)",
          boxShadow:
            "0 0 0 0.5px rgba(48,48,110,0.06), 0 8px 24px rgba(48,48,110,0.10), 0 18px 48px rgba(48,48,110,0.14)",
        }}
      >
        {bottomNavItems.map(({ key, label, path }) => {
          const isActive = location.pathname === path;
          const IconComp = NavIcons[key];
          const showBadge = key === "Alerts" && alertsCount > 0;
          return (
            <Link
              key={path}
              to={path}
              className="flex flex-col items-center justify-center gap-[2px] flex-1 h-full rounded-[20px] transition-transform active:scale-[0.92]"
              style={{
                transitionTimingFunction: "cubic-bezier(0.34,1.56,0.64,1)",
                background: isActive ? "rgba(48,48,110,0.06)" : "transparent",
              }}
            >
              <div className="w-7 h-7 flex items-center justify-center relative">
                <IconComp active={isActive} />
                {showBadge && (
                  <span
                    className="absolute -top-[3px] -right-[6px] min-w-[16px] h-4 flex items-center justify-center px-[3px] text-[10px] font-bold text-white rounded-full"
                    style={{
                      background: "#E5304A",
                      border: "1.5px solid rgba(255,255,255,0.95)",
                      letterSpacing: "-0.2px",
                    }}
                  >
                    {alertsCount > 9 ? "9+" : alertsCount}
                  </span>
                )}
              </div>
              <span
                className="text-[10px] leading-tight"
                style={{
                  color: isActive ? IND : INACTIVE_LBL,
                  fontWeight: isActive ? 700 : 500,
                }}
              >
                {label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
};