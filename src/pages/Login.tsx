import React from 'react';
import { useAuth } from '../lib/AuthContext';
import { Loader2, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';

const Login = () => {
  const { loginWithGoogle, loading, error } = useAuth();
  const [isLoggingIn, setIsLoggingIn] = React.useState(false);

  const handleLogin = async () => {
    setIsLoggingIn(true);
    try {
      await loginWithGoogle();
    } catch (err: any) {
      if (err.code === 'auth/popup-closed-by-user') {
        // User closed popup — no message needed
      } else {
        toast.error("Login failed. Please try again.");
      }
    } finally {
      setIsLoggingIn(false);
    }
  };

  return (
    <div
      className="min-h-screen bg-[#f8fafc] flex items-center justify-center p-4"
      style={{
        paddingTop: "max(1rem, env(safe-area-inset-top))",
        paddingBottom: "max(1rem, env(safe-area-inset-bottom))",
      }}
    >
      <div className="max-w-md w-full">
        <div className="text-center mb-8">
          <div className="w-20 h-20 bg-[#1e294b] rounded-3xl flex items-center justify-center mx-auto mb-6 shadow-xl shadow-slate-900/20 -rotate-3 hover:rotate-0 transition-transform duration-500 overflow-hidden">
            <img
              src="/edullent-icon.png"
              alt="Edullent logo"
              width={44}
              height={44}
              style={{ width: 44, height: 44, objectFit: 'contain' }}
            />
          </div>
          <h1
            className="font-wordmark text-4xl text-[#1e294b] mb-2"
            style={{ letterSpacing: '0.12em' }}
          >
            Edullent
          </h1>
          <p className="text-[#64748b] font-bold uppercase tracking-[0.2em] text-xs">Parent Portal</p>
        </div>

        <div className="bg-white rounded-[2.5rem] p-10 shadow-2xl shadow-slate-200/60 border border-slate-100 relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-slate-800 to-slate-900"></div>
          
          <div className="mb-10 text-center">
            <h2 className="text-2xl font-bold text-[#1e294b] mb-2">Parent Login</h2>
            <p className="text-slate-500 font-medium">Access your child's academic records</p>
          </div>

          {error && (
            <div className="mb-8 p-4 bg-rose-50 border border-rose-100 rounded-2xl flex items-start gap-3 animate-in fade-in slide-in-from-top-2">
              <AlertCircle className="w-5 h-5 text-rose-500 shrink-0 mt-0.5" />
              <p className="text-sm font-bold text-rose-600 leading-tight">{error}</p>
            </div>
          )}

          <button
            onClick={handleLogin}
            disabled={isLoggingIn || loading}
            className="w-full h-16 bg-white border-2 border-slate-100 rounded-2xl flex items-center justify-center gap-4 hover:bg-slate-50 hover:border-slate-200 transition-all duration-300 group disabled:opacity-50"
          >
            {isLoggingIn ? (
              <Loader2 className="w-6 h-6 text-[#1e294b] animate-spin" />
            ) : (
              <>
                <svg className="w-6 h-6 group-hover:scale-110 transition-transform" viewBox="0 0 24 24" aria-hidden="true">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.76h3.56c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.56-2.76c-.99.66-2.25 1.06-3.72 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z"/>
                  <path fill="#FBBC05" d="M5.84 14.11A6.6 6.6 0 0 1 5.5 12c0-.73.13-1.44.34-2.11V7.05H2.18a11 11 0 0 0 0 9.9l3.66-2.84z"/>
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.05l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z"/>
                </svg>
                <span className="text-lg font-bold text-[#1e294b]">Sign in with Google</span>
              </>
            )}
          </button>

          <div className="mt-10 pt-10 border-t border-slate-50 text-center">
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-loose">
              Only registered parents can access this portal.<br/>Use your registered Google account.
            </p>
          </div>
        </div>

        <p className="text-center mt-8 text-[11px] font-bold text-slate-400 uppercase tracking-widest">
          Secure Academic Monitoring • SSL Encrypted
        </p>
      </div>
    </div>
  );
};

export default Login;
