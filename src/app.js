(function(){
"use strict";
let RAW = JSON.parse(document.getElementById("data").textContent);
try{ const custom=sessionStorage.getItem("icdd:data"); if(custom) RAW=JSON.parse(custom); }catch(e){}
const REPORT = RAW.report_date;            // "2026-10-02"
const F = {}; RAW.fields.forEach((f,i)=>F[f]=i);
const ROWS = RAW.rows.map((r,i)=>({i, sheet:r[F.sheet], co:r[F.co], tp:r[F.tp]||"", acct:r[F.acct], desc:r[F.desc]||"", doc:String(r[F.doc]||""), type:r[F.type]||"", pdate:r[F.pdate]||"", due:r[F.due]||"", dc:+r[F.dc]||0, cur:r[F.cur]||"", lc:+r[F.lc]||0, lcur:r[F.lcur]||"", text:r[F.text]==null?"":String(r[F.text]), ref:r[F.ref]==null?"":String(r[F.ref]), user:r[F.user]||"", age:r[F.age], codes:r[F.codes]||[], cq:r[F.cq]||""}));
const N = ROWS.length;

/* ---------- helpers ---------- */
const $ = s=>document.querySelector(s);
const esc = s=>String(s==null?"":s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const nf0 = new Intl.NumberFormat("en-GB",{maximumFractionDigits:0});
const nf2 = new Intl.NumberFormat("en-GB",{minimumFractionDigits:2,maximumFractionDigits:2});
const fmtAmt = v=>Math.abs(v)>=1e6? (v/1e6).toFixed(2)+"M" : nf2.format(v);
const pct = (a,b)=>b? (100*a/b).toFixed(1)+"%" : "0%";
const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const fmtDate = s=>{ if(!s) return "–"; const [y,m,d]=s.split("-"); return +d+" "+MON[+m-1]+" "+y; };
const dayNum = s=>Math.round(Date.UTC(+s.slice(0,4),+s.slice(5,7)-1,+s.slice(8,10))/864e5);
const REPN = dayNum(REPORT);
const isoOf = n=>new Date(n*864e5).toISOString().slice(0,10);
function store(k,v){ try{ if(v===undefined){ const x=localStorage.getItem("icdd:"+k); return x?JSON.parse(x):null; } localStorage.setItem("icdd:"+k,JSON.stringify(v)); }catch(e){ return null; } }
function toast(msg){ const t=$("#toast"); t.textContent=msg; t.hidden=false; clearTimeout(toast._t); toast._t=setTimeout(()=>t.hidden=true,2600); }
function bars(el,items,opt={}){ // items: {label,value,total,cls,href,extra}
  const max = opt.max || Math.max(1,...items.map(i=>i.value));
  el.innerHTML = items.map((it,k)=>`<div class="barrow${it.href?" click":""}" data-k="${k}" ${it.href?'role="link" tabindex="0"':""}><span title="${esc(it.label)}" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(it.label)}</span><div class="track"><div class="fill ${it.cls||""}" style="width:${(100*it.value/max).toFixed(1)}%"></div></div><span class="v">${it.extra!=null?it.extra:nf0.format(it.value)}</span></div>`).join("");
  el.querySelectorAll(".barrow.click").forEach(b=>{ const go=()=>{ location.hash=items[+b.dataset.k].href; }; b.onclick=go; b.onkeydown=e=>{ if(e.key==="Enter") go(); }; });
}
function pager(el,page,total,per,cb){
  const pages=Math.max(1,Math.ceil(total/per));
  el.innerHTML = `<span>${total? (page*per+1)+"–"+Math.min(total,(page+1)*per)+" of "+nf0.format(total) : "0 lines"}</span><button class="small" ${page<=0?"disabled":""}>Previous</button><button class="small" ${page>=pages-1?"disabled":""}>Next</button>`;
  const [p,n]=el.querySelectorAll("button"); p.onclick=()=>cb(page-1); n.onclick=()=>cb(page+1);
}
async function copyText(t){ try{ await navigator.clipboard.writeText(t); toast("Copied"); }catch(e){ toast("Copy not allowed here"); } }

/* ---------- rules ---------- */
const CODES = {
  WRONG_TP:{name:"Wrong trading partner", grp:"partner", cls:"red", fix:"Change trading partner ATP054 to NC157 (the payable mirrors C157's receivable)"},
  NO_TP:{name:"Missing trading partner", grp:"partner", cls:"red", fix:"Fill the partner from the mirror entry in the other ERP"},
  WRONG_CUR:{name:"Wrong currency / amount", grp:"currency", cls:"red", fix:"Clear against its manual offset; block posting when the implied rate is over 3x"},
  BAD_CUR:{name:"Invalid currency code", grp:"currency", cls:"red", fix:"Change currency XO2 to XOF"},
  FX_REVAL:{name:"FX revaluation line", grp:"currency", cls:"amber", fix:"Tag as FX revaluation and clear against its reversal"},
  DUPLICATE:{name:"Possible duplicate", grp:"uncleared", cls:"red", fix:"Reverse the duplicate after the partner confirms"},
  UNCLEARED:{name:"Offsetting lines not cleared", grp:"uncleared", cls:"amber", fix:"Propose one clearing for the lines that net to zero"},
  OVER_365:{name:"Open more than 365 days", grp:"ageing", cls:"amber", fix:"Open a case, assign an owner, set a follow-up date"},
  DQ_ZERO:{name:"Zero-amount line", grp:"quality", cls:"grey", fix:"Exclude from the balance and clear"},
  CONTROL:{name:"Self-posted control line", grp:"quality", cls:"grey", fix:"Send to a second reviewer"}
};
const GROUPS = [
  {id:"partner", name:"Partner coding", codes:["WRONG_TP","NO_TP"], note:"Lines booked to the wrong trading partner, or with none. Partner balances cannot match until these are recoded."},
  {id:"currency", name:"Currency", codes:["WRONG_CUR","BAD_CUR","FX_REVAL"], note:"Wrong currency or amount, invalid currency codes, and FX revaluation lines that inflate the open item list."},
  {id:"uncleared", name:"Duplicates & uncleared", codes:["DUPLICATE","UNCLEARED"], note:"Lines that already net out or appear twice. Most can be closed with a single clearing proposal."},
  {id:"ageing", name:"Ageing", codes:["OVER_365"], note:"Open for more than a year. These need an owner and a decision, not another month of carry-forward."},
  {id:"quality", name:"Data quality", codes:["DQ_ZERO","CONTROL"], note:"Zero amounts and lines posted and approved by the same user."}
];
const GCOL = {partner:"var(--c1)",currency:"var(--c2)",uncleared:"var(--c3)",ageing:"var(--c4)",quality:"var(--c5)"};
const CLEARING = new Set(["DUPLICATE","UNCLEARED","FX_REVAL","DQ_ZERO","WRONG_CUR"]);
const byCode = {}; Object.keys(CODES).forEach(c=>byCode[c]=[]);
ROWS.forEach(r=>r.codes.forEach(c=>byCode[c]&&byCode[c].push(r)));
const issueRows = ROWS.filter(r=>r.codes.length);
const clearRows = issueRows.filter(r=>r.codes.some(c=>CLEARING.has(c)));
const caseRows = issueRows.filter(r=>!r.codes.some(c=>CLEARING.has(c)));
const caseKeys = new Set(caseRows.map(r=>r.sheet+"|"+r.co+"|"+r.tp));

function fixFor(r,c){
  if(c==="NO_TP"){ return CODES[c].fix; }
  if(c==="UNCLEARED") return `Clear with the other open lines of ${r.co} → ${r.tp||"?"} in ${r.cur} that net to zero`;
  if(c==="OVER_365") return `Open a case for ${r.co} → ${r.tp||"?"}, ${nf0.format(r.age)} days open; owner and follow-up date`;
  return CODES[c].fix;
}

/* ---------- state ---------- */
const decisions = store("decisions")||{};
const cases = store("cases")||{};
let owners = store("owners");
if(!Array.isArray(owners)) owners=[];
owners = owners.filter(name=>typeof name==="string").map(name=>name.trim()).filter(Boolean);
owners = owners.filter((name,i)=>owners.findIndex(other=>other.toLowerCase()===name.toLowerCase())===i);
let casesChanged=false;
Object.values(cases).forEach(c=>{
  if(!c||typeof c.owner!=="string"||!c.owner.trim()) return;
  const assigned=c.owner.trim();
  let owner=owners.find(name=>name.toLowerCase()===assigned.toLowerCase());
  if(!owner){ owner=assigned; owners.push(owner); }
  if(c.owner!==owner){ c.owner=owner; casesChanged=true; }
});
store("owners",owners);
if(casesChanged) store("cases",cases);
function setDecision(i,v){ if(decisions[i]===v) delete decisions[i]; else decisions[i]=v; store("decisions",decisions); }

/* ---------- AI / downloads / mcp ---------- */
let sample=null, downloads=null, mcp=null;
document.body.classList.add("no-ai","no-mcp");
if(window.claude && claude.use){
  claude.use("sample").then(s=>{ sample=s; if(s) document.body.classList.remove("no-ai"); }).catch(()=>{});
  claude.use("downloads").then(d=>{ downloads=d; }).catch(()=>{});
  claude.use("mcp").then(m=>{ mcp=m; if(m) document.body.classList.remove("no-mcp"); }).catch(()=>{});
}
async function ask(prompt,out,btn){
  if(!sample){ out.hidden=false; out.textContent="AI is not available in this view."; return; }
  out.hidden=false; out.classList.remove("muted"); out.textContent="Thinking…"; if(btn) btn.disabled=true;
  try{ const r=await sample(prompt,{modelTier:"quick",onText:({text})=>{ out.textContent=text; }}); out.textContent=r.text; }
  catch(e){ out.classList.add("muted"); out.textContent = e&&e.code==="not_granted" ? "AI was not allowed for this page." : e&&e.code==="rate_limited" ? "Too many AI requests, try again in a minute." : "AI request failed."; }
  finally{ if(btn) btn.disabled=false; }
}
async function saveFile(filename,data){
  if(!downloads){ const bl=data instanceof Blob?data:new Blob([data],{type:"text/csv;charset=utf-8"}); const u=URL.createObjectURL(bl); const a=document.createElement("a"); a.href=u; a.download=filename; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(u),4000); toast("Saved "+filename); return; }
  try{ await downloads.save({filename,data}); toast("Saved "+filename); }
  catch(e){ if(e&&e.code==="declined") return; if(e&&e.code==="rate_limited"){ toast("A save prompt is already open"); return; } await copyText(data); }
}

/* ---------- due-date buckets ---------- */
const dueRows = ROWS.filter(r=>r.due);
function dueCls(iso){ const d=dayNum(iso)-REPN; return d<0?"red":d<=14?"amber":"green"; }
const overdueRows = dueRows.filter(r=>r.due<REPORT);
const soonRows = dueRows.filter(r=>r.due>=REPORT && dayNum(r.due)-REPN<=14);

function groupCases(rows,dateOf){
  const m=new Map();
  rows.forEach(r=>{ const k=r.sheet+"|"+r.co+"|"+r.tp; let g=m.get(k); if(!g){ g={k,sheet:r.sheet,co:r.co,tp:r.tp,rows:[],sum:{},oldest:null}; m.set(k,g);} g.rows.push(r); g.sum[r.cur]=(g.sum[r.cur]||0)+r.dc; const d=dateOf(r); if(d&&(!g.oldest||d<g.oldest)) g.oldest=d; });
  return [...m.values()].map(g=>{ g.days = g.oldest? REPN-dayNum(g.oldest):0; return g; }).sort((a,b)=>b.days-a.days||b.rows.length-a.rows.length);
}
const odCases = groupCases(overdueRows,r=>r.due);
const nodueCases = groupCases(ROWS.filter(r=>!r.due && r.age>90),r=>r.pdate);
const sumTxt = s=>Object.entries(s).sort((a,b)=>Math.abs(b[1])-Math.abs(a[1])).slice(0,2).map(([c,v])=>fmtAmt(v)+" "+c).join("<br>")+(Object.keys(s).length>2?`<br><span class="note">+${Object.keys(s).length-2} more</span>`:"");

/* ---------- bell ---------- */
function renderBell(){
  const openOd = odCases.filter(g=>(cases[g.k]||{}).status!=="Resolved");
  const soonDays = {}; soonRows.forEach(r=>soonDays[r.due]=(soonDays[r.due]||0)+1);
  const sd = Object.entries(soonDays).sort();
  $("#bellBadge").textContent = openOd.length + sd.length;
  let h = ``;
  h += `<div class="bell-item" data-go="#overdue"><i class="dot red"></i><div><b>${openOd.length} overdue cases</b><div class="note">${nf0.format(overdueRows.length)} lines past due; oldest ${nf0.format(odCases[0]?odCases[0].days:0)} days</div></div></div>`;
  sd.slice(0,6).forEach(([d,n])=>{ h+=`<div class="bell-item" data-go="#calendar/${d}"><i class="dot amber"></i><div><b>${n} lines due ${fmtDate(d)}</b><div class="note">in ${dayNum(d)-REPN} days</div></div></div>`; });
  if(!sd.length) h+=`<div class="note" style="padding:8px">Nothing due in the next 14 days.</div>`;
  $("#bellPanel").innerHTML=h;
  $("#bellPanel").querySelectorAll("[data-go]").forEach(el=>el.onclick=()=>{ location.hash=el.dataset.go; toggleBell(false); });
}
function toggleBell(open){ const p=$("#bellPanel"); p.hidden = open===undefined? !p.hidden : !open; $("#bellBtn").setAttribute("aria-expanded",String(!p.hidden)); }
$("#bellBtn").onclick=e=>{ e.stopPropagation(); toggleBell(); };
document.addEventListener("click",e=>{ if(!$("#bellPanel").hidden && !e.target.closest(".bell-wrap")) toggleBell(false); });
document.addEventListener("keydown",e=>{ if(e.key==="Escape") toggleBell(false); });

/* ---------- overview ---------- */
function renderOverview(){
  const kp = [
    {l:"Open lines",v:nf0.format(N),s:"P20 · BPP · P10",c:"blue"},
    {l:"With an issue",v:nf0.format(issueRows.length),s:pct(issueRows.length,N),c:"red"},
    {l:"To clear",v:nf0.format(clearRows.length),s:"clearing proposed",c:"green"},
    {l:"Overdue cases",v:nf0.format(odCases.length),s:nf0.format(overdueRows.length)+" lines",c:"red"},
    {l:"Due in 14 days",v:nf0.format(soonRows.length),s:"lines",c:"amber"}
  ];
  $("#kpis").innerHTML = kp.map(k=>`<div class="card kpi ${k.c}"><div class="label">${k.l}</div><div class="value">${k.v}</div><div class="sub">${k.s}</div></div>`).join("");
  const _ba = `<div class="step"><span class="note">Before</span><span class="big">${nf0.format(N)} lines</span><span class="note">read one by one</span></div>
    <div class="step"><span class="note">After the scan</span><span class="big">${nf0.format(clearRows.length)} to clear</span><span class="note">approve a proposed clearing</span></div>
    <div class="step"><span class="note">Left for people</span><span class="big">${nf0.format(caseKeys.size)} cases</span><span class="note">${nf0.format(caseRows.length)} lines by company and partner</span></div>`;
  const items = Object.keys(CODES).map(c=>({label:CODES[c].name,value:byCode[c].length,cls:CODES[c].cls==="grey"?"":CODES[c].cls,href:"#errors/"+CODES[c].grp+"/"+c,extra:pct(byCode[c].length,N)})).sort((a,b)=>b.value-a.value);
  bars($("#ovBars"),items,{max:N*0.4});
  const top = odCases.slice(0,6);
  $("#ovTop").innerHTML = `<table><tbody>${top.map(g=>`<tr><td><b>${esc(g.co)} → ${esc(g.tp||"none")}</b><div class="note">${g.sheet} · ${g.rows.length} lines</div></td><td class="num">${sumTxt(g.sum)}</td><td><span class="pill red">${nf0.format(g.days)} d</span></td></tr>`).join("")}</tbody></table>`;
  renderDonut(); renderLine();
}
function renderDonut(){
  const data = GROUPS.map(g=>({g, n:new Set(g.codes.flatMap(c=>byCode[c].map(r=>r.i))).size}));
  const tot = data.reduce((a,d)=>a+d.n,0)||1; const R=42, C=2*Math.PI*R; let off=0;
  const arcs = data.map(d=>{ const len=C*d.n/tot; const a=`<circle class="seg" tabindex="0" role="link" aria-label="${d.g.name}: ${d.n}" data-g="${d.g.id}" cx="60" cy="60" r="${R}" fill="none" stroke="${GCOL[d.g.id]}" stroke-width="16" stroke-dasharray="${Math.max(0,len-1.5).toFixed(2)} ${(C-len+1.5).toFixed(2)}" stroke-dashoffset="${(-off).toFixed(2)}" transform="rotate(-90 60 60)"><title>${d.g.name}: ${nf0.format(d.n)}</title></circle>`; off+=len; return a; }).join("");
  $("#donut").innerHTML = `<svg viewBox="0 0 120 120" role="img" aria-label="Issue lines by group"><circle cx="60" cy="60" r="${R}" fill="none" stroke="var(--sunk)" stroke-width="16"/>${arcs}<text x="60" y="58" text-anchor="middle" font-size="15" font-weight="600" fill="var(--fg)">${nf0.format(issueRows.length)}</text><text x="60" y="72" text-anchor="middle" font-size="7" fill="var(--muted)">lines</text></svg>
  <div class="dleg">${data.map(d=>`<a href="#errors/${d.g.id}"><i style="background:${GCOL[d.g.id]}"></i><span>${d.g.name}</span><b>${nf0.format(d.n)}</b></a>`).join("")}</div>`;
  $("#donut").querySelectorAll(".seg").forEach(el=>{ const go=()=>{ location.hash="#errors/"+el.dataset.g; }; el.onclick=go; el.onkeydown=e=>{ if(e.key==="Enter") go(); }; });
}
function renderLine(){
  const [reportYear,reportMonth]=REPORT.slice(0,7).split("-").map((v,i)=>i?v-1:+v);
  const keys=[]; const m=new Map();
  for(let i=23;i>=0;i--){
    const d=new Date(Date.UTC(reportYear,reportMonth-i,1));
    const k=d.toISOString().slice(0,7);
    keys.push(k); m.set(k,{a:0,b:0});
  }
  ROWS.forEach(r=>{
    if(!r.pdate) return;
    const k=r.pdate.slice(0,7);
    const o=m.get(k);
    if(!o) return;
    o.a++; if(r.codes.length) o.b++;
  });
  if(!keys.length) return;
  const W=720,H=260,L=44,Rr=12,T=14,B=28; const max=Math.max(...keys.map(k=>m.get(k).a)); const nice=Math.ceil(max/100)*100||100;
  const x=i=>L+(W-L-Rr)*i/Math.max(1,keys.length-1), y=v=>T+(H-T-B)*(1-v/nice);
  const path=f=>keys.map((k,i)=>(i?"L":"M")+x(i).toFixed(1)+" "+y(m.get(k)[f]).toFixed(1)).join(" ");
  const grid=[0,.25,.5,.75,1].map(t=>{ const v=nice*t; return `<line x1="${L}" x2="${W-Rr}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)" stroke-width="1"/><text x="${L-8}" y="${y(v)+4}" text-anchor="end" font-size="11" fill="var(--muted)">${nf0.format(v)}</text>`; }).join("");
  const months=[]; keys.forEach((k,i)=>{ if(i%3===0){ const anchor=i===0?"start":"middle"; months.push(`<text x="${x(i)}" y="${H-8}" text-anchor="${anchor}" font-size="11" fill="var(--muted)">${MON[+k.slice(5,7)-1]} '${k.slice(2,4)}</text>`); } });
  const area=`${path("a")} L${x(keys.length-1)} ${y(0)} L${x(0)} ${y(0)} Z`;
  $("#lineChart").innerHTML=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Open lines by posting month over the last 24 calendar months">${grid}${months.join("")}<path d="${area}" fill="var(--c1)" opacity=".08"/><path d="${path("a")}" fill="none" stroke="var(--c1)" stroke-width="2" stroke-linejoin="round"/><path d="${path("b")}" fill="none" stroke="var(--c2)" stroke-width="2" stroke-linejoin="round"/><g id="xh" hidden><line id="xl" y1="${T}" y2="${H-B}" stroke="var(--line-strong)"/><circle id="xa" r="4" fill="var(--c1)" stroke="var(--surface)" stroke-width="2"/><circle id="xb" r="4" fill="var(--c2)" stroke="var(--surface)" stroke-width="2"/></g><rect id="hit" x="${L}" y="${T}" width="${W-L-Rr}" height="${H-T-B}" fill="transparent"/></svg><div class="tip" id="tip" hidden></div>`;
  const svg=$("#lineChart svg"), tip=$("#tip");
  const move=e=>{ const rc=svg.getBoundingClientRect(); const px=(e.clientX-rc.left)/rc.width*W; const i=Math.max(0,Math.min(keys.length-1,Math.round((px-L)/(W-L-Rr)*(keys.length-1)))); const k=keys[i], o=m.get(k);
    $("#xh").hidden=false; $("#xl").setAttribute("x1",x(i)); $("#xl").setAttribute("x2",x(i)); $("#xa").setAttribute("cx",x(i)); $("#xa").setAttribute("cy",y(o.a)); $("#xb").setAttribute("cx",x(i)); $("#xb").setAttribute("cy",y(o.b));
    tip.hidden=false; tip.innerHTML=`<b>${MON[+k.slice(5)-1]} ${k.slice(0,4)}</b><br>${nf0.format(o.a)} lines · ${nf0.format(o.b)} with issue`; tip.style.left=(x(i)/W*rc.width)+"px"; tip.style.top=(y(Math.max(o.a,o.b))/H*rc.height-8)+"px"; };
  $("#hit").onmousemove=move; $("#hit").onmouseleave=()=>{ $("#xh").hidden=true; tip.hidden=true; };
}

/* ---------- errors ---------- */
const E = {grp:"partner", code:"", q:"", page:0};
function renderErrors(){
  const g = GROUPS.find(x=>x.id===E.grp)||GROUPS[0];
  $("#grpTabs").innerHTML = GROUPS.map(x=>{ const n=new Set(x.codes.flatMap(c=>byCode[c].map(r=>r.i))).size; return `<button role="tab" aria-pressed="${x.id===g.id}" data-g="${x.id}">${x.name}<span class="n">${nf0.format(n)}</span></button>`; }).join("");
  $("#grpTabs").querySelectorAll("button").forEach(b=>b.onclick=()=>{ location.hash="#errors/"+b.dataset.g; });
  $("#codeTabs").innerHTML = `<button aria-pressed="${!E.code}" data-c="">All</button>`+g.codes.map(c=>`<button aria-pressed="${E.code===c}" data-c="${c}">${CODES[c].name}<span class="n">${nf0.format(byCode[c].length)}</span></button>`).join("");
  $("#codeTabs").querySelectorAll("button").forEach(b=>b.onclick=()=>{ location.hash="#errors/"+g.id+(b.dataset.c?"/"+b.dataset.c:""); });
  
  const codes = E.code? [E.code] : g.codes;
  const seen=new Set(); let list=[];
  codes.forEach(c=>byCode[c].forEach(r=>{ if(!seen.has(r.i)){ seen.add(r.i); list.push(r);} }));
  const q=E.q.trim().toLowerCase();
  if(q) list=list.filter(r=>(r.co+" "+r.tp+" "+r.doc+" "+r.text+" "+r.ref+" "+r.desc+" "+r.cur).toLowerCase().includes(q));
  list.sort((a,b)=>(b.age||0)-(a.age||0));
  const per=25, pages=Math.max(1,Math.ceil(list.length/per)); if(E.page>=pages) E.page=pages-1;
  const slice=list.slice(E.page*per,(E.page+1)*per);
  $("#errBody").innerHTML = slice.length? slice.map(r=>{
    const mine = r.codes.filter(c=>codes.includes(c)); const c0=mine[0]||r.codes[0]; const d=decisions[r.i];
    const dueP = r.due? `<span class="pill ${dueCls(r.due)}">${fmtDate(r.due)}</span>` : `<span class="note">–</span>`;
    const fx=fixFor(r,c0); const od=r.due&&r.due<REPORT;
    return `<tr data-i="${r.i}" class="${d==="ok"?"is-ok":d==="no"?"is-no":""}"><td><b>${esc(r.co)} → ${esc(r.tp||"—")}</b><div class="note">${r.sheet} · ${esc(r.doc)} · ${fmtDate(r.pdate)}</div></td><td class="num"><b>${nf2.format(r.dc)}</b> ${esc(r.cur)}<div class="note">${r.age!=null?nf0.format(r.age)+" days open":""}${od?' · <span style="color:var(--red)">overdue</span>':""}</div></td><td class="wrap"><div>${r.codes.slice(0,2).map(c=>`<span class="pill ${CODES[c]?CODES[c].cls:"grey"}">${CODES[c]?CODES[c].name:c}</span>`).join(" ")}${r.codes.length>2?` <button type="button" class="ghost small more-issues" aria-expanded="false">+${r.codes.length-2}</button>`:""}</div><div class="fixtxt">${esc(fx)}</div><div class="extra-issues" hidden>${r.codes.slice(2).map(c=>`<div class="extra-issue"><span class="pill ${CODES[c]?CODES[c].cls:"grey"}">${CODES[c]?CODES[c].name:esc(c)}</span><div class="fixtxt">${esc(fixFor(r,c))}</div></div>`).join("")}</div><div class="inline-ai" hidden></div></td><td class="dec"><div class="decide"><button class="ic ok" aria-pressed="${d==="ok"}" title="Approve fix" aria-label="Approve fix">✓</button><button class="ic no" aria-pressed="${d==="no"}" title="Reject fix" aria-label="Reject fix">✕</button></div><button class="ghost small ai-only" data-ai>Explain</button></td></tr>`;
  }).join("") : `<tr><td colspan="4" class="empty">No lines match.</td></tr>`;
  $("#errBody").querySelectorAll("tr[data-i]").forEach(tr=>{
    const r=ROWS[+tr.dataset.i];
    tr.querySelector(".ok").onclick=()=>{ setDecision(r.i,"ok"); renderErrors(); };
    tr.querySelector(".no").onclick=()=>{ setDecision(r.i,"no"); renderErrors(); };
    const more=tr.querySelector(".more-issues");
    if(more) more.onclick=()=>{
      const expanded=more.getAttribute("aria-expanded")!=="true";
      more.setAttribute("aria-expanded",String(expanded));
      more.textContent=expanded?"Show less":`+${r.codes.length-2}`;
      tr.querySelector(".extra-issues").hidden=!expanded;
    };
    const ab=tr.querySelector("[data-ai]"); ab.onclick=()=>{ const out=tr.querySelector(".inline-ai");
      ask(`You are an intercompany reconciliation analyst at a telecom group. In at most 3 short sentences, explain why this open SAP line was flagged and what the accountant should do, in plain English. No preamble.\nLine: ERP ${r.sheet}, company ${r.co}, trading partner ${r.tp||"(none)"}, account ${r.acct} ${r.desc}, doc ${r.doc} type ${r.type}, posted ${r.pdate}, due ${r.due||"n/a"}, amount ${r.dc} ${r.cur} (local ${r.lc} ${r.lcur}), age ${r.age} days, text "${r.text}", reference "${r.ref}".\nFlags: ${r.codes.map(c=>CODES[c]?CODES[c].name:c).join(", ")}.\nProposed fix: ${fixFor(r,r.codes[0])}.`, out, ab); };
  });
  pager($("#errPager"),E.page,list.length,per,p=>{ E.page=p; renderErrors(); });
}
let sT; $("#errSearch").oninput=e=>{ clearTimeout(sT); sT=setTimeout(()=>{ E.q=e.target.value; E.page=0; renderErrors(); },200); };

/* ---------- overdue ---------- */
const O = {mode:"due", status:"", page:0};
function renderOverdueKpis(){
  const resolved = odCases.filter(g=>(cases[g.k]||{}).status==="Resolved").length;
  const owned = odCases.filter(g=>(cases[g.k]||{}).owner).length;
  const over90 = odCases.filter(g=>g.days>90).length;
  $("#odKpis").innerHTML = [
    {l:"Overdue cases",v:odCases.length,s:nf0.format(overdueRows.length)+" lines",c:"red"},
    {l:"Over 90 days",v:over90,s:pct(over90,odCases.length)+" of cases",c:"amber"},
    {l:"With an owner",v:owned,s:pct(owned,odCases.length)+" assigned",c:"blue"},
    {l:"Resolved",v:resolved,s:"this browser",c:"green"}
  ].map(k=>`<div class="card kpi ${k.c}"><div class="label">${k.l}</div><div class="value">${nf0.format(k.v)}</div><div class="sub">${k.s}</div></div>`).join("");
}
function renderOwners(){
  const groups=odCases.concat(nodueCases);
  $("#ownerBody").innerHTML=owners.length?owners.map(name=>{
    const assigned=groups.filter(g=>(cases[g.k]||{}).owner===name).length;
    return `<tr><td>${esc(name)}</td><td class="num">${nf0.format(assigned)}</td><td class="num"><button class="ghost small" data-remove-owner="${esc(name)}" aria-label="Remove ${esc(name)}">Remove</button></td></tr>`;
  }).join(""):`<tr><td colspan="3" class="empty">No owners yet. Add a name above to make it available for assignment.</td></tr>`;
  $("#ownerBody").querySelectorAll("[data-remove-owner]").forEach(button=>button.onclick=()=>{
    const name=button.dataset.removeOwner;
    if(groups.some(g=>(cases[g.k]||{}).owner===name)){ toast("Reassign this owner before removing them"); return; }
    owners=owners.filter(owner=>owner!==name); store("owners",owners); renderOwners(); toast(name+" removed");
  });
}
$("#ownerForm").onsubmit=e=>{
  e.preventDefault();
  const name=$("#ownerName").value.trim();
  if(!name){ toast("Enter an owner name"); return; }
  if(owners.some(owner=>owner.toLowerCase()===name.toLowerCase())){ toast("That owner already exists"); return; }
  owners.push(name); store("owners",owners); $("#ownerName").value=""; renderOwners(); toast(name+" added");
};
function renderOverdue(){
  const src = O.mode==="due"? odCases : nodueCases;
  renderOverdueKpis();
  $("#odMode").innerHTML = `<button aria-pressed="${O.mode==="due"}" data-m="due">Past due<span class="n">${odCases.length}</span></button><button aria-pressed="${O.mode==="nodue"}" data-m="nodue">No due date<span class="n">${nodueCases.length}</span></button>`;
  $("#odMode").querySelectorAll("button").forEach(b=>b.onclick=()=>{ O.mode=b.dataset.m; O.page=0; renderOverdue(); });
  
  $("#odColDays").textContent = O.mode==="due"?"Days overdue":"Days open";
  let list = src.filter(g=>!O.status || ((cases[g.k]||{}).status||"Open")===O.status);
  const per=20; const pages=Math.max(1,Math.ceil(list.length/per)); if(O.page>=pages) O.page=pages-1;
  const slice=list.slice(O.page*per,(O.page+1)*per);
  const ST=["Open","In progress","Waiting for partner","Resolved"];
  $("#odBody").innerHTML = slice.length? slice.map(g=>{ const c=cases[g.k]||{}; const st=c.status||"Open";
    const cls = g.days>365?"red":g.days>90?"amber":"green";
    return `<tr data-k="${esc(g.k)}" class="st-${st.replace(/ /g,"")}"><td><b>${esc(g.co)} → ${esc(g.tp||"no partner")}</b><div class="note">${g.sheet} · ${g.rows.length} lines</div></td><td class="num">${sumTxt(g.sum)}</td><td class="num"><span class="pill ${cls}">${nf0.format(g.days)} days</span><div class="note">since ${fmtDate(g.oldest)}</div></td><td><select data-f="owner" aria-label="Owner" class="slim"><option value="" ${!c.owner?"selected":""}>Unassigned</option>${owners.map(owner=>`<option value="${esc(owner)}" ${owner===c.owner?"selected":""}>${esc(owner)}</option>`).join("")}</select></td><td><select data-f="status" aria-label="Status" class="slim">${ST.map(s=>`<option ${s===st?"selected":""}>${s}</option>`).join("")}</select></td><td class="num"><button class="ghost small" data-more aria-expanded="false">${c.note?"Note ●":"Note"}</button></td></tr><tr class="ai-row" hidden><td colspan="6"><div class="row" style="gap:8px"><input type="text" data-f="note" value="${esc(c.note||"")}" placeholder="Next step" aria-label="Note" style="flex:1;min-width:200px"><button class="small ai-only" data-ai>Draft email</button></div><div class="ai" hidden style="margin-top:8px"></div></td></tr>`;
  }).join("") : `<tr><td colspan="6" class="empty">No cases match.</td></tr>`;
  $("#odBody").querySelectorAll("tr[data-k]").forEach(tr=>{
    const k=tr.dataset.k; const g=src.find(x=>x.k===k); const row=tr.nextElementSibling;
    const onch=inp=>inp.onchange=()=>{ cases[k]=Object.assign(cases[k]||{}, {[inp.dataset.f]:inp.value}); store("cases",cases); if(inp.dataset.f==="note") tr.querySelector("[data-more]").textContent=inp.value?"Note ●":"Note"; if(inp.dataset.f==="owner") renderOverdueKpis(); if(inp.dataset.f==="status"){ renderBell(); renderOverdue(); } };
    tr.querySelectorAll("[data-f]").forEach(onch); row.querySelectorAll("[data-f]").forEach(onch);
    const mb=tr.querySelector("[data-more]"); mb.onclick=()=>{ row.hidden=!row.hidden; mb.setAttribute("aria-expanded",String(!row.hidden)); };
    row.querySelector("[data-ai]").onclick=e=>{ const out=row.querySelector(".ai");
      const sample5=g.rows.slice(0,5).map(r=>`doc ${r.doc}, posted ${r.pdate}, due ${r.due||"n/a"}, ${r.dc} ${r.cur}, text "${r.text}"`).join("\n");
      ask(`Write a short, polite follow-up email (subject line + max 120 words) from the intercompany accounting team of company ${g.co} to the accounting team of trading partner ${g.tp||"(unknown partner)"} about overdue open intercompany items. Ask them to confirm the balance or tell us what is missing, by a date 5 working days after ${REPORT}. Plain text, no placeholders except [Your name].\nCase: ${g.rows.length} lines, oldest date ${g.oldest}, ${g.days} days. Amounts: ${Object.entries(g.sum).map(([c,v])=>v.toFixed(2)+" "+c).join(", ")}.\nExamples:\n${sample5}`, out, e.target); };
  });
  pager($("#odPager"),O.page,list.length,per,p=>{ O.page=p; renderOverdue(); });
}
$("#odStatus").onchange=e=>{ O.status=e.target.value; O.page=0; renderOverdue(); };

/* ---------- calendar ---------- */
const dueByDay = {}; dueRows.forEach(r=>(dueByDay[r.due]=dueByDay[r.due]||[]).push(r));
const C = {y:+REPORT.slice(0,4), m:+REPORT.slice(5,7)-1, sel:""};
function renderCalendar(){
  $("#calTitle").textContent = MON[C.m]+" "+C.y;
  const first = Date.UTC(C.y,C.m,1)/864e5; const dow=(new Date(first*864e5).getUTCDay()+6)%7;
  let h = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map(d=>`<div class="dow">${d}</div>`).join("");
  for(let k=0;k<42;k++){ const n=first-dow+k; const iso=isoOf(n); const inM=+iso.slice(5,7)-1===C.m; const L=dueByDay[iso]||[];
    const cls=["day", inM?"":"out", L.length?"has "+dueCls(iso):"", iso===REPORT?"today":""].join(" ");
    h+=`<button class="${cls}" data-d="${iso}" ${L.length?"":"tabindex=\"-1\""} aria-label="${fmtDate(iso)}: ${L.length} lines due"><span class="d">${+iso.slice(8)}</span>${L.length?`<span class="c">${L.length} due</span>`:""}</button>`;
    if(k===34 && isoOf(first-dow+35).slice(5,7)-1!==C.m) break;
  }
  $("#cal").innerHTML=h;
  $("#cal").querySelectorAll(".day.has").forEach(b=>b.onclick=()=>{ C.sel=b.dataset.d; renderDay(); });
  renderDay();
}
function renderDay(){
  const el=$("#calDay"); const L=dueByDay[C.sel]||[];
  if(!C.sel||!L.length){ el.hidden=true; return; }
  el.hidden=false; const d=dayNum(C.sel)-REPN; const cls=dueCls(C.sel);
  el.innerHTML = `<div class="row"><h2>${fmtDate(C.sel)}</h2><span class="pill ${cls}">${d<0? -d+" days overdue" : d===0?"due on report date":"due in "+d+" days"}</span><span class="note">${L.length} lines</span><span class="spacer"></span><button class="ghost small" id="dayClose">Close</button></div>
  <div class="tablewrap" style="margin-top:10px"><table><thead><tr><th>ERP</th><th>Company → partner</th><th>Doc</th><th class="num">Amount</th><th>Text</th><th>Issue</th></tr></thead><tbody>${L.slice(0,150).map(r=>`<tr><td>${r.sheet}</td><td><b>${esc(r.co)}</b> → ${esc(r.tp||"—")}</td><td class="mono">${esc(r.doc)}</td><td class="num">${nf2.format(r.dc)} ${esc(r.cur)}</td><td>${esc(r.text)||'<span class="note">blank</span>'}</td><td>${r.codes.map(c=>`<span class="pill ${CODES[c]?CODES[c].cls:"grey"}">${CODES[c]?CODES[c].name:c}</span>`).join(" ")}</td></tr>`).join("")}</tbody></table></div>${L.length>150?`<p class="note">Showing 150 of ${L.length}.</p>`:""}`;
  $("#dayClose").onclick=()=>{ C.sel=""; el.hidden=true; };
}
$("#calPrev").onclick=()=>{ C.m--; if(C.m<0){C.m=11;C.y--;} renderCalendar(); };
$("#calNext").onclick=()=>{ C.m++; if(C.m>11){C.m=0;C.y++;} renderCalendar(); };
$("#calToday").onclick=()=>{ C.y=+REPORT.slice(0,4); C.m=+REPORT.slice(5,7)-1; renderCalendar(); };

/* ---------- comments ---------- */
const CQ = {"blank":{n:"Blank",cls:"red"},"copied text":{n:"Copied from another line",cls:"amber"},"number only":{n:"Number only",cls:"amber"},"too short":{n:"Too short",cls:"grey"}};
const cmRows = ROWS.filter(r=>r.cq);
function typeLabel(d){ d=d.toLowerCase();
  if(d.includes("withholding")) return "WHT on IC sale"; if(d.includes("goods in transit")) return "IC goods in transit";
  if(d.includes("down payment")) return "IC down payment"; if(d.includes("invoice to be issued")) return "IC invoice to be issued";
  if(d.includes("accrued revenues")) return "IC accrued revenue"; if(d.includes("accr")) return "IC accrual";
  if(d.includes("a/r")) return "IC receivable"; if(d.includes("a/p")||d.includes("ap ")) return "IC payable"; return "IC item"; }
function suggest(r){
  const ref = r.ref && r.ref!==r.text ? r.ref : (r.doc||"no ref");
  const ym = r.pdate? MON[+r.pdate.slice(5,7)-1]+" "+r.pdate.slice(0,4) : "";
  let act = "open";
  if(r.codes.includes("DUPLICATE")) act="check duplicate"; else if(r.codes.includes("UNCLEARED")||r.codes.includes("FX_REVAL")) act="to clear";
  else if(r.codes.includes("WRONG_TP")||r.codes.includes("NO_TP")) act="recode partner"; else if(r.due && r.due<REPORT) act="overdue, chase partner"; else if(r.codes.includes("OVER_365")) act="aged, owner to confirm";
  return `${typeLabel(r.desc)} ${r.co}→${r.tp||"?"} | ${ref} | ${ym} | ${act}`;
}
const M = {cq:"", q:"", page:0};
function renderComments(){
  const cnt={}; cmRows.forEach(r=>cnt[r.cq]=(cnt[r.cq]||0)+1);
  $("#cmKpis").innerHTML = `<div class="card kpi red"><div class="label">Weak comments</div><div class="value">${nf0.format(cmRows.length)}</div><div class="sub">${pct(cmRows.length,N)} of lines</div></div>`+Object.keys(CQ).map(k=>`<div class="card kpi ${CQ[k].cls==="grey"?"blue":CQ[k].cls}"><div class="label">${CQ[k].n}</div><div class="value">${nf0.format(cnt[k]||0)}</div><div class="sub">${pct(cnt[k]||0,cmRows.length)}</div></div>`).join("");
  $("#cmTabs").innerHTML = `<button aria-pressed="${!M.cq}" data-c="">All<span class="n">${nf0.format(cmRows.length)}</span></button>`+Object.keys(CQ).map(k=>`<button aria-pressed="${M.cq===k}" data-c="${k}">${CQ[k].n}<span class="n">${nf0.format(cnt[k]||0)}</span></button>`).join("");
  $("#cmTabs").querySelectorAll("button").forEach(b=>b.onclick=()=>{ M.cq=b.dataset.c; M.page=0; renderComments(); });
  let list = cmRows.filter(r=>!M.cq||r.cq===M.cq); const q=M.q.trim().toLowerCase();
  if(q) list=list.filter(r=>(r.co+" "+r.tp+" "+r.doc+" "+r.text+" "+r.ref).toLowerCase().includes(q));
  const per=25; const pages=Math.max(1,Math.ceil(list.length/per)); if(M.page>=pages) M.page=pages-1;
  const slice=list.slice(M.page*per,(M.page+1)*per);
  $("#cmBody").innerHTML = slice.length? slice.map(r=>`<tr data-i="${r.i}"><td class="mono">${esc(r.doc)}<div class="note">${r.sheet} · ${fmtDate(r.pdate)}</div></td><td><b>${esc(r.co)}</b> → ${esc(r.tp||"—")}</td><td class="wrap">${r.text?esc(r.text):'<span class="note">(blank)</span>'}</td><td><span class="pill ${CQ[r.cq].cls}">${CQ[r.cq].n}</span></td><td class="wrap"><span class="mono sug" style="white-space:normal">${esc(suggest(r))}</span><div class="inline-ai" hidden></div></td><td><div class="row" style="gap:4px;flex-wrap:nowrap"><button class="small" data-copy>Copy</button><button class="ghost small ai-only" data-ai>Improve</button></div></td></tr>`).join("") : `<tr><td colspan="6" class="empty">No lines match.</td></tr>`;
  $("#cmBody").querySelectorAll("tr[data-i]").forEach(tr=>{ const r=ROWS[+tr.dataset.i];
    tr.querySelector("[data-copy]").onclick=()=>copyText(tr.querySelector(".sug").textContent);
    const b=tr.querySelector("[data-ai]"); b.onclick=()=>ask(`Rewrite this SAP intercompany line text so a colleague understands it without opening the document. Max 80 characters, one line, format: <type> <company>→<partner> | <reference> | <Mon YYYY> | <status/action>. Reply with the line only.\nCurrent text: "${r.text}" (problem: ${r.cq}). Account: ${r.desc}. Company ${r.co}, partner ${r.tp||"unknown"}, doc ${r.doc}, reference "${r.ref}", posted ${r.pdate}, due ${r.due||"n/a"}, amount ${r.dc} ${r.cur}, flags: ${r.codes.join(", ")||"none"}.\nRule-based draft: ${suggest(r)}`, tr.querySelector(".inline-ai"), b);
  });
  pager($("#cmPager"),M.page,list.length,per,p=>{ M.page=p; renderComments(); });
}
let cT; $("#cmSearch").oninput=e=>{ clearTimeout(cT); cT=setTimeout(()=>{ M.q=e.target.value; M.page=0; renderComments(); },200); };

/* ---------- analysis ---------- */
function stats(){
  const erp={}; ROWS.forEach(r=>{ const e=erp[r.sheet]=erp[r.sheet]||{n:0,i:0}; e.n++; if(r.codes.length) e.i++; });
  const co={}; issueRows.forEach(r=>co[r.co]=(co[r.co]||0)+1);
  const dec=Object.values(decisions); const ok=dec.filter(x=>x==="ok").length, no=dec.filter(x=>x==="no").length;
  return {erp,co:Object.entries(co).sort((a,b)=>b[1]-a[1]).slice(0,8),ok,no};
}
function renderAnalysis(){
  const s=stats();
  bars($("#anCodes"),Object.keys(CODES).map(c=>({label:CODES[c].name,value:byCode[c].length,cls:CODES[c].cls==="grey"?"":CODES[c].cls,extra:pct(byCode[c].length,N),href:"#errors/"+CODES[c].grp+"/"+c})).sort((a,b)=>b.value-a.value),{max:N*0.4});
  bars($("#anErp"),Object.entries(s.erp).map(([k,v])=>({label:k+" ("+nf0.format(v.n)+" lines)",value:v.i,extra:pct(v.i,v.n)})),{max:Math.max(...Object.values(s.erp).map(v=>v.n))});
  const cnt={}; cmRows.forEach(r=>cnt[r.cq]=(cnt[r.cq]||0)+1);
  bars($("#anCq"),[{label:"Usable comment",value:N-cmRows.length,cls:"green",extra:pct(N-cmRows.length,N)}].concat(Object.keys(CQ).map(k=>({label:CQ[k].n,value:cnt[k]||0,cls:CQ[k].cls==="grey"?"":CQ[k].cls,extra:pct(cnt[k]||0,N),href:"#comments"}))),{max:N});
  bars($("#anCo"),s.co.map(([k,v])=>({label:k,value:v,extra:nf0.format(v)})));
  const res=odCases.filter(g=>(cases[g.k]||{}).status==="Resolved").length;
  bars($("#anProg"),[
    {label:"Approved fixes",value:s.ok,cls:"green",extra:nf0.format(s.ok)+" / "+nf0.format(issueRows.length)},
    {label:"Rejected fixes",value:s.no,cls:"red",extra:nf0.format(s.no)},
    {label:"Cases resolved",value:res,cls:"green",extra:res+" / "+odCases.length}
  ],{max:Math.max(1,issueRows.length/10)});
  $("#recList").innerHTML = recs().map(r=>`<li>${r}</li>`).join("");
}
function recs(){
  const top=Object.keys(CODES).sort((a,b)=>byCode[b].length-byCode[a].length);
  return [
    `Start with clearing: <b>${nf0.format(clearRows.length)}</b> lines (${pct(clearRows.length,N)}) already have a proposed clearing. Approving them in bulk shrinks the list before anyone investigates.`,
    `Recode partners: <b>${nf0.format(byCode.WRONG_TP.length+byCode.NO_TP.length)}</b> lines have a wrong or missing trading partner. Until they are fixed, partner balances cannot match.`,
    `Give every overdue case an owner: <b>${odCases.length}</b> cases, <b>${odCases.filter(g=>g.days>90).length}</b> of them more than 90 days past due.`,
    `Stop new bad data at entry: make the trading partner and a standard comment mandatory (${pct(cmRows.length,N)} of lines have a weak comment), and block currency codes that do not exist (XO2).`,
    `Biggest single error type is "${CODES[top[0]].name}" with ${pct(byCode[top[0]].length,N)} of lines. Agree a write-off or escalation rule for it in this meeting.`
  ];
}
$("#aiRec").onclick=e=>{ const s=stats();
  const facts = `Open intercompany lines: ${N}. Report date ${REPORT}. Issue lines: ${issueRows.length}. By rule: ${Object.keys(CODES).map(c=>CODES[c].name+" "+byCode[c].length).join("; ")}. Clearing proposals: ${clearRows.length}. Cases left for people: ${caseKeys.size}. Overdue cases: ${odCases.length} (${overdueRows.length} lines), >90 days: ${odCases.filter(g=>g.days>90).length}. Due in next 14 days: ${soonRows.length} lines. Weak comments: ${cmRows.length}. By ERP: ${Object.entries(s.erp).map(([k,v])=>k+" "+v.i+"/"+v.n).join(", ")}. Top companies by issue lines: ${s.co.map(x=>x[0]+" "+x[1]).join(", ")}. Decisions so far: ${s.ok} approved, ${s.no} rejected.`;
  ask(`You advise a corporate intercompany accounting team preparing for their month-end meeting. From the facts below, give 5 prioritised, concrete recommendations (one or two sentences each, numbered), then one line on what to measure next month. Use only these facts; do not invent numbers.\n${facts}`, $("#aiRecOut"), e.target); };

function csv(rows){ return rows.map(r=>r.map(v=>{ v=v==null?"":String(v); return /[",\n;]/.test(v)? '"'+v.replace(/"/g,'""')+'"' : v; }).join(",")).join("\n"); }
$("#expIssues").onclick=()=>{
  const out=[["erp","company","partner","account","doc","doc_type","posting_date","due_date","amount","currency","age_days","issues","proposed_fix","decision","text","reference"]];
  issueRows.forEach(r=>out.push([r.sheet,r.co,r.tp,r.acct,r.doc,r.type,r.pdate,r.due,r.dc,r.cur,r.age,r.codes.map(c=>CODES[c]?CODES[c].name:c).join(" | "),fixFor(r,r.codes[0]),decisions[r.i]==="ok"?"approved":decisions[r.i]==="no"?"rejected":"",r.text,r.ref]));
  saveFile("ic-issues-"+REPORT+".csv",csv(out)); };
$("#expCases").onclick=()=>{
  const out=[["erp","company","partner","lines","oldest_due","days_overdue","amounts","owner","status","note"]];
  odCases.forEach(g=>{ const c=cases[g.k]||{}; out.push([g.sheet,g.co,g.tp,g.rows.length,g.oldest,g.days,Object.entries(g.sum).map(([k,v])=>v.toFixed(2)+" "+k).join(" | "),c.owner||"",c.status||"Open",c.note||""]); });
  saveFile("ic-overdue-cases-"+REPORT+".csv",csv(out)); };


/* ---------- management report (PDF / Word) ---------- */
const PAL = {blue:"#005AFF",deep:"#124191",navy:"#001135",soft:"#E6EFFF",line:"#DCE2EC",fg:"#0B1530",muted:"#59667F",red:"#C8102E",amber:"#A85A00",green:"#0B7A45",c:["#005AFF","#E07B00","#7B5CE0","#0B8A6A","#5B6B86"]};
const FONT = '"Inter","Nokia Pure Headline",Arial,sans-serif';
function mkCanvas(w,h){ const c=document.createElement("canvas"); c.width=w; c.height=h; const x=c.getContext("2d"); x.textBaseline="alphabetic"; return [c,x]; }
function rr(x,a,b,w,h,r){ x.beginPath(); x.moveTo(a+r,b); x.arcTo(a+w,b,a+w,b+h,r); x.arcTo(a+w,b+h,a,b+h,r); x.arcTo(a,b+h,a,b,r); x.arcTo(a,b,a+w,b,r); x.closePath(); }
function txt(x,s,a,b,o={}){ x.font=(o.w||400)+" "+(o.s||22)+"px "+FONT; x.fillStyle=o.c||PAL.fg; x.textAlign=o.al||"left"; x.fillText(String(s),a,b); }
function wrap(x,s,a,b,maxW,lh,o={}){ x.font=(o.w||400)+" "+(o.s||22)+"px "+FONT; x.fillStyle=o.c||PAL.fg; x.textAlign="left"; const words=String(s).split(" "); let line=""; let y=b; words.forEach(w=>{ const t=line?line+" "+w:w; if(x.measureText(t).width>maxW&&line){ x.fillText(line,a,y); y+=lh; line=w; } else line=t; }); if(line){ x.fillText(line,a,y); y+=lh; } return y; }
function cLine(w,h){
  const [c,x]=mkCanvas(w,h); x.fillStyle="#fff"; x.fillRect(0,0,w,h);
  const [reportYear,reportMonth]=REPORT.slice(0,7).split("-").map((v,i)=>i?v-1:+v);
  const m=new Map(); const keys=[];
  for(let i=23;i>=0;i--){
    const d=new Date(Date.UTC(reportYear,reportMonth-i,1));
    const k=d.toISOString().slice(0,7); keys.push(k); m.set(k,{a:0,b:0});
  }
  ROWS.forEach(r=>{
    if(!r.pdate) return;
    const k=r.pdate.slice(0,7); const o=m.get(k);
    if(!o) return;
    o.a++; if(r.codes.length) o.b++;
  });
  const L=70,T=20,B=44,Rr=14; const mx=Math.max(...keys.map(k=>m.get(k).a)); const nice=Math.ceil(mx/500)*500||500;
  const X=i=>L+(w-L-Rr)*i/Math.max(1,keys.length-1), Y=v=>T+(h-T-B)*(1-v/nice);
  [0,.5,1].forEach(t=>{ x.strokeStyle=PAL.line; x.lineWidth=1; x.beginPath(); x.moveTo(L,Y(nice*t)); x.lineTo(w-Rr,Y(nice*t)); x.stroke(); txt(x,nf0.format(nice*t),L-10,Y(nice*t)+5,{s:18,c:PAL.muted,al:"right"}); });
  keys.forEach((k,i)=>{ if(i%3===0){ const anchor=i===0?"left":"center"; txt(x,MON[+k.slice(5,7)-1]+" '"+k.slice(2,4),X(i),h-14,{s:18,c:PAL.muted,al:anchor}); } });
  x.beginPath(); keys.forEach((k,i)=>i?x.lineTo(X(i),Y(m.get(k).a)):x.moveTo(X(i),Y(m.get(k).a))); x.lineTo(X(keys.length-1),Y(0)); x.lineTo(X(0),Y(0)); x.closePath(); x.fillStyle="rgba(0,90,255,.08)"; x.fill();
  [["a",PAL.c[0]],["b",PAL.c[1]]].forEach(([f,col])=>{ x.beginPath(); keys.forEach((k,i)=>i?x.lineTo(X(i),Y(m.get(k)[f])):x.moveTo(X(i),Y(m.get(k)[f]))); x.strokeStyle=col; x.lineWidth=3; x.lineJoin="round"; x.stroke(); });
  return c;
}
function cDonut(w,h){
  const [c,x]=mkCanvas(w,h); x.fillStyle="#fff"; x.fillRect(0,0,w,h);
  const data=GROUPS.map(g=>({g,n:new Set(g.codes.flatMap(k=>byCode[k].map(r=>r.i))).size})); const tot=data.reduce((a,d)=>a+d.n,0)||1;
  const R=h*0.27, cx=R+30, cy=h*0.5; let a0=-Math.PI/2; x.lineWidth=R*0.42;
  data.forEach((d,i)=>{ const a1=a0+2*Math.PI*d.n/tot; x.strokeStyle=PAL.c[i]; x.beginPath(); x.arc(cx,cy,R,a0+0.01,a1-0.01); x.stroke(); a0=a1; });
  txt(x,nf0.format(issueRows.length),cx,cy+6,{s:34,w:700,al:"center"}); txt(x,"issue lines",cx,cy+32,{s:18,c:PAL.muted,al:"center"});
  data.forEach((d,i)=>{ const y=h*0.2+i*h*0.14; x.fillStyle=PAL.c[i]; rr(x,cx+R+40,y-14,16,16,3); x.fill(); txt(x,d.g.name,cx+R+64,y,{s:18}); txt(x,nf0.format(d.n),w-6,y,{s:19,w:600,al:"right"}); });
  return c;
}
function cBars(w,items,max,rowH=44){
  const h=items.length*rowH+10; const [c,x]=mkCanvas(w,h); x.fillStyle="#fff"; x.fillRect(0,0,w,h); const lw=w<600?w*.5:Math.min(340,w*.42), vw=90;
  items.forEach((it,i)=>{ const y=i*rowH+rowH*0.62; txt(x,it.label,0,y,{s:21}); x.fillStyle="#EEF1F7"; rr(x,lw,y-16,w-lw-vw,12,6); x.fill(); const bw=Math.max(4,(w-lw-vw)*Math.min(1,it.value/max)); x.fillStyle=it.col||PAL.blue; rr(x,lw,y-16,bw,12,6); x.fill(); txt(x,it.extra,w,y,{s:21,w:600,al:"right"}); });
  return c;
}
function repData(){
  const s=stats(); const types=Object.keys(CODES).sort((a,b)=>byCode[b].length-byCode[a].length);
  const colOf=c=>["WRONG_TP","NO_TP","DUPLICATE","WRONG_CUR","BAD_CUR"].includes(c)?PAL.red:["OVER_365","UNCLEARED","FX_REVAL"].includes(c)?PAL.c[1]:PAL.c[4];
  const typeItems=types.map(c=>({label:CODES[c].name,value:byCode[c].length,extra:pct(byCode[c].length,N),col:colOf(c)}));
  const cnt={}; cmRows.forEach(r=>cnt[r.cq]=(cnt[r.cq]||0)+1);
  const cq=[{label:"Usable comment",value:N-cmRows.length,extra:pct(N-cmRows.length,N),col:PAL.green}].concat(Object.keys(CQ).map(k=>({label:CQ[k].n,value:cnt[k]||0,extra:pct(cnt[k]||0,N),col:PAL.c[1]})));
  const erp=Object.entries(s.erp).map(([k,v])=>({label:k+" ("+nf0.format(v.n)+")",value:v.i,extra:pct(v.i,v.n)}));
  const top=odCases.slice(0,8).map(g=>{ const c=cases[g.k]||{}; return {case:g.co+" → "+(g.tp||"none"),erp:g.sheet,lines:g.rows.length,amt:Object.entries(g.sum).sort((a,b)=>Math.abs(b[1])-Math.abs(a[1])).slice(0,1).map(([k,v])=>fmtAmt(v)+" "+k).join(""),days:g.days,owner:c.owner||"",status:c.status||"Open"}; });
  const res=odCases.filter(g=>(cases[g.k]||{}).status==="Resolved").length;
  const ai=$("#aiRecOut"); const aiTxt=(!ai.hidden&&ai.textContent&&!ai.classList.contains("muted")&&ai.textContent!=="Thinking…")?ai.textContent:"";
  const kp=[["Open lines",nf0.format(N),pct(1,1)==="100.0%"?"P20 · BPP · P10":"",PAL.blue],["With an issue",nf0.format(issueRows.length),pct(issueRows.length,N),PAL.red],["To clear",nf0.format(clearRows.length),"clearing proposed",PAL.green],["Overdue cases",nf0.format(odCases.length),nf0.format(overdueRows.length)+" lines",PAL.red],["Due in 14 days",nf0.format(soonRows.length),"lines",PAL.amber]];
  return {s,typeItems,cq,erp,top,res,aiTxt,kp,recs:recs().map(r=>r.replace(/<\/?b>/g,"")),co:s.co,groups:GROUPS.map(g=>g.name)};
}
function pageHeader(x,W,title,sub,kicker){
  const g=x.createLinearGradient(0,0,W,0); g.addColorStop(0,PAL.navy); g.addColorStop(.55,PAL.deep); g.addColorStop(1,PAL.blue);
  x.fillStyle=g; x.beginPath(); x.moveTo(0,0); x.lineTo(W,0); x.lineTo(W,230); x.lineTo(0,290); x.closePath(); x.fill();
  txt(x,kicker.toUpperCase(),84,86,{s:20,c:"rgba(255,255,255,.8)"}); txt(x,title,84,150,{s:58,w:700,c:"#fff"}); if(sub) txt(x,sub,84,196,{s:24,c:"rgba(255,255,255,.88)"});
}
function sectionTitle(x,s,a,b){ x.fillStyle=PAL.blue; rr(x,a,b-24,8,30,2); x.fill(); txt(x,s,a+22,b,{s:30,w:600,c:PAL.blue}); }
function pageFooter(x,W,H,n,t){ x.strokeStyle=PAL.line; x.lineWidth=1.5; x.beginPath(); x.moveTo(84,H-84); x.lineTo(W-84,H-84); x.stroke(); txt(x,"Anonymised hackathon data · Nokia Finance Hackathon use only",84,H-48,{s:19,c:PAL.muted}); txt(x,"Page "+n+" of "+t,W-84,H-48,{s:19,c:PAL.muted,al:"right"}); }
function tableC(x,cols,rows,a,b,W2,rowH){
  const tw=cols.reduce((s,c)=>s+c.w,0); let cx=a; x.fillStyle=PAL.soft; x.fillRect(a,b-30,W2,rowH); x.strokeStyle=PAL.blue; x.lineWidth=2; x.beginPath(); x.moveTo(a,b-30); x.lineTo(a+W2,b-30); x.moveTo(a,b-30+rowH); x.lineTo(a+W2,b-30+rowH); x.stroke();
  const xs=[]; cols.forEach(c=>{ xs.push(cx); const wpx=W2*c.w/tw; txt(x,c.h,c.al==="right"?cx+wpx-14:cx+14,b,{s:19,w:600,c:PAL.deep,al:c.al||"left"}); cx+=wpx; });
  rows.forEach((r,i)=>{ const y=b+(i+1)*rowH; let cx2=a; cols.forEach((c,j)=>{ const wpx=W2*c.w/tw; const o=r[j]; const t=typeof o==="object"?o.t:o; const col=typeof o==="object"?o.c:PAL.fg; txt(x,t,c.al==="right"?cx2+wpx-14:cx2+14,y,{s:20,c:col,w:j===0?600:400,al:c.al||"left"}); cx2+=wpx; }); x.strokeStyle=PAL.line; x.lineWidth=1; x.beginPath(); x.moveTo(a,y+14); x.lineTo(a+W2,y+14); x.stroke(); });
  return b+(rows.length+1)*rowH;
}
function buildPages(){
  const D=repData(); const W=1240,H=1754; const pages=[];
  let [c1,x]=mkCanvas(W,H); x.fillStyle="#fff"; x.fillRect(0,0,W,H);
  pageHeader(x,W,"Intercompany Management Report","Open lines across P20, BPP and P10, checked against ten rules","Nokia Finance Hackathon · Intercompany");
  x.strokeStyle=PAL.line; x.lineWidth=1.5; rr(x,84,318,W-168,86,6); x.stroke();
  [["Report date",fmtDate(REPORT)],["Scope","P20 · BPP · P10"],["Open lines",nf0.format(N)],["Prepared",fmtDate(new Date().toISOString().slice(0,10))]].forEach((m,i)=>{ const cx=84+i*(W-168)/4; txt(x,m[0],cx+22,350,{s:18,c:PAL.muted}); txt(x,m[1],cx+22,385,{s:24,w:600}); if(i) { x.beginPath(); x.moveTo(cx,330); x.lineTo(cx,392); x.stroke(); } });
  const tw=(W-168-4*16)/5; D.kp.forEach((k,i)=>{ const cx=84+i*(tw+16); x.strokeStyle=PAL.line; rr(x,cx,430,tw,130,6); x.stroke(); x.fillStyle=k[3]; x.fillRect(cx+2,430,tw-4,6); txt(x,k[0],cx+18,472,{s:18,c:PAL.muted}); txt(x,k[1],cx+18,520,{s:44,w:700,c:k[3]}); txt(x,k[2],cx+18,548,{s:17,c:PAL.muted}); });
  sectionTitle(x,"Open lines by posting month",84,620); x.drawImage(cLine(520,300),84,640);
  sectionTitle(x,"Issues by group",640,620); x.drawImage(cDonut(516,300),640,640);
  txt(x,"■ All lines   ■ With an issue   · Last 24 calendar months",84,970,{s:17,c:PAL.muted});
  sectionTitle(x,"Issues by type",84,1020); x.drawImage(cBars(620,D.typeItems,N*0.4,46),84,1040);
  sectionTitle(x,"Before and after the scan",750,1020);
  [["Before",nf0.format(N)+" lines","read one by one in SAP exports",PAL.blue],["After the scan",nf0.format(clearRows.length)+" to clear","each with a proposed clearing to approve",PAL.green],["Left for people",nf0.format(caseKeys.size)+" cases",nf0.format(caseRows.length)+" lines grouped by company and partner",PAL.c[1]]].forEach((b,i)=>{ const y=1050+i*150; x.fillStyle=b[3]; x.fillRect(750,y,8,128); x.fillStyle="#F3F5F9"; x.fillRect(758,y,W-84-758,128); txt(x,b[0],782,y+36,{s:19,c:PAL.muted}); txt(x,b[1],782,y+80,{s:36,w:700}); txt(x,b[2],782,y+112,{s:19,c:PAL.muted}); });
  pageFooter(x,W,H,1,2); pages.push(c1);
  let [c2,y2]=mkCanvas(W,H); y2.fillStyle="#fff"; y2.fillRect(0,0,W,H); x=y2;
  pageHeader(x,W,"Where to act first","","Intercompany · Detail");
  sectionTitle(x,"Oldest overdue cases",84,340);
  let yy=tableC(x,[{h:"Case",w:3},{h:"ERP",w:1.2},{h:"Lines",w:1,al:"right"},{h:"Open amount",w:2.2,al:"right"},{h:"Days",w:1.2,al:"right"},{h:"Owner",w:1.6},{h:"Status",w:2}],D.top.map(t=>[t.case,t.erp,String(t.lines),t.amt,{t:nf0.format(t.days),c:PAL.red},t.owner||"–",t.status]),84,390,W-168,50);
  sectionTitle(x,"Issue lines by ERP",84,yy+70); x.drawImage(cBars(480,D.erp,Math.max(...D.erp.map(e=>e.value))*1.6,46),84,yy+90);
  sectionTitle(x,"Comment quality",640,yy+70); x.drawImage(cBars(516,D.cq,N,46),640,yy+90);
  let y3=yy+90+Math.max(D.erp.length,D.cq.length)*46+70;
  sectionTitle(x,"Review progress",84,y3); txt(x,"Approved fixes: "+D.s.ok+"   Rejected: "+D.s.no+"   Cases resolved: "+D.res+" of "+odCases.length,84,y3+44,{s:24});
  y3+=90; sectionTitle(x,"Recommendations",84,y3); y3+=46;
  D.recs.forEach((r,i)=>{ x.fillStyle=PAL.soft; rr(x,84,y3-26,W-168,10,2); const y0=y3; y3=wrap(x,(i+1)+". "+r,100,y3,W-200,27,{s:19}); y3+=8; });
  pageFooter(x,W,H,2,2); pages.push(c2);
  return {pages,D};
}
async function exportPdf(){
  if(!(window.jspdf&&window.jspdf.jsPDF)){ toast("PDF library did not load"); return; }
  const {pages}=buildPages(); const doc=new window.jspdf.jsPDF({unit:"mm",format:"a4"});
  pages.forEach((c,i)=>{ if(i) doc.addPage(); doc.addImage(c.toDataURL("image/jpeg",.92),"JPEG",0,0,210,297); });
  await saveFile("ic-management-report-"+REPORT+".pdf",doc.output("blob"));
}
$("#expPdf").onclick=()=>exportPdf().catch(e=>toast("Could not build the PDF"));

/* ---------- currency ---------- */
let RATES = {date:"2026-11-12", src:"ECB euro reference rates", r:{"EUR":1,"USD":1.1081,"JPY":176.96,"CZK":24.379,"DKK":7.4754,"GBP":0.83595,"HUF":364.98,"PLN":4.4088,"RON":5.3473,"SEK":11.0628,"CHF":0.9232,"ISK":136.60,"NOK":10.5630,"TRY":55.6906,"AUD":1.6246,"BRL":6.2241,"CAD":1.5789,"CNY":7.3891,"HKD":8.6928,"IDR":20225.76,"ILS":3.5495,"INR":104.2118,"KRW":1478.32,"MXN":20.7113,"MYR":4.5194,"NZD":1.9942,"PHP":70.616,"SGD":1.4249,"THB":37.470,"ZAR":18.5219}};
const PEGS = {"XOF":655.957,"BGN":1.95583,"SKK":30.126}; // fixed euro conversion rates
const NAMES = {EUR:"Euro",USD:"US dollar",HUF:"Hungarian forint",JPY:"Japanese yen",CZK:"Czech koruna",DKK:"Danish krone",GBP:"Pound sterling",PLN:"Polish zloty",RON:"Romanian leu",SEK:"Swedish krona",CHF:"Swiss franc",ISK:"Icelandic krona",NOK:"Norwegian krone",TRY:"Turkish lira",AUD:"Australian dollar",BRL:"Brazilian real",CAD:"Canadian dollar",CNY:"Chinese yuan",HKD:"Hong Kong dollar",IDR:"Indonesian rupiah",ILS:"Israeli shekel",INR:"Indian rupee",KRW:"South Korean won",MXN:"Mexican peso",MYR:"Malaysian ringgit",NZD:"New Zealand dollar",PHP:"Philippine peso",SGD:"Singapore dollar",THB:"Thai baht",ZAR:"South African rand",XOF:"West African CFA franc",BGN:"Bulgarian lev",SKK:"Slovak koruna (legacy)"};
const MAIN = ["USD","EUR","HUF"];
const cachedRates = store("rates"); if(cachedRates && cachedRates.date>RATES.date) RATES=cachedRates;
let extra = store("curExtra")||[]; let base = store("curBase")||"EUR";
const rateOf = c=> c in RATES.r ? RATES.r[c] : PEGS[c];
function renderCurrency(){
  const all = Object.keys(RATES.r).concat(Object.keys(PEGS));
  $("#curLead").textContent = "ECB · "+fmtDate(RATES.date);
  $("#curBase").innerHTML = all.map(c=>`<option ${c===base?"selected":""}>${c}</option>`).join("");
  const shown = MAIN.concat(extra.filter(c=>!MAIN.includes(c)));
  $("#curAddSel").innerHTML = all.filter(c=>!shown.includes(c)).map(c=>`<option value="${c}">${c} · ${NAMES[c]||""}</option>`).join("");
  const amt = +$("#curAmt").value||0; const rb=rateOf(base);
  $("#curCards").innerHTML = shown.map(c=>{ const x=rateOf(c)/rb; const isBase=c===base;
    return `<div class="card cur">${MAIN.includes(c)?"":`<button class="ghost small rm" data-rm="${c}" aria-label="Remove ${c}">✕</button>`}<div class="code">${c}</div><div class="note">${NAMES[c]||""}${c in PEGS?" · fixed rate":""}</div>
    <div class="rate">${isBase?"base":fmtRate(x)}</div><div class="conv">${isBase?"":`1 ${base} = ${fmtRate(x)} ${c}<br>1 ${c} = ${fmtRate(1/x)} ${base}<br>`}${nf2.format(amt)} ${base} = ${nf2.format(amt*x)} ${c}</div></div>`; }).join("");
  $("#curCards").querySelectorAll("[data-rm]").forEach(b=>b.onclick=()=>{ extra=extra.filter(c=>c!==b.dataset.rm); store("curExtra",extra); renderCurrency(); });
  const net={}, cnt={}; ROWS.forEach(r=>{ net[r.cur]=(net[r.cur]||0)+r.dc; cnt[r.cur]=(cnt[r.cur]||0)+1; });
  $("#curConvTh").textContent="In "+base;
  $("#curBody").innerHTML = Object.keys(net).sort((a,b)=>cnt[b]-cnt[a]).map(c=>{ const rc=rateOf(c);
    return `<tr><td><b>${esc(c)}</b> <span class="note">${NAMES[c]||""}</span></td><td class="num">${nf0.format(cnt[c])}</td><td class="num">${nf2.format(net[c])}</td><td class="num">${rc? nf2.format(net[c]/rc*rb) : "–"}</td><td>${rc? (c in PEGS?'<span class="pill grey">fixed euro rate</span>':'<span class="pill green">ECB</span>') : c==="XO2"?'<span class="pill red">invalid code (XOF?)</span>':'<span class="pill amber">no ECB rate</span>'}</td></tr>`; }).join("");
}
function fmtRate(x){ return x>=100? nf2.format(x) : x>=1? x.toFixed(4) : x.toPrecision(4); }
$("#curBase").onchange=e=>{ base=e.target.value; store("curBase",base); renderCurrency(); };
$("#curAmt").oninput=()=>renderCurrency();
$("#curAdd").onclick=()=>{ const c=$("#curAddSel").value; if(!c) return; extra.push(c); store("curExtra",extra); renderCurrency(); toast(c+" added"); };
$("#curRefresh").onclick=async e=>{
  if(!mcp){ toast("Live refresh needs the Firecrawl connector"); return; }
  const b=e.target; b.disabled=true; b.textContent="Refreshing…";
  try{
    const res = await mcp.callTool("Firecrawl","firecrawl_scrape",{url:"https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml",formats:["rawHtml"],maxAge:0,objective:"Get today's ECB euro reference exchange rates for a currency converter"});
    const p = res && res.payload; let txt = "";
    const dig = o=>{ if(!o) return; if(typeof o==="string"){ if(o.includes("currency=")) txt+=o; return; } if(typeof o==="object") Object.values(o).forEach(dig); };
    dig(p); if(!txt && res) dig(res);
    const t = /time=['"](\d{4}-\d{2}-\d{2})['"]/.exec(txt); const r={EUR:1}; let m; const re=/currency=['"]([A-Z]{3})['"]\s+rate=['"]([\d.]+)['"]/g;
    while((m=re.exec(txt))) r[m[1]]=+m[2];
    if(!t || Object.keys(r).length<10) throw new Error("parse");
    RATES={date:t[1],src:"ECB euro reference rates (refreshed)",r}; store("rates",RATES); renderCurrency(); toast("Rates updated to "+fmtDate(t[1]));
  }catch(err){ toast(err&&err.code==="not_granted"?"Connector access was not allowed":"Could not refresh; showing "+fmtDate(RATES.date)+" rates"); }
  finally{ b.disabled=false; b.textContent="Refresh from ECB"; }
};

/* ---------- router ---------- */
const VIEWS = ["overview","errors","overdue","owners","calendar","analysis","currency","comments"];
const R = {overview:renderOverview, errors:renderErrors, overdue:renderOverdue, owners:renderOwners, calendar:renderCalendar, analysis:renderAnalysis, currency:renderCurrency, comments:renderComments};
function route(){
  const parts = (location.hash||"#overview").slice(1).split("/");
  const v = VIEWS.includes(parts[0])? parts[0] : "overview";
  if(v==="errors"){ const g=GROUPS.find(x=>x.id===parts[1]); const ng=g?g.id:E.grp; const nc=g&&parts[2]&&g.codes.includes(parts[2])?parts[2]:""; if(ng!==E.grp||nc!==E.code){E.page=0;} E.grp=ng; E.code=g?nc:E.code; }
  if(v==="calendar" && /^\d{4}-\d{2}-\d{2}$/.test(parts[1]||"")){ C.y=+parts[1].slice(0,4); C.m=+parts[1].slice(5,7)-1; C.sel=parts[1]; }
  VIEWS.forEach(x=>{ $("#v-"+x).hidden = x!==v; });
  document.querySelectorAll("#tabs a").forEach(a=>{ if(a.getAttribute("href")==="#"+v) a.setAttribute("aria-current","page"); else a.removeAttribute("aria-current"); });
  const TT={overview:"Overview",errors:"Errors",overdue:"Overdue",owners:"Owners",calendar:"Due-date calendar",analysis:"Analysis",currency:"Currency",comments:"Comments"}; $("#pageTitle").textContent=TT[v]; R[v]();
}
window.addEventListener("hashchange",()=>{ route(); window.scrollTo(0,0); });
$("#repChip").textContent = (RAW.label?RAW.label+" · ":"")+"Report date "+fmtDate(REPORT);
$("#loadData").onchange=e=>{ const f=e.target.files[0]; if(!f) return; f.text().then(t=>{ const j=JSON.parse(t); if(!j.rows||!j.fields) throw new Error("bad"); try{ sessionStorage.setItem("icdd:data",t); }catch(x){ toast("File too large for this browser session"); return; } location.reload(); }).catch(()=>toast("Not a valid data.json")); };
renderBell(); route();
})();
