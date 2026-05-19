import { Bell, Menu } from "lucide-react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../../lib/AuthContext";
import { useIsMobile } from "@/hooks/use-mobile";

interface ParentTopbarProps {
  onMenuClick: () => void;
}

const IND = "#30306E";

export const ParentTopbar = ({ onMenuClick }: ParentTopbarProps) => {
  const { studentData } = useAuth();
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const location = useLocation();
  const onAlerts = location.pathname === "/alerts";
  const goAlerts = () => { if (!onAlerts) navigate("/alerts"); };

  // ══════════════════════════════
  // MOBILE — Indigo Apple-style header
  // ══════════════════════════════
  if (isMobile) {
    return (
      <header
        className="flex items-center justify-between px-4 sticky top-0 z-[60]"
        style={{
          // status-bar-style is black-translucent → content runs under the notch
          // unless we add safe-area-inset-top here.
          paddingTop: "env(safe-area-inset-top)",
          height: "calc(56px + env(safe-area-inset-top))",
          fontFamily: "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif",
          background: "rgba(238,244,255,0.82)",
          WebkitBackdropFilter: "saturate(220%) blur(24px)",
          backdropFilter: "saturate(220%) blur(24px)",
          borderBottom: "0.5px solid rgba(48,48,110,0.08)",
        }}
      >
        {/* Left — menu + brand/live-dot */}
        <div className="flex items-center gap-2 min-w-0">
          <button
            onClick={onMenuClick}
            aria-label="Open menu"
            className="w-9 h-9 -ml-1 rounded-full flex items-center justify-center active:scale-90 transition-transform"
            style={{
              background: "rgba(255,255,255,0.8)",
              border: "0.5px solid rgba(48,48,110,0.12)",
              boxShadow: "0 1px 4px rgba(48,48,110,0.08)",
              WebkitBackdropFilter: "blur(12px)",
              backdropFilter: "blur(12px)",
            }}
          >
            <Menu className="w-[18px] h-[18px]" style={{ color: "rgba(48,48,110,0.55)" }} />
          </button>

          <div className="flex items-center gap-[7px] pl-1 min-w-0">
            <span
              className="w-[7px] h-[7px] rounded-full flex-shrink-0 animate-pulse"
              style={{ background: "#12C04E", boxShadow: "0 0 0 2.5px rgba(18,192,78,0.2)" }}
            />
            <span
              className="text-[15px] font-bold truncate"
              style={{ color: IND, letterSpacing: "-0.2px" }}
            >
              {studentData?.schoolName || "Edullent"}
            </span>
          </div>
        </div>

        {/* Right — bell only (name + avatar live in the dashboard hero below) */}
        <div className="flex items-center gap-[10px] flex-shrink-0">
          <button
            onClick={goAlerts}
            className="relative w-[38px] h-[38px] rounded-full flex items-center justify-center active:scale-90 transition-transform"
            style={{
              background: "rgba(255,255,255,0.8)",
              border: "0.5px solid rgba(48,48,110,0.12)",
              boxShadow: "0 1px 4px rgba(48,48,110,0.08), 0 4px 12px rgba(48,48,110,0.06)",
              WebkitBackdropFilter: "blur(12px)",
              backdropFilter: "blur(12px)",
            }}
            aria-label="Notifications"
          >
            <Bell className="w-[18px] h-[18px]" style={{ color: "rgba(48,48,110,0.55)" }} strokeWidth={1.8} />
            <span
              className="absolute top-[1px] right-[1px] w-[9px] h-[9px] rounded-full"
              style={{ background: "#E5304A", border: "2px solid #fff" }}
            />
          </button>
        </div>
      </header>
    );
  }

  // ══════════════════════════════
  // DESKTOP — unchanged
  // ══════════════════════════════
  return (
    <header className="h-16 bg-[#EEF4FF]/80 backdrop-blur-md border-b border-slate-100 flex items-center justify-between px-4 md:px-8 sticky top-0 z-[60]">
      <div className="flex items-center gap-3 min-w-0">
        <button
          onClick={onMenuClick}
          className="lg:hidden p-2 -ml-2 rounded-xl hover:bg-slate-100 transition-colors flex-shrink-0"
          aria-label="Open menu"
        >
          <Menu className="w-5 h-5 text-slate-600" />
        </button>

        <div className="flex flex-col leading-tight min-w-0">
          <span className="text-sm font-black text-slate-800 truncate max-w-[140px] md:max-w-none uppercase tracking-tight">
            {studentData?.schoolName || "EDULLENT"}
          </span>
          <div className="flex items-center gap-2 mt-0.5">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest truncate">
              {studentData?.branch || "Portal Active"}
            </span>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3 md:gap-6 flex-shrink-0">
        <button onClick={goAlerts} aria-label="Notifications" className="relative w-10 h-10 rounded-xl bg-slate-50 flex items-center justify-center hover:bg-slate-100 transition-all group">
          <Bell className="w-5 h-5 text-slate-400 group-hover:text-primary transition-colors" />
          <span className="absolute top-2.5 right-2.5 w-2 h-2 bg-rose-500 rounded-full border-2 border-white" />
        </button>
      </div>
    </header>
  );
};