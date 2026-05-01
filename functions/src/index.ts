import * as functions from "firebase-functions";
import { defineSecret } from "firebase-functions/params";
import * as admin from "firebase-admin";
import OpenAI from "openai";
import axios from "axios";
const pdf = require('pdf-parse');

admin.initializeApp();
// Tell Firestore Admin SDK to silently drop fields whose value is undefined,
// rather than throwing "Cannot use undefined as a Firestore value". The
// leaderboard insights doc has optional fields (action.progress, action.targetSubject,
// etc.) that the OpenAI response sometimes omits; without this setting EVERY
// such write fails. Idiomatic production setup; .settings() must be called
// before any other Firestore call. No-op for fields that ARE defined.
admin.firestore().settings({ ignoreUndefinedProperties: true });

// ── Secret Manager — key stored securely, never in source code ───────────────
const openaiApiKey = defineSecret("OPENAI_API_KEY");

// ── Shared constants ─────────────────────────────────────────────────────────
const ALLOWED_ROLES = new Set(["owner", "principal", "teacher", "data_entry", "parent"]);
const STAFF_ROLES = new Set(["owner", "principal", "teacher", "data_entry"]);
const ADMIN_ROLES = new Set(["owner", "principal"]);

const ALLOWED_OPENAI_MODELS = new Set([
  "gpt-4o-mini",
  "gpt-4o",
  "gpt-4.1-mini",
  "gpt-4-turbo",
  "gpt-3.5-turbo",
]);

// Fallback chain — if the requested model returns "model_not_found"
// (account/key doesn't have access to the newest one), step down through
// progressively older + universally-available models. The order is by
// quality preference; we stop at the first model the OpenAI key can serve.
const MODEL_FALLBACK_CHAIN = [
  "gpt-4o-mini",
  "gpt-4.1-mini",
  "gpt-3.5-turbo",
];

const MAX_PROMPT_CHARS = 8000;
const MAX_IMAGE_B64_BYTES = 8 * 1024 * 1024;   // ~6 MB raw image
const MAX_PDF_BYTES = 20 * 1024 * 1024;
const PDF_FETCH_TIMEOUT_MS = 15_000;

// Only allow PDF fetches from Firebase / GCS hosted files — kills SSRF.
const ALLOWED_PDF_HOSTS = [
  "firebasestorage.googleapis.com",
  "storage.googleapis.com",
];

// ── Helpers ──────────────────────────────────────────────────────────────────
function requireAuth(context: functions.https.CallableContext) {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "Login required.");
  }
  return context.auth;
}

function requireRole(
  context: functions.https.CallableContext,
  allowed: Set<string>,
): string {
  requireAuth(context);
  const role = (context.auth!.token as any).role;
  if (!role || !allowed.has(role)) {
    throw new functions.https.HttpsError("permission-denied", "Insufficient privileges.");
  }
  return role;
}

function validatePdfUrl(url: unknown): URL {
  if (typeof url !== "string" || url.length === 0 || url.length > 2048) {
    throw new functions.https.HttpsError("invalid-argument", "Invalid pdfUrl.");
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new functions.https.HttpsError("invalid-argument", "Malformed pdfUrl.");
  }
  if (parsed.protocol !== "https:") {
    throw new functions.https.HttpsError("invalid-argument", "pdfUrl must be https.");
  }
  const host = parsed.hostname;
  const allowed = ALLOWED_PDF_HOSTS.some((h) => host === h || host.endsWith("." + h));
  if (!allowed) {
    throw new functions.https.HttpsError("invalid-argument", "pdfUrl host not allowed.");
  }
  return parsed;
}

async function safeFetchPdfText(pdfUrl: string): Promise<string> {
  validatePdfUrl(pdfUrl);
  const response = await axios.get(pdfUrl, {
    responseType: "arraybuffer",
    timeout: PDF_FETCH_TIMEOUT_MS,
    maxContentLength: MAX_PDF_BYTES,
    maxBodyLength: MAX_PDF_BYTES,
    maxRedirects: 2,
  });
  const buffer = Buffer.from(response.data);
  const pdfData = await pdf(buffer);
  return (pdfData.text || "").replace(/\r?\n|\r/g, " ").slice(0, 40_000);
}

function resolveModel(requested: unknown, hasImage: boolean): string {
  if (hasImage) return "gpt-4o-mini"; // vision-capable, cost-capped
  if (typeof requested === "string" && ALLOWED_OPENAI_MODELS.has(requested)) {
    return requested;
  }
  return "gpt-4o-mini";
}

function safeJsonParse<T = any>(raw: string, label: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch (err) {
    console.error(`[${label}] JSON parse failed. Raw (first 500):`, raw.slice(0, 500));
    throw new functions.https.HttpsError(
      "internal",
      "AI returned invalid JSON. Please retry.",
    );
  }
}


// ── Original tutor function ──────────────────────────────────────────────────
export const getParentAITutor = functions
  .runWith({ secrets: [openaiApiKey], timeoutSeconds: 60, memory: "512MB" })
  .https.onCall(async (data, context) => {
    // Auth + role gate (CRITICAL fix — was missing entirely).
    requireRole(context, ALLOWED_ROLES);

    const {
      pdfUrl,
      title,
      description,
      question,
      type,
      topic,
      target_class,
      students_count,
    } = data || {};

    // Input bounds
    if (question && String(question).length > MAX_PROMPT_CHARS) {
      throw new functions.https.HttpsError("invalid-argument", "question too long.");
    }
    if (description && String(description).length > MAX_PROMPT_CHARS) {
      throw new functions.https.HttpsError("invalid-argument", "description too long.");
    }

    const openai = new OpenAI({ apiKey: openaiApiKey.value() });
    console.log("AI Request Type:", type || "tutor");

    let pdfText = "";
    if (pdfUrl) {
      try {
        pdfText = await safeFetchPdfText(String(pdfUrl));
      } catch (err: any) {
        // Auth/SSRF errors are HttpsErrors — rethrow them as-is.
        if (err instanceof functions.https.HttpsError) throw err;
        console.warn("PDF scan failed, continuing with context only:", err?.message);
      }
    }

    let systemPrompt = "You are a friendly AI Tutor for Edullent.";
    let userPrompt =
      `Context: ${description ?? ""}\nText: ${pdfText}\nQuery: ${question ?? ""}`;

    if (type === "calibration") {
      systemPrompt = "You are an expert Curriculum Designer for Edullent.";
      userPrompt =
        `Generate a calibrated assignment for Class: ${target_class} ` +
        `(${students_count} students) on Topic: ${topic || title}. ` +
        `Return JSON with: generated_assignment { title, description }.`;
    }

    try {
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        response_format: { type: "json_object" },
        max_tokens: 1500,
      });
      const raw = completion.choices[0].message.content ?? "";
      return { status: "success", data: safeJsonParse(raw, "getParentAITutor") };
    } catch (error: any) {
      console.error("getParentAITutor error:", error);
      throw new functions.https.HttpsError("internal", "AI call failed.");
    }
  });


// ── Universal AI proxy ───────────────────────────────────────────────────────
export const parentAIProxy = functions
  .runWith({ secrets: [openaiApiKey], timeoutSeconds: 60, memory: "512MB" })
  .https.onCall(async (data, context) => {
    requireRole(context, ALLOWED_ROLES);

    const openai = new OpenAI({ apiKey: openaiApiKey.value() });

    const {
      prompt,
      systemPrompt = "You are Edullent AI, a friendly educational assistant for school students and their parents. Always respond in simple, encouraging language.",
      jsonMode = true,
      imageBase64,
      model,
    } = data || {};

    if (typeof prompt !== "string" || prompt.length === 0) {
      throw new functions.https.HttpsError("invalid-argument", "prompt is required.");
    }
    if (prompt.length > MAX_PROMPT_CHARS) {
      throw new functions.https.HttpsError("invalid-argument", "prompt too long.");
    }
    if (typeof systemPrompt !== "string" || systemPrompt.length > MAX_PROMPT_CHARS) {
      throw new functions.https.HttpsError("invalid-argument", "systemPrompt too long.");
    }
    if (imageBase64 !== undefined) {
      if (typeof imageBase64 !== "string") {
        throw new functions.https.HttpsError("invalid-argument", "imageBase64 must be a string.");
      }
      if (imageBase64.length > MAX_IMAGE_B64_BYTES) {
        throw new functions.https.HttpsError("invalid-argument", "image too large.");
      }
    }

    const hasImage = !!imageBase64;
    const resolvedModel = resolveModel(model, hasImage);

    try {
      const messages: any[] = [{ role: "system", content: systemPrompt }];
      if (hasImage) {
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

      // Build the model attempt sequence. Start with the resolved choice,
      // then walk the fallback chain. We dedupe to avoid retrying the same
      // model. Vision requests stay locked to gpt-4o-mini (fallback chain
      // doesn't apply because non-vision models can't process the image).
      const modelsToTry: string[] = hasImage
        ? [resolvedModel]
        : Array.from(new Set<string>([resolvedModel, ...MODEL_FALLBACK_CHAIN]));

      let lastErr: any = null;
      for (const candidate of modelsToTry) {
        try {
          const completion = await openai.chat.completions.create({
            model: candidate,
            messages,
            max_tokens: 1500,
            ...(jsonMode && !hasImage ? { response_format: { type: "json_object" } } : {}),
          });
          const content = completion.choices[0]?.message?.content ?? "";
          if (candidate !== modelsToTry[0]) {
            // Surface a single info log when fallback succeeded so we can
            // see in production logs which model is actually serving.
            console.info(`parentAIProxy: succeeded with fallback model "${candidate}"`);
          }
          return { content };
        } catch (innerErr: any) {
          const innerCode = innerErr?.error?.code ?? innerErr?.code;
          const innerStatus = innerErr?.status ?? innerErr?.response?.status;
          // ONLY retry the next model on model_not_found / 404. Every other
          // error (rate limit, auth, invalid request) is real and should
          // surface immediately — retrying would just delay the truth.
          const shouldFallback = innerCode === "model_not_found" || innerStatus === 404;
          if (!shouldFallback) {
            throw innerErr;
          }
          console.warn(`parentAIProxy: model "${candidate}" not available — trying next in chain`);
          lastErr = innerErr;
        }
      }
      // Exhausted the chain — surface the last error to the outer catch.
      throw lastErr ?? new Error("All AI models in fallback chain returned not_found");
    } catch (error: any) {
      // Surface a SPECIFIC error code so the client can show a useful message
      // (and we can debug from production logs without poking around). Never
      // expose the OpenAI API key path, prompts, or raw error body to the
      // caller — only error code + a short safe message.
      const status = error?.status ?? error?.response?.status;
      const openaiCode = error?.error?.code ?? error?.code;
      console.error("parentAIProxy error:", {
        status, openaiCode,
        message: error?.message,
        type: error?.error?.type,
      });

      // Map common OpenAI failure modes to canonical Firebase HttpsError codes.
      // The codes are what FirebaseError.code becomes on the client (e.g.
      // "functions/resource-exhausted") so the UI can render targeted copy.
      if (status === 401 || openaiCode === "invalid_api_key") {
        throw new functions.https.HttpsError(
          "failed-precondition",
          "AI service is not configured correctly. Please contact support.",
        );
      }
      if (status === 429 || openaiCode === "rate_limit_exceeded" || openaiCode === "insufficient_quota") {
        throw new functions.https.HttpsError(
          "resource-exhausted",
          "AI service is at capacity right now — please try again in a minute.",
        );
      }
      if (status === 408 || openaiCode === "ETIMEDOUT" || openaiCode === "ECONNRESET") {
        throw new functions.https.HttpsError(
          "deadline-exceeded",
          "AI request timed out — please retry.",
        );
      }
      if (status && status >= 500) {
        throw new functions.https.HttpsError(
          "unavailable",
          "AI service is temporarily unavailable — please retry in a moment.",
        );
      }
      if (openaiCode === "model_not_found" || status === 404) {
        // The fallback chain was exhausted — every model returned not_found.
        // This usually means the OpenAI key is restricted to a tier that
        // doesn't include any of the fallback models. Operator action needed.
        throw new functions.https.HttpsError(
          "failed-precondition",
          "No AI model in the fallback chain is available to this OpenAI key. Please contact support.",
        );
      }
      throw new functions.https.HttpsError(
        "internal",
        `AI call failed${openaiCode ? ` (${openaiCode})` : ""}. Please retry.`,
      );
    }
  });


// ─── syncUserClaims ───────────────────────────────────────────────────────────
// Looks up the caller's email across role collections and writes
// Firebase custom claims { schoolId, role, branchId, schoolIds? } to the
// ID token. Frontend must call `auth.currentUser.getIdToken(true)` after.
//
// For parents with kids in multiple schools, schoolIds (array) is also set
// and the frontend can pass { schoolId: <chosen> } to pick one.
// ─────────────────────────────────────────────────────────────────────────────
export const syncUserClaims = functions
  .runWith({ timeoutSeconds: 30, memory: "256MB" })
  .https.onCall(async (data, context) => {
    requireAuth(context);
    const uid = context.auth!.uid;
    const email = (context.auth!.token.email || "").toLowerCase();
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

    // 5) Parent — may have kids in multiple schools. Collect ALL matching
    //    student records. Active school = caller-chosen (data.schoolId) if
    //    valid, otherwise the first by createdAt.
    const [byParentEmail, byStudentEmail] = await Promise.all([
      db.collection("students").where("parentEmail", "==", email).get(),
      db.collection("students").where("email", "==", email).get(),
    ]);
    const seen = new Set<string>();
    const candidates: any[] = [];
    for (const snap of [byParentEmail, byStudentEmail]) {
      snap.docs.forEach((doc) => {
        if (seen.has(doc.id)) return;
        seen.add(doc.id);
        candidates.push(doc.data());
      });
    }
    if (candidates.length > 0) {
      const schoolIds = Array.from(new Set(candidates.map((c) => c.schoolId).filter(Boolean)));
      const requestedSchoolId =
        typeof (data as any)?.schoolId === "string" ? (data as any).schoolId : null;
      const activeSchoolId =
        requestedSchoolId && schoolIds.includes(requestedSchoolId)
          ? requestedSchoolId
          : schoolIds[0];
      const activeRecord = candidates.find((c) => c.schoolId === activeSchoolId) || candidates[0];

      await auth.setCustomUserClaims(uid, {
        schoolId: activeSchoolId,
        schoolIds,
        role: "parent",
        branchId: activeRecord.branchId || null,
      });
      return {
        role: "parent",
        schoolId: activeSchoolId,
        schoolIds,
        branchId: activeRecord.branchId || null,
      };
    }

    // No role found — clear claims so stale ones don't leak.
    await auth.setCustomUserClaims(uid, null);
    throw new functions.https.HttpsError(
      "permission-denied",
      "No role found for this account. Contact your school administrator.",
    );
  });


// ─── branchId schema validator ────────────────────────────────────────────────
// Rejects tenant docs missing schoolId by QUARANTINING (not deleting).
// Auto-infers missing branchId by walking the enrollment / teacher chain.
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
  if (data.branchId) return data.branchId as string;

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

  if (data.teacherId) {
    const teach = await db.collection("teachers").doc(data.teacherId).get();
    const tBranch = teach.data()?.branchId;
    if (tBranch) return tBranch as string;
  }

  return null;
}

ENFORCED_COLLECTIONS.forEach((coll) => {
  exports[`enforceBranchId_${coll}`] = functions.firestore
    .document(`${coll}/{docId}`)
    .onWrite(async (change, context) => {
      const db = admin.firestore();
      const after = change.after.exists ? change.after.data() : null;
      if (!after) return null; // delete — nothing to validate

      // Already quarantined — don't recurse.
      if (after._quarantined === true) return null;

      // schoolId missing — QUARANTINE (do not delete — prevents silent data loss).
      if (!after.schoolId) {
        await db.collection("audit_logs").add({
          type: "schemaViolation",
          severity: "critical",
          collection: coll,
          docId: context.params.docId,
          uid: "system",
          reason: "missing schoolId",
          payload: after,
          ts: admin.firestore.FieldValue.serverTimestamp(),
        });
        await change.after.ref.update({
          _quarantined: true,
          _quarantineReason: "missing schoolId",
          _quarantinedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
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
          ts: admin.firestore.FieldValue.serverTimestamp(),
        });
      }

      return null;
    });
});


// ─── Audit logging ────────────────────────────────────────────────────────────
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

// Truncate large payloads to keep audit entries small. Uses UTF-8 bytes,
// not string length (fixed: multi-byte chars no longer miscounted).
function truncatePayload(obj: any, maxBytes = 1024): any {
  if (!obj) return null;
  const json = JSON.stringify(obj);
  if (Buffer.byteLength(json, "utf8") <= maxBytes) return obj;
  return { _truncated: true, preview: json.slice(0, maxBytes) };
}

function diffFields(before: any, after: any): string[] {
  if (!before || !after) return [];
  const all = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changed: string[] = [];
  for (const k of all) {
    if (k.startsWith("_")) continue;
    if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) changed.push(k);
  }
  return changed;
}

AUDITED_COLLECTIONS.forEach((coll) => {
  exports[`auditLog_${coll}`] = functions.firestore
    .document(`${coll}/{docId}`)
    .onWrite(async (change, context) => {
      const db = admin.firestore();
      const before = change.before.exists ? change.before.data() : null;
      const after  = change.after.exists  ? change.after.data()  : null;

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


// ─── aggregateSchoolStats ─────────────────────────────────────────────────────
// Streams docs through reducers — no full materialisation in RAM.
// Sequential scans to cap peak memory.
// ─────────────────────────────────────────────────────────────────────────────
const AGGREGATE_TTL_SECONDS = 5 * 60;
const ADMIN_PAGE_SIZE = 1000;
const ADMIN_MAX_DOCS  = 200_000;

async function adminStream<T>(
  ref: FirebaseFirestore.Query,
  onDoc: (d: FirebaseFirestore.QueryDocumentSnapshot) => void,
  label: string,
): Promise<number> {
  let cursor: FirebaseFirestore.QueryDocumentSnapshot | null = null;
  let count = 0;
  while (count < ADMIN_MAX_DOCS) {
    let q = ref.orderBy(admin.firestore.FieldPath.documentId()).limit(ADMIN_PAGE_SIZE);
    if (cursor) q = q.startAfter(cursor);
    const snap = await q.get();
    if (snap.empty) break;
    for (const d of snap.docs) {
      onDoc(d);
      count++;
    }
    if (snap.docs.length < ADMIN_PAGE_SIZE) break;
    cursor = snap.docs[snap.docs.length - 1];
  }
  if (count >= ADMIN_MAX_DOCS) {
    console.warn(`[aggregate] ${label} hit ADMIN_MAX_DOCS — archive old data.`);
  }
  return count;
}

export const aggregateSchoolStats = functions
  .runWith({ timeoutSeconds: 120, memory: "1GB" })
  .https.onCall(async (data, context) => {
    requireRole(context, new Set(["owner"]));
    const uid = context.auth!.uid;
    const force = !!(data as any)?.force;

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

    type BranchAgg = {
      students: Set<string>;
      att: { total: number; present: number };
      res: { total: number; passed: number };
      fees: { total: number; collected: number };
      teachers: number;
    };

    const branches: Array<{
      id: string; name: string; color: string;
      established: string; location: string;
    }> = [];
    const branchAgg = new Map<string, BranchAgg>();
    const teacherBranch = new Map<string, string>();
    const studentBranch = new Map<string, string>();
    const enrollmentBranch = new Map<string, string>();
    const palette = ["#1e3a8a", "#3b82f6", "#f59e0b", "#10b981", "#8b5cf6", "#ec4899"];

    // 1) Branch metadata — small collection, stream once.
    let bIdx = 0;
    await adminStream(
      db.collection("schools").doc(uid).collection("branches"),
      (d) => {
        const data = d.data();
        const id = (data.branchId || d.id) as string;
        branches.push({
          id,
          name: (data.name || data.schoolName || `Branch ${bIdx + 1}`) as string,
          color: data.color || palette[bIdx % palette.length],
          established: String(data.established || data.year || "N/A"),
          location: String(data.location || data.city || data.address || "—"),
        });
        branchAgg.set(id, {
          students: new Set(),
          att: { total: 0, present: 0 },
          res: { total: 0, passed: 0 },
          fees: { total: 0, collected: 0 },
          teachers: 0,
        });
        bIdx++;
      },
      `schools/${uid}/branches`,
    );

    // 2) Teachers — needed before students to resolve branch-by-teacher.
    await adminStream(
      db.collection("teachers").where("schoolId", "==", uid),
      (d) => {
        const t = d.data();
        const cid = t.branchId;
        if (cid && branchAgg.has(cid)) {
          branchAgg.get(cid)!.teachers++;
          teacherBranch.set(d.id, cid);
        }
      },
      "teachers",
    );

    // 3) Enrollments — resolves student→branch when student doc lacks branchId.
    await adminStream(
      db.collection("enrollments").where("schoolId", "==", uid),
      (d) => {
        const e = d.data();
        const sid = e.studentId as string;
        if (!sid || enrollmentBranch.has(sid)) return;
        const cid = (e.branchId as string) || teacherBranch.get(e.teacherId as string);
        if (cid) enrollmentBranch.set(sid, cid);
      },
      "enrollments",
    );

    // 4) Students — build studentBranch map.
    await adminStream(
      db.collection("students").where("schoolId", "==", uid),
      (d) => {
        const s = d.data();
        const cid = (s.branchId as string) || enrollmentBranch.get(d.id);
        if (cid && branchAgg.has(cid)) {
          branchAgg.get(cid)!.students.add(d.id);
          studentBranch.set(d.id, cid);
        }
      },
      "students",
    );

    // 5) Attendance rollup.
    await adminStream(
      db.collection("attendance").where("schoolId", "==", uid),
      (d) => {
        const a = d.data();
        const cid = studentBranch.get(a.studentId as string);
        if (!cid) return;
        const ag = branchAgg.get(cid)!;
        ag.att.total++;
        if (String(a.status ?? "").toLowerCase() === "present") ag.att.present++;
      },
      "attendance",
    );

    // 6) Results + test scores — fixed falsy-coercion bug (score of 0).
    const tallyResult = (r: any) => {
      const cid = studentBranch.get(r.studentId as string);
      if (!cid) return;
      const pct = typeof r.percentage === "number" ? r.percentage
                : typeof r.score === "number" ? r.score
                : null;
      if (pct === null) return;
      const ag = branchAgg.get(cid)!;
      ag.res.total++;
      if (pct >= 50) ag.res.passed++;
    };
    await adminStream(
      db.collection("results").where("schoolId", "==", uid),
      (d) => tallyResult(d.data()),
      "results",
    );
    await adminStream(
      db.collection("test_scores").where("schoolId", "==", uid),
      (d) => tallyResult(d.data()),
      "test_scores",
    );

    // 7) Fees.
    await adminStream(
      db.collection("fees").where("schoolId", "==", uid),
      (d) => {
        const f = d.data();
        const cid = studentBranch.get(f.studentId as string);
        if (!cid) return;
        const ag = branchAgg.get(cid)!;
        const amt  = f.amount || f.totalAmount || f.feeAmount || 0;
        const coll = f.paidAmount || f.collectedAmount || (f.status === "paid" ? amt : 0);
        ag.fees.total += amt;
        ag.fees.collected += coll;
      },
      "fees",
    );

    // Final per-branch numbers.
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

    const totalStudents = branchStats.reduce((s, b) => s + b.students, 0);
    const totalTeachers = branchStats.reduce((s, b) => s + b.teachers, 0);
    const avgAttendance = branchStats.length
      ? Math.round(branchStats.reduce((s, b) => s + b.attendance, 0) / branchStats.length) : 0;
    const avgPassRate = branchStats.length
      ? Math.round(branchStats.reduce((s, b) => s + b.passRate, 0) / branchStats.length) : 0;
    const avgAhi = branchStats.length
      ? Math.round(branchStats.reduce((s, b) => s + b.ahi, 0) / branchStats.length) : 0;

    const result = {
      branches: branchStats,
      totals: { totalStudents, totalTeachers, avgAttendance, avgPassRate, avgAhi },
      computedAt: Date.now(),
      fromCache: false,
    };

    try {
      await db.collection("owner_stats_cache").doc(uid).set(result);
    } catch (err) {
      console.warn("[aggregate] cache write failed:", err);
    }

    return result;
  });


// ─────────────────────────────────────────────────────────────────────────────
// EDULLENT LEADERBOARD — Phase 4 Cloud Functions
// All four functions live in asia-south1 (closer to the Indian student base)
// while the existing functions stay in us-central1. Mixed-region is fine for
// a single project.
// ─────────────────────────────────────────────────────────────────────────────
import { runLeaderboardCron, processClass } from "./leaderboard/cron";
import { generateInsightsForLeaderboard } from "./leaderboard/insights";
import { runActionTrackerCron } from "./leaderboard/actions";
import { manualTriggerImpl } from "./leaderboard/manualTrigger";
import { seedSampleDataImpl } from "./leaderboard/seedSampleData";
import { REGION, SCHEDULE, TIMEZONE, RUNTIME } from "./leaderboard/constants";
import type { LeaderboardDoc } from "./leaderboard/types";

// 1️⃣  Weekly leaderboard cron — Mon 02:00 IST
export const calculateWeeklyLeaderboard = functions
  .region(REGION)
  .runWith({ memory: RUNTIME.cron.memory, timeoutSeconds: RUNTIME.cron.timeoutSeconds })
  .pubsub.schedule(SCHEDULE.leaderboardCron)
  .timeZone(TIMEZONE)
  .onRun(async () => {
    await runLeaderboardCron();
  });

// 2️⃣  Insights generator — fires when a leaderboard doc is written
export const generateInsights = functions
  .region(REGION)
  .runWith({
    secrets: [openaiApiKey],
    memory: RUNTIME.trigger.memory,
    timeoutSeconds: RUNTIME.trigger.timeoutSeconds,
  })
  .firestore.document("leaderboards/{classKey}/weeks/{weekId}")
  .onWrite(async (change) => {
    // Skip delete events — nothing to generate insights from.
    if (!change.after.exists) return;
    const lb = change.after.data() as LeaderboardDoc | undefined;
    if (!lb || !lb.rankings || lb.rankings.length === 0) return;
    await generateInsightsForLeaderboard(lb, openaiApiKey.value());
  });

// 3️⃣  Daily action progress auto-tracker — every 06:00 IST
export const updateActionProgress = functions
  .region(REGION)
  .runWith({ memory: RUNTIME.cron.memory, timeoutSeconds: RUNTIME.cron.timeoutSeconds })
  .pubsub.schedule(SCHEDULE.actionCheckCron)
  .timeZone(TIMEZONE)
  .onRun(async () => {
    await runActionTrackerCron();
  });

// 4️⃣  Admin manual trigger — onCall HTTPS, owner/principal only
export const triggerLeaderboardManually = functions
  .region(REGION)
  .runWith({
    secrets: [openaiApiKey],
    memory: RUNTIME.callable.memory,
    timeoutSeconds: RUNTIME.callable.timeoutSeconds,
  })
  .https.onCall(async (data, context) => {
    requireAuth(context);
    try {
      return await manualTriggerImpl(
        data,
        (context.auth?.token ?? {}) as { role?: string },
        openaiApiKey.value(),
      );
    } catch (err: any) {
      const msg = err?.message || String(err);
      if (msg.startsWith("permission-denied")) {
        throw new functions.https.HttpsError("permission-denied", msg);
      }
      if (msg.startsWith("invalid-argument")) {
        throw new functions.https.HttpsError("invalid-argument", msg);
      }
      console.error("triggerLeaderboardManually error:", err);
      throw new functions.https.HttpsError("internal", "manual trigger failed");
    }
  });

// Exposed so processClass can be called from a test harness if added later.
export { processClass as _processClassForTesting };

// 5️⃣  Seed realistic sample data into source collections (testing helper)
export const seedSampleData = functions
  .region(REGION)
  .runWith({
    memory: RUNTIME.callable.memory,
    timeoutSeconds: RUNTIME.callable.timeoutSeconds,
  })
  .https.onCall(async (data, context) => {
    requireAuth(context);
    try {
      return await seedSampleDataImpl(
        data,
        (context.auth?.token ?? {}) as { role?: string; schoolId?: string; uid?: string },
      );
    } catch (err: any) {
      const msg = err?.message || String(err);
      if (msg.startsWith("permission-denied")) {
        throw new functions.https.HttpsError("permission-denied", msg);
      }
      if (msg.startsWith("invalid-argument")) {
        throw new functions.https.HttpsError("invalid-argument", msg);
      }
      console.error("seedSampleData error:", err);
      throw new functions.https.HttpsError("internal", msg);
    }
  });