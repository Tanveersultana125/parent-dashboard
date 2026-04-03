import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import DashboardPage from "./pages/DashboardPage";
import MyChildPage from "./pages/MyChildPage";
import PerformancePage from "./pages/PerformancePage";
import AttendancePage from "./pages/AttendancePage";
import AssignmentsPage from "./pages/AssignmentsPage";
import TestsPage from "./pages/TestsPage";
import ConceptStrengthsPage from "./pages/ConceptStrengthsPage";
import BehaviourPage from "./pages/BehaviourPage";
import TeacherNotesPage from "./pages/TeacherNotesPage";
import PrincipalNotesPage from "./pages/PrincipalNotesPage";
import AlertsPage from "./pages/AlertsPage";
import SettingsPage from "./pages/SettingsPage";
import ReportsPage from "./pages/ReportsPage";
import ClassesPage from "./pages/ClassesPage";
import FeesPage from "./pages/FeesPage";
import TimetablePage from "./pages/TimetablePage";
import NotFound from "./pages/NotFound";
import Login from "./pages/Login";
import { AuthProvider, useAuth } from "./lib/AuthContext";
import { GraduationCap, Loader2 } from "lucide-react";
import { ParentLayout } from "./components/layout/ParentLayout";

const queryClient = new QueryClient();

const AppRoutes = () => {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center gap-4">
        <div className="w-16 h-16 rounded-3xl bg-[#1e294b] flex items-center justify-center text-white animate-bounce shadow-xl">
          <GraduationCap className="w-8 h-8" />
        </div>
        <div className="flex flex-col items-center gap-1">
          <Loader2 className="w-6 h-6 animate-spin text-[#1e294b]" />
          <p className="text-xs font-black text-[#1e294b] uppercase tracking-widest mt-2">Securing Session</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Login />;
  }

  return (
    <Routes>
      <Route element={<ParentLayout />}>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/my-child" element={<MyChildPage />} />
        <Route path="/classes" element={<ClassesPage />} />
        <Route path="/performance" element={<PerformancePage />} />
        <Route path="/attendance" element={<AttendancePage />} />
        <Route path="/assignments" element={<AssignmentsPage />} />
        <Route path="/tests" element={<TestsPage />} />
        <Route path="/concepts" element={<ConceptStrengthsPage />} />
        <Route path="/behaviour" element={<BehaviourPage />} />
        <Route path="/teacher-notes" element={<TeacherNotesPage />} />
        <Route path="/principal-notes" element={<PrincipalNotesPage />} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/alerts" element={<AlertsPage />} />
        <Route path="/fees" element={<FeesPage />} />
        <Route path="/timetable" element={<TimetablePage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <AppRoutes />
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
