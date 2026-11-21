
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
const LABEL={admin:"Admin",teacher:"Teacher",student:"Student",parent:"Parent"};
const Ctx=createContext(null);
export const useAuth=()=>useContext(Ctx);

export function useQuery(fn,deps=[]){
const [s,set]=useState({data:null,loading:true,error:""}),[n,setN]=useState(0);
useEffect(()=>{
let ok=true;
set(x=>({...x,loading:true,error:""}));
fn().then(d=>ok&&set({data:d,loading:false,error:""}))
.catch(e=>ok&&set({data:null,loading:false,error:e.message||String(e)}));
return()=>{ok=false};
},[n,...deps]);
return {...s,reload:()=>setN(x=>x+1)};
}

export function AuthProvider({children}){
const [session,setSession]=useState(null);
const [profile,setProfile]=useState(null);
const [profiles,setProfiles]=useState([]);
const [loading,setLoading]=useState(configured);
const [recovery,setRecovery]=useState(/type=(invite|recovery)/.test(location.hash));
const [perr,setPerr]=useState("");
const [switching,setSwitching]=useState(false);

const withStudent=useCallback(async p=>{
if(p?.role==="student"){
p.student=(await run(
supabase.from("students")
.select("id,batch_id,admission_number,batch:batches!batch_id(name)")
.eq("profile_id",p.id).maybeSingle()
)).data;
}
return p;
},[]);

const load=useCallback(async s=>{
if(!s){
setProfile(null);
setProfiles([]);
setPerr("");
setLoading(false);
return;
}
try{
const list=(await run(
supabase.from("profiles")
.select("id,institute_id,full_name,role")
.order("full_name")
)).data||[];

setProfiles(list);

let claims={};
try{
claims=JSON.parse(atob(s.access_token.split(".")[1].replace(/-/g,"+").replace(/_/g,"/")));
}catch{}

const activeId=claims.active_profile_id;
const active=list.find(p=>p.id===activeId);

if(active){
setProfile(await withStudent({...active}));
}else{
setProfile(null);
}
setPerr("");
}catch(e){
setProfile(null);
setProfiles([]);
setPerr(e.message||"Could not load profiles");
}
setLoading(false);
},[withStudent]);

const selectProfile=useCallback(async p=>{
if(!session||!p)return;
setSwitching(true);
setPerr("");
try{
if(!ADMIN_API)throw new Error("Admin API not configured (VITE_ADMIN_API_URL)");

const r=await fetch(ADMIN_API+"/api/select-profile",{
method:"POST",
headers:{
"Content-Type":"application/json",
Authorization:"Bearer "+session.access_token
},
body:JSON.stringify({profile_id:p.id})
}).catch(()=>{
throw new Error("Could not reach the Admin API");
});

const j=await r.json().catch(()=>null);
if(!r.ok||!j||j.ok===false){
throw new Error(j?.error||"Could not select this profile");
}

const refreshed=await supabase.auth.refreshSession();
if(refreshed.error)throw refreshed.error;

setSession(refreshed.data.session);
setProfile(await withStudent({...p}));
setPerr("");
}catch(e){
setPerr(e.message||String(e));
}
setSwitching(false);
},[session,withStudent]);

const switchProfile=useCallback(()=>{
setProfile(null);
setPerr("");
},[]);

useEffect(()=>{
if(!configured)return;

supabase.auth.getSession().then(({data,error})=>{
if(error)setPerr(error.message);
setSession(data.session);
load(data.session);
});

const {data}=supabase.auth.onAuthStateChange((ev,s)=>{
if(ev==="PASSWORD_RECOVERY")setRecovery(true);
setSession(s);
setLoading(true);
setTimeout(()=>load(s),0);
});

return()=>data.subscription.unsubscribe();
},[load]);

return html`
<${Ctx.Provider} value=${{
session,profile,profiles,loading,recovery,setRecovery,perr,
switching,selectProfile,switchProfile,
signOut:()=>supabase.auth.signOut()
}}>
${children}
<//>`;
}

const Shell=({children})=>html`
<div style=${{
minHeight:"100vh",display:"grid",placeItems:"center",padding:18,
background:"linear-gradient(135deg,#101B3F,#4169E1)"
}}>
<div class="card" style=${{width:"min(440px,100%)"}}>${children}</div>
</div>`;

const link={cursor:"pointer",color:"var(--pri)"};

export function AuthScreen({kind,go}){
const [email,setE]=useState("");
const [pw,setP]=useState("");
const [name,setN]=useState("");
const [msg,setM]=useState(null);
const [busy,setB]=useState(false);

const submit=async()=>{
setB(true);
setM(null);
try{
if(kind==="login"){
const {error}=await supabase.auth.signInWithPassword({email,password:pw});
if(error)throw error;
}
else if(kind==="register"){
if(pw.length<8)throw new Error("Password must be at least 8 characters");
const {error}=await supabase.auth.signUp({
email,password:pw,
options:{data:{full_name:name},emailRedirectTo:location.origin}
});
if(error)throw error;
setM({ok:1,t:"Check your email and confirm your address. Registration gives no access by itself: your institute admin must add this email before you can sign in to a dashboard."});
}
else{
const {error}=await supabase.auth.resetPasswordForEmail(email,{redirectTo:location.origin});
if(error)throw error;
setM({ok:1,t:"If this email has an account, a reset link has been sent."});
}
}catch(e){
setM({t:e.message});
}
setB(false);
};

return html`
<${Shell}>
<h2>${kind==="register"?"Register":kind==="forgot"?"Forgot password":"Login"}</h2>
${!configured?html`
<p style=${{color:"var(--bad)"}}>
Backend not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (see README) and rebuild.
</p>`:html`
${kind==="register"&&html`
<p><input placeholder="Full name" style=${{width:"100%"}} value=${name} onInput=${e=>setN(e.target.value)}/></p>`}
<p><input type="email" placeholder="Email" style=${{width:"100%"}} value=${email} onInput=${e=>setE(e.target.value)}/></p>
${kind!=="forgot"&&html`
<p><input type="password" placeholder="Password" style=${{width:"100%"}} value=${pw} onInput=${e=>setP(e.target.value)}/></p>`}
${msg&&html`<p style=${{color:msg.ok?"var(--ok)":"var(--bad)"}}>${msg.t}</p>`}
<button class="btn" style=${{width:"100%"}} disabled=${busy||!email} onClick=${submit}>
${busy?"Please wait…":kind==="register"?"Create account":kind==="forgot"?"Send reset link":"Sign in"}
</button>
<p>
${kind==="login"?html`
<a style=${link} onClick=${()=>go("forgot")}>Forgot password?</a> ·
<a style=${link} onClick=${()=>go("register")}>Register</a>
`:html`<a style=${link} onClick=${()=>go("login")}>Back to login</a>`}
</p>`}
<p><a style=${{cursor:"pointer"}} onClick=${()=>go("home")}>← Home</a></p>
<//>`;
}

export function Recovery(){
const a=useAuth();
const [pw,setP]=useState("");
const [m,setM]=useState("");
const go=async()=>{
if(pw.length<8)return setM("At least 8 characters");
const {error}=await supabase.auth.updateUser({password:pw});
if(error)setM(error.message);
else{
history.replaceState(null,"",location.pathname);
a.setRecovery(false);
}
};
return html`
<${Shell}>
<h2>Set your password</h2>
<p>Choose a password for your account.</p>
<p><input type="password" style=${{width:"100%"}} value=${pw} onInput=${e=>setP(e.target.value)}/></p>
${m&&html`<p style=${{color:"var(--bad)"}}>${m}</p>`}
<button class="btn" onClick=${go}>Save password</button>
<//>`;
}

export function NotLinked(){
const a=useAuth();

if(a.profiles.length){
return html`
<${Shell}>
<h2>Select your profile</h2>
<p>Choose which dashboard you want to open.</p>
${a.profiles.map(p=>html`
<button
key=${p.id}
class="btn"
style=${{width:"100%",marginBottom:10,textAlign:"left",opacity:a.switching?0.6:1}}
disabled=${a.switching}
onClick=${()=>a.selectProfile(p)}
>
${p.full_name}<br/>
<small>${LABEL[p.role]||p.role}</small>
</button>`)}
${a.switching&&html`<p>Opening your dashboard…</p>`}
${a.perr&&html`<p style=${{color:"var(--bad)"}}>${a.perr}</p>`}
<button class="btn alt" onClick=${a.signOut}>Sign out</button>
<//>`;
}

return html`
<${Shell}>
<h2>No access yet</h2>
<p>You are signed in as ${a.session.user.email}, but this account has no institute profile. Ask your admin to add this email.</p>
${a.perr&&html`<p style=${{color:"var(--bad)"}}>${a.perr}</p>`}
<button class="btn" onClick=${a.signOut}>Sign out</button>
<//>`;
}

async function openFile(path,notify){
const {data,error}=await supabase.storage.from(BUCKET).createSignedUrl(path,300);
if(error)return notify(error.message,1);
window.open(data.signedUrl,"_blank");
}

async function adminCreate(token,body){
if(!ADMIN_API)throw new Error("Admin API not configured (VITE_ADMIN_API_URL)");
const r=await fetch(ADMIN_API+"/api/users",{
method:"POST",
headers:{"Content-Type":"application/json",Authorization:"Bearer "+token},
body:JSON.stringify(body)
}).catch(()=>{throw new Error("Could not reach the admin API")});
const j=await r.json().catch(()=>null);
if(!r.ok||!j||j.ok===false)throw new Error(j?.error||"Request failed ("+r.status+")");
}

const upd=async(q,msg="Not allowed or record not found")=>{
const r=await q.select("id");
if(r.error)throw r.error;
if(!r.data.length)throw new Error(msg);
};

const State=({q,children})=>q.loading?html`<p>Loading…</p>`:
q.error?html`<p style=${{color:"var(--bad)"}}>Error: ${q.error} <button class="btn sm alt" onClick=${q.reload}>Retry</button></p>`:
children;

function Crud({cfg,notify}){
const {profile:me,session}=useAuth();
const {table,select="*",order="created_at",cols,fields=[],filter,add,edit,del,toForm,save:custom,extra,title}=cfg;
const [q,setQ]=useState("");
const [form,setForm]=useState(null);
const [busy,setBusy]=useState(false);

const list=useQuery(async()=>{
let r=supabase.from(table).select(select).order(order,{ascending:false});
if(filter)r=filter(r);
return (await run(r)).data;
},[table]);

const refs=useQuery(async()=>{
const o={};
for(const f of fields)if(f.ref){
let r=supabase.from(f.ref.table).select(f.ref.select);
if(f.ref.filter)r=f.ref.filter(r);
o[f.k]=(await run(r)).data.map(x=>({id:x.id,text:f.ref.label(x)}));
}
return o;
},[table]);

const rows=(list.data||[]).filter(r=>JSON.stringify(r).toLowerCase().includes(q.toLowerCase()));

const save=async()=>{
setBusy(true);
try{
const p={};
for(const f of fields){
let v=form[f.k];
if(f.type==="file"){
if(v instanceof File){
if(!okFile(v))throw new Error("Only PDF/JPEG/PNG/WebP files up to 10 MB are allowed");
const path=f.path(form,me,v);
const u=await supabase.storage.from(BUCKET).upload(path,v,{contentType:v.type});
if(u.error)throw u.error;
v=path;
}else v=undefined;
}
else if(v===""||v==null){
if(f.req&&!(f.createOnly&&form.__id))throw new Error(f.label+" is required");
v=null;
}
else if(f.type==="number"){
v=Number(v);
if(!isFinite(v)||v<0)throw new Error(f.label+" must be a number, 0 or more");
}
else if(f.type==="email"&&!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)){
throw new Error("Invalid email");
}
else if(typeof v==="string")v=v.trim();

if(v!==undefined&&!(f.createOnly&&form.__id))p[f.k]=v;
}
const ctx={me,token:session.access_token};
if(custom)await custom({...form,...p},ctx);
else if(form.__id)await upd(supabase.from(table).update({...p,...(extra?extra(me):{})}).eq("id",form.__id));
else{
const r=await supabase.from(table).insert({...p,...(cfg.defaults?cfg.defaults(me):{})}).select("id");
if(r.error)throw r.error;
}
notify("Saved");
setForm(null);
list.reload();
}catch(e){
notify(e.message,1);
}
setBusy(false);
};

const remove=async r=>{
if(!window.confirm("Delete this record?"))return;
try{
await upd(supabase.from(table).delete().eq("id",r.id),"Not allowed or already deleted");
notify("Deleted");
list.reload();
}catch(e){
notify(e.message,1);
}
};

const input=f=>{
const v=form[f.k]??"";
if(f.ref)return html`
<select value=${v} onChange=${e=>setForm({...form,[f.k]:e.target.value})}>
<option value="">Select…</option>
${(refs.data?.[f.k]||[]).map(o=>html`<option key=${o.id} value=${o.id}>${o.text}</option>`)}
</select>`;
if(f.options)return html`
<select value=${v} onChange=${e=>setForm({...form,[f.k]:e.target.value})}>
${f.options.map(o=>html`<option key=${o} value=${o}>${o}</option>`)}
</select>`;
if(f.type==="file")return html`
<input type="file" accept="application/pdf,image/*" onChange=${e=>setForm({...form,[f.k]:e.target.files[0]})}/>`;
return html`
<input type=${f.type||"text"} step=${f.type==="number"?"any":undefined} value=${v} onInput=${e=>setForm({...form,[f.k]:e.target.value})}/>`;
};

const shown=form?fields.filter(f=>!(f.createOnly&&form.__id)):[];
return html`
<${Card} t=${title} span=${1}>
<div class="row" style=${{marginBottom:10}}>
<input placeholder="Search…" value=${q} onInput=${e=>setQ(e.target.value)}/>
${add&&html`<button class="btn sm" onClick=${()=>setForm({...(cfg.blank||{})})}>+ Add</button>`}
</div>
${form&&html`
<div class="card" style=${{marginBottom:12}}>
<div class="grid">
${shown.map(f=>html`
<label key=${f.k} style=${{display:"grid",gap:4}}>
${f.label}${f.req?" *":""}${input(f)}
</label>`)}
</div>
<div class="row" style=${{marginTop:10}}>
<button class="btn sm" disabled=${busy} onClick=${save}>${busy?"Saving…":"Save"}</button>
<button class="btn sm alt" onClick=${()=>setForm(null)}>Cancel</button>
</div>
</div>`}
<${State} q=${list}>
${rows.length?html`
<div class="tbl">
<table>
<thead><tr>
${cols.map(c=>html`<th key=${c.label}>${c.label}</th>`)}
${(edit||del)&&html`<th></th>`}
</tr></thead>
<tbody>
${rows.map(r=>html`
<tr key=${r.id}>
${cols.map(c=>html`
<td key=${c.label}>
${c.file?(r[c.k]?html`<button class="btn sm alt" onClick=${()=>openFile(r[c.k],notify)}>Open</button>`:"—"):(c.get?c.get(r):r[c.k])??"—"}
</td>`)}
${(edit||del)&&html`
<td style=${{whiteSpace:"nowrap"}}>
${edit&&html`<button class="btn sm alt" onClick=${()=>setForm(toForm?toForm(r):{...r,__id:r.id})}>Edit</button> `}
${del&&html`<button class="btn sm alt" style=${{color:"var(--bad)"}} onClick=${()=>remove(r)}>Delete</button>`}
</td>`}
</tr>`)}
</tbody>
</table>
</div>`:html`<p>${list.data&&list.data.length?"No records match your search.":"No records yet."}</p>`}
<//>
<//>`;
}

const BAT={table:"batches",select:"id,name",label:o=>o.name};
const STU={table:"students",select:"id,admission_number,profile:profiles!profile_id(full_name)",label:o=>`${nm(o)} (${o.admission_number||"no adm. no."})`};
const roleRef=r=>({table:"profiles",select:"id,full_name",filter:q=>q.eq("role",r),label:o=>o.full_name});
const STUSEL="*,profile:profiles!profile_id(full_name),batch:batches!batch_id(name)";
const SN="student:students!student_id(admission_number,profile:profiles!profile_id(full_name))";
const sName=r=>nm(r.student);
const inst=me=>({institute_id:me.institute_id});

const personCfg=(role,title)=>({
title,table:"profiles",order:"full_name",
filter:q=>q.eq("role",role),
cols:[{label:"Name",k:"full_name"}],
fields:[
{k:"full_name",label:"Full name",req:1},
{k:"email",label:"Email (invite is sent here)",type:"email",req:1,createOnly:1}
],
save:async(f,{me,token})=>{
if(f.__id)await upd(supabase.from("profiles").update({full_name:f.full_name}).eq("id",f.__id));
else await adminCreate(token,{role,full_name:f.full_name,email:f.email});
}
});

const C={
students:{
title:"Students",table:"students",select:STUSEL,
cols:[
{label:"Name",get:nm},
{label:"Admission no.",k:"admission_number"},
{label:"Batch",get:r=>r.batch?.name}
],
toForm:r=>({
__id:r.id,profile_id:r.profile_id,full_name:r.profile?.full_name,
admission_number:r.admission_number,batch_id:r.batch_id
}),
fields:[
{k:"full_name",label:"Full name",req:1},
{k:"email",label:"Email (invite is sent here)",type:"email",req:1,createOnly:1},
{k:"admission_number",label:"Admission no."},
{k:"batch_id",label:"Batch",ref:BAT}
],
save:async(f,{token})=>{
if(f.__id){
await upd(supabase.from("profiles").update({full_name:f.full_name}).eq("id",f.profile_id));
await upd(supabase.from("students").update({batch_id:f.batch_id,admission_number:f.admission_number}).eq("id",f.__id));
}else await adminCreate(token,{
role:"student",full_name:f.full_name,email:f.email,
batch_id:f.batch_id,admission_number:f.admission_number
});
}
},
teachers:personCfg("teacher","Teachers"),
parents:personCfg("parent","Parents"),

links:{
title:"Parent ↔ child links",table:"parent_student_links",
select:"*,parent:profiles!parent_profile_id(full_name),"+SN,
cols:[
{label:"Parent",get:r=>r.parent?.full_name},
{label:"Child",get:sName}
],
fields:[
{k:"parent_profile_id",label:"Parent",ref:roleRef("parent"),req:1},
{k:"student_id",label:"Child",ref:STU,req:1}
],
defaults:inst
},

batches:{
title:"Batches",table:"batches",
cols:[{label:"Name",k:"name"}],
fields:[{k:"name",label:"Batch name",req:1}],
defaults:inst
},

assign:{
title:"Teacher ↔ batch assignments",table:"teacher_batch_assignments",
select:"*,teacher:profiles!teacher_profile_id(full_name),batch:batches!batch_id(name)",
cols:[
{label:"Teacher",get:r=>r.teacher?.full_name},
{label:"Batch",get:r=>r.batch?.name}
],
fields:[
{k:"teacher_profile_id",label:"Teacher",ref:roleRef("teacher"),req:1},
{k:"batch_id",label:"Batch",ref:BAT,req:1}
],
defaults:inst
},

attendance:{
title:"Attendance records",table:"attendance",order:"attendance_date",
select:"*,"+SN,
cols:[
{label:"Date",k:"attendance_date"},
{label:"Student",get:sName},
{label:"Status",k:"status"}
]
},

exams:{
title:"Examinations",table:"exams",order:"exam_date",
select:"*,batch:batches!batch_id(name)",
cols:[
{label:"Exam",k:"title"},
{label:"Batch",get:r=>r.batch?.name},
{label:"Subject",k:"subject"},
{label:"Date",k:"exam_date"},
{label:"Total marks",k:"total_marks"}
],
fields:[
{k:"batch_id",label:"Batch",ref:BAT,req:1},
{k:"title",label:"Title",req:1},
{k:"subject",label:"Subject"},
{k:"exam_date",label:"Date",type:"date",req:1},
{k:"total_marks",label:"Total marks",type:"number",req:1}
],
defaults:inst
},

results:{
title:"Results",table:"results",
select:"*,exam:exams!exam_id(title,total_marks),"+SN,
cols:[
{label:"Exam",get:r=>r.exam?.title},
{label:"Student",get:sName},
{label:"Marks",get:r=>r.marks_obtained+" / "+(r.exam?.total_marks??"?")}
],
fields:[
{k:"exam_id",label:"Exam",ref:{table:"exams",select:"id,title",label:o=>o.title},req:1,createOnly:1},
{k:"student_id",label:"Student",ref:STU,req:1,createOnly:1},
{k:"marks_obtained",label:"Marks obtained",type:"number",req:1}
],
save:async f=>{
if(f.__id)return upd(supabase.from("results").update({marks_obtained:f.marks_obtained}).eq("id",f.__id));
const ex=(await run(supabase.from("results").select("id").eq("exam_id",f.exam_id).eq("student_id",f.student_id))).data;
if(ex.length)throw new Error("A result already exists for this student and exam. Edit it instead.");
const {error}=await supabase.from("results").insert({
exam_id:f.exam_id,student_id:f.student_id,marks_obtained:f.marks_obtained
});
if(error)throw error;
}
},

homework:{
title:"Homework",table:"homework",order:"due_date",
select:"*,batch:batches!batch_id(name)",
cols:[
{label:"Title",k:"title"},
{label:"Batch",get:r=>r.batch?.name},
{label:"Due",k:"due_date"},
{label:"Details",k:"description"},
{label:"Attachment",k:"attachment_path",file:1}
],
fields:[
{k:"batch_id",label:"Batch",ref:BAT,req:1},
{k:"title",label:"Title",req:1},
{k:"description",label:"Description"},
{k:"due_date",label:"Due date",type:"date"},
{k:"attachment_path",label:"Attachment (PDF/image)",type:"file",path:(f,me,file)=>`${me.institute_id}/study-materials/${f.batch_id}/${Date.now()}-${safe(file.name)}`}
],
defaults:inst,
save:async(f,{me})=>{
if(f.attachment_path&&!f.batch_id)throw new Error("Choose a batch first");
const row={
batch_id:f.batch_id,title:f.title,description:f.description,due_date:f.due_date,
...(f.attachment_path?{attachment_path:f.attachment_path}:{})
};
if(f.__id)await upd(supabase.from("homework").update(row).eq("id",f.__id));
else{
const {error}=await supabase.from("homework").insert({...row,institute_id:me.institute_id});
if(error)throw error;
}
}
},

submissions:{
title:"Student submissions",table:"homework_submissions
