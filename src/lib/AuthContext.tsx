import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import {
  onAuthStateChanged,
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
  User
} from 'firebase/auth';
import { auth, db } from './firebase';
import { collection, query, where, getDocs, updateDoc, doc, onSnapshot, getDoc } from 'firebase/firestore';
import { syncClaimsAndRefreshToken } from './syncClaims';

interface AuthContextType {
  user: User | null;
  studentData: any | null;
  loading: boolean;
  loginWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
  error: string | null;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [studentData, setStudentData] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Track student listener so we can clean it up when auth changes
  const unsubStudentRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      // Always clean up previous student listener first
      if (unsubStudentRef.current) { unsubStudentRef.current(); unsubStudentRef.current = null; }
      setLoading(true);
      if (currentUser && currentUser.email) {
        try {
          // Sync custom claims first. The Cloud Function looks up the student
          // across schools (Admin SDK bypasses rules) and returns the chosen
          // schoolId. We then filter our client-side query by that schoolId so
          // Firestore rules accept it.
          const synced = await syncClaimsAndRefreshToken(currentUser);
          const claimSchoolId = synced?.schoolId || null;

          // Whitelist Check for Students/Parents — must filter by schoolId
          // so the list query passes the `inSameSchool()` rule.
          const lowerEmail = currentUser.email.toLowerCase();
          const q = claimSchoolId
            ? query(
                collection(db, "students"),
                where("schoolId", "==", claimSchoolId),
                where("email", "==", lowerEmail),
              )
            : query(collection(db, "students"), where("email", "==", lowerEmail));
          const querySnapshot = await getDocs(q);

          if (!querySnapshot.empty) {
            const studentId = querySnapshot.docs[0].id;

            // Set up Real-Time Listener and store it for cleanup
            const unsubStudent = onSnapshot(doc(db, "students", studentId), async (docSnap) => {
              if (docSnap.exists()) {
                const data = docSnap.data();

                // Block deactivated / suspended accounts
                if (data.status === "Deactivated" || data.status === "Suspended" || data.status === "Blocked") {
                   await signOut(auth);
                   setUser(null);
                   setStudentData(null);
                   setError("Your account has been deactivated. Please contact school administration.");
                   setLoading(false);
                   return;
                }

                if (data.status === "Invited") {
                   updateDoc(doc(db, "students", studentId), { status: "Active" });
                }

                // Fetch Class Name — use getDoc (single doc get) instead of
                // a list query so rules can resolve via the per-doc `get` rule.
                let className = "General";
                if (data.classId) {
                   const classDoc = await getDoc(doc(db, "classes", data.classId));
                   if (classDoc.exists()) className = (classDoc.data() as any).name || "General";
                }

                setStudentData({ id: studentId, ...data, className });
                setUser(currentUser);
                setError(null);
                setLoading(false);
              }
            });
            unsubStudentRef.current = unsubStudent;
          } else {
            // Not in whitelist
            await signOut(auth);
            setUser(null);
            setStudentData(null);
            setError("You are not authorized to access the Parent Dashboard. Please contact your school administration.");
            setLoading(false);
          }
        } catch (err: any) {
          console.error("Auth Error:", err);
          setError("An error occurred during verification.");
          setLoading(false);
        }
      } else {
        setUser(null);
        setStudentData(null);
        setLoading(false);
      }
      setLoading(false);
    });

    return () => { unsubscribe(); if (unsubStudentRef.current) { unsubStudentRef.current(); unsubStudentRef.current = null; } };
  }, []);

  const loginWithGoogle = async () => {
    const provider = new GoogleAuthProvider();
    try {
      setError(null);
      await signInWithPopup(auth, provider);
    } catch (err: any) {
      setError(err.message);
      throw err;
    }
  };

  const logout = async () => {
    localStorage.removeItem("parent_ai_persistent_cache_v3");
    await signOut(auth);
  };

  return (
    <AuthContext.Provider value={{ user, studentData, loading, loginWithGoogle, logout, error }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
