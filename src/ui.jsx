import React from "react";
import htm from "htm";
export const html=htm.bind(React.createElement);
const Stat=({l,v,c})=>html`<div class="card stat"><small>${l}</small><strong style=${{color:c}}>${v}</strong></div>`;
const Card=({t,children,span})=>html`<div class="card" style=${span?{gridColumn:"1/-1"}:{}}><h4>${t}</h4>${children}</div>`;
const List=({items})=>html`<div>${items.map(([a,b],i)=>html`<div class="li" key=${i}><span>${a}</span><span style=${{color:"var(--h)"}}>${b}</span></div>`)}</div>`;
const Bars=({data,labels,color="#4169E1"})=>{const m=Math.max(...data);return html`<svg viewBox="0 0 300 140" width="100%" role="img" aria-label="Bar chart">${data.map((v,i)=>html`<g key=${i}><rect x=${i*(300/data.length)+6} y=${120-(v/m)*105} width=${300/data.length-12} height=${(v/m)*105} rx="5" fill=${color}><title>${labels[i]}: ${v}</title></rect><text x=${i*(300/data.length)+(300/data.length)/2} y="135" font-size="10" text-anchor="middle" fill="#64748B">${labels[i]}</text></g>`)}</svg>`};
const Line=({data,labels})=>{const m=Math.max(...data),n=data.length,p=data.map((v,i)=>[20+i*(260/(n-1)),115-(v/m)*95]);return html`<svg viewBox="0 0 300 140" width="100%"><polyline fill="none" stroke="#4169E1" stroke-width="3" points=${p.map(x=>x.join(",")).join(" ")}/>${p.map((q,i)=>html`<g key=${i}><circle cx=${q[0]} cy=${q[1]} r="4" fill="#4169E1"><title>${labels[i]}: ${data[i]}</title></circle><text x=${q[0]} y="135" font-size="10" text-anchor="middle" fill="#64748B">${labels[i]}</text></g>`)}</svg>`};
const M=["Jun","Jul","Aug","Sep","Oct","Nov"];

export {Stat,Card,List,Bars,Line,M};
