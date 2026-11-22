
const ROLES = new Set(["admin", "student", "teacher", "parent"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const val = (env, key) =>
  String(env[key] || "").trim().replace(/^["']|["']$/g, "").trim();

const baseUrl = env =>
  val(env, "SUPABASE_URL").replace(/\/+$/, "").replace(/\/(rest|auth)\/v1$/, "");

async function sb(env, path, options = {}) {
  const {
    method = "GET",
    token,
    service = false,
    body,
    prefer
  } = options;

  const key = val(env, service ? "SUPABASE_SERVICE_ROLE_KEY" : "SUPABASE_ANON_KEY");

  const response = await fetch(baseUrl(env) + path, {
    method,
    headers: {
      apikey: key,
      Authorization: "Bearer " + (token || key),
      "Content-Type": "application/json",
      ...(prefer ? { Prefer: prefer } : {})
    },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });

  const raw = await response.text();
  let json = null;

  try {
    json = raw ? JSON.parse(raw) : null;
  } catch {}

  return { ok: response.ok, status: response.status, json };
}

function decodeJwt(token) {
  try {
    const part = token.split(".")[1];
    const base64 = part.replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(base64));
  } catch {
    throw new HttpError(401, "Invalid session token");
  }
}

async function authenticate(env, token) {
  if (!token) throw new HttpError(401, "Sign in first");

  const result = await sb(env, "/auth/v1/user", { token });

  if (!result.ok || !result.json?.id) {
    throw new HttpError(401, "Invalid login session");
  }

  const claims = decodeJwt(token);

  if (!UUID.test(claims.session_id || "")) {
    throw new HttpError(401, "Invalid session ID");
  }

  return {
    userId: result.json.id,
    sessionId: claims.session_id,
    claims
  };
}

async function getActiveProfile(env, auth) {
  const profileId = auth.claims.active_profile_id;

  if (!UUID.test(profileId || "")) {
    throw new HttpError(403, "Select a profile first");
  }

  const mapping = await sb(
    env,
    `/rest/v1/user_profile_links?auth_user_id=eq.${auth.userId}&profile_id=eq.${profileId}&select=profile_id`,
    { service: true }
  );

  if (!mapping.ok || !mapping.json?.length) {
    throw new HttpError(403, "Profile is not linked to this account");
  }

  const result = await sb(
    env,
    `/rest/v1/profiles?id=eq.${profileId}&select=id,institute_id,full_name,role`,
    { service: true }
  );

  if (!result.ok || !result.json?.length) {
    throw new HttpError(403, "Profile not found");
  }

  return result.json[0];
}

async function requireAdmin(env, auth) {
  const profile = await getActiveProfile(env, auth);

  if (profile.role !== "admin" || !profile.institute_id) {
    throw new HttpError(403, "Admins only");
  }

  return profile;
}

async function findUserByEmail(env, email) {
  for (let page = 1; page <= 10; page++) {
    const result = await sb(
      env,
      `/auth/v1/admin/users?page=${page}&per_page=1000`,
      { service: true }
    );

    if (!result.ok) throw new HttpError(502, "Could not look up users");

    const users = result.json?.users || [];
    const found = users.find(
      user => (user.email || "").toLowerCase() === email
    );

    if (found) return found;
    if (users.length < 1000) break;
  }

  return null;
}
async function createProfile(env, admin, body) {
  const name = String(body.full_name || "").trim();
  const email = String(body.email || "").trim().toLowerCase();
  const role = body.role;

  if (!ROLES.has(role)) throw new HttpError(400, "Invalid role");
  if (role === "admin") throw new HttpError(400, "Admin profiles cannot be created here");
  if (name.length < 2 || name.length > 100) {
    throw new HttpError(400, "Full name must be 2-100 characters");
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 200) {
    throw new HttpError(400, "Invalid email");
  }

  const batchId = body.batch_id || null;

  if (batchId && !UUID.test(batchId)) {
    throw new HttpError(400, "Invalid batch");
  }

  if (role === "student" && batchId) {
    const batch = await sb(
      env,
      `/rest/v1/batches?id=eq.${batchId}&institute_id=eq.${admin.institute_id}&select=id`,
      { service: true }
    );

    if (!batch.ok || !batch.json?.length) {
      throw new HttpError(400, "Batch not found in your institute");
    }
  }

  let user = await findUserByEmail(env, email);

  if (user) {
    const existing = await sb(
      env,
      `/rest/v1/user_profile_links?auth_user_id=eq.${user.id}&select=profile_id`,
      { service: true }
    );

    if (!existing.ok) throw new HttpError(500, "Could not verify existing profiles");

    if (existing.json?.length) {
      const ids = existing.json.map(x => x.profile_id).join(",");
      const profiles = await sb(
        env,
        `/rest/v1/profiles?id=in.(${ids})&select=institute_id`,
        { service: true }
      );

      if (
        !profiles.ok ||
        profiles.json.length !== existing.json.length ||
        profiles.json.some(p => p.institute_id !== admin.institute_id)
      ) {
        throw new HttpError(403, "Account belongs to another institute");
      }
    }
  } else {
    const invite = await sb(env, "/auth/v1/invite", {
      method: "POST",
      service: true,
      body: { email, data: { full_name: name } }
    });

    if (!invite.ok || !invite.json?.id) {
      throw new HttpError(502, "Could not invite user");
    }

    user = invite.json;
  }

  const profileId = crypto.randomUUID();

  const profile = await sb(env, "/rest/v1/profiles", {
    method: "POST",
    service: true,
    prefer: "return=minimal",
    body: {
      id: profileId,
      institute_id: admin.institute_id,
      full_name: name,
      role
    }
  });

  if (!profile.ok) throw new HttpError(500, "Could not create profile");

  const mapping = await sb(env, "/rest/v1/user_profile_links", {
    method: "POST",
    service: true,
    prefer: "return=minimal",
    body: { auth_user_id: user.id, profile_id: profileId }
  });

  if (!mapping.ok) {
    await sb(env, `/rest/v1/profiles?id=eq.${profileId}`, {
      method: "DELETE",
      service: true
    });
    throw new HttpError(500, "Could not link profile to account");
  }

  if (role === "student") {
    const student = await sb(env, "/rest/v1/students", {
      method: "POST",
      service: true,
      prefer: "return=minimal",
      body: {
        profile_id: profileId,
        institute_id: admin.institute_id,
        batch_id: batchId,
        admission_number: body.admission_number
          ? String(body.admission_number).trim().slice(0, 50)
          : null
      }
    });

    if (!student.ok) {
      await sb(env, `/rest/v1/user_profile_links?profile_id=eq.${profileId}`, {
        method: "DELETE",
        service: true
      });
      await sb(env, `/rest/v1/profiles?id=eq.${profileId}`, {
        method: "DELETE",
        service: true
      });
      throw new HttpError(500, "Could not create student record");
    }
  }

  return { id: profileId, auth_user_id: user.id, role };
}

async function selectProfile(env, auth, body) {
  const profileId = String(body.profile_id || "");

  if (!UUID.test(profileId)) throw new HttpError(400, "Invalid profile ID");

  const mapping = await sb(
    env,
    `/rest/v1/user_profile_links?auth_user_id=eq.${auth.userId}&profile_id=eq.${profileId}&select=profile_id`,
    { service: true }
  );

  if (!mapping.ok || !mapping.json?.length) {
    throw new HttpError(403, "This profile is not linked to your account");
  }

  const profile = await sb(
    env,
    `/rest/v1/profiles?id=eq.${profileId}&select=id,institute_id,full_name,role`,
    { service: true }
  );

  if (!profile.ok || !profile.json?.length) {
    throw new HttpError(404, "Profile not found");
  }

  const session = await sb(env, "/rest/v1/active_profile_sessions?on_conflict=session_id", {
    method: "POST",
    service: true,
    prefer: "resolution=merge-duplicates,return=minimal",
    body: {
      session_id: auth.sessionId,
      auth_user_id: auth.userId,
      profile_id: profileId,
      updated_at: new Date().toISOString()
    }
  });

  if (!session.ok) throw new HttpError(500, "Could not activate profile");

  return profile.json[0];
}

/* ---------------- USER DELETE ---------------- */

async function deleteUserProfile(env, admin, profileId) {
  if (!UUID.test(profileId || "")) {
    throw new HttpError(400, "Invalid profile ID");
  }

  const profileResult = await sb(
    env,
    `/rest/v1/profiles?id=eq.${profileId}&institute_id=eq.${admin.institute_id}&select=id,role`,
    { service: true }
  );

  if (!profileResult.ok || !profileResult.json?.length) {
    throw new HttpError(404, "User profile not found in your institute");
  }

  const target = profileResult.json[0];

  if (!["student", "parent", "teacher"].includes(target.role)) {
    throw new HttpError(403, "Only students, parents and teachers can be deleted");
  }

  const links = await sb(
    env,
    `/rest/v1/user_profile_links?profile_id=eq.${profileId}&select=auth_user_id`,
    { service: true }
  );

  if (!links.ok) throw new HttpError(500, "Could not find linked login account");

  const authIds = [...new Set((links.json || []).map(x => x.auth_user_id))];

  if (target.role === "student") {
    const student = await sb(
      env,
      `/rest/v1/students?profile_id=eq.${profileId}`,
      { method: "DELETE", service: true }
    );

    if (!student.ok) throw new HttpError(500, "Could not remove student record");
  }

  const sessionDelete = await sb(
    env,
    `/rest/v1/active_profile_sessions?profile_id=eq.${profileId}`,
    { method: "DELETE", service: true }
  );

  if (!sessionDelete.ok) {
    throw new HttpError(500, "Could not remove active profile sessions");
  }

  const linkDelete = await sb(
    env,
    `/rest/v1/user_profile_links?profile_id=eq.${profileId}`,
    { method: "DELETE", service: true }
  );

  if (!linkDelete.ok) throw new HttpError(500, "Could not remove profile link");

  const profileDelete = await sb(
    env,
    `/rest/v1/profiles?id=eq.${profileId}&institute_id=eq.${admin.institute_id}`,
    { method: "DELETE", service: true }
  );

  if (!profileDelete.ok) {
    throw new HttpError(
      409,
      "Profile has related records. Related database records must be handled before deletion."
    );
  }

  for (const authId of authIds) {
    const remaining = await sb(
      env,
      `/rest/v1/user_profile_links?auth_user_id=eq.${authId}&select=profile_id`,
      { service: true }
    );

    if (!remaining.ok) {
      throw new HttpError(500, "Could not verify remaining linked profiles");
    }

    if (!remaining.json?.length) {
      const deleted = await sb(
        env,
        `/auth/v1/admin/users/${authId}`,
        { method: "DELETE", service: true }
      );

      if (!deleted.ok) {
        throw new HttpError(502, "Profile deleted, but login account deletion failed");
      }
    }
  }

  return { id: profileId, deleted: true };
        }
/* ---------------- MANAGEMENT MODULES ---------------- */

const MODULES = {
  fees: {
    table: "fees",
    fields: [
      "student_profile_id",
      "total_amount",
      "paid_amount",
      "due_date",
      "status",
      "description"
    ],
    required: ["student_profile_id", "total_amount"],
    order: "created_at.desc"
  },
  expenses: {
    table: "expenses",
    fields: ["title", "category", "amount", "expense_date", "description"],
    required: ["title", "category", "amount", "expense_date"],
    order: "expense_date.desc"
  },
  events: {
    table: "events",
    fields: [
      "title",
      "description",
      "event_date",
      "event_time",
      "venue",
      "poster_url"
    ],
    required: ["title", "event_date"],
    order: "event_date.desc"
  }
};

function cleanModuleBody(module, body, partial = false) {
  const config = MODULES[module];
  const result = {};

  for (const field of config.fields) {
    if (body[field] !== undefined) result[field] = body[field];
  }

  if (!partial) {
    for (const field of config.required) {
      if (
        result[field] === undefined ||
        result[field] === null ||
        result[field] === ""
      ) {
        throw new HttpError(400, `${field} is required`);
      }
    }
  }

  if (module === "fees") {
    if (result.student_profile_id && !UUID.test(result.student_profile_id)) {
      throw new HttpError(400, "Invalid student profile ID");
    }

    for (const field of ["total_amount", "paid_amount"]) {
      if (
        result[field] !== undefined &&
        (!Number.isFinite(Number(result[field])) || Number(result[field]) < 0)
      ) {
        throw new HttpError(400, `Invalid ${field}`);
      }
    }

    if (
      result.total_amount !== undefined &&
      Number(result.total_amount) <= 0
    ) {
      throw new HttpError(400, "Total amount must be greater than zero");
    }

    if (
      result.paid_amount !== undefined &&
      result.total_amount !== undefined &&
      Number(result.paid_amount) > Number(result.total_amount)
    ) {
      throw new HttpError(400, "Paid amount cannot exceed total amount");
    }
  }

  if (
    module === "expenses" &&
    result.amount !== undefined &&
    (!Number.isFinite(Number(result.amount)) || Number(result.amount) <= 0)
  ) {
    throw new HttpError(400, "Expense amount must be greater than zero");
  }

  if (
    module === "events" &&
    result.poster_url &&
    !/^https?:\/\//i.test(result.poster_url)
  ) {
    throw new HttpError(400, "Poster URL must be a valid HTTP or HTTPS URL");
  }

  return result;
}

async function verifyStudent(env, admin, profileId) {
  const result = await sb(
    env,
    `/rest/v1/profiles?id=eq.${profileId}&institute_id=eq.${admin.institute_id}&role=eq.student&select=id`,
    { service: true }
  );

  if (!result.ok || !result.json?.length) {
    throw new HttpError(400, "Student not found in your institute");
  }
}

async function listModule(env, admin, module) {
  const config = MODULES[module];

  const result = await sb(
    env,
    `/rest/v1/${config.table}?institute_id=eq.${admin.institute_id}&select=*&order=${config.order}`,
    { service: true }
  );

  if (!result.ok) throw new HttpError(500, `Could not load ${module}`);

  return result.json || [];
}

async function createModule(env, admin, module, body) {
  const config = MODULES[module];
  const data = cleanModuleBody(module, body);

  if (module === "fees") {
    await verifyStudent(env, admin, data.student_profile_id);

    data.paid_amount = Number(data.paid_amount || 0);
    data.total_amount = Number(data.total_amount);

    data.status =
      data.paid_amount >= data.total_amount
        ? "paid"
        : data.paid_amount > 0
          ? "partial"
          : "pending";
  }

  if (module === "expenses") {
    data.amount = Number(data.amount);
  }

  const result = await sb(env, `/rest/v1/${config.table}`, {
    method: "POST",
    service: true,
    prefer: "return=representation",
    body: {
      ...data,
      institute_id: admin.institute_id
    }
  });

  if (!result.ok) throw new HttpError(500, `Could not create ${module}`);

  return result.json?.[0] || { created: true };
}

async function updateModule(env, admin, module, id, body) {
  if (!UUID.test(id || "")) {
    throw new HttpError(400, "Invalid record ID");
  }

  const config = MODULES[module];
  const data = cleanModuleBody(module, body, true);

  if (!Object.keys(data).length) {
    throw new HttpError(400, "No valid fields to update");
  }

  if (module === "fees") {
    if (data.student_profile_id) {
      await verifyStudent(env, admin, data.student_profile_id);
    }

    if (data.total_amount !== undefined) {
      data.total_amount = Number(data.total_amount);
    }

    if (data.paid_amount !== undefined) {
      data.paid_amount = Number(data.paid_amount);
    }

    if (
      data.total_amount !== undefined ||
      data.paid_amount !== undefined
    ) {
      const old = await sb(
        env,
        `/rest/v1/fees?id=eq.${id}&institute_id=eq.${admin.institute_id}&select=total_amount,paid_amount`,
        { service: true }
      );

      if (!old.ok || !old.json?.length) {
        throw new HttpError(404, "Fee record not found");
      }

      const total =
        data.total_amount ?? Number(old.json[0].total_amount);

      const paid =
        data.paid_amount ?? Number(old.json[0].paid_amount);

      if (paid > total) {
        throw new HttpError(400, "Paid amount cannot exceed total amount");
      }

      data.status =
        paid >= total ? "paid" : paid > 0 ? "partial" : "pending";
    }
  }

  if (module === "expenses" && data.amount !== undefined) {
    data.amount = Number(data.amount);
  }

  const result = await sb(
    env,
    `/rest/v1/${config.table}?id=eq.${id}&institute_id=eq.${admin.institute_id}`,
    {
      method: "PATCH",
      service: true,
      prefer: "return=representation",
      body: data
    }
  );

  if (!result.ok) throw new HttpError(500, `Could not update ${module}`);
  if (!result.json?.length) throw new HttpError(404, "Record not found");

  return result.json[0];
}

async function deleteModule(env, admin, module, id) {
  if (!UUID.test(id || "")) {
    throw new HttpError(400, "Invalid record ID");
  }

  const config = MODULES[module];

  const result = await sb(
    env,
    `/rest/v1/${config.table}?id=eq.${id}&institute_id=eq.${admin.institute_id}`,
    {
      method: "DELETE",
      service: true,
      prefer: "return=representation"
    }
  );

  if (!result.ok) throw new HttpError(500, `Could not delete ${module}`);
  if (!result.json?.length) throw new HttpError(404, "Record not found");

  return { id, deleted: true };
}

/* ---------------- FEE PAYMENT HISTORY ---------------- */

async function listPayments(env, admin, feeId) {
  if (!UUID.test(feeId || "")) {
    throw new HttpError(400, "Invalid fee ID");
  }

  const fee = await sb(
    env,
    `/rest/v1/fees?id=eq.${feeId}&institute_id=eq.${admin.institute_id}&select=id`,
    { service: true }
  );

  if (!fee.ok || !fee.json?.length) {
    throw new HttpError(404, "Fee record not found");
  }

  const result = await sb(
    env,
    `/rest/v1/fee_payments?fee_id=eq.${feeId}&institute_id=eq.${admin.institute_id}&select=*&order=payment_date.desc`,
    { service: true }
  );

  if (!result.ok) throw new HttpError(500, "Could not load payment history");

  return result.json || [];
}

async function addPayment(env, admin, feeId, body) {
  if (!UUID.test(feeId || "")) {
    throw new HttpError(400, "Invalid fee ID");
  }

  const amount = Number(body.amount);

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new HttpError(400, "Enter a valid payment amount");
  }

  const feeResult = await sb(
    env,
    `/rest/v1/fees?id=eq.${feeId}&institute_id=eq.${admin.institute_id}&select=*`,
    { service: true }
  );

  if (!feeResult.ok || !feeResult.json?.length) {
    throw new HttpError(404, "Fee record not found");
  }

  const fee = feeResult.json[0];
  const total = Number(fee.total_amount);
  const paid = Number(fee.paid_amount || 0);

  if (paid + amount > total) {
    throw new HttpError(400, "Payment exceeds pending fees");
  }

  const newPaid = paid + amount;

  const status =
    newPaid >= total ? "paid" : "partial";

  const payment = await sb(env, "/rest/v1/fee_payments", {
    method: "POST",
    service: true,
    prefer: "return=representation",
    body: {
      fee_id: feeId,
      institute_id: admin.institute_id,
      student_profile_id: fee.student_profile_id,
      amount,
      payment_date:
        body.payment_date || new Date().toISOString().slice(0, 10),
      payment_method: body.payment_method || "other",
      note: body.note || null
    }
  });

  if (!payment.ok) {
    throw new HttpError(500, "Could not save payment");
  }

  const update = await sb(
    env,
    `/rest/v1/fees?id=eq.${feeId}&institute_id=eq.${admin.institute_id}`,
    {
      method: "PATCH",
      service: true,
      prefer: "return=minimal",
      body: {
        paid_amount: newPaid,
        status
      }
    }
  );

  if (!update.ok) {
    throw new HttpError(500, "Payment saved, but fee balance update failed");
  }

  return payment.json?.[0] || { saved: true };
    }
/* ---------------- MAIN REQUEST HANDLER ---------------- */

function corsHeaders(request, env) {
  const allowed = val(env, "ALLOWED_ORIGIN")
    .split(",")
    .map(x => x.trim())
    .filter(Boolean);

  const origin = request.headers.get("Origin") || "";

  return {
    "Access-Control-Allow-Origin":
      allowed.includes(origin) ? origin : allowed[0] || "*",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
}

function jsonResponse(data, status, headers) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...headers,
      "Content-Type": "application/json"
    }
  });
}

function getBearerToken(request) {
  const header = request.headers.get("Authorization") || "";
  return header.startsWith("Bearer ") ? header.slice(7) : "";
}

function readRoute(path, pattern) {
  const match = path.match(pattern);
  return match ? decodeURIComponent(match[1]) : null;
}

async function handleRequest(request, env) {
  const headers = corsHeaders(request, env);

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }

  try {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const method = request.method;

    if (path === "/api/health" && method === "GET") {
      const missing = [
        "SUPABASE_URL",
        "SUPABASE_ANON_KEY",
        "SUPABASE_SERVICE_ROLE_KEY"
      ].filter(key => !val(env, key));

      return jsonResponse({
        ok: missing.length === 0,
        data: { missing }
      }, missing.length ? 500 : 200, headers);
    }

    const auth = await authenticate(env, getBearerToken(request));

    let body = {};

    if (["POST", "PATCH", "PUT"].includes(method)) {
      try {
        body = await request.json();
      } catch {
        throw new HttpError(400, "Invalid JSON body");
      }
    }

    /* PROFILE SELECTION */

    if (path === "/api/select-profile" && method === "POST") {
      const profile = await selectProfile(env, auth, body);

      return jsonResponse({
        ok: true,
        data: profile
      }, 200, headers);
    }

    /* ADMIN USER MANAGEMENT */

    if (path === "/api/users" && method === "POST") {
      const admin = await requireAdmin(env, auth);
      const result = await createProfile(env, admin, body);

      return jsonResponse({
        ok: true,
        data: result
      }, 201, headers);
    }

    const deleteUserId = readRoute(path, /^\/api\/users\/([^/]+)$/);

    if (deleteUserId && method === "DELETE") {
      const admin = await requireAdmin(env, auth);
      const result = await deleteUserProfile(env, admin, deleteUserId);

      return jsonResponse({
        ok: true,
        data: result
      }, 200, headers);
    }

    /* ALL REMAINING MANAGEMENT ROUTES REQUIRE ADMIN */

    const admin = await requireAdmin(env, auth);

    /* FEE PAYMENTS */

    const paymentFeeId = readRoute(
      path,
      /^\/api\/fees\/([^/]+)\/payments$/
    );

    if (paymentFeeId && method === "GET") {
      const result = await listPayments(env, admin, paymentFeeId);

      return jsonResponse({
        ok: true,
        data: result
      }, 200, headers);
    }

    if (paymentFeeId && method === "POST") {
      const result = await addPayment(env, admin, paymentFeeId, body);

      return jsonResponse({
        ok: true,
        data: result
      }, 201, headers);
    }

    /* FEES, EXPENSES, EVENTS */

    const match = path.match(/^\/api\/(fees|expenses|events)(?:\/([^/]+))?$/);

    if (match) {
      const module = match[1];
      const id = match[2] ? decodeURIComponent(match[2]) : null;

      if (!id && method === "GET") {
        const result = await listModule(env, admin, module);

        return jsonResponse({
          ok: true,
          data: result
        }, 200, headers);
      }

      if (!id && method === "POST") {
        const result = await createModule(env, admin, module, body);

        return jsonResponse({
          ok: true,
          data: result
        }, 201, headers);
      }

      if (id && method === "PATCH") {
        const result = await updateModule(env, admin, module, id, body);

        return jsonResponse({
          ok: true,
          data: result
        }, 200, headers);
      }

      if (id && method === "DELETE") {
        const result = await deleteModule(env, admin, module, id);

        return jsonResponse({
          ok: true,
          data: result
        }, 200, headers);
      }
    }

    throw new HttpError(404, "API route not found");

  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;

    return jsonResponse({
      ok: false,
      error: error.message || "Internal server error"
    }, status, headers);
  }
}

export default {
  async fetch(request, env) {
    return handleRequest(request, env);
  }
};
