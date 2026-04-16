import * as functions from "firebase-functions";
import { defineSecret } from "firebase-functions/params";
import * as admin from "firebase-admin";
import OpenAI from "openai";
import axios from "axios";
const pdf = require('pdf-parse');

admin.initializeApp();

// ── Secret Manager — key stored securely, never in source code ───────────────
// To set: firebase secrets:set OPENAI_API_KEY
// Then deploy: firebase deploy --only functions
const openaiApiKey = defineSecret("OPENAI_API_KEY");

// ── Original tutor function (kept for backward compatibility) ─────────────────
export const getParentAITutor = functions
  .runWith({ secrets: [openaiApiKey], timeoutSeconds: 60, memory: "512MB" })
  .https.onCall(async (data, context) => {
    try {
        const { pdfUrl, title, description, question, type, topic, target_class, students_count } = data;
        const openai = new OpenAI({ apiKey: openaiApiKey.value() });

        console.log("AI Request Type:", type || "tutor");

        let pdfText = "";
        if (pdfUrl) {
            try {
                const response = await axios.get(pdfUrl, { responseType: 'arraybuffer' });
                const buffer = Buffer.from(response.data);
                const pdfData = await pdf(buffer);
                pdfText = pdfData.text.replace(/\r?\n|\r/g, " ");
            } catch (err) {
                console.warn("PDF scan failed, continuing with context only.");
            }
        }

        let systemPrompt = "You are a friendly AI Tutor for Edullent.";
        let userPrompt = `Context: ${description}\nText: ${pdfText}\nQuery: ${question}`;

        if (type === "calibration") {
            systemPrompt = "You are an expert Curriculum Designer for Edullent.";
            userPrompt = `Generate a calibrated assignment for Class: ${target_class} (${students_count} students) on Topic: ${topic || title}. Return JSON with: generated_assignment { title, description }.`;
        }

        const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPrompt }
            ],
            response_format: { type: "json_object" }
        });

        return { status: "success", data: JSON.parse(completion.choices[0].message.content!) };

    } catch (error: any) {
        console.error("AI Function Error:", error);
        return { status: "error", message: error.message };
    }
});

// ── Universal AI proxy — replaces all client-side OpenAI calls ────────────────
// Accepts: { prompt, systemPrompt?, jsonMode?, imageBase64?, model? }
// Returns: { content: string } — caller parses JSON if needed
export const parentAIProxy = functions
  .runWith({ secrets: [openaiApiKey], timeoutSeconds: 60, memory: "512MB" })
  .https.onCall(async (data, context) => {
    // Auth gate — only logged-in parents can call
    if (!context.auth) {
      throw new functions.https.HttpsError("unauthenticated", "Login required.");
    }

    const openai = new OpenAI({ apiKey: openaiApiKey.value() });

    const {
      prompt,
      systemPrompt = "You are Edullent AI, a friendly educational assistant for school students and their parents. Always respond in simple, encouraging language.",
      jsonMode = true,
      imageBase64,
      model,
    } = data;

    if (!prompt) {
      throw new functions.https.HttpsError("invalid-argument", "prompt is required.");
    }

    try {
      const messages: any[] = [{ role: "system", content: systemPrompt }];

      if (imageBase64) {
        messages.push({
          role: "user",
          content: [
            { type: "image_url", image_url: { url: `data:image/jpeg;base64,${imageBase64}` } },
            { type: "text", text: prompt },
          ],
        });
      } else {
        messages.push({ role: "user", content: prompt });
      }

      const resolvedModel = imageBase64 ? "gpt-4o" : (model || "gpt-4o-mini");

      const completion = await openai.chat.completions.create({
        model: resolvedModel,
        messages,
        max_tokens: 1500,
        ...(jsonMode && !imageBase64 ? { response_format: { type: "json_object" } } : {}),
      });

      const content = completion.choices[0]?.message?.content ?? "";
      return { content };

    } catch (error: any) {
      console.error("parentAIProxy error:", error);
      throw new functions.https.HttpsError("internal", error.message || "AI call failed");
    }
  });

// ─── syncUserClaims ───────────────────────────────────────────────────────────
// Looks up the caller's email across role collections and writes
// Firebase custom claims { schoolId, role, branchId } to the ID token.
// Frontend must call `auth.currentUser.getIdToken(true)` afterwards to
// force-refresh the token so Firestore rules see the new claims.
// ─────────────────────────────────────────────────────────────────────────────
export const syncUserClaims = functions
  .runWith({ timeoutSeconds: 30, memory: "256MB" })
  .https.onCall(async (_data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError("unauthenticated", "Login required.");
    }

    const uid = context.auth.uid;
    const email = (context.auth.token.email || "").toLowerCase();
    if (!email) {
      throw new functions.https.HttpsError("failed-precondition", "No email on token.");
    }

    const db = admin.firestore();
    const auth = admin.auth();

    // 1) Owner — user's own uid is a school doc under /schools/{uid}
    const schoolDoc = await db.collection("schools").doc(uid).get();
    if (schoolDoc.exists) {
      await auth.setCustomUserClaims(uid, {
        schoolId: uid,
        role: "owner",
      });
      return { role: "owner", schoolId: uid };
    }

    // 2) Principal
    const principalSnap = await db.collection("principals")
      .where("email", "==", email).limit(1).get();
    if (!principalSnap.empty) {
      const d = principalSnap.docs[0].data();
      await auth.setCustomUserClaims(uid, {
        schoolId: d.schoolId,
        role: "principal",
        branchId: d.branchId || null,
      });
      return { role: "principal", schoolId: d.schoolId, branchId: d.branchId || null };
    }

    // 3) Teacher — pick best record if same email exists in multiple schools.
    //    Priority: isPrimarySchool flag → Active/Invited status → most recent activation.
    const teacherSnap = await db.collection("teachers")
      .where("email", "==", email).get();
    if (!teacherSnap.empty) {
      const sorted = teacherSnap.docs.sort((a, b) => {
        const aD = a.data(), bD = b.data();
        const primary = Number(!!bD.isPrimarySchool) - Number(!!aD.isPrimarySchool);
        if (primary !== 0) return primary;
        const rank = (s: string) => s === "Active" ? 2 : s === "Invited" ? 1 : 0;
        const aRank = rank(aD.status);
        const bRank = rank(bD.status);
        if (aRank !== bRank) return bRank - aRank;
        const at = aD.activatedAt?.toMillis?.() || 0;
        const bt = bD.activatedAt?.toMillis?.() || 0;
        return bt - at;
      });
      const d = sorted[0].data();
      await auth.setCustomUserClaims(uid, {
        schoolId: d.schoolId,
        role: "teacher",
        branchId: d.branchId || null,
      });
      return { role: "teacher", schoolId: d.schoolId, branchId: d.branchId || null };
    }

    // 4) Data entry staff
    const deSnap = await db.collection("data_entry_staff")
      .where("email", "==", email).limit(1).get();
    if (!deSnap.empty) {
      const d = deSnap.docs[0].data();
      await auth.setCustomUserClaims(uid, {
        schoolId: d.schoolId || null,
        role: "data_entry",
        branchId: d.branchId || null,
      });
      return { role: "data_entry", schoolId: d.schoolId || null };
    }

    // 5) Parent — matches a student record via parentEmail or email
    let parentSnap = await db.collection("students")
      .where("parentEmail", "==", email).limit(1).get();
    if (parentSnap.empty) {
      parentSnap = await db.collection("students")
        .where("email", "==", email).limit(1).get();
    }
    if (!parentSnap.empty) {
      const d = parentSnap.docs[0].data();
      await auth.setCustomUserClaims(uid, {
        schoolId: d.schoolId,
        role: "parent",
        branchId: d.branchId || null,
      });
      return { role: "parent", schoolId: d.schoolId, branchId: d.branchId || null };
    }

    // No role found — clear claims so stale ones don't leak
    await auth.setCustomUserClaims(uid, null);
    throw new functions.https.HttpsError(
      "permission-denied",
      "No role found for this account. Contact your school administrator."
    );
  });

// ─── branchId schema validator ────────────────────────────────────────────────
// Tenant-scoped collections MUST carry both `schoolId` and `branchId`.
// This onWrite trigger:
//   1. Rejects creates/updates that drop schoolId
//   2. Auto-fills missing branchId by walking the enrollment / teacher chain
//   3. Logs the doc to `audit_logs/branchid_violations` if it can't be inferred
//
// Collections enforced: students, attendance, results, test_scores,
//                       gradebook_scores, fees, incidents, submissions
// ─────────────────────────────────────────────────────────────────────────────
const ENFORCED_COLLECTIONS = [
  "students",
  "attendance",
  "results",
  "test_scores",
  "gradebook_scores",
  "fees",
  "incidents",
  "submissions",
];

async function inferBranchId(
  data: any,
  db: admin.firestore.Firestore,
): Promise<string | null> {
  // 1) Direct field already present
  if (data.branchId) return data.branchId as string;

  // 2) Walk: studentId → enrollments → teacherId → teacher.branchId
  if (data.studentId) {
    const enrSnap = await db.collection("enrollments")
      .where("studentId", "==", data.studentId)
      .limit(1).get();
    if (!enrSnap.empty) {
      const enr = enrSnap.docs[0].data();
      if (enr.branchId) return enr.branchId as string;
      if (enr.teacherId) {
        const teach = await db.collection("teachers").doc(enr.teacherId).get();
        const tBranch = teach.data()?.branchId;
        if (tBranch) return tBranch as string;
      }
    }
  }

  // 3) For teacher-authored docs (assignments, tests): teacherId → teacher.branchId
  if (data.teacherId) {
    const teach = await db.collection("teachers").doc(data.teacherId).get();
    const tBranch = teach.data()?.branchId;
    if (tBranch) return tBranch as string;
  }

  return null;
}

// Build one trigger per enforced collection — Cloud Functions v1 needs a
// concrete document path; wildcards like `{collection}/{id}` aren't allowed.
ENFORCED_COLLECTIONS.forEach((coll) => {
  exports[`enforceBranchId_${coll}`] = functions.firestore
    .document(`${coll}/{docId}`)
    .onWrite(async (change, context) => {
      const db = admin.firestore();
      const after = change.after.exists ? change.after.data() : null;
      if (!after) return null; // delete — nothing to validate

      // schoolId is mandatory — log + delete the doc if missing
      if (!after.schoolId) {
        await db.collection("audit_logs").add({
          type: "schemaViolation",
          severity: "critical",
          collection: coll,
          docId: context.params.docId,
          uid: "system",
          reason: "missing schoolId",
          payload: after,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        await change.after.ref.delete();
        return null;
      }

      // branchId — try to infer if missing
      if (!after.branchId) {
        const inferred = await inferBranchId(after, db);
        if (inferred) {
          await change.after.ref.update({
            branchId: inferred,
            _branchIdInferredAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          return null;
        }

        await db.collection("audit_logs").add({
          type: "schemaViolation",
          severity: "warning",
          collection: coll,
          docId: context.params.docId,
          uid: "system",
          reason: "missing branchId — could not infer",
          payload: after,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }

      return null;
    });
});

// ─── Audit logging — sensitive collection writes ──────────────────────────────
// Captures who-changed-what for compliance + forensics. Append-only.
// Avoids logging high-volume collections (attendance, test_scores) to control cost.
//
// Audit log shape:
//   {
//     uid, schoolId, role, collection, docId,
//     action: 'create' | 'update' | 'delete',
//     changedFields: string[],   // for updates
//     before:  {...} | null,     // pre-state (truncated to 1KB)
//     after:   {...} | null,     // post-state (truncated to 1KB)
//     ts: serverTimestamp()
//   }
// ─────────────────────────────────────────────────────────────────────────────
const AUDITED_COLLECTIONS = [
  "principals",
  "teachers",
  "students",
  "data_entry_staff",
  "fees",
  "incidents",
  "interventions",
  "alert_resolutions",
  "principal_reports",
  "access_requests",
];

// Truncate large payloads to keep audit log entries small + cheap.
function truncatePayload(obj: any, maxBytes = 1024): any {
  if (!obj) return null;
  const json = JSON.stringify(obj);
  if (json.length <= maxBytes) return obj;
  return { _truncated: true, preview: json.slice(0, maxBytes) };
}

function diffFields(before: any, after: any): string[] {
  if (!before || !after) return [];
  const all = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changed: string[] = [];
  for (const k of all) {
    if (k.startsWith("_")) continue; // skip internal fields
    if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) changed.push(k);
  }
  return changed;
}

// ─── aggregateSchoolStats ─────────────────────────────────────────────────────
// Server-side aggregation for the owner dashboard. Reads tenant-scoped
// collections via Admin SDK (bypasses rules) and returns pre-computed branch
// rollups so the client doesn't have to fetch 60K+ docs.
//
// Result is cached in `owner_stats_cache/{ownerUid}` for AGGREGATE_TTL_SECONDS
// to keep latency low and Firestore reads cheap. Pass { force: true } to bypass.
// ─────────────────────────────────────────────────────────────────────────────
const AGGREGATE_TTL_SECONDS = 5 * 60; // 5 minutes
const ADMIN_PAGE_SIZE = 1000;
const ADMIN_MAX_DOCS  = 200_000;

async function adminFetchAll(
  ref: FirebaseFirestore.Query,
  label: string,
): Promise<FirebaseFirestore.QueryDocumentSnapshot[]> {
  const out: FirebaseFirestore.QueryDocumentSnapshot[] = [];
  let cursor: FirebaseFirestore.QueryDocumentSnapshot | null = null;
  while (out.length < ADMIN_MAX_DOCS) {
    let q = ref.orderBy(admin.firestore.FieldPath.documentId()).limit(ADMIN_PAGE_SIZE);
    if (cursor) q = q.startAfter(cursor);
    const snap = await q.get();
    if (snap.empty) break;
    out.push(...snap.docs);
    if (snap.docs.length < ADMIN_PAGE_SIZE) break;
    cursor = snap.docs[snap.docs.length - 1];
  }
  if (out.length >= ADMIN_MAX_DOCS) {
    console.warn(`[aggregate] ${label} hit ADMIN_MAX_DOCS — archive old data.`);
  }
  return out;
}

export const aggregateSchoolStats = functions
  .runWith({ timeoutSeconds: 120, memory: "1GB" })
  .https.onCall(async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError("unauthenticated", "Login required.");
    }
    const role = (context.auth.token as any).role;
    if (role !== "owner") {
      throw new functions.https.HttpsError("permission-denied", "Owner only.");
    }
    const uid = context.auth.uid;
    const force = !!data?.force;

    const db = admin.firestore();

    // Cache check
    if (!force) {
      const cacheRef = db.collection("owner_stats_cache").doc(uid);
      const cached = await cacheRef.get();
      const cd = cached.data();
      if (cd && cd.computedAt && (Date.now() - cd.computedAt) / 1000 < AGGREGATE_TTL_SECONDS) {
        return { ...cd, fromCache: true };
      }
    }

    // Tenant-scoped reads (Admin SDK bypasses rules; we filter manually).
    const [branchesDocs, studentsDocs, attendanceDocs, resultsDocs, testScoresDocs, feesDocs, teachersDocs, enrollmentsDocs] =
      await Promise.all([
        adminFetchAll(db.collection("schools").doc(uid).collection("branches"), `schools/${uid}/branches`),
        adminFetchAll(db.collection("students").where("schoolId", "==", uid),    "students"),
        adminFetchAll(db.collection("attendance").where("schoolId", "==", uid),  "attendance"),
        adminFetchAll(db.collection("results").where("schoolId", "==", uid),     "results"),
        adminFetchAll(db.collection("test_scores").where("schoolId", "==", uid), "test_scores"),
        adminFetchAll(db.collection("fees").where("schoolId", "==", uid),        "fees"),
        adminFetchAll(db.collection("teachers").where("schoolId", "==", uid),    "teachers"),
        adminFetchAll(db.collection("enrollments").where("schoolId", "==", uid), "enrollments"),
      ]);

    // Branch metadata
    const branches = branchesDocs.map((d, i) => ({
      id: (d.data().branchId || d.id) as string,
      name: (d.data().name || d.data().schoolName || `Branch ${i + 1}`) as string,
      color: d.data().color || ["#1e3a8a", "#3b82f6", "#f59e0b", "#10b981", "#8b5cf6", "#ec4899"][i % 6],
      established: String(d.data().established || d.data().year || "N/A"),
      location: String(d.data().location || d.data().city || d.data().address || "—"),
    }));

    // Per-branch state
    type BranchAgg = {
      students: Set<string>;
      att: { total: number; present: number };
      res: { total: number; passed: number };
      fees: { total: number; collected: number };
      teachers: number;
    };
    const branchAgg = new Map<string, BranchAgg>();
    branches.forEach((b) => branchAgg.set(b.id, {
      students: new Set(),
      att: { total: 0, present: 0 },
      res: { total: 0, passed: 0 },
      fees: { total: 0, collected: 0 },
      teachers: 0,
    }));

    // Teachers per branch
    const teacherBranch = new Map<string, string>();
    teachersDocs.forEach((d) => {
      const t = d.data();
      const cid = t.branchId;
      if (cid && branchAgg.has(cid)) {
        branchAgg.get(cid)!.teachers++;
        teacherBranch.set(d.id, cid);
      }
    });

    // Student → branch (try direct branchId, else enrollment chain)
    const studentBranch = new Map<string, string>();
    const enrollmentBranch = new Map<string, string>();
    enrollmentsDocs.forEach((d) => {
      const e = d.data();
      const sid = e.studentId as string;
      if (!sid || enrollmentBranch.has(sid)) return;
      const cid = (e.branchId as string) || teacherBranch.get(e.teacherId as string);
      if (cid) enrollmentBranch.set(sid, cid);
    });
    studentsDocs.forEach((d) => {
      const s = d.data();
      const cid = (s.branchId as string) || enrollmentBranch.get(d.id);
      if (cid && branchAgg.has(cid)) {
        branchAgg.get(cid)!.students.add(d.id);
        studentBranch.set(d.id, cid);
      }
    });

    // Attendance rollup
    attendanceDocs.forEach((d) => {
      const a = d.data();
      const cid = studentBranch.get(a.studentId as string);
      if (!cid) return;
      const ag = branchAgg.get(cid)!;
      ag.att.total++;
      if (String(a.status ?? "").toLowerCase() === "present") ag.att.present++;
    });

    // Results + test scores
    const tallyResult = (r: any) => {
      const cid = studentBranch.get(r.studentId as string);
      if (!cid) return;
      const ag = branchAgg.get(cid)!;
      ag.res.total++;
      if ((r.percentage || r.score || 0) >= 50) ag.res.passed++;
    };
    resultsDocs.forEach((d) => tallyResult(d.data()));
    testScoresDocs.forEach((d) => tallyResult(d.data()));

    // Fees
    feesDocs.forEach((d) => {
      const f = d.data();
      const cid = studentBranch.get(f.studentId as string);
      if (!cid) return;
      const ag = branchAgg.get(cid)!;
      const amt  = f.amount || f.totalAmount || f.feeAmount || 0;
      const coll = f.paidAmount || f.collectedAmount || (f.status === "paid" ? amt : 0);
      ag.fees.total += amt;
      ag.fees.collected += coll;
    });

    // Final per-branch numbers
    const branchStats = branches.map((b) => {
      const ag = branchAgg.get(b.id)!;
      const attPct = ag.att.total ? Math.round((ag.att.present / ag.att.total) * 100) : 0;
      const passRate = ag.res.total ? Math.round((ag.res.passed / ag.res.total) * 100) : 0;
      const feeColl = ag.fees.total ? Math.round((ag.fees.collected / ag.fees.total) * 100) : 0;
      const ahi = Math.round(attPct * 0.4 + passRate * 0.4 + feeColl * 0.2);
      return {
        ...b,
        students: ag.students.size,
        teachers: ag.teachers,
        attendance: attPct,
        passRate,
        feeCollection: feeColl,
        ahi,
        feesCollected: ag.fees.collected,
        feesTotal: ag.fees.total,
      };
    });

    // School-wide rollups
    const totalStudents = branchStats.reduce((s, b) => s + b.students, 0);
    const totalTeachers = branchStats.reduce((s, b) => s + b.teachers, 0);
    const avgAttendance = branchStats.length
      ? Math.round(branchStats.reduce((s, b) => s + b.attendance, 0) / branchStats.length)
      : 0;
    const avgPassRate = branchStats.length
      ? Math.round(branchStats.reduce((s, b) => s + b.passRate, 0) / branchStats.length)
      : 0;
    const avgAhi = branchStats.length
      ? Math.round(branchStats.reduce((s, b) => s + b.ahi, 0) / branchStats.length)
      : 0;

    const result = {
      branches: branchStats,
      totals: { totalStudents, totalTeachers, avgAttendance, avgPassRate, avgAhi },
      computedAt: Date.now(),
      fromCache: false,
    };

    // Write to cache (best-effort — don't fail the call if cache write fails)
    try {
      await db.collection("owner_stats_cache").doc(uid).set(result);
    } catch (err) {
      console.warn("[aggregate] cache write failed:", err);
    }

    return result;
  });

AUDITED_COLLECTIONS.forEach((coll) => {
  exports[`auditLog_${coll}`] = functions.firestore
    .document(`${coll}/{docId}`)
    .onWrite(async (change, context) => {
      const db = admin.firestore();
      const before = change.before.exists ? change.before.data() : null;
      const after  = change.after.exists  ? change.after.data()  : null;

      // Resolve actor — prefer the doc's lastModifiedBy/uid field, else "system"
      const actorUid =
        (after?._lastModifiedBy as string) ||
        (before?._lastModifiedBy as string) ||
        (after?.uid as string) ||
        "system";
      const schoolId =
        (after?.schoolId as string) || (before?.schoolId as string) || null;

      const action: "create" | "update" | "delete" =
        !before ? "create" : !after ? "delete" : "update";

      const changedFields = action === "update" ? diffFields(before, after) : [];

      // Skip pure metadata-only updates (lastActive timestamp, etc.) to cut noise.
      const NOISE_FIELDS = new Set([
        "lastActive", "lastLoginAt", "_lastModifiedBy",
        "_branchIdInferredAt", "_branchIdBackfilledAt",
      ]);
      if (action === "update" && changedFields.every((f) => NOISE_FIELDS.has(f))) {
        return null;
      }

      await db.collection("audit_logs").add({
        uid: actorUid,
        schoolId,
        collection: coll,
        docId: context.params.docId,
        action,
        changedFields,
        before: truncatePayload(before),
        after:  truncatePayload(after),
        ts: admin.firestore.FieldValue.serverTimestamp(),
      });
      return null;
    });
});
