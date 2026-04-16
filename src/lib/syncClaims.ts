/**
 * syncClaims.ts
 * Calls the `syncUserClaims` Cloud Function to populate Firebase custom claims
 * ({ schoolId, role, branchId }) on the user's ID token, then force-refreshes
 * the token so Firestore security rules see the new claims.
 *
 * Call this immediately after onAuthStateChanged fires with a valid user,
 * BEFORE running any tenant-scoped Firestore queries.
 */
import { getFunctions, httpsCallable } from "firebase/functions";
import type { User } from "firebase/auth";

const FUNCTIONS_REGION = "us-central1"; // Same region as deployed functions

export async function syncClaimsAndRefreshToken(user: User): Promise<{
  role: string;
  schoolId: string | null;
  branchId?: string | null;
} | null> {
  try {
    const fns = getFunctions(undefined, FUNCTIONS_REGION);
    const call = httpsCallable<unknown, { role: string; schoolId: string; branchId?: string }>(
      fns,
      "syncUserClaims",
    );
    const res = await call({});
    // Force-refresh the ID token so the new custom claims take effect immediately.
    await user.getIdToken(true);
    return res.data ?? null;
  } catch (err: any) {
    console.warn("[syncClaims] failed:", err?.message || err);
    // Non-fatal during the transition phase; once Firestore rules are enforced
    // the caller's subsequent queries will fail and surface the real error.
    return null;
  }
}