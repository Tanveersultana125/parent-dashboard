import { 
  ArrowLeft, BookOpen, FileText, PlayCircle, Star, User, 
  Calculator, FlaskConical, Globe, Monitor, Palette, Languages, 
  ChevronLeft, Award, TrendingUp, Info
} from "lucide-react";
import React from "react";

interface Topic {
  name: string;
  score: number;
}

interface TestScore {
  name: string;
  date: string;
  score: string;
  status: "success" | "warning" | "error";
}

interface Resource {
  icon: "FileText" | "PlayCircle" | "Star";
  title: string;
  subtitle: string;
  action: string;
  color: string;
  url: string;
}

interface SubjectDetailProps {
  subject: string;
  teacher: string;
  grade: string;
  average: number;
  topics: Topic[];
  testScores: TestScore[];
  feedback: string;
  resources: Resource[];
  onBack: () => void;
}

const getSubjectIcon = (name: string) => {
  const n = name.toLowerCase();
  if (n.includes("math")) return Calculator;
  if (n.includes("science")) return FlaskConical;
  if (n.includes("english")) return Languages;
  if (n.includes("social")) return Globe;
  if (n.includes("computer")) return Monitor;
  if (n.includes("art")) return Palette;
  return BookOpen;
};

export const SubjectPerformanceDetail = ({
  subject,
  teacher,
  grade,
  average,
  topics,
  testScores,
  feedback,
  resources,
  onBack,
}: SubjectDetailProps) => {
  const Icon = getSubjectIcon(subject);

  return (
    <div className="space-y-12 animate-in fade-in slide-in-from-bottom-6 duration-700 pb-20 text-left font-sans">
      
      {/* ── BACK ACTION ── */}
      <button 
        onClick={onBack}
        className="flex items-center gap-3 px-6 py-3 rounded-2xl bg-white border border-slate-100 text-xs font-black text-slate-400 uppercase tracking-widest hover:text-[#1e3a8a] hover:border-[#1e3a8a]/20 transition-all shadow-sm group"
      >
        <ChevronLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
        <span>Performance Matrix Overview</span>
      </button>

      {/* ── HEADER PLATE ── */}
      <div className="bg-white border border-slate-50 rounded-[3.5rem] p-12 flex flex-col md:flex-row items-center justify-between gap-10 shadow-sm relative overflow-hidden group">
        <div className="absolute top-0 right-0 p-12 opacity-[0.02] scale-150 rotate-12 transition-transform duration-1000 group-hover:rotate-0">
           {React.createElement(Icon, { size: 160 })}
        </div>

        <div className="flex items-center gap-10 relative z-10">
          <div className={`w-24 h-24 rounded-[2.5rem] bg-indigo-50 flex items-center justify-center shadow-inner text-[#1e3a8a]`}>
             {React.createElement(Icon, { size: 40 })}
          </div>
          <div>
            <h1 className="text-5xl font-black text-slate-900 tracking-tighter uppercase italic mb-2">{subject}</h1>
            <div className="flex items-center gap-3 text-slate-400">
              <User className="w-5 h-5" />
              <span className="text-lg font-bold">Teacher: <span className="text-slate-600">{teacher}</span></span>
            </div>
          </div>
        </div>
        
        <div className="flex items-center gap-10 md:gap-20 w-full md:w-auto justify-around border-t md:border-t-0 md:border-l border-slate-50 pt-10 md:pt-0 md:pl-20 relative z-10">
          <div className="text-center">
            <p className="text-6xl font-black text-emerald-500 tracking-tighter mb-1 italic">{grade}</p>
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Current Grade</p>
          </div>
          <div className="text-center">
            <p className="text-6xl font-black text-slate-900 tracking-tighter mb-1 italic">{average}%</p>
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Average Index</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
        {/* Topic Mastery Audit */}
        <div className="bg-white rounded-[3.5rem] border border-slate-50 p-12 shadow-sm">
          <div className="flex items-center justify-between mb-12">
            <h3 className="text-sm font-black text-slate-800 uppercase tracking-[0.3em] border-l-4 border-emerald-400 pl-6 leading-none italic">Topic Performance</h3>
          </div>
          <div className="space-y-10">
            {topics.map((topic) => (
              <div key={topic.name} className="space-y-4">
                <div className="flex justify-between items-end">
                  <span className="font-black text-slate-700 text-lg uppercase tracking-tight italic">{topic.name}</span>
                  <span className={`font-black text-lg ${topic.score >= 80 ? "text-emerald-500" : topic.score >= 70 ? "text-amber-500" : "text-rose-500"}`}>
                    {topic.score}%
                  </span>
                </div>
                <div className="h-4 w-full bg-slate-50 rounded-full overflow-hidden border border-slate-100 shadow-inner">
                  <div 
                    className={`h-full rounded-full transition-all duration-1000 ease-out shadow-lg ${
                      topic.score >= 80 ? "bg-emerald-500" : 
                      topic.score >= 70 ? "bg-amber-500" : "bg-rose-500"
                    }`}
                    style={{ width: `${topic.score}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Chronological Scores */}
        <div className="bg-white rounded-[3.5rem] border border-slate-50 p-12 shadow-sm flex flex-col">
          <div className="flex items-center justify-between mb-12">
            <h3 className="text-sm font-black text-slate-800 uppercase tracking-[0.3em] border-l-4 border-[#1e3a8a] pl-6 leading-none italic">Recent Test Scores</h3>
          </div>
          <div className="space-y-4 flex-1 overflow-y-auto no-scrollbar max-h-[400px]">
            {testScores.map((test, index) => (
              <div key={index} className="flex items-center justify-between p-6 rounded-[2rem] border border-slate-50 bg-slate-50/30 hover:bg-white hover:shadow-xl transition-all group">
                <div className="flex items-center gap-6">
                  <div className={`w-14 h-14 rounded-2xl flex items-center justify-center font-black italic shadow-sm transition-transform group-hover:rotate-6 ${
                    test.status === "success" ? "bg-emerald-50 text-emerald-500" :
                    test.status === "warning" ? "bg-amber-50 text-amber-500" :
                    "bg-rose-50 text-rose-500"
                  }`}>
                    {test.score.includes("/") ? test.score.split("/")[0] : test.score}
                  </div>
                  <div>
                    <h4 className="font-black text-slate-800 uppercase tracking-tight italic group-hover:text-[#1e3a8a] transition-colors">{test.name}</h4>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{test.date}</p>
                  </div>
                </div>
                <div className={`px-5 py-2 rounded-xl font-black text-xs uppercase tracking-widest border ${
                  test.status === "success" ? "bg-emerald-50 text-emerald-600 border-emerald-100" :
                  test.status === "warning" ? "bg-amber-50 text-amber-600 border-amber-100" :
                  "bg-rose-50 text-rose-600 border-rose-100"
                }`}>
                  {test.score}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
        {/* Behavioral & Pedagogical Feedback */}
        <div className="bg-white rounded-[4rem] border border-slate-50 p-12 shadow-sm">
          <h3 className="text-sm font-black text-slate-800 uppercase tracking-[0.3em] mb-12 border-l-4 border-indigo-400 pl-6 leading-none italic">Teacher Feedback</h3>
          <div className="bg-indigo-50/50 p-10 rounded-[3rem] border border-indigo-100 relative overflow-hidden group">
            <div className="absolute top-0 right-0 w-32 h-32 bg-white/50 rounded-full -mr-16 -mt-16 group-hover:scale-150 transition-transform duration-1000" />
            <span className="text-9xl text-indigo-100 font-black absolute -top-8 left-4 select-none opacity-50 italic">“</span>
            <p className="text-slate-600 text-xl font-black italic tracking-tighter leading-relaxed relative z-10 pl-6 py-4 uppercase">
              {feedback}
            </p>
            <div className="mt-8 flex items-center gap-5 pl-6">
              <div className="w-14 h-14 rounded-2xl bg-[#1e3a8a] flex items-center justify-center shadow-lg group-hover:rotate-12 transition-transform">
                <User className="w-6 h-6 text-white" />
              </div>
              <div>
                <p className="text-lg font-black text-slate-900 italic uppercase tracking-tight">{teacher}</p>
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Institutional Faculty</p>
              </div>
            </div>
          </div>
        </div>

        {/* Growth Acceleration Assets */}
        <div className="bg-white rounded-[4rem] border border-slate-50 p-12 shadow-sm">
          <h3 className="text-sm font-black text-slate-800 uppercase tracking-[0.3em] mb-12 border-l-4 border-amber-400 pl-6 leading-none italic">Suggested Resources</h3>
          <div className="space-y-6">
             {resources.map((res, i) => {
                const ResIcon = res.icon === "FileText" ? FileText : res.icon === "PlayCircle" ? PlayCircle : Star;
                return (
                  <ResourceItem 
                    key={i} 
                    icon={ResIcon} 
                    title={res.title} 
                    subtitle={res.subtitle} 
                    action={res.action} 
                    color={res.color} 
                    url={res.url}
                  />
                );
             })}
          </div>
        </div>
      </div>
    </div>
  );
};

const ResourceItem = ({ icon: Icon, title, subtitle, action, color, url }: any) => (
   <div 
     onClick={() => url !== "#" && window.open(url, "_blank")}
     className="flex items-center gap-6 p-6 rounded-[2.5rem] bg-slate-50 border border-slate-100 hover:bg-white hover:shadow-2xl transition-all cursor-pointer group"
   >
      <div className={`w-16 h-16 rounded-2xl ${color} flex items-center justify-center shadow-sm group-hover:rotate-12 transition-transform`}>
        <Icon size={24} />
      </div>
      <div className="flex-1">
        <p className="text-lg font-black text-slate-800 uppercase tracking-tight italic leading-none mb-1 group-hover:text-[#1e3a8a] transition-colors">{title}</p>
        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{subtitle}</p>
      </div>
      <span className={`text-[10px] font-black uppercase tracking-widest px-5 py-2 rounded-xl border border-slate-100 shadow-sm group-hover:bg-[#1e3a8a] group-hover:text-white transition-all`}>{action}</span>
   </div>
);
