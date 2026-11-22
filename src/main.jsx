import React,{useState} from "react";
import {createRoot} from "react-dom/client";
import "./styles.css";
import {html} from "./ui";
import {AuthProvider,AuthScreen,Dash,NotLinked,Recovery,useAuth} from "./portal";
const ROLES={student:{n:"Student",i:"🎓",d:"Attendance, homework, results, fees"},parent:{n:"Parent",i:"👪",d:"Track your child's progress"},teacher:{n:"Teacher",i:"👩‍🏫",d:"Batches, attendance, homework"},admin:{n:"Admin / Owner",i:"🏫",d:"Run the whole institute"}};
const FE=[["📊","Smart dashboards"],["🗓️","Attendance tracking"],["📝","Offline exam results"],["📚","Homework & materials"],["💳","Fee tracking"],["🔔","Notifications"]];
function Site({go,page}){const P=["home","about","features","services","contact"];
const nav=html`<div class="nav"><b>🎓 Coaching LMS</b>${P.map(p=>html`<a key=${p} class=${page===p?"on":""} onClick=${()=>go(p)}>${p[0].toUpperCase()+p.slice(1)}</a>`)}<button class="btn sm" onClick=${()=>go("login")}>Login</button><button class="btn alt sm" onClick=${()=>go("register")}>Register</button></div>`;
const ft=html`<div style=${{background:"var(--side)",color:"#C7D2FE",padding:24,textAlign:"center"}}>© 2026 Coaching LMS · Coaching institute management</div>`;
let body;
if(page==="home")body=html`<div class="hero"><div class="wrap"><span class="tag">Coaching Management Platform</span><h1>One platform for your entire coaching institute</h1><p>Students, parents, teachers and owners – all connected. Classroom teaching stays offline; management goes digital.</p><div class="row"><button class="btn" style=${{background:"#fff",color:"#101B3F"}} onClick=${()=>go("login")}>Sign in</button><button class="btn alt" style=${{color:"#fff",borderColor:"#fff"}} onClick=${()=>go("features")}>See features</button></div></div></div>
<div class="wrap sec"><h2>Built for four roles</h2><div class="grid">${Object.values(ROLES).map(r=>html`<div class="card" key=${r.n}><h3>${r.i} ${r.n}</h3>${r.d}</div>`)}</div></div>
<div class="wrap sec"><h2>Features</h2><div class="grid">${FE.map(f=>html`<div class="card" key=${f[1]}><h3>${f[0]} ${f[1]}</h3></div>`)}</div></div>

<div class="wrap sec"><h2>Benefits</h2><div class="grid">${["Less paperwork","Transparent for parents","Faster result sharing","Ready to scale as SaaS"].map(b=>html`<div class="card" key=${b}>✔ ${b}</div>`)}</div></div>`;
else if(page==="about")body=html`<div class="wrap sec"><h2>About</h2><div class="card">A coaching management system for institutes that teach offline and want to manage academics and administration digitally.</div></div>`;
else if(page==="features")body=html`<div class="wrap sec"><h2>Features</h2><div class="grid">${FE.map(f=>html`<div class="card" key=${f[1]}><h3>${f[0]} ${f[1]}</h3></div>`)}</div></div>`;
else if(page==="services")body=html`<div class="wrap sec"><h2>Services</h2><div class="grid">${["Setup & onboarding","Data migration","Training for staff"].map(s=>html`<div class="card" key=${s}>${s}</div>`)}</div></div>`;
else body=html`<div class="wrap sec"><h2>Contact</h2><div class="card"><div class="row"><input placeholder="Your name"/><input placeholder="Email"/></div></div></div>`;
return html`<div>${nav}${body}${ft}</div>`}
function Gate(){const a=useAuth(),[pg,setPg]=useState("home");
if(a.recovery)return html`<${Recovery}/>`;
if(a.loading)return html`<div class="wrap sec">Loading…</div>`;
if(a.session&&a.profile)return html`<${Dash}/>`;
if(a.session)return html`<${NotLinked}/>`;
if(["login","register","forgot"].includes(pg))return html`<${AuthScreen} kind=${pg} go=${setPg}/>`;
return html`<${Site} page=${pg} go=${setPg}/>`}
createRoot(document.getElementById("root")).render(html`<${AuthProvider}><${Gate}/><//>`);
