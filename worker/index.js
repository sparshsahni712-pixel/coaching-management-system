
const ROLES = new Set(["student", "teacher", "parent"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function sb(env, path, {
  method = "GET",
  token,
  service = false,
  body,
  prefer
} = {}) {
  const key = service
    ? env.SUPABASE_SERVICE_ROLE_KEY
    : env.SUPABASE_ANON_KEY;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);

  try {
    const res = await fetch(
      env.SUPABASE_URL.replace(/\/$/, "") + path,
      {
        method,
        signal: ctrl.signal,
        headers: {
          apikey: key,
          Authorization: "Bearer " + (token || key),
          "Content-Type": "application/json",
          ...(prefer ? { Prefer: prefer } : {})
        },
        body: body === undefined ? undefined : JSON.stringify(body)
      }
    );

    const raw = await res.text();
    let json = null;

    try {
      json = raw ? JSON.parse(raw) : null;
    } catch {
      json = { raw };
    }

    return {
      ok: res.ok,
      status: res.status,
      json
    };
  } catch (e) {
    throw new HttpError(
      e.name === "AbortError" ? 504 : 502,
      "Supabase request failed"
    );
  } finally {
    clearTimeout(timer);
  }
}

function getClaims(token) {
  try {
    const part = token.split(".")[1];
    const base64 = part.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - base64.length % 4) % 4);
    return JSON.parse(atob(padded));
  } catch {
    throw new HttpError(401, "Invalid access token");
  }
}

async function authenticate(req, env) {
  const header = req.headers.get("Authorization") || "";
  const token = header.replace(/^Bearer\s+/i, "");

  if (!token) {
    throw new HttpError(401, "Sign in first");
  }

  const claims = getClaims(token);

  if (!claims.session_id || !claims.sub) {
    throw new HttpError(401, "Session information missing");
  }

  const who = await sb(env, "/auth/v1/user", { token });

  if (!who.ok || !who.json?.id || who.json.id !== claims.sub) {
    throw new HttpError(401, "Invalid session");
  }

  return {
    token,
    userId: who.json.id,
    sessionId: claims.session_id,
    claims
  };
}

async function selectProfile(req, env) {
  const auth = await authenticate(req, env);

  let body;

  try {
    body = await req.json();
  } catch {
    throw new HttpError(400, "Invalid JSON");
  }

  const profileId = String(body.profile_id || "");

  if (!UUID.test(profileId)) {
    throw new HttpError(400, "Invalid profile ID");
  }

  const link = await sb(
    env,
    `/rest/v1/user_profile_links?auth_user_id=eq.${auth.userId}&profile_id=eq.${profileId}&select=profile_id`,
    { service: true }
  );

  if (!link.ok) {
    throw new HttpError(500, "Could not verify profile link");
  }

  if (!link.json?.length) {
    throw new HttpError(
      403,
      "This profile is not linked to your account"
    );
  }

  const profile = await sb(
    env,
    `/rest/v1/profiles?id=eq.${profileId}&select=id,role,institute_id`,
    { service: true }
  );

  if (!profile.ok || !profile.json?.length) {
    throw new HttpError(404, "Profile not found");
  }

  const saved = await sb(
    env,
    "/rest/v1/active_profile_sessions?on_conflict=session_id",
    {
      method: "POST",
      service: true,
      prefer: "resolution=merge-duplicates,return=minimal",
      body: {
        session_id: auth.sessionId,
        auth_user_id: auth.userId,
        profile_id: profileId
      }
    }
  );

  if (!saved.ok) {
    throw new HttpError(
      500,
      "Could not activate profile: " +
      JSON.stringify(saved.json)
    );
  }

  return {
    ok: true,
    profile_id: profileId
  };
}

async function findUserByEmail(env, email) {
  for (let page = 1; page <= 10; page++) {
    const r = await sb(
      env,
      `/auth/v1/admin/users?page=${page}&per_page=1000`,
      { service: true }
    );

    if (!r.ok) {
      throw new HttpError(502, "Could not look up users");
    }

    const users = r.json?.users || [];
    const found = users.find(
      u => (u.email || "").toLowerCase() === email
    );

    if (found) return found;
    if (users.length < 1000) break;
  }

  return null;
}

async function createUser(req, env) {
  const auth = await authenticate(req, env);
  const activeProfileId = auth.claims.active_profile_id;

  if (!activeProfileId || !UUID.test(activeProfileId)) {
    throw new HttpError(403, "Select an admin profile first");
  }

  const adminResult = await sb(
    env,
    `/rest/v1/profiles?id=eq.${activeProfileId}&select=id,role,institute_id`,
    { service: true }
  );

  const admin = adminResult.ok && adminResult.json?.[0];

  if (!admin || admin.role !== "admin" || !admin.institute_id) {
    throw new HttpError(403, "Admins only");
  }

  const adminLink = await sb(
    env,
    `/rest/v1/user_profile_links?auth_user_id=eq.${auth.userId}&profile_id=eq.${activeProfileId}&select=profile_id`,
    { service: true }
  );

  if (!adminLink.ok || !adminLink.json?.length) {
    throw new HttpError(403, "Admin profile is not linked to this account");
  }

  let b;

  try {
    b = await req.json();
  } catch {
    throw new HttpError(400, "Invalid JSON");
  }

  const name = String(b.full_name || "").trim();
  const email = String(b.email || "").trim().toLowerCase();

  if (!ROLES.has(b.role)) {
    throw new HttpError(400, "Role must be student, teacher or parent");
  }

  if (name.length < 2 || name.length > 100) {
    throw new HttpError(400, "Full name must be 2-100 characters");
  }

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 200) {
    throw new HttpError(400, "Invalid email");
  }

  const admissionNumber = b.admission_number
    ? String(b.admission_number).trim().slice(0, 50)
    : null;

  if (b.batch_id && !UUID.test(b.batch_id)) {
    throw new HttpError(400, "Invalid batch ID");
  }

  if (b.role === "student" && b.batch_id) {
    const batchResult = await sb(
      env,
      `/rest/v1/batches?id=eq.${b.batch_id}&select=id,institute_id`,
      { service: true }
    );

    if (!batchResult.ok) {
      throw new HttpError(500, "Could not verify batch");
    }

    const batch = batchResult.json?.[0];

    if (!batch) {
      throw new HttpError(400, "Batch not found");
    }

    if (batch.institute_id !== admin.institute_id) {
      throw new HttpError(400, "Batch belongs to another institute");
    }
  }

  let user = await findUserByEmail(env, email);

  if (user) {
    const links = await sb(
      env,
      `/rest/v1/user_profile_links?auth_user_id=eq.${user.id}&select=profile_id`,
      { service: true }
    );

    if (!links.ok) {
      throw new HttpError(502, "Could not check existing profile links");
    }

    for (const link of links.json || []) {
      const existing = await sb(
        env,
        `/rest/v1/profiles?id=eq.${link.profile_id}&select=institute_id`,
        { service: true }
      );

      if (!existing.ok) {
        throw new HttpError(502, "Could not verify existing profile");
      }

      if (existing.json?.[0]?.institute_id !== admin.institute_id) {
        throw new HttpError(
          409,
          "This email is already linked to another institute"
        );
      }
    }
  } else {
    const invitation = await sb(
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

    if (!invitation.ok || !invitation.json?.id) {
      throw new HttpError(
        502,
        "Could not invite user: " +
        (invitation.json?.msg || invitation.status)
      );
    }

    user = invitation.json;
  }

  const profileId = crypto.randomUUID();

  const profileResult = await sb(
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
        role: b.role
      }
    }
  );

  if (!profileResult.ok) {
    throw new HttpError(
      500,
      "Could not create profile: " +
      JSON.stringify(profileResult.json)
    );
  }

  const linkResult = await sb(
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

  if (!linkResult.ok) {
    await sb(
      env,
      `/rest/v1/profiles?id=eq.${profileId}`,
      { method: "DELETE", service: true }
    );

    throw new HttpError(
      500,
      "Could not link profile: " +
      JSON.stringify(linkResult.json)
    );
  }

  if (b.role === "student") {
    const studentResult = await sb(
      env,
      "/rest/v1/students",
      {
        method: "POST",
        service: true,
        prefer: "return=minimal",
        body: {
          profile_id: profileId,
          institute_id: admin.institute_id,
          batch_id: b.batch_id || null,
          admission_number: admissionNumber
        }
      }
    );

    if (!studentResult.ok) {
      await sb(
        env,
        `/rest/v1/user_profile_links?auth_user_id=eq.${user.id}&profile_id=eq.${profileId}`,
        { method: "DELETE", service: true }
      );

      await sb(
        env,
        `/rest/v1/profiles?id=eq.${profileId}`,
        { method: "DELETE", service: true }
      );

      throw new HttpError(
        500,
        "Could not create student record: " +
        JSON.stringify(studentResult.json)
      );
    }
  }

  return {
    ok: true,
    data: {
      id: profileId,
      auth_user_id: user.id
    }
  };
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
        "Access-Control-Allow-Methods": "POST,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type,Authorization"
      });
    }

    const send = (status, data) => new Response(
      status === 204 ? null : JSON.stringify(data),
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

      if (
        !env.SUPABASE_URL ||
        !env.SUPABASE_ANON_KEY ||
        !env.SUPABASE_SERVICE_ROLE_KEY
      ) {
        throw new HttpError(503, "Server not configured");
      }

      const path = new URL(req.url).pathname;

      if (req.method !== "POST") {
        throw new HttpError(405, "Method not allowed");
      }

      if (path === "/api/select-profile") {
        const result = await selectProfile(req, env);
        return send(200, result);
      }

      if (path === "/api/users") {
        const result = await createUser(req, env);
        return send(201, result);
      }

      throw new HttpError(404, "Not found");

    } catch (e) {
      console.error("Worker error:", e);

      return send(
        e instanceof HttpError ? e.status : 500,
        {
          ok: false,
          error: e instanceof HttpError
            ? e.message
            : "Internal server error"
        }
      );
    }
  }
};

