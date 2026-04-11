import { useState } from "react";
import { Outlet } from "react-router-dom";
import { ParentSidebar } from "./ParentSidebar";
import { ParentTopbar } from "./ParentTopbar";
import { MobileBottomNav } from "./MobileBottomNav";
import { PageTransition } from "@/components/PageTransition";

export const ParentLayout = () => {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div
      className="flex min-h-screen w-full"
      /* Prevent pull-to-refresh on the whole layout wrapper */
      style={{ overscrollBehavior: 'none' }}
    >
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <ParentSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div className="flex-1 flex flex-col lg:ml-[280px] min-w-0">
        <ParentTopbar onMenuClick={() => setSidebarOpen(true)} />
        {/*
          pb-28 on mobile = space for bottom nav (56px) + safe-area-inset-bottom
          Adds -webkit-overflow-scrolling:touch for momentum on iOS
        */}
        <main
          className="flex-1 p-3 md:p-6 overflow-x-hidden bg-slate-50/50 lg:pb-8"
          style={{
            WebkitOverflowScrolling: 'touch',
            overscrollBehavior: 'none',
            /* safe area aware bottom padding for mobile bottom nav */
            paddingBottom: 'calc(env(safe-area-inset-bottom) + 7rem)',
          }}
        >
          <PageTransition>
            <div className="max-w-7xl mx-auto w-full">
              <Outlet />
            </div>
          </PageTransition>
        </main>
      </div>

      {/* Bottom nav sits above safe area */}
      <MobileBottomNav onMenuClick={() => setSidebarOpen(true)} />
    </div>
  );
};
