
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

  const result = await sb(
    env,
    "/rest/v1/rpc/admin_delete_profile",
    {
      method: "POST",
      service: true,
      body: {
        p_profile_id: profileId,
        p_institute_id: admin.institute_id
      }
    }
  );

  if (!result.ok) {
    const message =
      result.json?.message ||
      result.json?.details ||
      "Could not safely delete profile";

    throw new HttpError(409, message);
  }

  const authIds = result.json?.auth_user_ids || [];
  const deletedAccounts = [];

  for (const authId of authIds) {
    const remaining = await sb(
      env,
      `/rest/v1/user_profile_links?auth_user_id=eq.${authId}&select=profile_id`,
      { service: true }
    );

    if (!remaining.ok) {
      throw new HttpError(
        500,
        "Profile deleted, but remaining account links could not be checked"
      );
    }

    if (!remaining.json?.length) {
      const deleted = await sb(
        env,
        `/auth/v1/admin/users/${authId}`,
        {
          method: "DELETE",
          service: true
        }
      );

      if (!deleted.ok) {
        throw new HttpError(
          502,
          "Profile deleted, but login account deletion failed"
        );
      }

      deletedAccounts.push(authId);
    }
  }

  return {
    id: profileId,
    deleted: true,
    deletedAccounts
  };
}

/* ---------------- MANAGEMENT MODULES ---------------- */

const MODULES = {
  fees: {
    table: "fees",
    order: "created_at.desc"
  },
  expenses: {
    table: "expenses",
    order: "expense_date.desc"
  },
  events: {
    table: "events",
    order: "event_date.desc"
  }
};

function cleanModuleBody(module, body, partial = false) {
  const fields = {
    fees: ["student_id", "amount", "due_date"],
    expenses: ["title", "category", "amount", "expense_date", "description"],
    events: ["title", "description", "event_date", "event_time", "venue", "poster_url"]
  };

  const required = {
    fees: ["student_id", "amount"],
    expenses: ["title", "category", "amount", "expense_date"],
    events: ["title", "event_date"]
  };

  const data = {};

  for (const field of fields[module]) {
    if (body[field] !== undefined) data[field] = body[field];
  }

  if (!partial) {
    for (const field of required[module]) {
      if (data[field] === undefined || data[field] === null || data[field] === "") {
        throw new HttpError(400, `${field} is required`);
      }
    }
  }

  if (module === "fees") {
    if (data.student_id && !UUID.test(data.student_id)) {
      throw new HttpError(400, "Invalid student ID");
    }

    if (
      data.amount !== undefined &&
      (!Number.isFinite(Number(data.amount)) || Number(data.amount) <= 0)
    ) {
      throw new HttpError(400, "Invalid fee amount");
    }

    if (data.amount !== undefined) data.amount = Number(data.amount);
  }

  if (module === "expenses") {
    if (
      data.amount !== undefined &&
      (!Number.isFinite(Number(data.amount)) || Number(data.amount) <= 0)
    ) {
      throw new HttpError(400, "Invalid expense amount");
    }

    if (data.amount !== undefined) data.amount = Number(data.amount);
  }

  if (
    module === "events" &&
    data.poster_url &&
    !/^https?:\/\//i.test(data.poster_url)
  ) {
    throw new HttpError(400, "Invalid poster URL");
  }

  return data;
}

async function verifyStudent(env, admin, studentId) {
  const result = await sb(
    env,
    `/rest/v1/students?id=eq.${studentId}&institute_id=eq.${admin.institute_id}&select=id`,
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
    await verifyStudent(env, admin, data.student_id);
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

  if (module === "fees" && data.student_id) {
    await verifyStudent(env, admin, data.student_id);
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


/* ---------------- SCOPING HELPERS (students, parents, exams, results) ---------------- */

const inList = ids => `in.(${ids.join(",")})`;
const detail = r => r?.json?.message || r?.json?.details || r?.json?.hint || "";

async function restGet(env, path, what) {
  const r = await sb(env, path, { service: true });
  if (!r.ok) {
    throw new HttpError(500, `Could not load ${what}${detail(r) ? ": " + detail(r) : ""}`);
  }
  return r.json || [];
}

async function insertRow(env, table, row, instituteId) {
  let r = await sb(env, `/rest/v1/${table}`, {
    method: "POST",
    service: true,
    prefer: "return=representation",
    body: { ...row, institute_id: instituteId }
  });
  if (!r.ok && /institute_id/i.test(detail(r))) {
    r = await sb(env, `/rest/v1/${table}`, {
      method: "POST",
      service: true,
      prefer: "return=representation",
      body: row
    });
  }
  if (!r.ok) {
    throw new HttpError(500, `Could not save ${table}${detail(r) ? ": " + detail(r) : ""}`);
  }
  return r.json?.[0] || { created: true };
}

async function teacherBatchIds(env, p) {
  const rows = await restGet(
    env,
    `/rest/v1/teacher_batch_assignments?teacher_profile_id=eq.${p.id}&select=batch_id`,
    "assigned batches"
  );
  return rows.map(x => x.batch_id).filter(Boolean);
}

async function childStudentIds(env, p) {
  const rows = await restGet(
    env,
    `/rest/v1/parent_student_links?parent_profile_id=eq.${p.id}&select=student_id`,
    "linked children"
  );
  return rows.map(x => x.student_id).filter(Boolean);
}

// null = admin (everything in the institute); otherwise an array of student ids this profile may see
async function visibleStudentIds(env, p) {
  if (p.role === "admin") return null;

  if (p.role === "student") {
    const rows = await restGet(
      env,
      `/rest/v1/students?profile_id=eq.${p.id}&institute_id=eq.${p.institute_id}&select=id`,
      "student record"
    );
    return rows.map(x => x.id);
  }

  if (p.role === "parent") return childStudentIds(env, p);

  if (p.role === "teacher") {
    const batches = await teacherBatchIds(env, p);
    if (!batches.length) return [];
    const rows = await restGet(
      env,
      `/rest/v1/students?institute_id=eq.${p.institute_id}&batch_id=${inList(batches)}&select=id`,
      "students"
    );
    return rows.map(x => x.id);
  }

  return [];
}

// null = admin (all batches in the institute); otherwise an array of batch ids
async function visibleBatchIds(env, p) {
  if (p.role === "admin") return null;
  if (p.role === "teacher") return teacherBatchIds(env, p);

  const ids = await visibleStudentIds(env, p);
  if (!ids.length) return [];
  const rows = await restGet(
    env,
    `/rest/v1/students?institute_id=eq.${p.institute_id}&id=${inList(ids)}&select=batch_id`,
    "batches"
  );
  return [...new Set(rows.map(x => x.batch_id).filter(Boolean))];
}

async function listBatches(env, p) {
  return restGet(
    env,
    `/rest/v1/batches?institute_id=eq.${p.institute_id}&select=id,name&order=name.asc`,
    "batches"
  );
}

async function createBatch(env, admin, body) {
  const name = String(body.name || "").trim();
  if (name.length < 2 || name.length > 100) {
    throw new HttpError(400, "Batch name must be 2-100 characters");
  }
  return insertRow(env, "batches", { name }, admin.institute_id);
}

async function listStudents(env, p) {
  const ids = await visibleStudentIds(env, p);
  if (ids && !ids.length) return [];

  let path =
    `/rest/v1/students?institute_id=eq.${p.institute_id}` +
    `&select=id,profile_id,batch_id,admission_number,profiles:profile_id(full_name)`;
  if (ids) path += `&id=${inList(ids)}`;

  return restGet(env, path, "students");
}

async function listScoped(env, p, table, order) {
  const ids = await visibleStudentIds(env, p);
  if (ids && !ids.length) return [];

  let path = `/rest/v1/${table}?institute_id=eq.${p.institute_id}&select=*&order=${order}`;
  if (ids) path += `&student_id=${inList(ids)}`;

  return restGet(env, path, table);
}

async function listPayments(env, admin, feeId) {
  if (!UUID.test(feeId || "")) throw new HttpError(400, "Invalid fee ID");
  return restGet(
    env,
    `/rest/v1/fee_payments?fee_id=eq.${feeId}&institute_id=eq.${admin.institute_id}&select=*&order=payment_date.desc`,
    "payments"
  );
}

async function listParents(env, admin) {
  const parents = await restGet(
    env,
    `/rest/v1/profiles?institute_id=eq.${admin.institute_id}&role=eq.parent&select=id,full_name&order=full_name.asc`,
    "parents"
  );
  if (!parents.length) return [];

  const links = await restGet(
    env,
    `/rest/v1/parent_student_links?parent_profile_id=${inList(parents.map(x => x.id))}&select=parent_profile_id,student_id`,
    "parent links"
  );

  return parents.map(x => ({
    id: x.id,
    full_name: x.full_name,
    student_ids: links.filter(l => l.parent_profile_id === x.id).map(l => l.student_id)
  }));
}

async function checkParentAndStudent(env, admin, body) {
  const parentId = String(body.parent_profile_id || "");
  const studentId = String(body.student_id || "");

  if (!UUID.test(parentId) || !UUID.test(studentId)) {
    throw new HttpError(400, "Choose a parent and a student");
  }

  const parent = await restGet(
    env,
    `/rest/v1/profiles?id=eq.${parentId}&institute_id=eq.${admin.institute_id}&role=eq.parent&select=id`,
    "parent"
  );
  if (!parent.length) throw new HttpError(400, "Parent not found in your institute");

  await verifyStudent(env, admin, studentId);

  return { parentId, studentId };
}

async function linkParent(env, admin, body) {
  const { parentId, studentId } = await checkParentAndStudent(env, admin, body);

  const existing = await restGet(
    env,
    `/rest/v1/parent_student_links?parent_profile_id=eq.${parentId}&student_id=eq.${studentId}&select=student_id`,
    "parent links"
  );
  if (existing.length) return { parent_profile_id: parentId, student_id: studentId, linked: true };

  await insertRow(
    env,
    "parent_student_links",
    { parent_profile_id: parentId, student_id: studentId },
    admin.institute_id
  );

  return { parent_profile_id: parentId, student_id: studentId, linked: true };
}

async function unlinkParent(env, admin, query) {
  const { parentId, studentId } = await checkParentAndStudent(env, admin, {
    parent_profile_id: query.get("parent_profile_id"),
    student_id: query.get("student_id")
  });

  const r = await sb(
    env,
    `/rest/v1/parent_student_links?parent_profile_id=eq.${parentId}&student_id=eq.${studentId}`,
    { method: "DELETE", service: true }
  );
  if (!r.ok) throw new HttpError(500, `Could not unlink${detail(r) ? ": " + detail(r) : ""}`);

  return { parent_profile_id: parentId, student_id: studentId, linked: false };
}

/* ---------------- EXAMS AND RESULTS ---------------- */

async function assertBatchAccess(env, p, batchId) {
  if (!UUID.test(batchId || "")) throw new HttpError(400, "Choose a valid batch");

  const batch = await restGet(
    env,
    `/rest/v1/batches?id=eq.${batchId}&institute_id=eq.${p.institute_id}&select=id`,
    "batch"
  );
  if (!batch.length) throw new HttpError(400, "Batch not found in your institute");

  if (p.role === "teacher") {
    const mine = await teacherBatchIds(env, p);
    if (!mine.includes(batchId)) {
      throw new HttpError(403, "You are not assigned to this batch");
    }
  } else if (p.role !== "admin") {
    throw new HttpError(403, "Not allowed");
  }
}

function cleanExam(body, partial = false) {
  const data = {};
  for (const field of ["batch_id", "title", "subject", "exam_date", "total_marks"]) {
    if (body[field] !== undefined) data[field] = body[field];
  }

  if (!partial) {
    for (const field of ["batch_id", "title", "exam_date", "total_marks"]) {
      if (data[field] === undefined || data[field] === null || data[field] === "") {
        throw new HttpError(400, `${field} is required`);
      }
    }
  }

  if (data.title !== undefined) {
    data.title = String(data.title).trim();
    if (data.title.length < 2 || data.title.length > 150) {
      throw new HttpError(400, "Exam title must be 2-150 characters");
    }
  }

  if (data.subject !== undefined) {
    data.subject = data.subject ? String(data.subject).trim().slice(0, 100) : null;
  }

  if (data.total_marks !== undefined) {
    const total = Number(data.total_marks);
    if (!Number.isFinite(total) || total <= 0) throw new HttpError(400, "Invalid total marks");
    data.total_marks = total;
  }

  return data;
}

async function createExam(env, p, body) {
  const data = cleanExam(body);
  await assertBatchAccess(env, p, data.batch_id);
  return insertRow(env, "exams", data, p.institute_id);
}

async function getExam(env, p, id) {
  if (!UUID.test(id || "")) throw new HttpError(400, "Invalid exam ID");
  const rows = await restGet(
    env,
    `/rest/v1/exams?id=eq.${id}&institute_id=eq.${p.institute_id}&select=*`,
    "exam"
  );
  if (!rows.length) throw new HttpError(404, "Exam not found");
  return rows[0];
}

async function updateExam(env, p, id, body) {
  const exam = await getExam(env, p, id);
  await assertBatchAccess(env, p, exam.batch_id);

  const data = cleanExam(body, true);
  if (data.batch_id && data.batch_id !== exam.batch_id) {
    await assertBatchAccess(env, p, data.batch_id);
  }
  if (!Object.keys(data).length) throw new HttpError(400, "No valid fields to update");

  const r = await sb(env, `/rest/v1/exams?id=eq.${id}&institute_id=eq.${p.institute_id}`, {
    method: "PATCH",
    service: true,
    prefer: "return=representation",
    body: data
  });
  if (!r.ok) throw new HttpError(500, `Could not update exam${detail(r) ? ": " + detail(r) : ""}`);

  return r.json?.[0] || { id };
}

async function deleteExam(env, admin, id) {
  await getExam(env, admin, id);

  const r = await sb(env, `/rest/v1/exams?id=eq.${id}&institute_id=eq.${admin.institute_id}`, {
    method: "DELETE",
    service: true,
    prefer: "return=representation"
  });
  if (!r.ok) {
    throw new HttpError(
      409,
      `Could not delete exam (delete its results first)${detail(r) ? ": " + detail(r) : ""}`
    );
  }

  return { id, deleted: true };
}

async function listExams(env, p) {
  const batches = await visibleBatchIds(env, p);
  if (batches && !batches.length) return [];

  let path = `/rest/v1/exams?institute_id=eq.${p.institute_id}&select=*&order=exam_date.desc`;
  if (batches) path += `&batch_id=${inList(batches)}`;

  return restGet(env, path, "exams");
}

async function listResults(env, p, examId) {
  const exams = await restGet(
    env,
    `/rest/v1/exams?institute_id=eq.${p.institute_id}&select=id`,
    "exams"
  );
  let examIds = exams.map(x => x.id);

  if (examId) {
    if (!UUID.test(examId)) throw new HttpError(400, "Invalid exam ID");
    examIds = examIds.filter(x => x === examId);
  }
  if (!examIds.length) return [];

  const students = await visibleStudentIds(env, p);
  if (students && !students.length) return [];

  let path = `/rest/v1/results?select=*&exam_id=${inList(examIds)}`;
  if (students) path += `&student_id=${inList(students)}`;

  return restGet(env, path, "results");
}

async function saveResult(env, p, body) {
  const exam = await getExam(env, p, String(body.exam_id || ""));
  await assertBatchAccess(env, p, exam.batch_id);

  const studentId = String(body.student_id || "");
  if (!UUID.test(studentId)) throw new HttpError(400, "Invalid student ID");

  const student = await restGet(
    env,
    `/rest/v1/students?id=eq.${studentId}&institute_id=eq.${p.institute_id}&select=id,batch_id`,
    "student"
  );
  if (!student.length) throw new HttpError(400, "Student not found in your institute");
  if (student[0].batch_id !== exam.batch_id) {
    throw new HttpError(400, "This student is not in the exam's batch");
  }

  const marks = Number(body.marks_obtained);
  if (body.marks_obtained === "" || body.marks_obtained === null || !Number.isFinite(marks) || marks < 0) {
    throw new HttpError(400, "Enter valid marks");
  }
  if (exam.total_marks !== null && exam.total_marks !== undefined && marks > Number(exam.total_marks)) {
    throw new HttpError(400, `Marks cannot be more than ${exam.total_marks}`);
  }

  const existing = await restGet(
    env,
    `/rest/v1/results?exam_id=eq.${exam.id}&student_id=eq.${studentId}&select=exam_id`,
    "results"
  );

  if (existing.length) {
    const r = await sb(env, `/rest/v1/results?exam_id=eq.${exam.id}&student_id=eq.${studentId}`, {
      method: "PATCH",
      service: true,
      prefer: "return=representation",
      body: { marks_obtained: marks }
    });
    if (!r.ok) throw new HttpError(500, `Could not update result${detail(r) ? ": " + detail(r) : ""}`);
    return r.json?.[0] || { exam_id: exam.id, student_id: studentId, marks_obtained: marks };
  }

  return insertRow(
    env,
    "results",
    { exam_id: exam.id, student_id: studentId, marks_obtained: marks },
    p.institute_id
  );
}

/* ---------------- FEE PAYMENT HISTORY ---------------- */
async function addPayment(env, admin, feeId, body) {
  if (!UUID.test(feeId || "")) {
    throw new HttpError(400, "Invalid fee ID");
  }

  const amount = Number(body.amount);

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new HttpError(400, "Enter a valid payment amount");
  }

  const result = await sb(env, "/rest/v1/rpc/admin_record_fee_payment", {
    method: "POST",
    service: true,
    body: {
      p_fee_id: feeId,
      p_institute_id: admin.institute_id,
      p_amount: amount,
      p_payment_date: body.payment_date || new Date().toISOString(),
      p_payment_method: body.payment_method || "other",
      p_reference_number: body.reference_number || null,
      p_received_by: admin.id
    }
  });

  if (!result.ok) {
    const message =
      result.json?.message ||
      result.json?.details ||
      "Could not save payment";

    throw new HttpError(400, message);
  }

  return result.json;
}
/* ---------------- GEMINI AI HELPER ---------------- */

async function askGemini(env, message, profile) {
  const apiKey = val(env, "GEMINI_API_KEY");

  if (!apiKey) {
    throw new HttpError(503, "AI service is not configured");
  }

  const question = String(message || "").trim();

  if (!question || question.length > 2000) {
    throw new HttpError(400, "Message must be 1-2000 characters");
  }

  const response = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{
            text: "You are the helpful AI assistant inside a coaching management system. Help with general questions about education and using the system. Do not claim to access student records or attendance unless verified data is explicitly provided. Never reveal private information."
          }]
        },
        contents: [{
          role: "user",
          parts: [{ text: question }]
        }],
        generationConfig: {
          maxOutputTokens: 500
        }
      })
    }
  );

  const result = await response.json();

  if (!response.ok) {
    throw new HttpError(502, "AI service request failed");
  }

  const answer = result.candidates?.[0]?.content?.parts
    ?.map(part => part.text || "")
    .join("")
    .trim();

  if (!answer) {
    throw new HttpError(502, "AI could not generate a response");
  }

  return answer;
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

    const activeProfile = await getActiveProfile(env, auth);
    const role = activeProfile.role;
    const isAdmin = role === "admin";
    const canManage = isAdmin || role === "teacher";
    const ok = (data, status = 200) => jsonResponse({ ok: true, data }, status, headers);

    if (!activeProfile.institute_id) {
      throw new HttpError(403, "This profile is not attached to an institute");
    }
    
/* AI CHAT ROUTE */

if (path === "/api/ai/chat" && method === "POST") {
  const answer = await askGemini(env, body.message, activeProfile);

  return ok({ answer });
}
    /* READS ALLOWED FOR EVERY ROLE (scoped to what that profile may see) */

    if (method === "GET") {
      if (path === "/api/events") return ok(await listModule(env, activeProfile, "events"));
      if (path === "/api/batches") return ok(await listBatches(env, activeProfile));
      if (path === "/api/students") return ok(await listStudents(env, activeProfile));
      if (path === "/api/exams") return ok(await listExams(env, activeProfile));
      if (path === "/api/results") {
        return ok(await listResults(env, activeProfile, url.searchParams.get("exam_id")));
      }
      if (path === "/api/payments") {
        return ok(await listScoped(env, activeProfile, "fee_payments", "payment_date.desc"));
      }
      if (path === "/api/fees" && !isAdmin) {
        return ok(await listScoped(env, activeProfile, "fees", "created_at.desc"));
      }
    }

    /* EXAMS AND RESULTS: ADMIN OR ASSIGNED TEACHER */

    if (path === "/api/results" && method === "POST") {
      if (!canManage) throw new HttpError(403, "Only admins and teachers can enter results");
      return ok(await saveResult(env, activeProfile, body), 201);
    }

    const examMatch = path.match(/^\/api\/exams(?:\/([^/]+))?$/);

    if (examMatch && method !== "GET") {
      if (!canManage) throw new HttpError(403, "Only admins and teachers can manage exams");
      const examId = examMatch[1] ? decodeURIComponent(examMatch[1]) : null;

      if (!examId && method === "POST") return ok(await createExam(env, activeProfile, body), 201);
      if (examId && method === "PATCH") return ok(await updateExam(env, activeProfile, examId, body));
      if (examId && method === "DELETE") {
        const adminOnly = await requireAdmin(env, auth);
        return ok(await deleteExam(env, adminOnly, examId));
      }
    }

    /* ADMIN-ONLY MANAGEMENT */

    const admin = await requireAdmin(env, auth);

    if (path === "/api/batches" && method === "POST") {
      return ok(await createBatch(env, admin, body), 201);
    }

    if (path === "/api/parents" && method === "GET") {
      return ok(await listParents(env, admin));
    }

    if (path === "/api/parent-links" && method === "POST") {
      return ok(await linkParent(env, admin, body), 201);
    }

    if (path === "/api/parent-links" && method === "DELETE") {
      return ok(await unlinkParent(env, admin, url.searchParams));
    }

    /* FEE PAYMENTS */

    const paymentFeeId = readRoute(path, /^\/api\/fees\/([^/]+)\/payments$/);

    if (paymentFeeId && method === "GET") {
      return ok(await listPayments(env, admin, paymentFeeId));
    }

    if (paymentFeeId && method === "POST") {
      return ok(await addPayment(env, admin, paymentFeeId, body), 201);
    }

    if (path === "/api/payments" && method === "POST") {
      return ok(await addPayment(env, admin, String(body.fee_id || ""), body), 201);
    }

    /* FEES, EXPENSES, EVENTS */

    const match = path.match(/^\/api\/(fees|expenses|events)(?:\/([^/]+))?$/);

    if (match) {
      const module = match[1];
      const id = match[2] ? decodeURIComponent(match[2]) : null;

      if (!id && method === "GET") return ok(await listModule(env, admin, module));
      if (!id && method === "POST") return ok(await createModule(env, admin, module, body), 201);
      if (id && method === "PATCH") return ok(await updateModule(env, admin, module, id, body));
      if (id && method === "DELETE") return ok(await deleteModule(env, admin, module, id));
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
