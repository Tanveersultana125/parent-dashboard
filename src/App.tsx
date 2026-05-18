import { lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider, useAuth } from "./lib/AuthContext";
import { GraduationCap, Loader2 } from "lucide-react";
import { ParentLayout } from "./components/layout/ParentLayout";
import { InstallBanner } from "./components/InstallBanner";
import { PWAUpdatePrompt } from "./components/PWAUpdatePrompt";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { OfflineBanner } from "./components/OfflineBanner";
import { SplashScreen } from "./components/SplashScreen";

// ── Lazy-loaded pages (code splitting) ──────────────────────────────────────
const DashboardPage       = lazy(() => import("./pages/DashboardPage"));
const MyChildPage         = lazy(() => import("./pages/MyChildPage"));
const PerformancePage     = lazy(() => import("./pages/PerformancePage"));
const AttendancePage      = lazy(() => import("./pages/AttendancePage"));
const AssignmentsPage     = lazy(() => import("./pages/AssignmentsPage"));
const TestsPage           = lazy(() => import("./pages/TestsPage"));
const ConceptStrengthsPage = lazy(() => import("./pages/ConceptStrengthsPage"));
const BehaviourPage       = lazy(() => import("./pages/BehaviourPage"));
const TeacherNotesPage    = lazy(() => import("./pages/TeacherNotesPage"));
const PrincipalNotesPage  = lazy(() => import("./pages/PrincipalNotesPage"));
const AlertsPage          = lazy(() => import("./pages/AlertsPage"));
const SettingsPage        = lazy(() => import("./pages/SettingsPage"));
const ReportsPage         = lazy(() => import("./pages/ReportsPage"));
const ClassesPage         = lazy(() => import("./pages/ClassesPage"));
const TimetablePage       = lazy(() => import("./pages/TimetablePage"));
const AIPracticePage      = lazy(() => import("./pages/AIPracticePage"));
const SyllabusPage        = lazy(() => import("./pages/SyllabusPage"));
const ExamStructurePage   = lazy(() => import("./pages/ExamStructurePage"));
const AlumniPage          = lazy(() => import("./pages/AlumniPage"));
const Leaderboard         = lazy(() => import("./pages/leaderboard/Leaderboard"));
const Insights            = lazy(() => import("./pages/leaderboard/Insights"));
const Help                = lazy(() => import("./pages/Help"));
const NotFound            = lazy(() => import("./pages/NotFound"));
const Login               = lazy(() => import("./pages/Login"));

// ── Shared page loader ───────────────────────────────────────────────────────
function PageLoader() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <Loader2 className="w-8 h-8 animate-spin text-[#0B1F3A]" />
    </div>
  );
}

// ── App shell loader (auth check) ────────────────────────────────────────────
function AppShellLoader() {
  return (
    <div className="min-h-screen bg-white flex flex-col items-center justify-center gap-4">
      <div className="w-16 h-16 rounded-3xl bg-[#0B1F3A] flex items-center justify-center text-white animate-bounce shadow-xl">
        <GraduationCap className="w-8 h-8" />
      </div>
      <div className="flex flex-col items-center gap-1">
        <Loader2 className="w-6 h-6 animate-spin text-[#0B1F3A]" />
        <p className="text-xs font-black text-[#0B1F3A] uppercase tracking-widest mt-2">
          Securing Session
        </p>
      </div>
    </div>
  );
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5,   // 5 min
      retry: 1,
    },
  },
});

const AppRoutes = () => {
  const { user, loading } = useAuth();

  if (loading) return <AppShellLoader />;

  if (!user) {
    return (
      <Suspense fallback={<PageLoader />}>
        <Login />
      </Suspense>
    );
  }

  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        <Route element={<ErrorBoundary><ParentLayout /></ErrorBoundary>}>
          <Route path="/"              element={<DashboardPage />} />
          <Route path="/my-child"      element={<MyChildPage />} />
          <Route path="/classes"       element={<ClassesPage />} />
          <Route path="/performance"   element={<PerformancePage />} />
          <Route path="/attendance"    element={<AttendancePage />} />
          <Route path="/assignments"   element={<AssignmentsPage />} />
          <Route path="/tests"         element={<TestsPage />} />
          <Route path="/exam-structure" element={<ExamStructurePage />} />
          <Route path="/alumni"        element={<AlumniPage />} />
          <Route path="/syllabus"      element={<SyllabusPage />} />
          <Route path="/concepts"      element={<ConceptStrengthsPage />} />
          <Route path="/behaviour"     element={<BehaviourPage />} />
          <Route path="/teacher-notes" element={<TeacherNotesPage />} />
          <Route path="/principal-notes" element={<PrincipalNotesPage />} />
          <Route path="/reports"       element={<ReportsPage />} />
          <Route path="/alerts"        element={<AlertsPage />} />
          <Route path="/timetable"     element={<TimetablePage />} />
          <Route path="/ai-practice"   element={<AIPracticePage />} />
          <Route path="/leaderboard"            element={<Leaderboard />} />
          <Route path="/leaderboard/insights"   element={<Insights />} />
          <Route path="/help"          element={<Help />} />
          <Route path="/settings"      element={<SettingsPage />} />
        </Route>
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  );
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <OfflineBanner />
          <AppRoutes />
          {/* PWA: install banner + update prompt (outside routes so always visible) */}
          <InstallBanner />
          <PWAUpdatePrompt />
          {/* Mobile-only brand splash — shows once per session, above everything */}
          <SplashScreen />
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
