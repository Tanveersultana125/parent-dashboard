/**
 * auditedWrites.ts
 * Thin wrappers around Firestore write operations that inject `_lastModifiedBy`
 * so the server-side audit logger can attribute the change to the right user.
 *
 * Use these for any write to AUDITED_COLLECTIONS (principals, teachers, students,
 * fees, incidents, interventions, alert_resolutions, principal_reports, access_requests).
 */
import {
  addDoc, setDoc, updateDoc, deleteDoc,
  type CollectionReference, type DocumentReference,
  type DocumentData, type WithFieldValue, type SetOptions, type UpdateData,
} from "firebase/firestore";
import { auth } from "./firebase";

function actor(): string {
  return auth.currentUser?.uid || "anonymous";
}

export function auditedAdd<T extends DocumentData>(
  ref: CollectionReference<T>,
  data: WithFieldValue<T>,
) {
  return addDoc(ref, { ...data, _lastModifiedBy: actor() } as WithFieldValue<T>);
}

export function auditedSet<T extends DocumentData>(
  ref: DocumentReference<T>,
  data: WithFieldValue<T>,
  options?: SetOptions,
) {
  const payload = { ...data, _lastModifiedBy: actor() } as WithFieldValue<T>;
  return options ? setDoc(ref, payload, options) : setDoc(ref, payload);
}

export function auditedUpdate<T extends DocumentData>(
  ref: DocumentReference<T>,
  data: UpdateData<T>,
) {
  return updateDoc(ref, { ...data, _lastModifiedBy: actor() } as UpdateData<T>);
}

export function auditedDelete<T extends DocumentData>(ref: DocumentReference<T>) {
  // Delete cannot carry metadata — the audit logger will mark uid="system" for
  // raw deletes. If you need attributable delete, soft-delete via update first.
  return deleteDoc(ref);
}