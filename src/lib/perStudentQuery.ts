/**
 * Centralised per-student query helper for the parent dashboard.
 *
 * WHY THIS EXISTS
 * ───────────────
 * Teacher and principal dashboards write per-student docs (attendance,
 * test_scores, gradebook_scores, assignments/submissions, parent_notes,
 * principal_to_parent_notes, risks, results, etc.) with TWO identifying
 * fields: `studentId` AND `studentEmail`.
 *
 * The parent's `studentData.id` is the `students/{doc_id}` Firestore ID,
 * resolved by AuthContext from the signed-in user's email. But teacher /
 * principal write paths don't always carry that exact studentId — some
 * legacy and partial enrollments end up with a different value in the
 * `studentId` field, while `studentEmail` is always correct.
 *
 * Result: a single-query read by `studentId` silently misses docs that
 * the same student CAN see by email. Live verified 2026-05-01: the
 * attendance page returned 1 doc by studentId vs 15 by studentEmail for
 * the same student.
 *
 * THE PATTERN
 * ───────────
 * For every per-student read, set up TWO `onSnapshot` listeners:
 *   - One scoped query by `studentId`
 *   - One scoped query by `studentEmail` (lowercased)
 * Merge both snapshot caches by Firestore doc id (Map keyed on `d.id`)
 * before handing them to the UI. Cleanup unsubscribes both.
 *
 * USAGE
 * ─────
 *   // Live subscription (use in useEffect):
 *   const unsub = subscribePerStudent({
 *     collection: "attendance",
 *     student: studentData,
 *     filters: [where("date", ">=", "2025-06-01")],
 *     onChange: (docs) => setLogs(docs),
 *   });
 *   return () => unsub();
 *
 *   // One-shot fetch:
 *   const docs = await fetchPerStudent({
 *     collection: "results",
 *     student: studentData,
 *     filters: [where("date", ">=", weekStart)],
 *   });
 *
 * SEE ALSO
 * ────────
 * - `subscribeEnrollments` in `enrollmentQuery.ts` is the older single-
 *   purpose version of this pattern. Both use the same merge logic.
 * - Memory file `dual_query_pattern_studentid_email.md` documents the
 *   project-wide rule.
 */
import {
  where,
  onSnapshot,
  getDocs,
  type QueryConstraint,
  type QuerySnapshot,
  type DocumentData,
  type Unsubscribe,
} from "firebase/firestore";
import { scopedQuery } from "./scopedQuery";

export interface StudentLike {
  id?: string;
  email?: string;
  studentEmail?: string;
  schoolId?: string;
}

export type PerStudentDoc = {
  id: string;
  data: () => DocumentData;
};

interface SubscribeOpts {
  collection: string;
  student: StudentLike | null | undefined;
  /** Extra Firestore constraints (e.g. `where("date", ">=", ...)`, `limit(...)`). Applied to BOTH listeners. */
  filters?: QueryConstraint[];
  onChange: (docs: PerStudentDoc[]) => void;
  onError?: (err: Error) => void;
}

/** Resolve the canonical lowercased email from any of the standard fields. */
const resolveEmail = (s: StudentLike | null | undefined): string => {
  const raw = s?.email || s?.studentEmail || "";
  return raw.trim().toLowerCase();
};

/** Merge two QuerySnapshots into a unique-by-id list of docs. */
const mergeUnique = (
  a: QuerySnapshot | null,
  b: QuerySnapshot | null,
): PerStudentDoc[] => {
  const map = new Map<string, PerStudentDoc>();
  a?.docs.forEach((d) => map.set(d.id, d));
  b?.docs.forEach((d) => map.set(d.id, d));
  return Array.from(map.values());
};

/**
 * Subscribe to a per-student collection with the dual studentId/studentEmail
 * pattern. Returns a single unsubscribe function that tears down both
 * listeners. Calls `onChange` with a merged unique-by-id list every time
 * either listener fires.
 *
 * If the student has no id, calls onChange with [] and returns a noop.
 * If the student has no email, only the studentId listener runs (still safe).
 */
export function subscribePerStudent(opts: SubscribeOpts): Unsubscribe {
  const { collection, student, filters = [], onChange, onError } = opts;

  if (!student?.id) {
    onChange([]);
    return () => {};
  }

  const schoolId = student.schoolId;
  const email = resolveEmail(student);

  let snapById: QuerySnapshot | null = null;
  let snapByEmail: QuerySnapshot | null = null;

  const emit = () => onChange(mergeUnique(snapById, snapByEmail));

  // Listener 1 — by canonical studentId
  const u1 = onSnapshot(
    scopedQuery(collection, schoolId, where("studentId", "==", student.id), ...filters),
    (s) => { snapById = s; emit(); },
    onError,
  );

  // Listener 2 — by studentEmail (catches docs whose studentId field
  // doesn't match the parent's auth doc id)
  let u2: Unsubscribe = () => {};
  if (email) {
    u2 = onSnapshot(
      scopedQuery(collection, schoolId, where("studentEmail", "==", email), ...filters),
      (s) => { snapByEmail = s; emit(); },
      onError,
    );
  }

  return () => { u1(); u2(); };
}

/**
 * One-shot fetch with the same dual-query pattern. Use for non-live
 * lookups (weekly report builds, on-demand exports, etc.). Returns a
 * unique-by-id list of docs.
 */
export async function fetchPerStudent(opts: {
  collection: string;
  student: StudentLike | null | undefined;
  filters?: QueryConstraint[];
}): Promise<PerStudentDoc[]> {
  const { collection, student, filters = [] } = opts;
  if (!student?.id) return [];

  const schoolId = student.schoolId;
  const email = resolveEmail(student);

  const queries = [
    getDocs(scopedQuery(collection, schoolId, where("studentId", "==", student.id), ...filters)),
  ];
  if (email) {
    queries.push(getDocs(scopedQuery(collection, schoolId, where("studentEmail", "==", email), ...filters)));
  }
  const [byIdSnap, byEmailSnap] = await Promise.all(queries);
  return mergeUnique(byIdSnap, byEmailSnap ?? null);
}
