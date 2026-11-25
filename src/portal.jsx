import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { supabase, configured } from "./lib/supabase";

const AuthContext = createContext(null);
const portalStyles = `
.field{display:grid;gap:6px;margin:12px 0;font-weight:600;font-size:14px}
.field input,.field select,.field textarea{width:100%;padding:11px;border:1px solid #d0d5dd;border-radius:9px;font:inherit}
.notice{padding:12px;border-radius:9px;margin:12px 0;background:#fff7e6}.notice.error{background:#fff0f0;color:#b42318}.notice.success{background:#ecfdf3;color:#067647}
.table-wrap{overflow:auto;margin-top:12px}table{width:100%;border-collapse:collapse;min-width:580px}th,td{text-align:left;padding:11px;border-bottom:1px solid #eaecf0;font-size:14px}
.modal-backdrop{position:fixed;inset:0;background:#10182899;z-index:1000;display:grid;place-items:center;padding:16px}.modal-card{width:min(620px,100%);max-height:90vh;overflow:auto}
.event-row{display:flex;gap:16px;padding:15px 0;border-bottom:1px solid #eaecf0}.event-poster{width:115px;height:115px;object-fit:cover;border-radius:10px}
@media(max-width:600px){.event-row{flex-direction:column}.event-poster{width:100%;height:180px}}
`;

const API_URL = (import.meta.env.VITE_ADMIN_API_URL || "").replace(/\/$/, "");

async function request(path, token, options = {}) {
  if (!API_URL) throw new Error("VITE_ADMIN_API_URL is not configured.");
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.ok === false) {
    throw new Error(result.error || result.message || `Request failed (${response.status})`);
  }
  return result.data ?? result;
}

const asArray = (value) => Array.isArray(value) ? value : Array.isArray(value?.items) ? value.items : [];
const money = (value) => `₹${Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const dateLabel = (value) => value ? new Date(value).toLocaleDateString("en-IN") : "—";

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [recovery, setRecovery] = useState(false);
  const [authError, setAuthError] = useState("");

  const loadProfile = useCallback(async (currentSession) => {
    if (!currentSession?.user) {
      setProfile(null);
      setProfiles([]);
      return;
    }
    const { data, error } = await supabase
      .from("user_profile_links")
      .select("profile_id, profiles(*)")
      .eq("auth_user_id", currentSession.user.id);
    if (error) throw error;
    const linked = (data || []).map((row) => row.profiles).filter(Boolean);
    setProfiles(linked);
    if (!linked.length) {
      setProfile(null);
      return;
    }
        const tokenClaims = JSON.parse(
      atob(currentSession.access_token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))
    );

    const { data: active } = await supabase
      .from("active_profile_sessions")
      .select("profile_id")
      .eq("auth_user_id", currentSession.user.id)
      .eq("session_id", tokenClaims.session_id)
      .maybeSingle();

    const selectedProfile =
      linked.find((item) => item.id === active?.profile_id) || linked[0];

    if (!active?.profile_id || active.profile_id !== selectedProfile.id) {
      await request("/api/select-profile", currentSession.access_token, {
        method: "POST",
        body: JSON.stringify({ profile_id: selectedProfile.id }),
      });
    }

    setProfile(selectedProfile);
  }, []);

  useEffect(() => {
    let mounted = true;
    if (!configured) {
      setAuthError("Supabase is not configured. Check your environment variables.");
      setLoading(false);
      return undefined;
    }
    supabase.auth.getSession().then(async ({ data: { session: current } }) => {
      if (!mounted) return;
      setSession(current);
      try { await loadProfile(current); }
      catch (error) { setAuthError(error.message); }
      if (mounted) setLoading(false);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, current) => {
      setSession(current);
      Promise.resolve().then(async () => {
        try { await loadProfile(current); }
        catch (error) { setAuthError(error.message); }
      });
    });
    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, [loadProfile]);

  const value = useMemo(() => ({
    session, profile, profiles, loading, recovery, setRecovery, authError, setAuthError,
    reloadProfile: () => loadProfile(session),
    signOut: async () => { await supabase.auth.signOut(); setSession(null); setProfile(null); setProfiles([]); },
    chooseProfile: async (nextProfile) => {
      if (!session?.access_token) throw new Error("Please sign in again.");
      await request("/api/select-profile", session.access_token, {
        method: "POST",
        body: JSON.stringify({ profile_id: nextProfile.id }),
      });
      await supabase.auth.refreshSession();
      setProfile(nextProfile);
    },
  }), [session, profile, profiles, loading, recovery, authError, loadProfile]);

  return <AuthContext.Provider value={value}><style>{portalStyles}</style>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider.");
  return value;
}

export function AuthScreen({ kind = "login", go = () => {} }) {
  const auth = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true); setError(""); setNotice("");
    try {
      if (kind === "forgot") {
        const { error: err } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: window.location.origin,
        });
        if (err) throw err;
        setNotice("Password reset link sent. Check your email.");
      } else if (kind === "register") {
        const { error: err } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { full_name: fullName } },
        });
        if (err) throw err;
        setNotice("Account created. If email confirmation is enabled, verify your email. Ask your institute admin to link your profile.");
      } else {
        const { error: err } = await supabase.auth.signInWithPassword({ email, password });
        if (err) throw err;
      }
    } catch (err) {
      setError(err.message || "Authentication failed.");
    } finally { setBusy(false); }
  };

  return <div className="wrap sec" style={{ maxWidth: 470, margin: "48px auto" }}>
    <div className="card">
      <h2>{kind === "register" ? "Create account" : kind === "forgot" ? "Reset password" : "Welcome back"}</h2>
      <p className="muted">Coaching LMS secure account access</p>
      {!configured && (
  <div className="notice error">
    Supabase environment variables are missing in this build.
  </div>
)}
      {error && <div className="notice error">{error}</div>}
      {notice && <div className="notice success">{notice}</div>}
      <form onSubmit={submit}>
        {kind === "register" && <label className="field">Full name<input required value={fullName} onChange={(e)=>setFullName(e.target.value)} /></label>}
        <label className="field">Email<input type="email" required value={email} onChange={(e)=>setEmail(e.target.value)} /></label>
        {kind !== "forgot" && <label className="field">Password<input type="password" required minLength={6} value={password} onChange={(e)=>setPassword(e.target.value)} /></label>}
        <button className="btn" disabled={busy}>{busy ? "Please wait…" : kind === "register" ? "Register" : kind === "forgot" ? "Send reset link" : "Sign in"}</button>
      </form>
      <div className="row" style={{ marginTop: 15, flexWrap: "wrap" }}>
        {kind !== "login" && <button className="btn alt" onClick={()=>go("login")}>Back to login</button>}
        {kind === "login" && <><button className="btn alt" onClick={()=>go("forgot")}>Forgot password?</button><button className="btn alt" onClick={()=>go("register")}>Create account</button></>}
      </div>
    </div>
  </div>;
}

export function Recovery() {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const submit = async (event) => {
    event.preventDefault(); setBusy(true); setError("");
    const { error: err } = await supabase.auth.updateUser({ password });
    if (err) setError(err.message); else setDone(true);
    setBusy(false);
  };
  return <div className="wrap sec" style={{ maxWidth: 460, margin: "50px auto" }}><div className="card">
    <h2>Set a new password</h2>
    {error && <div className="notice error">{error}</div>}
    {done ? <div className="notice success">Password updated. You can sign in with your new password.</div> :
      <form onSubmit={submit}><label className="field">New password<input type="password" minLength={6} required value={password} onChange={(e)=>setPassword(e.target.value)} /></label><button className="btn" disabled={busy}>{busy?"Saving…":"Update password"}</button></form>}
  </div></div>;
}

export function NotLinked() {
  const auth = useAuth();
  return <div className="wrap sec" style={{ maxWidth: 560, margin: "50px auto" }}><div className="card">
    <h2>No institute profile linked</h2>
    <p>You are signed in as <b>{auth.session?.user?.email}</b>, but this account is not linked to a student, parent, teacher, or admin profile.</p>
    <p className="muted">Ask your institute administrator to link your email to the correct profile.</p>
    {auth.authError && <div className="notice error">{auth.authError}</div>}
    <button className="btn" onClick={auth.signOut}>Sign out</button>
  </div></div>;
}

function Panel({ title, action, children }) {
  return <section className="card" style={{ marginTop: 16 }}>
    <div className="row" style={{ justifyContent: "space-between", alignItems: "center", flexWrap: "wrap" }}>
      <h2>{title}</h2>{action}
    </div>{children}
  </section>;
}
function Input({ label, ...props }) {
  return <label className="field">{label}<input {...props}/></label>;
}
function AIChat() {
  const { session, profile } = useAuth();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const sendMessage = async () => {
    const question = message.trim();
    if (!question || busy) return;

    setMessages(old => [...old, { role: "user", text: question }]);
    setMessage("");
    setBusy(true);
    setError("");

    try {
      const result = await request("/api/ai/chat", session.access_token, {
        method: "POST",
        body: JSON.stringify({ message: question }),
      });

      setMessages(old => [...old, { role: "assistant", text: result.answer }]);
    } catch (e) {
      setError(e.message || "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  if (!profile || !session?.access_token) return null;

  return (
    <div style={{ position: "fixed", right: 18, bottom: 18, zIndex: 999 }}>
      {open && (
        <div style={{
          width: "min(350px, calc(100vw - 36px))",
          height: 430,
          background: "white",
          border: "1px solid #ddd",
          borderRadius: 14,
          padding: 14,
          marginBottom: 10,
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 5px 25px #0002"
        }}>
          <h3>AI Assistant</h3>
          <div style={{ flex: 1, overflowY: "auto", marginBottom: 10 }}>
            {messages.map((item, index) => (
              <p key={index}>
                <b>{item.role === "user" ? "You" : "AI"}:</b> {item.text}
              </p>
            ))}
            {busy && <p>AI is thinking...</p>}
            {error && <p style={{ color: "red" }}>{error}</p>}
          </div>

          <input
            value={message}
            onChange={e => setMessage(e.target.value)}
            onKeyDown={e => e.key === "Enter" && sendMessage()}
            placeholder="Ask something..."
            maxLength={2000}
          />
          <button className="btn" onClick={sendMessage} disabled={busy}>
            {busy ? "Sending..." : "Send"}
          </button>
        </div>
      )}

      <button className="btn" onClick={() => setOpen(!open)}>
        {open ? "Close AI" : "Ask AI"}
      </button>
    </div>
  );
}
export function Dash() {
  const auth = useAuth();
  const { session, profile, profiles } = auth;
  const role = profile?.role;
  const admin = role === "admin";
  const teacher = role === "teacher";
  const canManage = admin || teacher;
  const [section, setSection] = useState("overview");
    const [records, setRecords] = useState({
    fees: [],
    expenses: [],
    events: [],
    payments: [],
    exams: [],
    results: [],
    batches: [],
    parents: [],
    teachers: [],
  });
  const [students, setStudents] = useState([]);

const [attendanceDate, setAttendanceDate] = useState(
  new Date().toISOString().slice(0, 10)
);
const [attendanceBatch, setAttendanceBatch] = useState("");
const [attendanceRows, setAttendanceRows] = useState([]);
const [attendanceLoading, setAttendanceLoading] = useState(false);
const [busy, setBusy] = useState(false);
const [error, setError] = useState("");
const [notice, setNotice] = useState("");
const [dialog, setDialog] = useState("");
const [edit, setEdit] = useState(null);
const [form, setForm] = useState({});
const token = session?.access_token;

const refresh = useCallback(async () => {
  if (!token) return;
  setBusy(true);
  setError("");
  const problems = [];

  const load = (label, path, enabled = true) => enabled
    ? request(path, token).then(asArray).catch((e) => {
        problems.push(`${label}: ${e.message}`);
        return [];
      })
    : Promise.resolve([]);

  try {
    const [fees, expenses, events, payments, exams, results, batches, parents, studentRows, teachers] = await Promise.all([
      load("Fees", "/api/fees", role !== "teacher"),
      load("Expenses", "/api/expenses", admin),
      load("Events", "/api/events"),
      load("Payments", "/api/payments", role !== "teacher"),
      load("Exams", "/api/exams"),
      load("Results", "/api/results"),
      load("Batches", "/api/batches"),
      load("Parents", "/api/parents", admin),
      load("Students", "/api/students"),
      load("Teachers", "/api/teachers", admin),
    ]);

    setRecords({ fees, expenses, events, payments, exams, results, batches, parents, teachers });
    setStudents(studentRows);

    if (problems.length) {
      setError(`Some sections could not load — ${problems.join(" | ")}`);
    }
  } catch (e) {
    setError(e.message || "Unable to load records.");
  } finally {
    setBusy(false);
  }
}, [token, admin, role]);

useEffect(() => {
  refresh();
}, [refresh]);

  const totalFees = records.fees.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const totalPaid = records.payments.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const totalExpenses = records.expenses.reduce((sum, row) => sum + Number(row.amount || 0), 0);

  const studentName = (id) => {
    const s = students.find((x) => x.id === id);
    return s?.profiles?.full_name || s?.admission_number || "Student";
  };
  const batchName = (id) => records.batches.find((b) => b.id === id)?.name || "—";
  const examById = (id) => records.exams.find((x) => x.id === id);

  const loadAttendance = async () => {
    if (!attendanceBatch) {
      setError("Choose a batch first.");
      return;
    }

    setAttendanceLoading(true);
    setError("");

    try {
      const rows = await request(
        `/api/attendance?batch_id=${encodeURIComponent(attendanceBatch)}&date=${encodeURIComponent(attendanceDate)}`,
        token
      );

      setAttendanceRows(asArray(rows).map((student) => ({
        ...student,
        attendance: student.attendance || ""
      })));
    } catch (e) {
      setError(e.message || "Could not load attendance.");
      setAttendanceRows([]);
    } finally {
      setAttendanceLoading(false);
    }
  };

  const saveAttendance = async () => {
    if (!attendanceBatch || !attendanceRows.length) {
      setError("Choose a batch and load students first.");
      return;
    }

    if (attendanceRows.some((student) => !student.attendance)) {
      setError("Select a status for every student.");
      return;
    }

    setAttendanceLoading(true);
    setError("");

    try {
      await request("/api/attendance", token, {
        method: "POST",
        body: JSON.stringify({
          batch_id: attendanceBatch,
          attendance_date: attendanceDate,
          records: attendanceRows.map((student) => ({
            student_id: student.id,
            status: student.attendance
          }))
        })
      });

      setNotice("Attendance saved successfully.");
      await loadAttendance();
    } catch (e) {
      setError(e.message || "Could not save attendance.");
    } finally {
      setAttendanceLoading(false);
    }
  };
  
  const startNew = (type, item = null) => {
    setEdit(item);
    setForm(item ? { ...item } : type === "fees"
      ? { student_id: "", amount: "", due_date: "" }
      : type === "expenses"
        ? { title: "", category: "", amount: "", expense_date: new Date().toISOString().slice(0,10), description: "" }
        : type === "exams"
          ? { batch_id: "", title: "", subject: "", exam_date: "", total_marks: "" }
          : type === "students"
            ? { full_name: "", email: "", batch_id: "", admission_number: "" }
            : type === "parents"
              ? { full_name: "", email: "" }
              : type === "link"
                ? { parent_profile_id: item?.id || "", student_id: "" }
                : type === "results"
                  ? { marks: Object.fromEntries(records.results.filter((r) => r.exam_id === item?.id).map((r) => [r.student_id, String(r.marks_obtained)])) }
                  : { title: "", description: "", event_date: "", event_time: "", venue: "", poster_url: "" });
    setDialog(type);
  };

  const closeDialog = () => { setDialog(""); setEdit(null); setForm({}); };

  const save = async () => {
    setBusy(true); setError(""); setNotice("");
    try {
      if (dialog === "students" || dialog === "parents") {
        const body = { role: dialog === "students" ? "student" : "parent", full_name: form.full_name, email: form.email };
        if (dialog === "students") { body.batch_id = form.batch_id || null; body.admission_number = form.admission_number || ""; }
        await request("/api/users", token, { method: "POST", body: JSON.stringify(body) });
        closeDialog();
        setNotice(`${dialog === "students" ? "Student" : "Parent"} added. An invitation email was sent to ${body.email} (if the account is new).`);
      } else if (dialog === "link") {
        await request("/api/parent-links", token, { method: "POST", body: JSON.stringify({ parent_profile_id: form.parent_profile_id, student_id: form.student_id }) });
        closeDialog(); setNotice("Student linked to parent.");
      } else if (dialog === "results") {
        const entries = Object.entries(form.marks || {}).filter(([, v]) => String(v).trim() !== "");
        for (const [student_id, marks] of entries) {
          await request("/api/results", token, { method: "POST", body: JSON.stringify({ exam_id: edit.id, student_id, marks_obtained: marks }) });
        }
        closeDialog(); setNotice(`Results saved for ${entries.length} student(s).`);
      } else {
        const path = `/api/${dialog}${edit?.id ? `/${edit.id}` : ""}`;
        await request(path, token, { method: edit?.id ? "PATCH" : "POST", body: JSON.stringify(form) });
        closeDialog(); setNotice("Saved successfully.");
      }
      await refresh();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  const remove = async (kind, id, message = "Delete this record?") => {
    if (!window.confirm(message)) return;
    setBusy(true); setError("");
    try {
      await request(`/api/${kind}/${id}`, token, { method: "DELETE" });
      setNotice("Deleted successfully."); await refresh();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  const unlink = async (parentId, studentId) => {
    if (!window.confirm("Remove this child from the parent?")) return;
    setBusy(true); setError("");
    try {
      await request(`/api/parent-links?parent_profile_id=${encodeURIComponent(parentId)}&student_id=${encodeURIComponent(studentId)}`, token, { method: "DELETE" });
      setNotice("Link removed."); await refresh();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  const addBatch = async () => {
    const name = window.prompt("New batch name (for example: Class 10 - Morning):");
    if (!name || !name.trim()) return;
    setBusy(true); setError("");
    try {
      await request("/api/batches", token, { method: "POST", body: JSON.stringify({ name: name.trim() }) });
      setNotice("Batch added."); await refresh();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  const addPayment = async (fee) => {
    const amount = window.prompt(`Enter payment amount (fee amount ${money(fee.amount)}):`);
    if (amount === null || amount.trim() === "") return;
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) { setError("Enter a valid payment amount."); return; }
    const method = window.prompt("Payment method (Cash / UPI / Bank):", "Cash") || "Cash";
    setBusy(true); setError("");
    try {
      await request("/api/payments", token, { method: "POST", body: JSON.stringify({
        fee_id: fee.id, student_id: fee.student_id, amount: value, payment_method: method,
      }) });
      setNotice("Payment recorded."); await refresh();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  const uploadPoster = async (file) => {
    if (!file) return;
    if (!file.type.startsWith("image/") || file.size > 5 * 1024 * 1024) {
      setError("Choose an image smaller than 5 MB."); return;
    }
    setBusy(true); setError("");
    try {
      const ext = file.name.split(".").pop() || "jpg";
      const path = `event-posters/${profile.institute_id}/${Date.now()}.${ext}`;
      const { error: uploadError } = await supabase.storage.from("lms-files").upload(path, file, { contentType: file.type });
      if (uploadError) throw uploadError;
      const { data, error: urlError } = await supabase.storage.from("lms-files").createSignedUrl(path, 60 * 60 * 24 * 30);
      if (urlError) throw urlError;
      setForm((old) => ({ ...old, poster_url: data.signedUrl }));
      setNotice("Poster uploaded. Save the event to publish it.");
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  const navigation = [
    ["overview", "Overview"], ["events", "Events & announcements"],
    ...(teacher ? [] : [["fees", "Fees & payments"]]),
    ["exams", "Exams & results"],["attendance", "Attendance"],
    ...(admin ? [["students", "Students"], ["parents", "Parents"], ["expenses", "Expenses"]] : []),
  ];

  const dialogTitle = { fees: "fee", expenses: "expense", events: "event", exams: "exam", students: "student", parents: "parent", link: "child to parent", results: "results" }[dialog];
  const examStudents = dialog === "results" && edit ? students.filter((s) => s.batch_id === edit.batch_id) : [];

  return <div className="wrap sec" style={{ maxWidth: 1180 }}>
    <div className="row" style={{ justifyContent: "space-between", alignItems: "center", flexWrap: "wrap" }}>
      <div><h1>{profile?.full_name || "Coaching Portal"}</h1><p className="muted">{profile?.role?.toUpperCase()} · {profile?.institute_name || "Institute workspace"}</p></div>
      <div className="row"><button className="btn alt" onClick={refresh} disabled={busy}>{busy ? "Refreshing…" : "Refresh"}</button><button className="btn alt" onClick={auth.signOut}>Sign out</button></div>
    </div>
    {profiles.length > 1 && <Panel title="Switch profile"><div className="row" style={{ flexWrap: "wrap" }}>{profiles.map((p) =>
      <button key={p.id} className={p.id === profile.id ? "btn" : "btn alt"} onClick={async () => {
        try { await auth.chooseProfile(p); } catch (e) { setError(e.message); }
      }}>{p.role}: {p.full_name}</button>)}</div></Panel>}
    <div className="row" style={{ flexWrap: "wrap", margin: "18px 0" }}>
      {navigation.map(([id, label]) => <button key={id} className={section === id ? "btn" : "btn alt"} onClick={() => setSection(id)}>{label}</button>)}
    </div>
    {error && <div className="notice error">{error}</div>}{notice && <div className="notice success">{notice}</div>}

    {section === "overview" && <>
      <div className="grid">
        {!teacher && <div className="card"><div className="muted">Total fee records</div><h2>{money(totalFees)}</h2></div>}
        {!teacher && <div className="card"><div className="muted">Payments received</div><h2>{money(totalPaid)}</h2></div>}
        {admin && <div className="card"><div className="muted">Expenses</div><h2>{money(totalExpenses)}</h2></div>}
        {canManage && <div className="card"><div className="muted">Students</div><h2>{students.length}</h2></div>}
        {admin && <div className="card"><div className="muted">Parents</div><h2>{records.parents.length}</h2></div>}
        <div className="card"><div className="muted">Exams</div><h2>{records.exams.length}</h2></div>
        <div className="card"><div className="muted">Announcements</div><h2>{records.events.length}</h2></div>
      </div>
      <Panel title="Recent announcements"><EventsList items={records.events.slice(0, 4)} admin={admin} onEdit={(x)=>startNew("events",x)} onDelete={(x)=>remove("events",x.id)}/></Panel>
    </>}

    {section === "events" && <Panel title="Events & announcements" action={admin && <button className="btn" onClick={()=>startNew("events")}>Add event</button>}>
      <EventsList items={records.events} admin={admin} onEdit={(x)=>startNew("events",x)} onDelete={(x)=>remove("events",x.id)}/>
    </Panel>}

    {section === "fees" && !teacher && <Panel title="Fees & payment history" action={admin && <button className="btn" onClick={()=>startNew("fees")}>Create fee</button>}>
      <div className="table-wrap"><table><thead><tr><th>Student</th><th>Amount</th><th>Due date</th><th>Status</th>{admin && <th>Actions</th>}</tr></thead><tbody>
        {records.fees.map((f)=><tr key={f.id}><td>{studentName(f.student_id)}</td><td>{money(f.amount)}</td><td>{dateLabel(f.due_date)}</td><td>{f.status || "pending"}</td>{admin && <td><button className="btn alt" onClick={()=>addPayment(f)}>Record payment</button> <button className="btn alt" onClick={()=>startNew("fees",f)}>Edit</button> <button className="btn alt" onClick={()=>remove("fees",f.id)}>Delete</button></td>}</tr>)}
      </tbody></table></div>
      {!records.fees.length && <p className="muted">No fee records found.</p>}
      <h3 style={{ marginTop: 22 }}>Payment history</h3>
      <div className="table-wrap"><table><thead><tr><th>Date</th><th>Amount</th><th>Method</th><th>Reference</th></tr></thead><tbody>
        {records.payments.map((p)=><tr key={p.id || `${p.fee_id}-${p.payment_date}`}><td>{dateLabel(p.payment_date)}</td><td>{money(p.amount)}</td><td>{p.payment_method || "—"}</td><td>{p.reference_number || "—"}</td></tr>)}
      </tbody></table></div>
      {!records.payments.length && <p className="muted">No payment history found.</p>}
    </Panel>}

    {section === "exams" && <>
      <Panel title="Exams" action={canManage && <button className="btn" onClick={()=>startNew("exams")}>Add exam</button>}>
        <div className="table-wrap"><table><thead><tr><th>Title</th><th>Subject</th><th>Batch</th><th>Date</th><th>Total marks</th>{canManage && <th>Actions</th>}</tr></thead><tbody>
          {records.exams.map((x)=><tr key={x.id}><td>{x.title}</td><td>{x.subject || "—"}</td><td>{batchName(x.batch_id)}</td><td>{dateLabel(x.exam_date)}</td><td>{x.total_marks ?? "—"}</td>{canManage && <td><button className="btn alt" onClick={()=>startNew("results",x)}>Enter results</button> <button className="btn alt" onClick={()=>startNew("exams",x)}>Edit</button>{admin && <> <button className="btn alt" onClick={()=>remove("exams",x.id,"Delete this exam? Delete its results first if it has any.")}>Delete</button></>}</td>}</tr>)}
        </tbody></table></div>
        {!records.exams.length && <p className="muted">No exams found.</p>}
      </Panel>
      <Panel title="Results">
        <div className="table-wrap"><table><thead><tr><th>Exam</th><th>Student</th><th>Marks</th></tr></thead><tbody>
          {records.results.map((r)=>{ const ex = examById(r.exam_id); return <tr key={`${r.exam_id}-${r.student_id}`}><td>{ex?.title || "Exam"}</td><td>{studentName(r.student_id)}</td><td>{r.marks_obtained}{ex?.total_marks ? ` / ${ex.total_marks}` : ""}</td></tr>; })}
        </tbody></table></div>
        {!records.results.length && <p className="muted">No results published yet.</p>}
      </Panel>
    </>}

    {section === "attendance" && canManage && <Panel
      title={teacher ? "My batch attendance" : "Attendance management"}
    >
      <p className="muted">
        {teacher
          ? "You can mark attendance only for your assigned batches."
          : "Select an institute batch to mark attendance."}
      </p>

      <div className="row" style={{ flexWrap: "wrap", alignItems: "end", gap: 12 }}>
        <label className="field" style={{ minWidth: 220, flex: 1 }}>
          Select batch
          <select
            value={attendanceBatch}
            onChange={(e) => {
              setAttendanceBatch(e.target.value);
              setAttendanceRows([]);
            }}
          >
            <option value="">Choose batch</option>
            {records.batches.map((batch) => (
              <option key={batch.id} value={batch.id}>{batch.name}</option>
            ))}
          </select>
        </label>

        <label className="field" style={{ minWidth: 180 }}>
          Attendance date
          <input
            type="date"
            value={attendanceDate}
            onChange={(e) => {
              setAttendanceDate(e.target.value);
              setAttendanceRows([]);
            }}
          />
        </label>

        <button
          className="btn"
          onClick={loadAttendance}
          disabled={attendanceLoading || !attendanceBatch}
        >
          {attendanceLoading ? "Loading..." : "Load students"}
        </button>
      </div>

      {attendanceRows.length > 0 && <>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Student</th>
                <th>Admission no.</th>
                <th>Attendance status</th>
              </tr>
            </thead>
            <tbody>
              {attendanceRows.map((student) => (
                <tr key={student.id}>
                  <td>{student.profiles?.full_name || student.admission_number || "Student"}</td>
                  <td>{student.admission_number || "—"}</td>
                  <td>
                    <select
                      value={student.attendance}
                      onChange={(e) =>
                        setAttendanceRows((rows) =>
                          rows.map((row) =>
                            row.id === student.id
                              ? { ...row, attendance: e.target.value }
                              : row
                          )
                        )
                      }
                    >
                      <option value="">Select status</option>
                      <option value="present">Present</option>
                      <option value="absent">Absent</option>
                      <option value="late">Late</option>
                      <option value="leave">Leave</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="row" style={{ justifyContent: "flex-end", marginTop: 14 }}>
          <button
            className="btn"
            onClick={saveAttendance}
            disabled={attendanceLoading}
          >
            {attendanceLoading ? "Saving..." : "Save attendance"}
          </button>
        </div>
      </>}

      {!attendanceLoading && attendanceBatch && attendanceRows.length === 0 && (
        <p className="muted">
          No students loaded. Select a date and click Load students.
        </p>
      )}
    </Panel>}
    
    {section === "students" && admin && <Panel title="Student records" action={<div className="row" style={{ flexWrap: "wrap" }}><button className="btn alt" onClick={addBatch}>Add batch</button><button className="btn" onClick={()=>startNew("students")}>Add student</button></div>}>
      <div className="table-wrap"><table><thead><tr><th>Name</th><th>Admission number</th><th>Batch</th><th>Actions</th></tr></thead><tbody>
        {students.map((s)=><tr key={s.id}><td>{s.profiles?.full_name || "Student"}</td><td>{s.admission_number || "—"}</td><td>{batchName(s.batch_id)}</td><td><button className="btn alt" onClick={()=>remove("users", s.profile_id, "Delete this student and their login? This cannot be undone.")}>Delete</button></td></tr>)}
      </tbody></table></div>
      {!students.length && <p className="muted">No students yet. Add a batch first, then add students.</p>}
    </Panel>}

    {section === "parents" && admin && <Panel title="Parents" action={<button className="btn" onClick={()=>startNew("parents")}>Add parent</button>}>
      <div className="table-wrap"><table><thead><tr><th>Name</th><th>Children</th><th>Actions</th></tr></thead><tbody>
        {records.parents.map((pr)=><tr key={pr.id}><td>{pr.full_name}</td><td>{pr.student_ids.length ? pr.student_ids.map((sid)=><span key={sid} style={{ display: "inline-block", marginRight: 8 }}>{studentName(sid)} <button className="btn alt" style={{ padding: "2px 8px" }} onClick={()=>unlink(pr.id, sid)}>✕</button></span>) : "—"}</td><td><button className="btn alt" onClick={()=>startNew("link",pr)}>Link student</button> <button className="btn alt" onClick={()=>remove("users", pr.id, "Delete this parent and their login? This cannot be undone.")}>Delete</button></td></tr>)}
      </tbody></table></div>
      {!records.parents.length && <p className="muted">No parents yet. Add a parent, then link them to their child.</p>}
    </Panel>}

    {section === "expenses" && admin && <Panel title="Expense management" action={<button className="btn" onClick={()=>startNew("expenses")}>Add expense</button>}>
      <div className="table-wrap"><table><thead><tr><th>Title</th><th>Category</th><th>Amount</th><th>Date</th><th>Description</th><th>Actions</th></tr></thead><tbody>
        {records.expenses.map((x)=><tr key={x.id}><td>{x.title}</td><td>{x.category || "—"}</td><td>{money(x.amount)}</td><td>{dateLabel(x.expense_date)}</td><td>{x.description || "—"}</td><td><button className="btn alt" onClick={()=>startNew("expenses",x)}>Edit</button> <button className="btn alt" onClick={()=>remove("expenses",x.id)}>Delete</button></td></tr>)}
      </tbody></table></div>
      {!records.expenses.length && <p className="muted">No expenses added yet.</p>}
    </Panel>}

    {dialog && <div className="modal-backdrop" onClick={(e)=>e.target===e.currentTarget&&closeDialog()}>
      <div className="card modal-card">
        <div className="row" style={{ justifyContent: "space-between" }}><h2>{edit && dialog !== "link" && dialog !== "results" ? "Edit" : dialog === "results" ? "Enter" : "Add"} {dialogTitle}</h2><button className="btn alt" onClick={closeDialog}>Close</button></div>
        {dialog === "fees" && <>
          <label className="field">Student<select value={form.student_id || ""} onChange={(e)=>setForm({...form,student_id:e.target.value})}><option value="">Choose student</option>{students.map((s)=><option key={s.id} value={s.id}>{s.profiles?.full_name || s.admission_number || s.id}</option>)}</select></label>
          <Input label="Amount" type="number" min="0.01" value={form.amount || ""} onChange={(e)=>setForm({...form,amount:e.target.value})}/>
          <Input label="Due date" type="date" value={form.due_date || ""} onChange={(e)=>setForm({...form,due_date:e.target.value})}/>
        </>}
        {dialog === "expenses" && <>
          <Input label="Title" value={form.title || ""} onChange={(e)=>setForm({...form,title:e.target.value})}/>
          <Input label="Category" value={form.category || ""} onChange={(e)=>setForm({...form,category:e.target.value})}/>
          <Input label="Amount" type="number" min="0.01" value={form.amount || ""} onChange={(e)=>setForm({...form,amount:e.target.value})}/>
          <Input label="Expense date" type="date" value={form.expense_date || ""} onChange={(e)=>setForm({...form,expense_date:e.target.value})}/>
          <label className="field">Description<textarea value={form.description || ""} onChange={(e)=>setForm({...form,description:e.target.value})}/></label>
        </>}
        {dialog === "events" && <>
          <Input label="Title" value={form.title || ""} onChange={(e)=>setForm({...form,title:e.target.value})}/>
          <label className="field">Description<textarea value={form.description || ""} onChange={(e)=>setForm({...form,description:e.target.value})}/></label>
          <Input label="Event date" type="date" value={form.event_date || ""} onChange={(e)=>setForm({...form,event_date:e.target.value})}/>
          <Input label="Event time" type="time" value={form.event_time || ""} onChange={(e)=>setForm({...form,event_time:e.target.value})}/>
          <Input label="Venue" value={form.venue || ""} onChange={(e)=>setForm({...form,venue:e.target.value})}/>
          <label className="field">Poster image (max 5 MB)<input type="file" accept="image/*" onChange={(e)=>uploadPoster(e.target.files?.[0])}/></label>
          {form.poster_url && <img src={form.poster_url} alt="Event poster preview" style={{ maxWidth: 190, maxHeight: 190, objectFit: "contain" }}/>}
        </>}
        {dialog === "exams" && <>
          <label className="field">Batch<select value={form.batch_id || ""} onChange={(e)=>setForm({...form,batch_id:e.target.value})}><option value="">Choose batch</option>{records.batches.map((b)=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
          <Input label="Exam title" value={form.title || ""} onChange={(e)=>setForm({...form,title:e.target.value})}/>
          <Input label="Subject" value={form.subject || ""} onChange={(e)=>setForm({...form,subject:e.target.value})}/>
          <Input label="Exam date" type="date" value={(form.exam_date || "").slice(0,10)} onChange={(e)=>setForm({...form,exam_date:e.target.value})}/>
          <Input label="Total marks" type="number" min="1" value={form.total_marks ?? ""} onChange={(e)=>setForm({...form,total_marks:e.target.value})}/>
        </>}
        {dialog === "students" && <>
          <Input label="Full name" value={form.full_name || ""} onChange={(e)=>setForm({...form,full_name:e.target.value})}/>
          <Input label="Email (login invitation is sent here)" type="email" value={form.email || ""} onChange={(e)=>setForm({...form,email:e.target.value})}/>
          <label className="field">Batch<select value={form.batch_id || ""} onChange={(e)=>setForm({...form,batch_id:e.target.value})}><option value="">No batch yet</option>{records.batches.map((b)=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
          <Input label="Admission number (optional)" value={form.admission_number || ""} onChange={(e)=>setForm({...form,admission_number:e.target.value})}/>
        </>}
        {dialog === "parents" && <>
          <Input label="Full name" value={form.full_name || ""} onChange={(e)=>setForm({...form,full_name:e.target.value})}/>
          <Input label="Email (login invitation is sent here)" type="email" value={form.email || ""} onChange={(e)=>setForm({...form,email:e.target.value})}/>
          <p className="muted">After adding the parent, use “Link student” to connect them to their child.</p>
        </>}
        {dialog === "link" && <>
          <p>Parent: <b>{edit?.full_name}</b></p>
          <label className="field">Student<select value={form.student_id || ""} onChange={(e)=>setForm({...form,student_id:e.target.value})}><option value="">Choose student</option>{students.map((s)=><option key={s.id} value={s.id}>{s.profiles?.full_name || s.admission_number || s.id}</option>)}</select></label>
        </>}
        {dialog === "results" && <>
          <p><b>{edit?.title}</b> · {batchName(edit?.batch_id)} · total {edit?.total_marks}</p>
          {!examStudents.length && <p className="muted">No students in this exam's batch yet.</p>}
          {examStudents.map((s)=><Input key={s.id} label={s.profiles?.full_name || s.admission_number || "Student"} type="number" min="0" max={edit?.total_marks} value={form.marks?.[s.id] ?? ""} onChange={(e)=>setForm({...form,marks:{...form.marks,[s.id]:e.target.value}})}/>)}
        </>}
        <div className="row" style={{ justifyContent: "flex-end", marginTop: 14 }}><button className="btn alt" onClick={closeDialog}>Cancel</button><button className="btn" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save"}</button></div>
      </div>
    </div>}
        <AIChat />
  </div>;
}

function EventsList({ items, admin, onEdit, onDelete }) {
  if (!items.length) return <p className="muted">No events or announcements yet.</p>;
  return <div>{items.map((event)=><div key={event.id} className="event-row">
    {event.poster_url && <img src={event.poster_url} alt="Event poster" className="event-poster"/>}
    <div style={{ flex: 1 }}><h3>{event.title}</h3><p className="muted">{dateLabel(event.event_date)} {event.event_time || ""} · {event.venue || "Venue not specified"}</p><p>{event.description}</p>
      {admin && <div className="row"><button className="btn alt" onClick={()=>onEdit(event)}>Edit</button><button className="btn alt" onClick={()=>onDelete(event)}>Delete</button></div>}
    </div>
  </div>)}</div>;
}
console.log("PORTAL VERSION 3 LOADED");

