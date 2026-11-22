import React, { useCallback, useEffect, useMemo, useState } from "react";
import { supabase, configured } from "./lib/supabase";

const API_URL = (import.meta.env.VITE_ADMIN_API_URL || "").replace(/\/$/, "");

const styles = `
*{box-sizing:border-box} .lms{font-family:Inter,system-ui,-apple-system,Segoe UI,sans-serif;color:#172033;min-height:100vh;background:#f5f7fb}
.lms button,.lms input,.lms select,.lms textarea{font:inherit}.lms button{cursor:pointer;border:0;border-radius:10px;padding:10px 14px;font-weight:650}
.lms .primary{background:#2457d6;color:#fff}.lms .secondary{background:#e9eefb;color:#2449a7}.lms .danger{background:#fff0f0;color:#b42318}
.lms .shell{display:grid;grid-template-columns:250px 1fr;min-height:100vh}.lms aside{background:#111c35;color:#fff;padding:22px 16px}
.lms .brand{font-size:19px;font-weight:800;margin:4px 8px 26px}.lms .nav{display:grid;gap:7px}.lms .nav button{background:transparent;color:#cbd5e8;text-align:left}.lms .nav button.active,.lms .nav button:hover{background:#263858;color:#fff}
.lms main{padding:26px;min-width:0}.lms .top{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:22px}
.lms h1{font-size:25px;margin:0 0 5px}.lms .muted{color:#68748a;font-size:13px}.lms .grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;margin:18px 0}
.lms .card{background:#fff;border:1px solid #e8ecf3;border-radius:15px;padding:17px;box-shadow:0 3px 12px #18274708}.lms .metric{font-size:25px;font-weight:800;margin-top:7px}
.lms .panel{background:#fff;border:1px solid #e8ecf3;border-radius:15px;padding:18px;margin-top:15px;overflow:hidden}
.lms .panel-head{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:14px}.lms h2{font-size:17px;margin:0}
.lms table{border-collapse:collapse;width:100%;min-width:600px}.lms th,.lms td{text-align:left;padding:12px 10px;border-bottom:1px solid #edf0f5;font-size:13px}.lms th{color:#667085;font-weight:700;background:#fafbfe}
.lms .table-wrap{overflow:auto}.lms .field{display:grid;gap:6px;margin-bottom:12px}.lms label{font-size:13px;font-weight:650;color:#344054}
.lms input,.lms select,.lms textarea{width:100%;border:1px solid #d8deea;border-radius:9px;padding:10px 11px;background:#fff;color:#172033}.lms textarea{min-height:80px;resize:vertical}
.lms .formgrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.lms .actions{display:flex;gap:8px;flex-wrap:wrap}.lms .tag{display:inline-block;border-radius:20px;padding:4px 9px;background:#edf2ff;color:#2449a7;font-size:11px;font-weight:700}
.lms .notice{padding:12px 14px;border-radius:10px;background:#fff8e7;color:#805b13;margin:12px 0;font-size:13px}.lms .error{background:#fff0f0;color:#b42318}.lms .success{background:#ecfdf3;color:#067647}
.lms .login{max-width:430px;margin:7vh auto;padding:26px}.lms .event{display:flex;gap:15px;align-items:flex-start}.lms .poster{width:110px;height:110px;object-fit:cover;border-radius:10px;background:#eef1f6}
.lms .empty{padding:25px;text-align:center;color:#778196;font-size:14px}.lms .mobile-menu{display:none}
@media(max-width:850px){.lms .shell{grid-template-columns:1fr}.lms aside{padding:12px;position:sticky;top:0;z-index:3}.lms .brand{margin:3px 5px 10px}.lms .nav{display:flex;overflow:auto}.lms .nav button{white-space:nowrap;padding:9px}.lms main{padding:16px}.lms .grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:520px){.lms .formgrid{grid-template-columns:1fr}.lms .top{align-items:flex-start;flex-direction:column}.lms h1{font-size:22px}.lms .grid{gap:9px}.lms .card{padding:13px}.lms .metric{font-size:21px}}
`;

const money = (n) => `₹${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const dateText = (v) => v ? new Date(v).toLocaleDateString("en-IN") : "—";

async function api(path, token, options = {}) {
  if (!API_URL) throw new Error("VITE_ADMIN_API_URL is not configured.");
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error || payload.message || `Request failed (${response.status})`);
  }
  return payload.data ?? payload;
}

function Field({ label, children }) {
  return <div className="field"><label>{label}</label>{children}</div>;
}

function Modal({ title, onClose, children }) {
  return <div onMouseDown={(e) => e.target === e.currentTarget && onClose()} style={{position:"fixed",inset:0,background:"#10182888",zIndex:10,display:"grid",placeItems:"center",padding:16}}>
    <div className="card" style={{width:"min(620px,100%)",maxHeight:"90vh",overflow:"auto"}}>
      <div className="panel-head"><h2>{title}</h2><button className="secondary" onClick={onClose}>Close</button></div>
      {children}
    </div>
  </div>;
}

export default function Portal() {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [profiles, setProfiles] = useState([]);
  const [page, setPage] = useState("dashboard");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [data, setData] = useState({ fees: [], payments: [], expenses: [], events: [] });
  const [students, setStudents] = useState([]);
  const [modal, setModal] = useState("");
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({});
  const [login, setLogin] = useState({ email: "", password: "" });

  const role = profile?.role || "";
  const isAdmin = role === "admin";
  const token = session?.access_token;

  const loadProfile = useCallback(async (authSession) => {
    if (!authSession?.user) { setProfile(null); setProfiles([]); return; }
    const { data: links, error: linkError } = await supabase
      .from("user_profile_links").select("profile_id, profiles(*)")
      .eq("auth_user_id", authSession.user.id);
    if (linkError) throw linkError;
    const available = (links || []).map((x) => x.profiles).filter(Boolean);
    setProfiles(available);
    if (!available.length) { setProfile(null); return; }
    const { data: active } = await supabase.from("active_profile_sessions")
      .select("profile_id").eq("auth_user_id", authSession.user.id).maybeSingle();
    const selected = available.find((p) => p.id === active?.profile_id) || available[0];
    setProfile(selected);
  }, []);

  const refresh = useCallback(async () => {
    if (!token || !profile) return;
    setBusy(true); setError("");
    try {
      const [fees, expenses, events, payments, studentRows] = await Promise.all([
        api("/api/fees", token).catch(() => []),
        api("/api/expenses", token).catch(() => []),
        api("/api/events", token).catch(() => []),
        api("/api/payments", token).catch(() => []),
        isAdmin ? supabase.from("students").select("id,profile_id,admission_number,profiles:profile_id(full_name)").eq("institute_id", profile.institute_id) : Promise.resolve({data:[]}),
      ]);
      setData({
        fees: Array.isArray(fees) ? fees : fees.items || [],
        expenses: Array.isArray(expenses) ? expenses : expenses.items || [],
        events: Array.isArray(events) ? events : events.items || [],
        payments: Array.isArray(payments) ? payments : payments.items || [],
      });
      setStudents(studentRows?.data || []);
    } catch (e) { setError(e.message || "Could not load portal data."); }
    finally { setBusy(false); }
  }, [token, profile, isAdmin]);

  useEffect(() => {
    if (!configured) { setLoading(false); setError("Supabase is not configured. Check your environment variables."); return; }
    supabase.auth.getSession().then(async ({ data: { session: s } }) => {
      setSession(s);
      try { await loadProfile(s); } catch (e) { setError(e.message); }
      setLoading(false);
    });
    const { data: listener } = supabase.auth.onAuthStateChange(async (_event, s) => {
      setSession(s);
      try { await loadProfile(s); } catch (e) { setError(e.message); }
    });
    return () => listener.subscription.unsubscribe();
  }, [loadProfile]);

  useEffect(() => { refresh(); }, [refresh]);

  const signIn = async (e) => {
    e.preventDefault(); setBusy(true); setError("");
    const { data: result, error: err } = await supabase.auth.signInWithPassword(login);
    if (err) setError(err.message);
    else { setSession(result.session); try { await loadProfile(result.session); } catch (x) { setError(x.message); } }
    setBusy(false);
  };

  const signOut = async () => { await supabase.auth.signOut(); setSession(null); setProfile(null); setProfiles([]); };
  const selectProfile = async (p) => {
    setBusy(true); setError("");
    try {
      await api("/api/select-profile", token, { method: "POST", body: JSON.stringify({ profile_id: p.id }) });
      await supabase.auth.refreshSession();
      setProfile(p);
      setPage("dashboard");
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  const saveRecord = async (kind) => {
    setBusy(true); setError(""); setMessage("");
    try {
      const path = `/api/${kind}${editing?.id ? `/${editing.id}` : ""}`;
      const method = editing?.id ? "PATCH" : "POST";
      await api(path, token, { method, body: JSON.stringify(form) });
      setModal(""); setEditing(null); setForm({});
      setMessage("Saved successfully.");
      await refresh();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  const deleteRecord = async (kind, id) => {
    if (!window.confirm("Are you sure you want to delete this record?")) return;
    setBusy(true); setError("");
    try { await api(`/api/${kind}/${id}`, token, { method: "DELETE" }); setMessage("Deleted successfully."); await refresh(); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  const openNew = (kind, record = null) => {
    setEditing(record);
    setForm(record ? { ...record } : kind === "fees" ? { student_id:"", amount:"", due_date:"" } : kind === "expenses" ? { title:"", category:"", amount:"", expense_date:new Date().toISOString().slice(0,10), description:"" } : { title:"", description:"", event_date:"", event_time:"", venue:"", poster_url:"" });
    setModal(kind);
  };

  const totals = useMemo(() => ({
    fees: data.fees.reduce((s, x) => s + Number(x.amount || 0), 0),
    expenses: data.expenses.reduce((s, x) => s + Number(x.amount || 0), 0),
    received: data.payments.reduce((s, x) => s + Number(x.amount || 0), 0),
  }), [data]);

  const recordPayment = async (fee) => {
    const amount = window.prompt(`Payment amount for fee ${money(fee.amount)}:`);
    if (!amount) return;
    const numeric = Number(amount);
    if (!Number.isFinite(numeric) || numeric <= 0) { setError("Enter a valid payment amount."); return; }
    const payment_method = window.prompt("Payment method (Cash / UPI / Bank):", "Cash") || "Cash";
    setBusy(true); setError("");
    try {
      await api("/api/payments", token, { method:"POST", body:JSON.stringify({ fee_id:fee.id, student_id:fee.student_id, amount:numeric, payment_method }) });
      setMessage("Payment recorded."); await refresh();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  const uploadPoster = async (file) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) { setError("Please select an image file."); return; }
    if (file.size > 5 * 1024 * 1024) { setError("Poster must be smaller than 5 MB."); return; }
    setBusy(true); setError("");
    try {
      const ext = file.name.split(".").pop() || "jpg";
      const path = `event-posters/${profile.institute_id}/${Date.now()}.${ext}`;
      const { error: uploadError } = await supabase.storage.from("lms-files").upload(path, file, { upsert:false, contentType:file.type });
      if (uploadError) throw uploadError;
      const { data: signed, error: signedError } = await supabase.storage.from("lms-files").createSignedUrl(path, 60 * 60 * 24 * 30);
      if (signedError) throw signedError;
      setForm((f) => ({ ...f, poster_url:signed.signedUrl }));
      setMessage("Poster uploaded. Save the event to publish it.");
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  if (loading) return <div className="lms"><style>{styles}</style><div className="empty">Loading portal…</div></div>;

  if (!session) return <div className="lms"><style>{styles}</style><div className="card login">
    <h1>Coaching Portal</h1><p className="muted">Sign in to continue to your institute portal.</p>
    {error && <div className="notice error">{error}</div>}
    <form onSubmit={signIn}>
      <Field label="Email"><input type="email" required value={login.email} onChange={(e)=>setLogin({...login,email:e.target.value})}/></Field>
      <Field label="Password"><input type="password" required value={login.password} onChange={(e)=>setLogin({...login,password:e.target.value})}/></Field>
      <button className="primary" disabled={busy} style={{width:"100%"}}>{busy ? "Signing in…" : "Sign in"}</button>
    </form>
  </div></div>;

  if (!profile) return <div className="lms"><style>{styles}</style><div className="card login">
    <h1>No institute profile linked</h1><p className="muted">You are signed in as {session.user.email}. Ask your institute admin to link this account to a student, parent, or teacher profile.</p>
    {error && <div className="notice error">{error}</div>}<button className="secondary" onClick={signOut}>Sign out</button>
  </div></div>;

  const nav = [
    ["dashboard","Dashboard"],["events","Events & Announcements"],["fees","Fees & Payments"],
    ...(isAdmin ? [["expenses","Expenses"],["students","Students"]] : []),
  ];

  return <div className="lms"><style>{styles}</style><div className="shell">
    <aside>
      <div className="brand">Coaching Portal</div>
      <div className="muted" style={{color:"#aab7ce",margin:"0 8px 15px"}}>{profile.full_name || profile.email || "Institute user"} · {role}</div>
      <nav className="nav">{nav.map(([id,label])=><button key={id} className={page===id?"active":""} onClick={()=>setPage(id)}>{label}</button>)}</nav>
      <button onClick={signOut} style={{marginTop:22,background:"#263858",color:"#fff",width:"100%"}}>Sign out</button>
    </aside>
    <main>
      <div className="top"><div><h1>{nav.find(x=>x[0]===page)?.[1] || "Dashboard"}</h1><div className="muted">{profile.institute_name || "Institute workspace"}</div></div>
        <div className="actions"><span className="tag">{role.toUpperCase()}</span><button className="secondary" onClick={refresh} disabled={busy}>{busy?"Loading…":"Refresh"}</button></div>
      </div>
      {error && <div className="notice error">{error}</div>}{message && <div className="notice success">{message}</div>}
      {profiles.length>1 && <div className="panel"><div className="panel-head"><h2>Switch profile</h2></div><div className="actions">{profiles.map(p=><button key={p.id} className={p.id===profile.id?"primary":"secondary"} onClick={()=>selectProfile(p)}>{p.role}: {p.full_name}</button>)}</div></div>}

      {page==="dashboard" && <>
        <div className="grid">
          <div className="card"><div className="muted">Total fees</div><div className="metric">{money(totals.fees)}</div></div>
          <div className="card"><div className="muted">Payments received</div><div className="metric">{money(totals.received)}</div></div>
          {isAdmin && <div className="card"><div className="muted">Expenses</div><div className="metric">{money(totals.expenses)}</div></div>}
          <div className="card"><div className="muted">Upcoming / listed events</div><div className="metric">{data.events.length}</div></div>
        </div>
        <div className="panel"><div className="panel-head"><h2>Latest announcements</h2><button className="secondary" onClick={()=>setPage("events")}>View all</button></div>
          {data.events.slice(0,3).map(ev=><div className="event" key={ev.id} style={{padding:"10px 0",borderBottom:"1px solid #edf0f5"}}>{ev.poster_url && <img className="poster" src={ev.poster_url} alt="Event poster"/>}<div><b>{ev.title}</b><div className="muted">{dateText(ev.event_date)} {ev.event_time || ""} · {ev.venue || "Venue not specified"}</div><p>{ev.description}</p></div></div>)}
          {!data.events.length && <div className="empty">No announcements yet.</div>}
        </div>
      </>}

      {page==="events" && <div className="panel">
        <div className="panel-head"><h2>Events & Announcements</h2>{isAdmin && <button className="primary" onClick={()=>openNew("events")}>Add event</button>}</div>
        {data.events.map(ev=><div className="event" key={ev.id} style={{padding:"14px 0",borderBottom:"1px solid #edf0f5"}}>
          {ev.poster_url ? <img className="poster" src={ev.poster_url} alt="Event poster"/> : <div className="poster" style={{display:"grid",placeItems:"center"}}>Event</div>}
          <div style={{flex:1}}><b>{ev.title}</b><div className="muted">{dateText(ev.event_date)} {ev.event_time || ""} · {ev.venue || "Venue not specified"}</div><p>{ev.description}</p>
          {isAdmin && <div className="actions"><button className="secondary" onClick={()=>openNew("events",ev)}>Edit</button><button className="danger" onClick={()=>deleteRecord("events",ev.id)}>Delete</button></div>}</div>
        </div>)}
        {!data.events.length && <div className="empty">No events or announcements available.</div>}
      </div>}

      {page==="fees" && <div className="panel">
        <div className="panel-head"><h2>{isAdmin?"Fee records":"My fee details"}</h2>{isAdmin && <button className="primary" onClick={()=>openNew("fees")}>Create fee</button>}</div>
        <div className="table-wrap"><table><thead><tr><th>Student</th><th>Amount</th><th>Due date</th><th>Status</th>{isAdmin&&<th>Actions</th>}</tr></thead><tbody>
          {data.fees.map(f=><tr key={f.id}><td>{students.find(s=>s.id===f.student_id)?.profiles?.full_name || f.student_name || f.student_id || "Student"}</td><td>{money(f.amount)}</td><td>{dateText(f.due_date)}</td><td><span className="tag">{f.status || "pending"}</span></td>{isAdmin&&<td><div className="actions"><button className="secondary" onClick={()=>recordPayment(f)}>Record payment</button><button className="secondary" onClick={()=>openNew("fees",f)}>Edit</button><button className="danger" onClick={()=>deleteRecord("fees",f.id)}>Delete</button></div></td>}</tr>)}
        </tbody></table></div>{!data.fees.length&&<div className="empty">No fee records found.</div>}
        <div className="panel" style={{marginTop:18}}><h2>Payment history</h2><div className="table-wrap"><table><thead><tr><th>Date</th><th>Amount</th><th>Method</th><th>Reference</th></tr></thead><tbody>
          {data.payments.map(p=><tr key={p.id}><td>{dateText(p.payment_date)}</td><td>{money(p.amount)}</td><td>{p.payment_method || "—"}</td><td>{p.reference_number || "—"}</td></tr>)}
        </tbody></table></div>{!data.payments.length&&<div className="empty">No payment history found.</div>}</div>
      </div>}

      {page==="expenses" && isAdmin && <div className="panel">
        <div className="panel-head"><h2>Expense records</h2><button className="primary" onClick={()=>openNew("expenses")}>Add expense</button></div>
        <div className="table-wrap"><table><thead><tr><th>Title</th><th>Category</th><th>Amount</th><th>Date</th><th>Description</th><th>Actions</th></tr></thead><tbody>
          {data.expenses.map(x=><tr key={x.id}><td>{x.title}</td><td>{x.category || "—"}</td><td>{money(x.amount)}</td><td>{dateText(x.expense_date)}</td><td>{x.description || "—"}</td><td><div className="actions"><button className="secondary" onClick={()=>openNew("expenses",x)}>Edit</button><button className="danger" onClick={()=>deleteRecord("expenses",x.id)}>Delete</button></div></td></tr>)}
        </tbody></table></div>{!data.expenses.length&&<div className="empty">No expenses added yet.</div>}
      </div>}

      {page==="students" && isAdmin && <div className="panel"><div className="panel-head"><h2>Students</h2></div>
        <div className="table-wrap"><table><thead><tr><th>Name</th><th>Admission number</th><th>Student record ID</th></tr></thead><tbody>
          {students.map(s=><tr key={s.id}><td>{s.profiles?.full_name || "Student"}</td><td>{s.admission_number || "—"}</td><td>{s.id}</td></tr>)}
        </tbody></table></div>{!students.length&&<div className="empty">No student records found.</div>}
      </div>}
    </main>
  </div>

  {modal && <Modal title={`${editing?"Edit":"Add"} ${modal==="events"?"event":modal==="fees"?"fee":"expense"}`} onClose={()=>setModal("")}>
    {modal==="fees" && <><Field label="Student"><select value={form.student_id||""} onChange={e=>setForm({...form,student_id:e.target.value})}><option value="">Select student</option>{students.map(s=><option key={s.id} value={s.id}>{s.profiles?.full_name || s.admission_number || s.id}</option>)}</select></Field><div className="formgrid"><Field label="Fee amount"><input type="number" min="1" value={form.amount||""} onChange={e=>setForm({...form,amount:e.target.value})}/></Field><Field label="Due date"><input type="date" value={form.due_date||""} onChange={e=>setForm({...form,due_date:e.target.value})}/></Field></div></>}
    {modal==="expenses" && <><Field label="Title"><input value={form.title||""} onChange={e=>setForm({...form,title:e.target.value})}/></Field><div className="formgrid"><Field label="Category"><input value={form.category||""} onChange={e=>setForm({...form,category:e.target.value})}/></Field><Field label="Amount"><input type="number" min="0" value={form.amount||""} onChange={e=>setForm({...form,amount:e.target.value})}/></Field></div><Field label="Expense date"><input type="date" value={form.expense_date||""} onChange={e=>setForm({...form,expense_date:e.target.value})}/></Field><Field label="Description"><textarea value={form.description||""} onChange={e=>setForm({...form,description:e.target.value})}/></Field></>}
    {modal==="events" && <><Field label="Event title"><input value={form.title||""} onChange={e=>setForm({...form,title:e.target.value})}/></Field><Field label="Description"><textarea value={form.description||""} onChange={e=>setForm({...form,description:e.target.value})}/></Field><div className="formgrid"><Field label="Event date"><input type="date" value={form.event_date||""} onChange={e=>setForm({...form,event_date:e.target.value})}/></Field><Field label="Event time"><input type="time" value={form.event_time||""} onChange={e=>setForm({...form,event_time:e.target.value})}/></Field></div><Field label="Venue"><input value={form.venue||""} onChange={e=>setForm({...form,venue:e.target.value})}/></Field><Field label="Poster image (max 5 MB)"><input type="file" accept="image/*" onChange={e=>uploadPoster(e.target.files?.[0])}/></Field>{form.poster_url&&<img src={form.poster_url} alt="Poster preview" style={{maxWidth:"180px",maxHeight:180,objectFit:"contain"}}/>}</>}
    {error&&<div className="notice error">{error}</div>}<div className="actions" style={{justifyContent:"flex-end",marginTop:14}}><button className="secondary" onClick={()=>setModal("")}>Cancel</button><button className="primary" disabled={busy} onClick={()=>saveRecord(modal)}>{busy?"Saving…":"Save"}</button></div>
  </Modal>}
  </div>;
}
