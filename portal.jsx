import React,{useState,useEffect,useCallback,createContext,useContext} from "react";
import {supabase,configured} from "./lib/supabase";
import {html,Stat,Card,Bars} from "./ui";

const ADMIN_API=(import.meta.env.VITE_ADMIN_API_URL||"").replace(/\/$/,"");
const BUCKET="lms-files";
const run=async p=>{const r=await p;if(r.error)throw new Error(r.error.message);return r};
const inr=n=>"₹"+Number(n||0).toLocaleString("en-IN");
const today=()=>new Date().toISOString().slice(0,10);
const okFile=f=>["application/pdf","image/jpeg","image/png","image/webp"].includes(f.type)&&f.size<=10*1024*1024;
const safe=n=>n.replace(/[^\w.\-]/g,"_").slice(0,80);
const nm=s=>s?.profile?.full_name||"—";
const Ctx=createContext(null);export const useAuth=()=>useContext(Ctx);

export function useQuery(fn,deps=[]){const [s,set]=useState({data:null,loading:true,error:""}),[n,setN]=useState(0);
useEffect(()=>{let ok=true;set(x=>({...x,loading:true,error:""}));fn().then(d=>ok&&set({data:d,loading:false,error:""})).catch(e=>ok&&set({data:null,loading:false,error:e.message||String(e)}));return()=>{ok=false}},[n,...deps]);
return {...s,reload:()=>setN(x=>x+1)}}

export function AuthProvider({children}){
const [session,setSession]=useState(null),[profile,setProfile]=useState(null),[loading,setLoading]=useState(configured),[recovery,setRecovery]=useState(/type=(invite|recovery)/.test(location.hash)),[perr,setPerr]=useState("");
const load=useCallback(async s=>{if(!s){setProfile(null);setLoading(false);return}
try{const p=(await run(supabase.from("profiles").select("id,institute_id,full_name,role").eq("id",s.user.id).maybeSingle())).data;
if(p&&p.role==="student"){p.student=(await run(supabase.from("students").select("id,batch_id,admission_number,batch:batches!batch_id(name)").eq("profile_id",p.id).maybeSingle())).data}
setProfile(p);setPerr("")}catch(e){setProfile(null);setPerr(e.message)}setLoading(false)},[]);
useEffect(()=>{if(!configured)return;
supabase.auth.getSession().then(({data})=>{setSession(data.session);load(data.session)});
const {data}=supabase.auth.onAuthStateChange((ev,s)=>{if(ev==="PASSWORD_RECOVERY")setRecovery(true);setSession(s);if(s)setLoading(true);setTimeout(()=>load(s),0)});
return()=>data.subscription.unsubscribe()},[load]);
return html`<${Ctx.Provider} value=${{session,profile,loading,recovery,setRecovery,perr,signOut:()=>supabase.auth.signOut()}}>${children}<//>`}

const Shell=({children})=>html`<div style=${{minHeight:"100vh",display:"grid",placeItems:"center",padding:18,background:"linear-gradient(135deg,#101B3F,#4169E1)"}}><div class="card" style=${{width:"min(440px,100%)"}}>${children}</div></div>`;
const link={cursor:"pointer",color:"var(--pri)"};
export function AuthScreen({kind,go}){
const [email,setE]=useState(""),[pw,setP]=useState(""),[name,setN]=useState(""),[msg,setM]=useState(null),[busy,setB]=useState(false);
const submit=async()=>{setB(true);setM(null);try{
if(kind==="login"){const {error}=await supabase.auth.signInWithPassword({email,password:pw});if(error)throw error}
else if(kind==="register"){if(pw.length<8)throw new Error("Password must be at least 8 characters");
const {error}=await supabase.auth.signUp({email,password:pw,options:{data:{full_name:name},emailRedirectTo:location.origin}});if(error)throw error;
setM({ok:1,t:"Check your email and confirm your address. Registration gives no access by itself: your institute admin must add this email before you can sign in to a dashboard."})}
else{const {error}=await supabase.auth.resetPasswordForEmail(email,{redirectTo:location.origin});if(error)throw error;setM({ok:1,t:"If this email has an account, a reset link has been sent."})}
}catch(e){setM({t:e.message})}setB(false)};
return html`<${Shell}><h2>${kind==="register"?"Register":kind==="forgot"?"Forgot password":"Login"}</h2>
${!configured?html`<p style=${{color:"var(--bad)"}}>Backend not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (see README) and rebuild.</p>`:html`
${kind==="register"&&html`<p><input placeholder="Full name" style=${{width:"100%"}} value=${name} onInput=${e=>setN(e.target.value)}/></p>`}
<p><input type="email" placeholder="Email" style=${{width:"100%"}} value=${email} onInput=${e=>setE(e.target.value)}/></p>
${kind!=="forgot"&&html`<p><input type="password" placeholder="Password" style=${{width:"100%"}} value=${pw} onInput=${e=>setP(e.target.value)}/></p>`}
${msg&&html`<p style=${{color:msg.ok?"var(--ok)":"var(--bad)"}}>${msg.t}</p>`}
<button class="btn" style=${{width:"100%"}} disabled=${busy||!email} onClick=${submit}>${busy?"Please wait…":kind==="register"?"Create account":kind==="forgot"?"Send reset link":"Sign in"}</button>
<p>${kind==="login"?html`<a style=${link} onClick=${()=>go("forgot")}>Forgot password?</a> · <a style=${link} onClick=${()=>go("register")}>Register</a>`:html`<a style=${link} onClick=${()=>go("login")}>Back to login</a>`}</p>`}
<p><a style=${{cursor:"pointer"}} onClick=${()=>go("home")}>← Home</a></p><//>`}
export function Recovery(){const a=useAuth(),[pw,setP]=useState(""),[m,setM]=useState("");
const go=async()=>{if(pw.length<8)return setM("At least 8 characters");const {error}=await supabase.auth.updateUser({password:pw});if(error)setM(error.message);else{history.replaceState(null,"",location.pathname);a.setRecovery(false)}};
return html`<${Shell}><h2>Set your password</h2><p>Choose a password for your account.</p><p><input type="password" style=${{width:"100%"}} value=${pw} onInput=${e=>setP(e.target.value)}/></p>${m&&html`<p style=${{color:"var(--bad)"}}>${m}</p>`}<button class="btn" onClick=${go}>Save password</button><//>`}
export function NotLinked(){const a=useAuth();return html`<${Shell}><h2>No access yet</h2><p>You are signed in as ${a.session.user.email}, but this account has no institute profile. Ask your admin to add this email.</p>${a.perr&&html`<p style=${{color:"var(--bad)"}}>${a.perr}</p>`}<button class="btn" onClick=${a.signOut}>Sign out</button><//>`}

async function openFile(path,notify){const {data,error}=await supabase.storage.from(BUCKET).createSignedUrl(path,300);if(error)return notify(error.message,1);window.open(data.signedUrl,"_blank")}
async function adminCreate(token,body){if(!ADMIN_API)throw new Error("Admin API not configured (VITE_ADMIN_API_URL)");
const r=await fetch(ADMIN_API+"/api/users",{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+token},body:JSON.stringify(body)}).catch(()=>{throw new Error("Could not reach the admin API")});
const j=await r.json().catch(()=>null);if(!r.ok||!j||j.ok===false)throw new Error(j?.error||"Request failed ("+r.status+")")}
const upd=async(q,msg="Not allowed or record not found")=>{const r=await q.select("id");if(r.error)throw r.error;if(!r.data.length)throw new Error(msg)};
const State=({q,children})=>q.loading?html`<p>Loading…</p>`:q.error?html`<p style=${{color:"var(--bad)"}}>Error: ${q.error} <button class="btn sm alt" onClick=${q.reload}>Retry</button></p>`:children;

function Crud({cfg,notify}){
const {profile:me,session}=useAuth(),{table,select="*",order="created_at",cols,fields=[],filter,add,edit,del,toForm,save:custom,extra,title}=cfg;
const [q,setQ]=useState(""),[form,setForm]=useState(null),[busy,setBusy]=useState(false);
const list=useQuery(async()=>{let r=supabase.from(table).select(select).order(order,{ascending:false});if(filter)r=filter(r);return (await run(r)).data},[table]);
const refs=useQuery(async()=>{const o={};for(const f of fields)if(f.ref){let r=supabase.from(f.ref.table).select(f.ref.select);if(f.ref.filter)r=f.ref.filter(r);o[f.k]=(await run(r)).data.map(x=>({id:x.id,text:f.ref.label(x)}))}return o},[table]);
const rows=(list.data||[]).filter(r=>JSON.stringify(r).toLowerCase().includes(q.toLowerCase()));
const save=async()=>{setBusy(true);try{const p={};
for(const f of fields){let v=form[f.k];
if(f.type==="file"){if(v instanceof File){if(!okFile(v))throw new Error("Only PDF/JPEG/PNG/WebP files up to 10 MB are allowed");const path=f.path(form,me,v);const u=await supabase.storage.from(BUCKET).upload(path,v,{contentType:v.type});if(u.error)throw u.error;v=path}else v=undefined}
else if(v===""||v==null){if(f.req&&!(f.createOnly&&form.__id))throw new Error(f.label+" is required");v=null}
else if(f.type==="number"){v=Number(v);if(!isFinite(v)||v<0)throw new Error(f.label+" must be a number, 0 or more")}
else if(f.type==="email"&&!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v))throw new Error("Invalid email");
else if(typeof v==="string")v=v.trim();
if(v!==undefined&&!(f.createOnly&&form.__id))p[f.k]=v}
const ctx={me,token:session.access_token};
if(custom)await custom({...form,...p},ctx);
else if(form.__id)await upd(supabase.from(table).update({...p,...(extra?extra(me):{})}).eq("id",form.__id));
else{const r=await supabase.from(table).insert({...p,...(cfg.defaults?cfg.defaults(me):{})}).select("id");if(r.error)throw r.error}
notify("Saved");setForm(null);list.reload()}catch(e){notify(e.message,1)}setBusy(false)};
const remove=async r=>{if(!window.confirm("Delete this record?"))return;try{await upd(supabase.from(table).delete().eq("id",r.id),"Not allowed or already deleted");notify("Deleted");list.reload()}catch(e){notify(e.message,1)}};
const input=f=>{const v=form[f.k]??"";
if(f.ref)return html`<select value=${v} onChange=${e=>setForm({...form,[f.k]:e.target.value})}><option value="">Select…</option>${(refs.data?.[f.k]||[]).map(o=>html`<option key=${o.id} value=${o.id}>${o.text}</option>`)}</select>`;
if(f.options)return html`<select value=${v} onChange=${e=>setForm({...form,[f.k]:e.target.value})}>${f.options.map(o=>html`<option key=${o} value=${o}>${o}</option>`)}</select>`;
if(f.type==="file")return html`<input type="file" accept="application/pdf,image/*" onChange=${e=>setForm({...form,[f.k]:e.target.files[0]})}/>`;
return html`<input type=${f.type||"text"} step=${f.type==="number"?"any":undefined} value=${v} onInput=${e=>setForm({...form,[f.k]:e.target.value})}/>`};
const shown=form?fields.filter(f=>!(f.createOnly&&form.__id)):[];
return html`<${Card} t=${title} span=${1}><div class="row" style=${{marginBottom:10}}><input placeholder="Search…" value=${q} onInput=${e=>setQ(e.target.value)}/>${add&&html`<button class="btn sm" onClick=${()=>setForm({...(cfg.blank||{})})}>+ Add</button>`}</div>
${form&&html`<div class="card" style=${{marginBottom:12}}><div class="grid">${shown.map(f=>html`<label key=${f.k} style=${{display:"grid",gap:4}}>${f.label}${f.req?" *":""}${input(f)}</label>`)}</div><div class="row" style=${{marginTop:10}}><button class="btn sm" disabled=${busy} onClick=${save}>${busy?"Saving…":"Save"}</button><button class="btn sm alt" onClick=${()=>setForm(null)}>Cancel</button></div></div>`}
<${State} q=${list}>${rows.length?html`<div class="tbl"><table><thead><tr>${cols.map(c=>html`<th key=${c.label}>${c.label}</th>`)}${(edit||del)&&html`<th></th>`}</tr></thead><tbody>${rows.map(r=>html`<tr key=${r.id}>${cols.map(c=>html`<td key=${c.label}>${c.file?(r[c.k]?html`<button class="btn sm alt" onClick=${()=>openFile(r[c.k],notify)}>Open</button>`:"—"):(c.get?c.get(r):r[c.k])??"—"}</td>`)}${(edit||del)&&html`<td style=${{whiteSpace:"nowrap"}}>${edit&&html`<button class="btn sm alt" onClick=${()=>setForm(toForm?toForm(r):{...r,__id:r.id})}>Edit</button> `}${del&&html`<button class="btn sm alt" style=${{color:"var(--bad)"}} onClick=${()=>remove(r)}>Delete</button>`}</td>`}</tr>`)}</tbody></table></div>`:html`<p>${list.data&&list.data.length?"No records match your search.":"No records yet."}</p>`}<//><//>`}

const BAT={table:"batches",select:"id,name",label:o=>o.name};
const STU={table:"students",select:"id,admission_number,profile:profiles!profile_id(full_name)",label:o=>`${nm(o)} (${o.admission_number||"no adm. no."})`};
const roleRef=r=>({table:"profiles",select:"id,full_name",filter:q=>q.eq("role",r),label:o=>o.full_name});
const STUSEL="*,profile:profiles!profile_id(full_name),batch:batches!batch_id(name)";
const SN="student:students!student_id(admission_number,profile:profiles!profile_id(full_name))";
const sName=r=>nm(r.student);
const inst=me=>({institute_id:me.institute_id});
const personCfg=(role,title)=>({title,table:"profiles",order:"full_name",filter:q=>q.eq("role",role),cols:[{label:"Name",k:"full_name"}],
fields:[{k:"full_name",label:"Full name",req:1},{k:"email",label:"Email (invite is sent here)",type:"email",req:1,createOnly:1}],
save:async(f,{me,token})=>{if(f.__id)await upd(supabase.from("profiles").update({full_name:f.full_name}).eq("id",f.__id));else await adminCreate(token,{role,full_name:f.full_name,email:f.email})}});
const C={
students:{title:"Students",table:"students",select:STUSEL,cols:[{label:"Name",get:nm},{label:"Admission no.",k:"admission_number"},{label:"Batch",get:r=>r.batch?.name}],
 toForm:r=>({__id:r.id,profile_id:r.profile_id,full_name:r.profile?.full_name,admission_number:r.admission_number,batch_id:r.batch_id}),
 fields:[{k:"full_name",label:"Full name",req:1},{k:"email",label:"Email (invite is sent here)",type:"email",req:1,createOnly:1},{k:"admission_number",label:"Admission no."},{k:"batch_id",label:"Batch",ref:BAT}],
 save:async(f,{token})=>{if(f.__id){await upd(supabase.from("profiles").update({full_name:f.full_name}).eq("id",f.profile_id));await upd(supabase.from("students").update({batch_id:f.batch_id,admission_number:f.admission_number}).eq("id",f.__id))}else await adminCreate(token,{role:"student",full_name:f.full_name,email:f.email,batch_id:f.batch_id,admission_number:f.admission_number})}},
teachers:personCfg("teacher","Teachers"),parents:personCfg("parent","Parents"),
links:{title:"Parent ↔ child links",table:"parent_student_links",select:"*,parent:profiles!parent_profile_id(full_name),"+SN,cols:[{label:"Parent",get:r=>r.parent?.full_name},{label:"Child",get:sName}],
 fields:[{k:"parent_profile_id",label:"Parent",ref:roleRef("parent"),req:1},{k:"student_id",label:"Child",ref:STU,req:1}],defaults:inst},
batches:{title:"Batches",table:"batches",cols:[{label:"Name",k:"name"}],fields:[{k:"name",label:"Batch name",req:1}],defaults:inst},
assign:{title:"Teacher ↔ batch assignments",table:"teacher_batch_assignments",select:"*,teacher:profiles!teacher_profile_id(full_name),batch:batches!batch_id(name)",cols:[{label:"Teacher",get:r=>r.teacher?.full_name},{label:"Batch",get:r=>r.batch?.name}],
 fields:[{k:"teacher_profile_id",label:"Teacher",ref:roleRef("teacher"),req:1},{k:"batch_id",label:"Batch",ref:BAT,req:1}],defaults:inst},
attendance:{title:"Attendance records",table:"attendance",order:"attendance_date",select:"*,"+SN,cols:[{label:"Date",k:"attendance_date"},{label:"Student",get:sName},{label:"Status",k:"status"}]},
exams:{title:"Examinations",table:"exams",order:"exam_date",select:"*,batch:batches!batch_id(name)",cols:[{label:"Exam",k:"title"},{label:"Batch",get:r=>r.batch?.name},{label:"Subject",k:"subject"},{label:"Date",k:"exam_date"},{label:"Total marks",k:"total_marks"}],
 fields:[{k:"batch_id",label:"Batch",ref:BAT,req:1},{k:"title",label:"Title",req:1},{k:"subject",label:"Subject"},{k:"exam_date",label:"Date",type:"date",req:1},{k:"total_marks",label:"Total marks",type:"number",req:1}],defaults:inst},
results:{title:"Results",table:"results",select:"*,exam:exams!exam_id(title,total_marks),"+SN,cols:[{label:"Exam",get:r=>r.exam?.title},{label:"Student",get:sName},{label:"Marks",get:r=>r.marks_obtained+" / "+(r.exam?.total_marks??"?")}],
 fields:[{k:"exam_id",label:"Exam",ref:{table:"exams",select:"id,title",label:o=>o.title},req:1,createOnly:1},{k:"student_id",label:"Student",ref:STU,req:1,createOnly:1},{k:"marks_obtained",label:"Marks obtained",type:"number",req:1}],
 save:async f=>{if(f.__id)return upd(supabase.from("results").update({marks_obtained:f.marks_obtained}).eq("id",f.__id));
  const ex=(await run(supabase.from("results").select("id").eq("exam_id",f.exam_id).eq("student_id",f.student_id))).data;if(ex.length)throw new Error("A result already exists for this student and exam. Edit it instead.");
  const {error}=await supabase.from("results").insert({exam_id:f.exam_id,student_id:f.student_id,marks_obtained:f.marks_obtained});if(error)throw error}},
homework:{title:"Homework",table:"homework",order:"due_date",select:"*,batch:batches!batch_id(name)",cols:[{label:"Title",k:"title"},{label:"Batch",get:r=>r.batch?.name},{label:"Due",k:"due_date"},{label:"Details",k:"description"},{label:"Attachment",k:"attachment_path",file:1}],
 fields:[{k:"batch_id",label:"Batch",ref:BAT,req:1},{k:"title",label:"Title",req:1},{k:"description",label:"Description"},{k:"due_date",label:"Due date",type:"date"},
 {k:"attachment_path",label:"Attachment (PDF/image)",type:"file",path:(f,me,file)=>`${me.institute_id}/study-materials/${f.batch_id}/${Date.now()}-${safe(file.name)}`}],defaults:inst,
 save:async(f,{me})=>{if(f.attachment_path&&!f.batch_id)throw new Error("Choose a batch first");const row={batch_id:f.batch_id,title:f.title,description:f.description,due_date:f.due_date,...(f.attachment_path?{attachment_path:f.attachment_path}:{})};
  if(f.__id)await upd(supabase.from("homework").update(row).eq("id",f.__id));else{const {error}=await supabase.from("homework").insert({...row,institute_id:me.institute_id});if(error)throw error}}},
submissions:{title:"Student submissions",table:"homework_submissions",order:"submitted_at",select:"*,hw:homework!homework_id(title),"+SN,cols:[{label:"Homework",get:r=>r.hw?.title},{label:"Student",get:sName},{label:"Status",k:"status"},{label:"Marks",k:"marks_obtained"},{label:"Feedback",k:"feedback"},{label:"File",k:"file_path",file:1}],
 fields:[{k:"status",label:"Review status",options:["submitted","checked","correction_required"]},{k:"marks_obtained",label:"Marks",type:"number"},{k:"feedback",label:"Feedback"}],extra:me=>({reviewed_by:me.id,reviewed_at:new Date().toISOString()})},
fees:{title:"Fees",table:"fees",order:"due_date",select:"*,"+SN+",pay:fee_payments(amount)",cols:[{label:"Student",get:sName},{label:"Amount",get:r=>inr(r.amount)},{label:"Paid",get:r=>inr((r.pay||[]).reduce((a,p)=>a+Number(p.amount),0))},{label:"Status",k:"status"},{label:"Due",k:"due_date"}],
 fields:[{k:"student_id",label:"Student",ref:STU,req:1,createOnly:1},{k:"amount",label:"Amount",type:"number",req:1},{k:"due_date",label:"Due date",type:"date"}],defaults:inst},
payments:{title:"Fee payments",table:"fee_payments",order:"payment_date",select:"*,"+SN,cols:[{label:"Student",get:sName},{label:"Amount",get:r=>inr(r.amount)},{label:"Date",get:r=>new Date(r.payment_date).toLocaleDateString()},{label:"Method",k:"payment_method"},{label:"Reference",k:"reference_number"}],
 fields:[{k:"fee_id",label:"Fee",ref:{table:"fees",select:"id,amount,"+SN,label:o=>`${sName(o)} – ${inr(o.amount)}`},req:1},{k:"amount",label:"Amount received",type:"number",req:1},{k:"payment_method",label:"Method (cash/UPI/…)"},{k:"reference_number",label:"Reference no."}],
 save:async(f,{me})=>{const amt=Number(f.amount);if(amt<=0)throw new Error("Amount must be more than 0");const fee=(await run(supabase.from("fees").select("id,amount,student_id").eq("id",f.fee_id).single())).data;
  const {error}=await supabase.from("fee_payments").insert({institute_id:me.institute_id,fee_id:fee.id,student_id:fee.student_id,amount:amt,payment_method:f.payment_method,reference_number:f.reference_number,received_by:me.id});if(error)throw error;
  const sum=(await run(supabase.from("fee_payments").select("amount").eq("fee_id",fee.id))).data.reduce((a,p)=>a+Number(p.amount),0);
  const u=await supabase.from("fees").update({status:sum>=Number(fee.amount)?"paid":"partial"}).eq("id",fee.id);if(u.error)throw new Error("Payment saved, but updating the fee status failed: "+u.error.message)}},
expenses:{title:"Expenses",table:"expenses",order:"expense_date",cols:[{label:"Item",k:"title"},{label:"Category",k:"category"},{label:"Amount",get:r=>inr(r.amount)},{label:"Date",k:"expense_date"}],
 fields:[{k:"title",label:"Item",req:1},{k:"category",label:"Category"},{k:"amount",label:"Amount",type:"number",req:1},{k:"expense_date",label:"Date",type:"date"}],defaults:inst}};
const mode=(c,m)=>({...c,add:!!m.add,edit:!!m.edit,del:!!m.del});
const FULL={add:1,edit:1,del:1},RO={},AE={add:1,edit:1};

function AttendanceMark({notify}){const [batch,setB]=useState(""),[date,setD]=useState(today()),[marks,setMarks]=useState({}),[busy,setBusy]=useState(false);
const batches=useQuery(async()=>(await run(supabase.from("batches").select("id,name").order("name"))).data,[]);
const studs=useQuery(async()=>batch?(await run(supabase.from("students").select("id,admission_number,profile:profiles!profile_id(full_name)").eq("batch_id",batch))).data:[],[batch]);
const ex=useQuery(async()=>{const ids=(studs.data||[]).map(s=>s.id);return ids.length?(await run(supabase.from("attendance").select("id,student_id,status").eq("attendance_date",date).in("student_id",ids))).data:[]},[studs.data,date]);
useEffect(()=>{if(!studs.data||ex.loading||ex.error)return;const m={};studs.data.forEach(s=>{m[s.id]=(ex.data||[]).find(e=>e.student_id===s.id)?.status||"present"});setMarks(m)},[studs.data,ex.data]);
const save=async()=>{setBusy(true);try{let n=0;for(const s of studs.data){const old=(ex.data||[]).find(e=>e.student_id===s.id),st=marks[s.id];
if(old){if(old.status!==st){await upd(supabase.from("attendance").update({status:st}).eq("id",old.id),"Not allowed to change this record");n++}}
else{const {error}=await supabase.from("attendance").insert({student_id:s.id,attendance_date:date,status:st});if(error)throw error;n++}}
notify(n?`Attendance saved (${n} change${n>1?"s":""})`:"No changes to save");ex.reload()}catch(e){notify(e.message,1)}setBusy(false)};
return html`<${Card} t="Mark attendance" span=${1}><div class="row" style=${{marginBottom:10}}><select value=${batch} onChange=${e=>setB(e.target.value)}><option value="">Select batch…</option>${(batches.data||[]).map(b=>html`<option key=${b.id} value=${b.id}>${b.name}</option>`)}</select><input type="date" value=${date} onInput=${e=>setD(e.target.value)}/></div>
${batches.error&&html`<p style=${{color:"var(--bad)"}}>${batches.error}</p>`}
${!batch?html`<p>Select a batch to begin.</p>`:html`<${State} q=${studs}>${(studs.data||[]).length?html`<p>Students without a saved record start as Present; change anyone who was not, then save.</p>${studs.data.map(s=>html`<div class="li" key=${s.id}><span>${nm(s)}</span><select value=${marks[s.id]||"present"} onChange=${e=>setMarks({...marks,[s.id]:e.target.value})}><option value="present">Present</option><option value="absent">Absent</option><option value="late">Late</option></select></div>`)}<button class="btn" style=${{marginTop:10}} disabled=${busy} onClick=${save}>${busy?"Saving…":"Save attendance"}</button>`:html`<p>No students in this batch.</p>`}<//>`}<//>`}

function HomeworkStudent({notify}){const {profile:me}=useAuth(),stu=me.student;const [busy,setBusy]=useState("");
const d=useQuery(async()=>{if(!stu)return {hw:[],sub:[]};const hw=(await run(supabase.from("homework").select("*").order("due_date"))).data;const sub=(await run(supabase.from("homework_submissions").select("*").eq("student_id",stu.id))).data;return {hw,sub}},[]);
const up=async(h,s,f)=>{if(!f)return;if(!okFile(f))return notify("Only PDF/JPEG/PNG/WebP files up to 10 MB are allowed",1);setBusy(h.id);try{
const path=`${me.institute_id}/homework/${stu.id}/${h.id}/${Date.now()}-${safe(f.name)}`;const u=await supabase.storage.from(BUCKET).upload(path,f,{contentType:f.type});if(u.error)throw u.error;
if(s){try{await upd(supabase.from("homework_submissions").update({file_path:path}).eq("id",s.id))}catch(e){await supabase.storage.from(BUCKET).remove([path]);throw e}if(s.file_path)await supabase.storage.from(BUCKET).remove([s.file_path])}
else{const {error}=await supabase.from("homework_submissions").insert({homework_id:h.id,student_id:stu.id,submitted_by_profile_id:me.id,file_path:path});if(error){await supabase.storage.from(BUCKET).remove([path]);throw error}}
notify(s?"File replaced":"Submitted");d.reload()}catch(e){notify(e.message,1)}setBusy("")};
if(!stu)return html`<${Card} t="Homework"><p>Your student record was not found. Ask your admin.</p><//>`;
return html`<${Card} t="Homework" span=${1}><${State} q=${d}>${d.data&&d.data.hw.length?d.data.hw.map(h=>{const s=d.data.sub.find(x=>x.homework_id===h.id);return html`<div class="li" key=${h.id} style=${{flexWrap:"wrap"}}><span><b style=${{color:"var(--h)"}}>${h.title}</b><br/>${h.description||""} ${h.due_date?"· Due "+h.due_date:""}${s?html`<br/>Status: <b>${s.status}</b>${s.marks_obtained!=null?" · Marks: "+s.marks_obtained:""}${s.feedback?" · "+s.feedback:""}`:""}</span><span class="row">${h.attachment_path&&html`<button class="btn sm alt" onClick=${()=>openFile(h.attachment_path,notify)}>Open task</button>`}${s&&s.file_path&&html`<button class="btn sm alt" onClick=${()=>openFile(s.file_path,notify)}>My file</button>`}<label class="btn sm">${busy===h.id?"Uploading…":s?"Replace file":"Submit file"}<input type="file" accept="application/pdf,image/*" hidden disabled=${busy===h.id} onChange=${e=>{up(h,s,e.target.files[0]);e.target.value=""}}/></label></span></div>`}):html`<p>No homework assigned yet.</p>`}<//><//>`}

function Overview({role}){const {profile:me}=useAuth();
const d=useQuery(async()=>{const cnt=async(t,f)=>{let r=supabase.from(t).select("id",{count:"exact",head:true});if(f)r=f(r);return (await run(r)).count||0};
const st=[],up=await cnt("exams",r=>r.gte("exam_date",today()));let chart=null;
const money=async()=>{const fees=(await run(supabase.from("fees").select("amount"))).data,pays=(await run(supabase.from("fee_payments").select("amount,payment_date"))).data;
const tot=fees.reduce((a,f)=>a+Number(f.amount),0),paid=pays.reduce((a,p)=>a+Number(p.amount),0);return {tot,paid,pays}};
const attPct=async()=>{const a=(await run(supabase.from("attendance").select("status"))).data;if(!a.length)return ["No records"];const p=a.filter(x=>x.status!=="absent").length*100/a.length;return [Math.round(p)+"%",p<75?"var(--bad)":"var(--ok)"]};
if(role==="admin"){for(const [l,r] of [["Students","student"],["Teachers","teacher"],["Parents","parent"]])st.push([l,await cnt("profiles",q=>q.eq("role",r))]);st.push(["Batches",await cnt("batches")],["Upcoming exams",up]);
const m=await money();st.push(["Fees collected",inr(m.paid),"var(--ok)"],["Pending fees",inr(Math.max(0,m.tot-m.paid)),"var(--bad)"]);
const g={};m.pays.forEach(p=>{const k=(p.payment_date||"").slice(0,7);if(k)g[k]=(g[k]||0)+Number(p.amount)});const ks=Object.keys(g).sort().slice(-6);if(ks.length)chart={labels:ks.map(k=>k.slice(2)),data:ks.map(k=>g[k])}}
else if(role==="teacher"){st.push(["Assigned batches",await cnt("batches")],["Assigned students",await cnt("students")],["Upcoming exams",up],["Homework posted",await cnt("homework")])}
else if(role==="student"){const a=await attPct();st.push(["Attendance",...a],["Upcoming exams",up],["Homework",await cnt("homework")]);const m=await money();st.push(["Fees due",inr(Math.max(0,m.tot-m.paid)),"var(--bad)"])}
else{const a=await attPct();st.push(["Linked children",await cnt("parent_student_links")],["Attendance",...a],["Upcoming exams",up]);const m=await money();st.push(["Fees due",inr(Math.max(0,m.tot-m.paid)),"var(--bad)"])}
return {st,chart}},[role]);
return html`<div class="card" style=${{background:"var(--pri)",color:"#fff"}}><h3 style=${{color:"#fff"}}>Welcome, ${me.full_name}</h3>Live data from your institute</div><${State} q=${d}>${d.data&&html`<div class="grid">${d.data.st.map(([l,v,c])=>html`<${Stat} key=${l} l=${l} v=${v} c=${c}/>`)}</div>${d.data.chart&&html`<${Card} t="Fees collected by month (₹)"><${Bars} data=${d.data.chart.data} labels=${d.data.chart.labels}/><//>`}`}<//>`}
function Profile(){const {profile:me}=useAuth(),s=me.student;return html`<${Card} t="My profile"><div class="li"><span>Name</span><span>${me.full_name}</span></div><div class="li"><span>Admission no.</span><span>${s?.admission_number||"—"}</span></div><div class="li"><span>Batch</span><span>${s?.batch?.name||"Not assigned"}</span></div><//>`}

const PAGES={
admin:{Overview:"ov",Students:mode(C.students,FULL),Teachers:mode(C.teachers,AE),Parents:mode(C.parents,AE),"Parent links":mode(C.links,{add:1,del:1}),Batches:mode(C.batches,FULL),"Teacher assignments":mode(C.assign,{add:1,del:1}),Attendance:"att",Exams:mode(C.exams,FULL),Results:mode(C.results,FULL),Homework:mode(C.homework,FULL),Submissions:mode(C.submissions,{edit:1}),Fees:mode(C.fees,AE),Payments:mode(C.payments,{add:1}),Expenses:mode(C.expenses,FULL)},
teacher:{Overview:"ov","Assigned Students":mode(C.students,RO),"Assigned Batches":mode(C.batches,RO),Attendance:"att",Exams:mode(C.exams,AE),Results:mode(C.results,AE),Homework:mode(C.homework,AE),"Student Submissions":mode(C.submissions,{edit:1})},
student:{Overview:"ov",Profile:"prof",Attendance:mode(C.attendance,RO),Exams:mode(C.exams,RO),Results:mode(C.results,RO),Homework:"hw",Fees:mode(C.fees,RO)},
parent:{Overview:"ov","Linked Children":mode(C.students,RO),Attendance:mode(C.attendance,RO),Exams:mode(C.exams,RO),Results:mode(C.results,RO),Homework:mode(C.homework,RO),Fees:mode(C.fees,RO)}};
const LABEL={admin:"Admin",teacher:"Teacher",student:"Student",parent:"Parent"};

export function Dash(){const a=useAuth(),p=a.profile;
if(!PAGES[p.role])return html`<${Shell}><h2>Unsupported role</h2><p>Your profile role "${p.role}" has no dashboard. Ask your admin.</p><button class="btn" onClick=${a.signOut}>Sign out</button><//>`;
if(!p.institute_id)return html`<${Shell}><h2>Institute missing</h2><p>Your profile is not linked to an institute yet. Ask your admin.</p><button class="btn" onClick=${a.signOut}>Sign out</button><//>`;
return html`<${DashInner}/>`}
function DashInner(){const {profile,signOut}=useAuth(),role=profile.role,pages=PAGES[role];
const [v,setV]=useState("Overview"),[o,setO]=useState(false),[t,setT]=useState(null);
const notify=(m,bad)=>{setT({m,bad});setTimeout(()=>setT(null),4000)};const P=pages[v];
return html`<div class="app"><nav class=${"side"+(o?" open":"")}><b>🎓 Coaching LMS</b>${Object.keys(pages).map(n=>html`<a key=${n} class=${v===n?"on":""} onClick=${()=>{setV(n);setO(false)}}>${n}</a>`)}</nav>
<div class="main"><div class="top"><button class="btn sm burger" aria-label="Menu" onClick=${()=>setO(!o)}>☰</button><h3>${v}</h3><span class="tag" style=${{background:"#DCFCE7",color:"#166534"}}>${profile.full_name} · ${LABEL[role]}</span><button class="btn alt sm" onClick=${signOut}>Logout</button></div>
<div class="page" key=${v}>${P==="ov"?html`<${Overview} role=${role}/>`:P==="prof"?html`<${Profile}/>`:P==="hw"?html`<${HomeworkStudent} notify=${notify}/>`:P==="att"?html`<${AttendanceMark} notify=${notify}/><${Crud} cfg=${mode(C.attendance,RO)} notify=${notify}/>`:html`<${Crud} cfg=${P} notify=${notify}/>`}</div></div>
${t&&html`<div class="toast" style=${t.bad?{background:"var(--bad)",color:"#fff"}:{}}>${t.m}</div>`}</div>`}
