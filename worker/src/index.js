
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

  return {
    ok: response.ok,
    status: response.status,
    json
  };
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

    if (!result.ok) {
      throw new HttpError(502, "Could not look up users");
    }

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

  if (!ROLES.has(role)) {
    throw new HttpError(400, "Invalid role");
  }

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

    if (!existing.ok) {
      throw new HttpError(500, "Could not verify existing profiles");
    }

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
    const invite = await sb(
      env,
      "/auth/v1/invite",
      {
        method: "POST",
        service: true,
        body: {
          email,
          data: { full_name: name }
        }
      }
    );

    if (!invite.ok || !invite.json?.id) {
      throw new HttpError(502, "Could not invite user");
    }

    user = invite.json;
  }

  const profileId = crypto.randomUUID();

  const profile = await sb(
    env,
    "/rest/v1/profiles",
    {
      method: "POST",
      service: true,
      prefer: "return=minimal",
      body: {
        id: profileId,
        institute_id: admin.institute_id,
        full_name: name,
        role
      }
    }
  );

  if (!profile.ok) {
    throw new HttpError(500, "Could not create profile");
  }

  const mapping = await sb(
    env,
    "/rest/v1/user_profile_links",
    {
      method: "POST",
      service: true,
      prefer: "return=minimal",
      body: {
        auth_user_id: user.id,
        profile_id: profileId
      }
    }
  );

  if (!mapping.ok) {
    await sb(
      env,
      `/rest/v1/profiles?id=eq.${profileId}`,
      { method: "DELETE", service: true }
    );

    throw new HttpError(500, "Could not link profile to account");
  }

  if (role === "student") {
    const student = await sb(
      env,
      "/rest/v1/students",
      {
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
      }
    );

    if (!student.ok) {
      await sb(
        env,
        `/rest/v1/user_profile_links?profile_id=eq.${profileId}`,
        { method: "DELETE", service: true }
      );

      await sb(
        env,
        `/rest/v1/profiles?id=eq.${profileId}`,
        { method: "DELETE", service: true }
      );

      throw new HttpError(500, "Could not create student record");
    }
  }

  return {
    id: profileId,
    auth_user_id: user.id,
    role
  };
}

async function selectProfile(env, auth, body) {
  const profileId = String(body.profile_id || "");

  if (!UUID.test(profileId)) {
    throw new HttpError(400, "Invalid profile ID");
  }

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

  const session = await sb(
    env,
    "/rest/v1/active_profile_sessions?on_conflict=session_id",
    {
      method: "POST",
      service: true,
      prefer: "resolution=merge-duplicates,return=minimal",
      body: {
        session_id: auth.sessionId,
        auth_user_id: auth.userId,
        profile_id: profileId,
        updated_at: new Date().toISOString()
      }
    }
  );

  if (!session.ok) {
    throw new HttpError(500, "Could not activate profile");
  }

  return profile.json[0];
}

export default {
  async fetch(req, env) {
    const origin = req.headers.get("Origin") || "";

    const allowed = (env.ALLOWED_ORIGIN || "")
      .split(",")
      .map(s => s.trim())
      .filter(Boolean);

    const cors = { Vary: "Origin" };

    if (origin && allowed.includes(origin)) {
      Object.assign(cors, {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "POST,GET,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type,Authorization"
      });
    }

    const send = (status, body) =>
      new Response(
        status === 204 ? null : JSON.stringify(body),
        {
          status,
          headers: {
            ...cors,
            "Content-Type": "application/json",
            "Cache-Control": "no-store"
          }
        }
      );

    try {
      if (origin && !allowed.includes(origin)) {
        throw new HttpError(403, "Origin not allowed");
      }

      if (req.method === "OPTIONS") {
        return send(204);
      }

      const missing = [
        "SUPABASE_URL",
        "SUPABASE_ANON_KEY",
        "SUPABASE_SERVICE_ROLE_KEY"
      ].filter(k => !val(env, k));

      const path = new URL(req.url).pathname;

      if (path === "/api/health" && req.method === "GET") {
        return send(200, { ok: true, data: { missing } });
      }

      if (missing.length) {
        throw new HttpError(
          503,
          "Server not configured. Missing: " + missing.join(", ")
        );
      }

      if (
        !["/api/users", "/api/select-profile"].includes(path) ||
        req.method !== "POST"
      ) {
        throw new HttpError(404, "Not found");
      }

      const token = (req.headers.get("Authorization") || "")
        .replace(/^Bearer /i, "");

      const auth = await authenticate(env, token);

      let body;

      try {
        body = await req.json();
      } catch {
        throw new HttpError(400, "Invalid JSON");
      }

      if (path === "/api/select-profile") {
        const profile = await selectProfile(env, auth, body);

        return send(200, {
          ok: true,
          data: profile
        });
      }

      const admin = await requireAdmin(env, auth);
      const created = await createProfile(env, admin, body);

      return send(201, {
        ok: true,
        data: created
      });

    } catch (error) {
      if (!(error instanceof HttpError)) {
        console.error("Worker error", error);
      }

      return send(
        error instanceof HttpError ? error.status : 500,
        {
          ok: false,
          error: error instanceof HttpError
            ? error.message
            : "Internal server error"
        }
      );
    }
  }
};
