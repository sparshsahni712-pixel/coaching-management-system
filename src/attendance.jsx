import React, { useEffect, useMemo, useState } from "react";
import { Avatar } from "./avatar";

const STATUS = {
  present: { label: "Present", color: "#16A34A" },
  absent: { label: "Absent", color: "#DC2626" },
  late: { label: "Late", color: "#D97706" },
};
const asRows = (v) => (Array.isArray(v) ? v : Array.isArray(v?.items) ? v.items : []);

export const localDate = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const monthRange = (ym) => {
  const [y, m] = ym.split("-").map(Number);
  return [`${ym}-01`, `${ym}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}`];
};
const dLabel = (v) => v ? new Date(`${v}T00:00:00`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";
const mLabel = (ym) => new Date(`${ym}-01T00:00:00`).toLocaleDateString("en-IN", { month: "long", year: "numeric" });

function tally(rows) {
  const t = { present: 0, absent: 0, late: 0, total: 0 };
  rows.forEach((r) => { if (t[r.status] !== undefined) { t[r.status] += 1; t.total += 1; } });
  // Late still counts as attended.
  t.pct = t.total ? Math.round(((t.present + t.late) / t.total) * 1000) / 10 : null;
  return t;
}
const fmtPct = (v) => (v === null || v === undefined ? "—" : `${v}%`);

function useRecords(api, query, enabled = true) {
  const [state, setState] = useState({ rows: [], loading: enabled, error: "" });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!enabled) { setState({ rows: [], loading: false, error: "" }); return undefined; }
    let live = true;
    setState((s) => ({ ...s, loading: true, error: "" }));
    api(`/api/attendance${query}`)
      .then((r) => { if (live) setState({ rows: asRows(r), loading: false, error: "" }); })
      .catch((e) => { if (live) setState({ rows: [], loading: false, error: e.message || "Could not load attendance." }); });
    return () => { live = false; };
  }, [api, query, enabled, tick]);
  return { ...state, reload: () => setTick((t) => t + 1) };
}

function Pill({ status }) {
  const s = STATUS[status];
  return <span className="pill" style={{ background: s?.color || "#64748B" }}>{s?.label || status}</span>;
}
function Note({ type, children }) {
  return <div className={`notice ${type || ""}`}>{children}</div>;
}
function Loading() { return <p className="muted" role="status">Loading attendance…</p>; }
function Stat({ label, value, sub, color }) {
  return <div className="card stat"><small>{label}</small><strong style={{ color }}>{value}</strong>{sub && <div className="muted" style={{ fontSize: 12 }}>{sub}</div>}</div>;
}

/* ---------------- Dashboard ---------------- */
function AttendanceDashboard({ api, students, batches }) {
  const today = localDate();
  const monthStart = `${today.slice(0, 7)}-01`;
  const rec = useRecords(api, `?from=${monthStart}&to=${today}`);
  const todayRows = useMemo(() => rec.rows.filter((r) => r.attendance_date === today), [rec.rows, today]);
  const t = tally(todayRows);
  const m = tally(rec.rows);
  const notMarked = Math.max(students.length - t.total, 0);

  const perBatch = batches.map((b) => {
    const ids = students.filter((s) => s.batch_id === b.id);
    const rows = todayRows.filter((r) => r.batch_id === b.id);
    const bt = tally(rows);
    return { b, count: ids.length, ...bt, none: Math.max(ids.length - bt.total, 0) };
  }).filter((x) => x.count > 0);

  if (rec.loading) return <Loading />;
  return <>
    {rec.error && <Note type="error">{rec.error}</Note>}
    <div className="grid">
      <Stat label="Total students" value={students.length} />
      <Stat label="Present today" value={t.present + t.late} sub={t.late ? `${t.late} of them late` : ""} color="#16A34A" />
      <Stat label="Absent today" value={t.absent} color="#DC2626" />
      <Stat label="Attendance today" value={fmtPct(t.pct)} sub={t.total ? `${t.total} marked, ${notMarked} not marked` : "Not marked yet"} />
      <Stat label={`Attendance this month`} value={fmtPct(m.pct)} sub={`${m.total} records`} />
    </div>
    <section className="card" style={{ marginTop: 16 }}>
      <h3>Today's summary · {dLabel(today)}</h3>
      {!perBatch.length ? <p className="muted">No students in any batch yet. Add students to a batch to start marking attendance.</p> :
        <div className="table-wrap"><table><thead><tr><th>Batch</th><th>Students</th><th>Present</th><th>Late</th><th>Absent</th><th>Not marked</th><th>%</th></tr></thead><tbody>
          {perBatch.map((x) => <tr key={x.b.id}><td>{x.b.name}</td><td>{x.count}</td><td>{x.present}</td><td>{x.late}</td><td>{x.absent}</td><td>{x.none}</td><td>{fmtPct(x.pct)}</td></tr>)}
        </tbody></table></div>}
      <p className="muted" style={{ fontSize: 12 }}>Attendance % counts Present and Late as attended, out of students marked.</p>
    </section>
  </>;
}

/* ---------------- Mark attendance ---------------- */
function MarkAttendance({ api, role, students, batches, nameOf, avatarOf }) {
  const options = role === "admin" ? batches : batches.filter((b) => students.some((s) => s.batch_id === b.id));
  const [batchId, setBatchId] = useState("");
  const [date, setDate] = useState(localDate());
  const [marks, setMarks] = useState({});
  const [saved, setSaved] = useState({});
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);
  const ready = Boolean(batchId && date);
  const rec = useRecords(api, ready ? `?batch_id=${batchId}&from=${date}&to=${date}` : "", ready);

  useEffect(() => {
    const m = {};
    rec.rows.forEach((r) => { m[r.student_id] = r.status; });
    setMarks(m); setSaved(m);
  }, [rec.rows]);
  useEffect(() => { setMsg(null); }, [batchId, date]);

  const list = useMemo(() => students.filter((s) => s.batch_id === batchId)
    .sort((a, b) => nameOf(a).localeCompare(nameOf(b))), [students, batchId, nameOf]);
  const c = tally(list.map((s) => ({ status: marks[s.id] })).filter((r) => r.status));
  const unmarked = list.filter((s) => !marks[s.id]);
  const editing = Object.keys(saved).length > 0;
  const dirty = list.some((s) => marks[s.id] !== saved[s.id]);

  const setAll = (status) => setMarks(Object.fromEntries(list.map((s) => [s.id, status])));
  const save = async () => {
    if (!list.length) return;
    if (unmarked.length) { setMsg({ type: "error", text: `Mark ${unmarked.length} more student${unmarked.length > 1 ? "s" : ""} (or use "Mark all present") before saving.` }); return; }
    setSaving(true); setMsg(null);
    try {
      await api("/api/attendance", { method: "POST", body: JSON.stringify({ batch_id: batchId, date, records: list.map((s) => ({ student_id: s.id, status: marks[s.id] })) }) });
      setMsg({ type: "success", text: `Attendance saved for ${list.length} students on ${dLabel(date)}.` });
      rec.reload();
    } catch (e) { setMsg({ type: "error", text: e.message || "Could not save attendance." }); }
    finally { setSaving(false); }
  };

  return <section className="card">
    <h3>Mark attendance</h3>
    <div className="att-filters">
      <label className="field">Batch<select value={batchId} onChange={(e) => setBatchId(e.target.value)}><option value="">Choose batch</option>{options.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
      <label className="field">Date<input type="date" max={localDate()} value={date} onChange={(e) => setDate(e.target.value)} /></label>
    </div>
    {!options.length && <p className="muted">No batches with students yet. Add a batch and students first.</p>}
    {msg && <Note type={msg.type}>{msg.text}</Note>}
    {rec.error && <Note type="error">{rec.error}</Note>}
    {!ready && options.length > 0 && <p className="muted">Select a batch and date to load students.</p>}
    {ready && rec.loading && <Loading />}
    {ready && !rec.loading && !list.length && <p className="muted">This batch has no students yet.</p>}
    {ready && !rec.loading && list.length > 0 && <>
      {editing && <Note>Attendance for this date is already recorded. You are editing it.</Note>}
      <div className="row" style={{ margin: "8px 0" }}>
        <button className="btn alt sm" onClick={() => setAll("present")}>Mark all present</button>
        <button className="btn alt sm" onClick={() => setAll("absent")}>Mark all absent</button>
        <span className="muted">Present {c.present} · Late {c.late} · Absent {c.absent} · Unmarked {unmarked.length}</span>
      </div>
      <div className="att-list">
        {list.map((s) => <div className="att-row" key={s.id}>
          <div className="att-who"><Avatar name={nameOf(s)} src={avatarOf(s)} size={34} /><span>{nameOf(s)}</span></div>
          <div className="att-btns" role="group" aria-label={`Attendance for ${nameOf(s)}`}>
            {Object.entries(STATUS).map(([k, v]) => <button key={k} type="button" aria-pressed={marks[s.id] === k}
              className={`att-btn ${marks[s.id] === k ? "on" : ""}`} style={marks[s.id] === k ? { background: v.color, borderColor: v.color, color: "#fff" } : { color: v.color, borderColor: v.color }}
              onClick={() => setMarks((m) => ({ ...m, [s.id]: k }))}>{v.label}</button>)}
          </div>
        </div>)}
      </div>
      <div className="row" style={{ justifyContent: "flex-end", marginTop: 14 }}>
        <button className="btn" disabled={saving || (editing && !dirty)} onClick={save}>{saving ? "Saving…" : editing ? "Update attendance" : "Save attendance"}</button>
      </div>
    </>}
  </section>;
}

/* ---------------- History + individual student ---------------- */
function StudentHistory({ api, student, nameOf, avatarOf, batchName, onBack }) {
  const rec = useRecords(api, `?student_id=${student.id}`);
  const t = tally(rec.rows);
  const months = useMemo(() => {
    const map = {};
    rec.rows.forEach((r) => { const k = r.attendance_date.slice(0, 7); (map[k] = map[k] || []).push(r); });
    return Object.entries(map).sort((a, b) => b[0].localeCompare(a[0])).map(([k, rows]) => [k, tally(rows)]);
  }, [rec.rows]);
  return <section className="card">
    <div className="row" style={{ justifyContent: "space-between" }}>
      <div className="row"><Avatar name={nameOf(student)} src={avatarOf(student)} size={44} /><div><h3 style={{ margin: 0 }}>{nameOf(student)}</h3><span className="muted">{batchName(student.batch_id)}</span></div></div>
      {onBack && <button className="btn alt sm" onClick={onBack}>Back</button>}
    </div>
    {rec.loading ? <Loading /> : <>
      {rec.error && <Note type="error">{rec.error}</Note>}
      <div className="grid" style={{ margin: "14px 0" }}>
        <Stat label="Attendance" value={fmtPct(t.pct)} sub={`${t.total} days recorded`} />
        <Stat label="Present" value={t.present} color="#16A34A" />
        <Stat label="Late" value={t.late} color="#D97706" />
        <Stat label="Absent" value={t.absent} color="#DC2626" />
      </div>
      {!rec.rows.length ? <p className="muted">No attendance has been recorded for this student yet.</p> : <>
        <h4>Monthly records</h4>
        <div className="table-wrap"><table><thead><tr><th>Month</th><th>Present</th><th>Late</th><th>Absent</th><th>%</th></tr></thead><tbody>
          {months.map(([k, x]) => <tr key={k}><td>{mLabel(k)}</td><td>{x.present}</td><td>{x.late}</td><td>{x.absent}</td><td>{fmtPct(x.pct)}</td></tr>)}
        </tbody></table></div>
        <h4 style={{ marginTop: 16 }}>Daily history</h4>
        <div className="table-wrap"><table><thead><tr><th>Date</th><th>Status</th></tr></thead><tbody>
          {rec.rows.slice(0, 120).map((r) => <tr key={r.id || r.attendance_date}><td>{dLabel(r.attendance_date)}</td><td><Pill status={r.status} /></td></tr>)}
        </tbody></table></div>
        {rec.rows.length > 120 && <p className="muted">Showing the latest 120 days.</p>}
      </>}
    </>}
  </section>;
}

function AttendanceHistory({ api, role, students, batches, nameOf, avatarOf, batchName }) {
  const own = role === "student" || role === "parent";
  const [q, setQ] = useState("");
  const [batchId, setBatchId] = useState("");
  const [month, setMonth] = useState(localDate().slice(0, 7));
  const [day, setDay] = useState("");
  const [picked, setPicked] = useState(own && students.length === 1 ? students[0] : null);
  const [from, to] = day ? [day, day] : monthRange(month || localDate().slice(0, 7));
  const rec = useRecords(api, `?from=${from}&to=${to}${batchId ? `&batch_id=${batchId}` : ""}`, !picked);

  const byId = useMemo(() => Object.fromEntries(students.map((s) => [s.id, s])), [students]);
  const needle = q.trim().toLowerCase();
  const people = useMemo(() => students
    .filter((s) => (!batchId || s.batch_id === batchId) && (!needle || nameOf(s).toLowerCase().includes(needle)))
    .sort((a, b) => nameOf(a).localeCompare(nameOf(b)))
    .map((s) => ({ s, ...tally(rec.rows.filter((r) => r.student_id === s.id)) })), [students, batchId, needle, rec.rows, nameOf]);
  const detail = useMemo(() => rec.rows
    .filter((r) => byId[r.student_id] && (!needle || nameOf(byId[r.student_id]).toLowerCase().includes(needle))), [rec.rows, byId, needle, nameOf]);

  if (picked) return <StudentHistory api={api} student={picked} nameOf={nameOf} avatarOf={avatarOf} batchName={batchName} onBack={own && students.length === 1 ? null : () => setPicked(null)} />;

  return <section className="card">
    <h3>Attendance history</h3>
    <div className="att-filters">
      <label className="field">Search student<input placeholder="Student name" value={q} onChange={(e) => setQ(e.target.value)} /></label>
      <label className="field">Batch<select value={batchId} onChange={(e) => setBatchId(e.target.value)}><option value="">All batches</option>{batches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
      <label className="field">Month<input type="month" value={month} onChange={(e) => { setMonth(e.target.value); setDay(""); }} /></label>
      <label className="field">Specific date (optional)<input type="date" value={day} onChange={(e) => setDay(e.target.value)} /></label>
    </div>
    {rec.error && <Note type="error">{rec.error}</Note>}
    {rec.loading ? <Loading /> : <>
      <p className="muted">{day ? dLabel(day) : mLabel(month)} · {rec.rows.length} records</p>
      <h4>Student summary</h4>
      {!people.length ? <p className="muted">No students match these filters.</p> :
        <div className="table-wrap"><table><thead><tr><th>Student</th><th>Present</th><th>Late</th><th>Absent</th><th>%</th></tr></thead><tbody>
          {people.map((x) => <tr key={x.s.id}>
            <td><button className="linkbtn" onClick={() => setPicked(x.s)}><Avatar name={nameOf(x.s)} src={avatarOf(x.s)} size={28} /> {nameOf(x.s)}</button></td>
            <td>{x.present}</td><td>{x.late}</td><td>{x.absent}</td><td>{fmtPct(x.pct)}</td></tr>)}
        </tbody></table></div>}
      <h4 style={{ marginTop: 18 }}>Daily records</h4>
      {!detail.length ? <p className="muted">No attendance recorded for this period.</p> :
        <div className="table-wrap"><table><thead><tr><th>Date</th><th>Student</th><th>Batch</th><th>Status</th></tr></thead><tbody>
          {detail.slice(0, 200).map((r) => <tr key={r.id || `${r.student_id}-${r.attendance_date}`}><td>{dLabel(r.attendance_date)}</td><td>{nameOf(byId[r.student_id])}</td><td>{batchName(r.batch_id || byId[r.student_id]?.batch_id)}</td><td><Pill status={r.status} /></td></tr>)}
        </tbody></table></div>}
      {detail.length > 200 && <p className="muted">Showing the first 200 records. Narrow the filters to see more.</p>}
    </>}
  </section>;
}

/* ---------------- Module ---------------- */
export function Attendance({ api, role, students, batches, nameOf, avatarOf, batchName }) {
  const canManage = role === "admin" || role === "teacher";
  const tabs = canManage ? [["dashboard", "Dashboard"], ["mark", "Mark attendance"], ["history", "History"]] : [["history", "My attendance"]];
  const [tab, setTab] = useState(tabs[0][0]);
  const shared = { api, role, students, batches, nameOf, avatarOf, batchName };
  return <div style={{ marginTop: 16 }}>
    {canManage && <div className="row" style={{ marginBottom: 12 }}>{tabs.map(([id, label]) => <button key={id} className={tab === id ? "btn sm" : "btn alt sm"} onClick={() => setTab(id)}>{label}</button>)}</div>}
    {tab === "dashboard" && <AttendanceDashboard api={api} students={students} batches={batches} />}
    {tab === "mark" && <MarkAttendance {...shared} />}
    {tab === "history" && <AttendanceHistory {...shared} />}
  </div>;
}
