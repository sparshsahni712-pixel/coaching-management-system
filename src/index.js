// Admin-only user creation. The service-role key lives ONLY here (Cloudflare secret SUPABASE_SERVICE_ROLE_KEY).
const ROLES = new Set(['student', 'teacher', 'parent']);   // admins can never be created through this API
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
class HttpError extends Error { constructor(s, m) { super(m); this.status = s; } }

async function sb(env, path, { method = 'GET', token, service = false, body, prefer } = {}) {
  const key = service ? env.SUPABASE_SERVICE_ROLE_KEY : env.SUPABASE_ANON_KEY;
  const ctrl = new AbortController(), t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(env.SUPABASE_URL + path, { method, signal: ctrl.signal,
      headers: { apikey: key, Authorization: 'Bearer ' + (token || key), 'Content-Type': 'application/json', ...(prefer ? { Prefer: prefer } : {}) },
      body: body ? JSON.stringify(body) : undefined });
    const text = await res.text(); let json = null; try { json = text ? JSON.parse(text) : null; } catch { /* non-json */ }
    return { ok: res.ok, status: res.status, json };
  } catch (e) { throw new HttpError(e.name === 'AbortError' ? 504 : 502, 'Supabase unreachable'); } finally { clearTimeout(t); }
}
async function findUserByEmail(env, email) {
  for (let page = 1; page <= 10; page++) {
    const r = await sb(env, `/auth/v1/admin/users?page=${page}&per_page=1000`, { service: true });
    if (!r.ok) throw new HttpError(502, 'Could not look up users');
    const u = (r.json.users || []).find(x => (x.email || '').toLowerCase() === email);
    if (u) return u; if ((r.json.users || []).length < 1000) break;
  }
  return null;
}
export default {
  async fetch(req, env) {
    const origin = req.headers.get('Origin') || '';
    const allowed = (env.ALLOWED_ORIGIN || '').split(',').map(s => s.trim()).filter(Boolean);
    const cors = { Vary: 'Origin' };
    if (origin && allowed.includes(origin)) Object.assign(cors, { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type,Authorization' });
    const send = (s, b) => new Response(s === 204 ? null : JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
    try {
      if (origin && !allowed.includes(origin)) throw new HttpError(403, 'Origin not allowed');
      if (req.method === 'OPTIONS') return send(204);
      if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY || !env.SUPABASE_SERVICE_ROLE_KEY) throw new HttpError(503, 'Server not configured');
      if (new URL(req.url).pathname !== '/api/users' || req.method !== 'POST') throw new HttpError(404, 'Not found');
      const token = (req.headers.get('Authorization') || '').replace(/^Bearer /, '');
      if (!token) throw new HttpError(401, 'Sign in first');
      const who = await sb(env, '/auth/v1/user', { token });
      if (!who.ok || !who.json?.id) throw new HttpError(401, 'Invalid session');
      // caller must be an admin: read with the CALLER's token so RLS applies
      const me = await sb(env, `/rest/v1/profiles?id=eq.${who.json.id}&select=role,institute_id`, { token });
      const p = me.ok && me.json && me.json[0];
      if (!p || p.role !== 'admin' || !p.institute_id) throw new HttpError(403, 'Admins only');
      let b; try { b = await req.json(); } catch { throw new HttpError(400, 'Invalid JSON'); }
      const name = String(b.full_name || '').trim(), email = String(b.email || '').trim().toLowerCase();
      if (!ROLES.has(b.role)) throw new HttpError(400, 'Role must be student, teacher or parent');
      if (name.length < 2 || name.length > 100) throw new HttpError(400, 'Full name must be 2-100 characters');
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 200) throw new HttpError(400, 'Invalid email');
      const adm = b.admission_number ? String(b.admission_number).trim().slice(0, 50) : null;
      if (b.batch_id && !UUID.test(b.batch_id)) throw new HttpError(400, 'Invalid batch');
      if (b.role === 'student' && b.batch_id) {
        const bt = await sb(env, `/rest/v1/batches?id=eq.${b.batch_id}&institute_id=eq.${p.institute_id}&select=id`, { service: true });
        if (!bt.ok || !bt.json?.length) throw new HttpError(400, 'Batch not found in your institute');
      }
      let user = await findUserByEmail(env, email);
      if (user) {
        const ex = await sb(env, `/rest/v1/profiles?id=eq.${user.id}&select=id`, { service: true });
        if (ex.json?.length) throw new HttpError(409, 'This email already has a profile');
      } else {
        const inv = await sb(env, '/auth/v1/invite', { method: 'POST', service: true, body: { email, data: { full_name: name } } });
        if (!inv.ok || !inv.json?.id) throw new HttpError(502, 'Could not invite user: ' + (inv.json?.msg || inv.status));
        user = inv.json;
      }
      const pr = await sb(env, '/rest/v1/profiles', { method: 'POST', service: true, prefer: 'return=minimal', body: { id: user.id, institute_id: p.institute_id, full_name: name, role: b.role } });
      if (!pr.ok) throw new HttpError(500, 'Could not create profile');
      if (b.role === 'student') {
        const st = await sb(env, '/rest/v1/students', { method: 'POST', service: true, prefer: 'return=minimal', body: { profile_id: user.id, institute_id: p.institute_id, batch_id: b.batch_id || null, admission_number: adm } });
        if (!st.ok) { await sb(env, `/rest/v1/profiles?id=eq.${user.id}`, { method: 'DELETE', service: true }); throw new HttpError(500, 'Could not create student record'); }
      }
      return send(201, { ok: true, data: { id: user.id } });
    } catch (e) {
      if (!(e instanceof HttpError)) console.error('Worker error', e);
      return send(e instanceof HttpError ? e.status : 500, { ok: false, error: e instanceof HttpError ? e.message : 'Internal error' });
    }
  },
};
