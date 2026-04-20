/**
 * Centralised enrollment query for the parent dashboard.
 *
 * Why this exists:
 * Some teacher/principal-dashboard code paths historically wrote
 * `enrollments.studentId = email` instead of the actual student doc ID.
 * Newer writes use the real Firestore doc ID. We need parent-dashboard reads
 * to match BOTH formats so legacy enrollments (those created before the
 * teacher/principal write fix) keep showing up — without requiring a data
 * migration.
 *
 * Strategy: subscribe to TWO scoped queries (one by studentId, one by
 * studentEmail), merge results by doc.id, and forward to a single callback.
 * Returns a single unsubscribe function that tears both listeners down.
 */
import {
  collection,
  query,
  where,
  onSnapshot,
  QuerySnapshot,
  DocumentData,
  Unsubscribe,
} from "firebase/firestore";
import { db } from "./firebase";

interface StudentLike {
  id?: string;
  email?: string;
  schoolId?: string;
}

type Doc = { id: string; data: () => DocumentData };

/** Subscribe to enrollments for a student. Calls `cb` with a merged-deduped list of docs. */
export function subscribeEnrollments(
  student: StudentLike | null | undefined,
  cb: (docs: Doc[]) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  if (!student?.id) {
    cb([]);
    return () => {};
  }

  const schoolId = student.schoolId;
  const email = student.email?.toLowerCase();

  let snap1: QuerySnapshot | null = null;
  let snap2: QuerySnapshot | null = null;

  const emit = () => {
    const map = new Map<string, Doc>();
    snap1?.docs.forEach((d) => map.set(d.id, d));
    snap2?.docs.forEach((d) => map.set(d.id, d));
    cb(Array.from(map.values()));
  };

  // Query A — by canonical studentId (modern enrollments use student doc ID here)
  const qById = schoolId
    ? query(
        collection(db, "enrollments"),
        where("schoolId", "==", schoolId),
        where("studentId", "==", student.id),
      )
    : query(collection(db, "enrollments"), where("studentId", "==", student.id));
  const u1 = onSnapshot(
    qById,
    (s) => { snap1 = s; emit(); },
    onError,
  );

  // Query B — by studentEmail (legacy enrollments stored email in studentId
  // but always also wrote studentEmail; some pre-fix writes didn't set
  // studentId to the doc ID at all, so this catches them).
  let u2: Unsubscribe = () => {};
  if (email) {
    const qByEmail = schoolId
      ? query(
          collection(db, "enrollments"),
          where("schoolId", "==", schoolId),
          where("studentEmail", "==", email),
        )
      : query(collection(db, "enrollments"), where("studentEmail", "==", email));
    u2 = onSnapshot(
      qByEmail,
      (s) => { snap2 = s; emit(); },
      onError,
    );
  }

  return () => { u1(); u2(); };
}