'use strict';

/* ═══════════ CONFIG ═══════════ */
const CONFIG={LEARNING_STEPS:[20,60,300],GRAD:600,EASY_GRAD:900,
  MIN_EASE:1.3,MAX_EASE:3.0,DEF_EASE:2.5,HARD_MULT:1.2,EASY_MULT:1.3,MAX_INT:4*3600,
  LEECH_THRESHOLD:8,LEECH_COOLDOWN:1800};
const KEY='srs_adaptive_v3';

/* ═══════════ STATE ═══════════ */
let deck=[], categories=[], cardState={};
let currentFilter='all', currentCard=null, showingAnswer=false;
let sessionStart=Date.now(), sessionReviews=0, sessionCorrect=0;
let view='study', deckSearch='', deckFilter='all';
let selectedIds=new Set();
let storageOK=true;
let sinceNewCard=0;
let leechEnabled=true;

const newState=()=>({phase:'new',step:0,int:0,ease:CONFIG.DEF_EASE,dueAt:0,reps:0,lapses:0});
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid=(p='c')=>`${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,7)}`;
const catOf=id=>categories.find(c=>c.id===id)||{id,label:id||'—',color:'#8A8E96'};

/* ═══════════ SM-2 ═══════════ */
function schedule(s0,r){
  const s=Object.assign({},s0||newState()), now=Date.now();
  s.reps++;
  const learning = s.phase==='new'||s.phase==='learning';
  if(learning){
    if(r===1){s.phase='learning';s.step=0;s.ease=Math.max(s.ease-.2,CONFIG.MIN_EASE);s.int=CONFIG.LEARNING_STEPS[0];}
    else if(r===2){s.phase='learning';s.int=Math.round(CONFIG.LEARNING_STEPS[Math.min(s.step,CONFIG.LEARNING_STEPS.length-1)]*1.5);}
    else if(r===3){s.step++;
      if(s.step>=CONFIG.LEARNING_STEPS.length){s.phase='review';s.int=CONFIG.GRAD;}
      else{s.phase='learning';s.int=CONFIG.LEARNING_STEPS[s.step];}}
    else{s.phase='review';s.int=CONFIG.EASY_GRAD;s.ease=Math.min(s.ease+.15,CONFIG.MAX_EASE);}
  }else{
    if(r===1){s.lapses++;s.phase='learning';s.step=0;s.ease=Math.max(s.ease-.2,CONFIG.MIN_EASE);s.int=CONFIG.LEARNING_STEPS[0];}
    else if(r===2){s.ease=Math.max(s.ease-.15,CONFIG.MIN_EASE);s.int=Math.round(Math.min(s.int*CONFIG.HARD_MULT,CONFIG.MAX_INT));}
    else if(r===3){s.int=Math.round(Math.min(s.int*s.ease,CONFIG.MAX_INT));}
    else{s.ease=Math.min(s.ease+.15,CONFIG.MAX_EASE);s.int=Math.round(Math.min(s.int*s.ease*CONFIG.EASY_MULT,CONFIG.MAX_INT));}
  }
  s.dueAt=now+s.int*1000;
  return s;
}

/* ═══════════ STORAGE ═══════════ */
let saveTimer=null;
const snapshot=()=>({deck,categories,cardState,sessionStart,sessionReviews,sessionCorrect,currentFilter,view,leechEnabled,savedAt:Date.now(),v:3});
function save(){
  const json=JSON.stringify(snapshot());
  let ok=false;
  try{localStorage.setItem(KEY,json);ok=true;}catch(e){}
  try{if(window.storage&&window.storage.set){window.storage.set(KEY,json);ok=true;}}catch(e){}
  storageOK=ok;
  const ind=document.getElementById('save-ind');
  if(ind){
    ind.textContent=ok?'saved':'not saved!';
    ind.className='save-ind show'+(ok?'':' err');
    clearTimeout(saveTimer);
    if(ok)saveTimer=setTimeout(()=>ind.classList.remove('show'),800);
  }
}
async function load(){
  let json=null;
  try{json=localStorage.getItem(KEY);}catch(e){}
  if(!json){try{if(window.storage&&window.storage.get){const r=await window.storage.get(KEY);json=r&&r.value?r.value:null;}}catch(e){}}
  if(!json)return false;
  try{
    const d=JSON.parse(json);
    deck=Array.isArray(d.deck)?d.deck:[];
    categories=Array.isArray(d.categories)?d.categories:[];
    cardState=d.cardState||{};
    sessionStart=d.sessionStart||Date.now();
    sessionReviews=d.sessionReviews||0; sessionCorrect=d.sessionCorrect||0;
    currentFilter=d.currentFilter||'all'; view=d.view||'study';
    leechEnabled=d.leechEnabled!==false;
    deck.forEach(c=>{if(!cardState[c.id])cardState[c.id]=newState();});
    Object.keys(cardState).forEach(id=>{if(!deck.some(c=>c.id===id))delete cardState[id];});
    return true;
  }catch(e){return false;}
}
window.addEventListener('beforeunload',()=>{try{localStorage.setItem(KEY,JSON.stringify(snapshot()));}catch(e){}});
document.addEventListener('visibilitychange',()=>{if(document.hidden)save();});

/* ═══════════ TOAST + MODAL (no native dialogs) ═══════════ */
let toastTimer=null;
function toast(msg,isErr){
  const el=document.getElementById('toast');
  el.textContent=msg;
  el.className='toast show'+(isErr?' err':'');
  clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>el.classList.remove('show'),2400);
}
function closeModal(){
  const r=document.getElementById('modal-root');
  r.classList.remove('show'); r.innerHTML='';
}
function openModal(html,opts){
  const r=document.getElementById('modal-root');
  r.innerHTML=html; r.classList.add('show');
  const close=()=>closeModal();
  const x=r.querySelector('.m-close'); if(x)x.addEventListener('click',close);
  r.onclick=e=>{if(e.target===r)close();};
  r.onkeydown=e=>{if(e.key==='Escape')close();};
  if(opts&&opts.after)opts.after(r,close);
  return r;
}
/* replacement for confirm() */
function ask(opts){
  const{title='ยืนยัน',body='',okText='ตกลง',cancelText='ยกเลิก',danger=false,onOk}=opts;
  openModal(`<div class="modal narrow">
    <div class="m-head"><div class="m-title">${esc(title)}</div><button class="m-close">×</button></div>
    <div class="m-body">${body}</div>
    <div class="m-acts">
      <button class="btn sub sm" id="ask-no">${esc(cancelText)}</button>
      <button class="btn ${danger?'danger':''} sm" id="ask-yes">${esc(okText)}</button>
    </div></div>`,{after:(r,close)=>{
      r.querySelector('#ask-no').addEventListener('click',close);
      r.querySelector('#ask-yes').addEventListener('click',()=>{close();if(onOk)onOk();});
      setTimeout(()=>{const b=r.querySelector('#ask-yes');if(b)b.focus();},30);
    }});
}
/* replacement for prompt() */
function askText(opts){
  const{title='กรอกข้อมูล',label='',value='',okText='ตกลง',onOk}=opts;
  openModal(`<div class="modal narrow">
    <div class="m-head"><div class="m-title">${esc(title)}</div><button class="m-close">×</button></div>
    <div class="frow"><div class="flabel">${esc(label)}</div>
      <input type="text" class="finput" id="ask-input" value="${esc(value)}"></div>
    <div class="m-acts">
      <button class="btn sub sm" id="ask-no">ยกเลิก</button>
      <button class="btn sm" id="ask-yes">${esc(okText)}</button>
    </div></div>`,{after:(r,close)=>{
      const inp=r.querySelector('#ask-input');
      const go=()=>{const v=inp.value.trim();close();if(v&&onOk)onOk(v);};
      r.querySelector('#ask-no').addEventListener('click',close);
      r.querySelector('#ask-yes').addEventListener('click',go);
      inp.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();go();}});
      setTimeout(()=>inp.focus(),40);
    }});
}

/* ═══════════ CARD OPS ═══════════ */
function removeCards(ids){
  const set=new Set(ids);
  deck=deck.filter(c=>!set.has(c.id));
  ids.forEach(id=>{delete cardState[id];selectedIds.delete(id);});
  if(currentCard&&set.has(currentCard.id)){currentCard=null;showingAnswer=false;}
  save();
  if(view==='deck')renderDeckList();
  else if(view==='study')renderStudyCard();
  else if(view==='settings')renderSettings();
  updateTabs();
  toast(`ลบแล้ว ${ids.length} ใบ`);
}
function deleteCard(id){
  const c=deck.find(x=>x.id===id); if(!c)return;
  ask({title:'ลบการ์ด',danger:true,okText:'ลบ',
    body:`ลบการ์ดนี้?<br><br><strong>${esc(c.front.replace(/<[^>]*>/g,''))}</strong><br>→ ${esc(c.back)}`,
    onOk:()=>removeCards([id])});
}

/* ═══════════ SELECTION ═══════════ */
/* Mirrors Anki's queue model: due learning cards always take priority (sorted
   earliest-due-first, not randomly reselected), review cards come next, and
   new cards trickle in at a ratio instead of flooding the pool — otherwise a
   few fast-cycling learning cards dominate and new cards never get a turn. */
const inFilter=c=>currentFilter==='all'||c.cat===currentFilter;
function notCurrent(c){return !currentCard||c.id!==currentCard.id;}
function pickNext(){
  const now=Date.now();
  const pool=deck.filter(inFilter);
  const learningDue=pool.filter(c=>{const s=cardState[c.id];return s&&s.phase==='learning'&&s.dueAt<=now;})
    .sort((a,b)=>cardState[a.id].dueAt-cardState[b.id].dueAt);
  if(learningDue.length){
    const alt=learningDue.filter(notCurrent);
    return (alt.length?alt:learningDue)[0];
  }
  const reviewDue=pool.filter(c=>{const s=cardState[c.id];return s&&s.phase==='review'&&s.dueAt<=now;})
    .sort((a,b)=>cardState[a.id].dueAt-cardState[b.id].dueAt);
  const fresh=pool.filter(c=>{const s=cardState[c.id];return s&&s.phase==='new';});
  if(!reviewDue.length&&!fresh.length)return null;
  if(fresh.length){
    const ratio=reviewDue.length?Math.max(1,Math.round(reviewDue.length/fresh.length)):1;
    sinceNewCard++;
    if(!reviewDue.length||sinceNewCard>=ratio){
      sinceNewCard=0;
      return fresh[0];
    }
  }
  if(reviewDue.length){
    const alt=reviewDue.filter(notCurrent);
    return (alt.length?alt:reviewDue)[0];
  }
  return fresh[0]||null;
}
function nextDue(){
  const now=Date.now(); let m=Infinity;
  deck.forEach(c=>{if(!inFilter(c))return;const s=cardState[c.id];
    if(s&&s.dueAt>now&&s.dueAt<m)m=s.dueAt;});
  return m===Infinity?null:m-now;
}
const dueCount=()=>{const n=Date.now();return deck.filter(c=>inFilter(c)&&cardState[c.id]&&cardState[c.id].dueAt<=n).length;};
function fmt(ms){const s=Math.max(1,Math.round(ms/1000));
  if(s<60)return s+'s'; if(s<3600)return Math.round(s/60)+'m';
  return (s/3600).toFixed(s<7200?1:0)+'h';}

/* ═══════════ ROUTER ═══════════ */
function setView(v){view=v;
  document.querySelectorAll('.tab').forEach(t=>t.classList.toggle('active',t.dataset.view===v));
  render();save();}
function render(){
  updateTabs();
  if(view==='study')renderStudy();
  else if(view==='deck')renderDeck();
  else renderSettings();
  document.getElementById('fab').style.display=view==='settings'?'none':'flex';
}
function updateTabs(){
  const b=document.getElementById('tab-badge'), d=dueCount();
  if(d>0){b.textContent=d;b.style.display='inline-block';}else b.style.display='none';
  document.getElementById('tab-cnt').textContent=' '+deck.length;
}

/* ═══════════ STUDY ═══════════ */
function renderStudy(){
  const main=document.getElementById('main');
  if(!deck.length){
    main.innerHTML=`<div class="onboard">
      <h2>เริ่มต้นที่นี่</h2>
      <p>ตอนนี้ยังไม่มีการ์ดในระบบ<br>
      นำเข้าไฟล์ deck (.json) ที่มีอยู่ หรือเพิ่มการ์ดเองทีละใบ</p>
      <div class="onboard-acts">
        <button class="btn" id="ob-import">นำเข้าไฟล์ deck</button>
        <button class="btn out" id="ob-paste">วาง JSON</button>
        <button class="btn sub" id="ob-add">เพิ่มการ์ดเอง</button>
      </div></div>`;
    main.querySelector('#ob-import').addEventListener('click',()=>document.getElementById('file-in').click());
    main.querySelector('#ob-paste').addEventListener('click',openPasteJSON);
    main.querySelector('#ob-add').addEventListener('click',()=>openCardModal());
    return;
  }
  main.innerHTML=`<div class="stats">
      <div class="stat"><div class="stat-label">Due</div><div class="stat-value due" id="s-due">0</div></div>
      <div class="stat"><div class="stat-label">New</div><div class="stat-value new" id="s-new">0</div></div>
      <div class="stat"><div class="stat-label">Learn</div><div class="stat-value learn" id="s-learn">0</div></div>
      <div class="stat"><div class="stat-label">Review</div><div class="stat-value done" id="s-rev">0</div></div>
      <div class="stat"><div class="stat-label">Acc</div><div class="stat-value" id="s-acc">—</div></div>
    </div>
    <div class="card-area" id="card-area"></div>
    <div class="ratings" id="ratings" style="display:none">
      <button class="rate-btn again" data-rate="1"><div class="rate-key">1</div><div class="rate-label">ลืม</div><div class="rate-int" id="i1">20s</div></button>
      <button class="rate-btn hard" data-rate="2"><div class="rate-key">2</div><div class="rate-label">ยาก</div><div class="rate-int" id="i2">1m</div></button>
      <button class="rate-btn good" data-rate="3"><div class="rate-key">3</div><div class="rate-label">ได้</div><div class="rate-int" id="i3">5m</div></button>
      <button class="rate-btn easy" data-rate="4"><div class="rate-key">4</div><div class="rate-label">ง่าย</div><div class="rate-int" id="i4">10m</div></button>
    </div>
    <div class="controls" id="controls"></div>`;
  const ctrl=document.getElementById('controls');
  let chips=`<button class="chip" data-cat="all">ทั้งหมด<span class="cnt">${deck.length}</span></button>`;
  categories.forEach(cat=>{const n=deck.filter(c=>c.cat===cat.id).length; if(!n)return;
    chips+=`<button class="chip" data-cat="${esc(cat.id)}"><span class="dot" style="background:${esc(cat.color)}"></span>${esc(cat.label)}<span class="cnt">${n}</span></button>`;});
  ctrl.innerHTML=chips;
  ctrl.querySelectorAll('.chip').forEach(ch=>{
    ch.classList.toggle('active',ch.dataset.cat===currentFilter);
    ch.addEventListener('click',()=>{currentFilter=ch.dataset.cat;currentCard=null;showingAnswer=false;renderStudy();save();});});
  document.querySelectorAll('.rate-btn').forEach(b=>b.addEventListener('click',()=>rate(+b.dataset.rate)));
  renderStudyCard();
}
function renderStudyCard(){
  const area=document.getElementById('card-area'), rt=document.getElementById('ratings');
  if(!area||!rt){if(view==='study')renderStudy();return;}
  if(currentCard&&!deck.some(c=>c.id===currentCard.id)){currentCard=null;showingAnswer=false;}
  if(currentCard&&!cardState[currentCard.id])cardState[currentCard.id]=newState();
  if(!currentCard)currentCard=pickNext();
  if(!currentCard){
    rt.style.display='none';
    const nd=nextDue();
    area.innerHTML=`<div class="empty"><h2>ทำได้ดีมาก!</h2>
      <p>ยังไม่มีการ์ดต้องรีวิวในหมวดนี้</p>
      ${nd!==null?`<div class="empty-time">การ์ดถัดไป: ${fmt(nd)}</div>`:''}
      <button class="btn" id="cram">รีวิวการ์ดที่จำแล้ว</button></div>`;
    const cb=area.querySelector('#cram');
    if(cb)cb.addEventListener('click',cram);
    updateStats(); return;
  }
  rt.style.display='grid';
  previewIntervals();
  const c=currentCard, s=cardState[c.id], cat=catOf(c.cat);
  let stage='',sc='';
  if(s.phase==='new')stage='ใหม่';
  else if(s.phase==='learning'&&s.lapses>0){stage=`ลืม ×${s.lapses}`;sc='warn';}
  else if(s.phase==='learning')stage=`เรียน ${s.step+1}/${CONFIG.LEARNING_STEPS.length}`;
  else stage=`ทวน · ease ${s.ease.toFixed(1)}`;
  if(s.leech){stage+=' · leech 🩸';sc='warn';}
  const raw=String(c.front).replace(/<[^>]*>/g,'');
  let fc='prompt';
  if(raw.length>15)fc+=' small'; if(raw.length>30)fc+=' smaller';
  let ans='';
  if(showingAnswer){
    let ac='answer-main';
    if(c.mono)ac+=' mono';
    if(String(c.back).length>20)ac+=' small';
    const g=c.tag?`<span class="tag-badge">${esc(c.tag)}</span>`:'';
    ans=`<div class="answer"><div class="${ac}">${esc(c.back)}</div>${g}${c.note?`<div class="note">${c.note}</div>`:''}</div>`;
  }
  area.innerHTML=`<div class="card" id="card-el">
    <div class="card-tag" style="color:${esc(cat.color)}">${esc(cat.label)}</div>
    <div class="card-stage ${sc}">${c.warn?esc(c.warn)+' ':''}${stage}<button class="card-edit" id="edit-cur">edit</button></div>
    <div class="card-content">
      <div class="${fc}">${c.front}</div>
      ${c.hint&&!showingAnswer?`<div class="hint">${esc(c.hint)}</div>`:''}
    </div>${ans}
    <div class="tap-hint">${showingAnswer?'ให้คะแนน · 1 2 3 4':'แตะการ์ด / space · ดูเฉลย'}</div></div>`;
  document.getElementById('card-el').addEventListener('click',e=>{
    if(e.target.closest('#edit-cur'))return; flip();});
  document.getElementById('edit-cur').addEventListener('click',e=>{
    e.stopPropagation(); openCardModal(currentCard);});
  document.querySelectorAll('.rate-btn').forEach(b=>b.classList.toggle('disabled',!showingAnswer));
  updateStats();
}
function previewIntervals(){
  if(!currentCard)return;
  const s=cardState[currentCard.id];
  for(let r=1;r<=4;r++){
    const el=document.getElementById('i'+r);
    if(el)el.textContent=fmt(schedule(s,r).dueAt-Date.now());}
}
function updateStats(){
  const now=Date.now(); let d=0,n=0,l=0,rv=0;
  deck.forEach(c=>{if(!inFilter(c))return;const s=cardState[c.id];if(!s)return;
    if(s.dueAt<=now)d++;
    if(s.phase==='new')n++;
    else if(s.phase==='learning')l++;
    else rv++;});
  const set=(id,v)=>{const e=document.getElementById(id);if(e)e.textContent=v;};
  set('s-due',d);set('s-new',n);set('s-learn',l);set('s-rev',rv);
  set('s-acc',sessionReviews?Math.round(100*sessionCorrect/sessionReviews)+'%':'—');
}
function flip(){if(currentCard&&!showingAnswer){showingAnswer=true;renderStudyCard();}}
function rate(r){
  if(!currentCard||!showingAnswer)return;
  if(!deck.some(c=>c.id===currentCard.id)){currentCard=null;showingAnswer=false;renderStudyCard();return;}
  const prevLapses=(cardState[currentCard.id]||{}).lapses||0;
  const s=schedule(cardState[currentCard.id]||newState(),r);
  if(leechEnabled&&s.lapses>prevLapses&&s.lapses>=CONFIG.LEECH_THRESHOLD&&!s.leech){
    s.leech=true; s.dueAt=Date.now()+CONFIG.LEECH_COOLDOWN*1000;
    toast(`การ์ดนี้ผิดซ้ำ ${s.lapses} ครั้ง — เว้นระยะให้นานขึ้น`,true);
  }
  cardState[currentCard.id]=s;
  sessionReviews++; if(r>1)sessionCorrect++;
  showingAnswer=false; currentCard=null;
  save(); renderStudyCard(); updateTabs();
}
function cram(){
  const pool=deck.filter(inFilter); if(!pool.length)return;
  currentCard=pool[Math.floor(Math.random()*pool.length)];
  showingAnswer=false; renderStudyCard();
}

/* ═══════════ DECK ═══════════ */
function renderDeck(){
  const main=document.getElementById('main');
  main.innerHTML=`<div class="deck-tools">
      <input type="text" class="search" id="d-search" placeholder="ค้นหา front / back / note" value="${esc(deckSearch)}">
      <button class="btn sm" id="d-add">+ เพิ่ม</button>
      <button class="btn out sm" id="d-bulk">Bulk</button>
    </div>
    <div class="deck-tools" id="d-filters" style="margin-top:-3px"></div>
    <div class="bulk-bar" id="bulk-bar" style="display:none">
      <span class="bulk-info">เลือกไว้ <strong id="bulk-n">0</strong> ใบ</span>
      <div style="flex:1"></div>
      <button class="btn sub sm" id="b-clear">ยกเลิก</button>
      <button class="btn danger sm" id="b-del">ลบที่เลือก</button>
    </div>
    <div class="deck-count" id="d-count"></div>
    <div class="sel-row">
      <label class="check"><input type="checkbox" id="sel-all"> เลือกทั้งหมดที่เห็น</label>
      <div style="flex:1"></div>
      <button class="btn sub sm" id="del-shown">ลบทั้งหมดที่เห็น</button>
    </div>
    <div class="deck-list" id="d-list"></div>`;
  const f=document.getElementById('d-filters');
  let h=`<button class="chip ${deckFilter==='all'?'active':''}" data-df="all">ทั้งหมด<span class="cnt">${deck.length}</span></button>`;
  categories.forEach(cat=>{const n=deck.filter(c=>c.cat===cat.id).length;
    h+=`<button class="chip ${deckFilter===cat.id?'active':''}" data-df="${esc(cat.id)}"><span class="dot" style="background:${esc(cat.color)}"></span>${esc(cat.label)}<span class="cnt">${n}</span></button>`;});
  f.innerHTML=h;
  f.querySelectorAll('.chip').forEach(ch=>ch.addEventListener('click',()=>{deckFilter=ch.dataset.df;renderDeck();}));
  document.getElementById('d-search').addEventListener('input',e=>{deckSearch=e.target.value;renderDeckList();});
  document.getElementById('d-add').addEventListener('click',()=>openCardModal());
  document.getElementById('d-bulk').addEventListener('click',openBulkModal);
  document.getElementById('b-clear').addEventListener('click',()=>{selectedIds.clear();renderDeckList();});
  document.getElementById('b-del').addEventListener('click',()=>{
    const n=selectedIds.size; if(!n)return;
    ask({title:'ลบที่เลือก',danger:true,okText:`ลบ ${n} ใบ`,
      body:`ลบการ์ดที่เลือกไว้ <strong>${n}</strong> ใบ?<br><span class="danger-txt">ทำแล้วกู้คืนไม่ได้</span>`,
      onOk:()=>removeCards([...selectedIds])});});
  document.getElementById('sel-all').addEventListener('change',e=>{
    const fd=filtered();
    fd.forEach(c=>e.target.checked?selectedIds.add(c.id):selectedIds.delete(c.id));
    renderDeckList();});
  document.getElementById('del-shown').addEventListener('click',()=>{
    const fd=filtered(); if(!fd.length)return;
    ask({title:'ลบทั้งหมดที่เห็น',danger:true,okText:`ลบ ${fd.length} ใบ`,
      body:`ลบการ์ด <strong>${fd.length}</strong> ใบที่แสดงอยู่ทั้งหมด?<br><span class="danger-txt">ทำแล้วกู้คืนไม่ได้</span>`,
      onOk:()=>removeCards(fd.map(c=>c.id))});});
  renderDeckList();
}
function filtered(){
  const q=deckSearch.trim().toLowerCase();
  return deck.filter(c=>{
    if(deckFilter!=='all'&&c.cat!==deckFilter)return false;
    if(!q)return true;
    return (c.front+' '+c.back+' '+(c.note||'')).replace(/<[^>]*>/g,'').toLowerCase().includes(q);});
}
function renderDeckList(){
  const list=document.getElementById('d-list'), cnt=document.getElementById('d-count');
  if(!list||!cnt)return;
  const fd=filtered(), n=selectedIds.size;
  cnt.innerHTML=`${fd.length} card${fd.length!==1?'s':''}${deckSearch?` · "${esc(deckSearch)}"`:''}`
    +(n?` <span style="color:var(--again);font-weight:700">· เลือก ${n}</span>`:'');
  const bar=document.getElementById('bulk-bar'); if(bar)bar.style.display=n?'flex':'none';
  const bn=document.getElementById('bulk-n'); if(bn)bn.textContent=n;
  if(!fd.length){list.innerHTML='<div class="deck-empty">ไม่มีการ์ดตรงเงื่อนไข</div>';return;}
  list.innerHTML=fd.map(c=>{
    const cat=catOf(c.cat), sel=selectedIds.has(c.id);
    const raw=String(c.front).replace(/<[^>]*>/g,'');
    return `<div class="deck-row ${sel?'sel':''}" data-id="${esc(c.id)}">
      <input type="checkbox" class="row-check" data-id="${esc(c.id)}" ${sel?'checked':''}>
      <div class="cat-tag" style="background:${esc(cat.color)}">${esc(cat.label)}</div>
      <div class="d-mid" style="min-width:0">
        <div class="d-front">${c.warn?esc(c.warn)+' ':''}${esc(raw)}</div>
        <div class="d-back">→ ${esc(c.back)}</div></div>
      <div class="d-acts">
        <button data-a="edit" data-id="${esc(c.id)}">แก้</button>
        <button class="del" data-a="del" data-id="${esc(c.id)}">ลบ</button></div></div>`;}).join('');
  list.querySelectorAll('.row-check').forEach(ck=>ck.addEventListener('change',e=>{
    const id=e.target.dataset.id;
    if(e.target.checked)selectedIds.add(id); else selectedIds.delete(id);
    renderDeckList();}));
  list.querySelectorAll('.d-acts button').forEach(b=>b.addEventListener('click',e=>{
    e.stopPropagation();
    const id=b.dataset.id;
    if(b.dataset.a==='edit')openCardModal(deck.find(c=>c.id===id));
    else deleteCard(id);}));
  list.querySelectorAll('.d-mid').forEach(m=>m.addEventListener('click',()=>{
    const id=m.closest('.deck-row').dataset.id;
    openCardModal(deck.find(c=>c.id===id));}));
}

/* ═══════════ CARD MODAL ═══════════ */
function openCardModal(card){
  if(!categories.length)categories.push({id:'default',label:'ทั่วไป',color:'#5C7F8A'});
  const isEdit=!!card;
  const c=card||{cat:categories[0].id,front:'',back:'',note:'',warn:null,tag:'',mono:false};
  const opts=categories.map(k=>`<option value="${esc(k.id)}" ${k.id===c.cat?'selected':''}>${esc(k.label)}</option>`).join('');
  openModal(`<div class="modal">
    <div class="m-head"><div class="m-title">${isEdit?'แก้การ์ด':'เพิ่มการ์ดใหม่'}</div><button class="m-close">×</button></div>
    <div class="frow"><div class="flabel">หมวดหมู่</div><select class="fselect" id="f-cat">${opts}</select></div>
    <div class="frow"><div class="flabel">Front (คำถาม)</div><input type="text" class="finput" id="f-front" value="${esc(c.front)}"></div>
    <div class="frow"><div class="flabel">Back (คำตอบ)</div><input type="text" class="finput" id="f-back" value="${esc(c.back)}"></div>
    <div class="fgrid">
      <div class="frow"><div class="flabel">Tag / badge (ไม่บังคับ)</div><input type="text" class="finput" id="f-tag" value="${esc(c.tag||'')}" placeholder="เช่น chapter 3, hard, formula"></div>
      <div class="frow inline"><label class="check"><input type="checkbox" id="f-mono" ${c.mono?'checked':''}> แสดงคำตอบแบบ monospace</label></div>
    </div>
    <div class="frow"><div class="flabel">Note (ใส่ &lt;strong&gt; &lt;em&gt; ได้)</div>
      <textarea class="ftext" id="f-note" style="min-height:80px">${esc(c.note||'')}</textarea></div>
    <div class="frow inline"><label class="check"><input type="checkbox" id="f-warn" ${c.warn?'checked':''}> ตัวหลอก / tricky ⚠</label></div>
    <div class="m-acts">
      ${isEdit?'<button class="btn danger sm" id="m-del">ลบการ์ดนี้</button>':''}
      <div style="flex:1"></div>
      <button class="btn sub sm" id="m-cancel">ยกเลิก</button>
      <button class="btn sm" id="m-save">${isEdit?'บันทึก':'เพิ่ม'}</button>
    </div></div>`,{after:(r,close)=>{
      r.querySelector('#m-cancel').addEventListener('click',close);
      const del=r.querySelector('#m-del');
      if(del)del.addEventListener('click',()=>{close();deleteCard(card.id);});
      const doSave=()=>{
        const front=r.querySelector('#f-front').value.trim();
        const back=r.querySelector('#f-back').value.trim();
        if(!front||!back){toast('ต้องใส่ทั้ง front และ back',true);return;}
        const data={cat:r.querySelector('#f-cat').value,front,back,
          note:r.querySelector('#f-note').value.trim()||null,
          tag:r.querySelector('#f-tag').value.trim()||null,
          mono:r.querySelector('#f-mono').checked,
          warn:r.querySelector('#f-warn').checked?'⚠':null};
        if(isEdit)Object.assign(card,data);
        else{const nc=Object.assign({id:uid('u')},data);deck.push(nc);cardState[nc.id]=newState();}
        save();close();toast(isEdit?'บันทึกแล้ว':'เพิ่มการ์ดแล้ว');
        if(view==='deck')renderDeckList(); else if(view==='study')renderStudy();
        updateTabs();};
      r.querySelector('#m-save').addEventListener('click',doSave);
      r.addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&e.key==='Enter'){e.preventDefault();doSave();}});
      setTimeout(()=>r.querySelector('#f-front').focus(),40);
    }});
}

/* ═══════════ BULK TEXT IMPORT ═══════════ */
function openBulkModal(){
  if(!categories.length)categories.push({id:'default',label:'ทั่วไป',color:'#5C7F8A'});
  const opts=categories.map(k=>`<option value="${esc(k.id)}">${esc(k.label)}</option>`).join('');
  openModal(`<div class="modal">
    <div class="m-head"><div class="m-title">Bulk import (TSV / CSV)</div><button class="m-close">×</button></div>
    <div class="fhint" style="margin-bottom:10px">แต่ละบรรทัด: <code>front → back → [หมวด] → [note]</code> คั่นด้วย Tab, | , ; หรือ ,</div>
    <div class="frow"><div class="flabel">หมวดหมู่ default</div><select class="fselect" id="b-cat">${opts}</select></div>
    <div class="frow"><div class="flabel">วางข้อมูล</div><textarea class="ftext" id="b-text" placeholder="word&#9;meaning&#10;term&#9;definition"></textarea></div>
    <div id="b-prev" style="display:none"><div class="flabel" style="margin-bottom:5px">Preview</div><div class="preview" id="b-list"></div></div>
    <div class="m-acts">
      <button class="btn out sm" id="b-pv">Preview</button><div style="flex:1"></div>
      <button class="btn sub sm" id="m-cancel">ยกเลิก</button>
      <button class="btn sm" id="b-go" disabled>Import</button>
    </div></div>`,{after:(r,close)=>{
      r.querySelector('#m-cancel').addEventListener('click',close);
      const parse=()=>{
        const txt=r.querySelector('#b-text').value;
        const def=r.querySelector('#b-cat').value;
        return txt.split('\n').filter(l=>l.trim()).map(line=>{
          let p;
          if(line.includes('\t'))p=line.split('\t');
          else if(line.includes('|'))p=line.split('|');
          else if(line.includes(';'))p=line.split(';');
          else if(line.split(',').length>=2)p=line.split(',');
          else return{err:'ไม่มีตัวคั่น',raw:line};
          p=p.map(x=>x.trim());
          if(p.length<2||!p[0]||!p[1])return{err:'ข้อมูลไม่ครบ',raw:line};
          return{front:p[0],back:p[1],cat:p[2]||def,note:p[3]||null,
            dup:deck.some(c=>c.front===p[0]&&c.back===p[1])};});};
      r.querySelector('#b-pv').addEventListener('click',()=>{
        const rows=parse();
        const box=r.querySelector('#b-prev'), list=r.querySelector('#b-list');
        if(!rows.length){box.style.display='none';return;}
        list.innerHTML=rows.map(x=>x.err
          ?`<div class="prow err">✗ ${esc(x.err)} · ${esc(x.raw)}</div>`
          :`<div class="prow ${x.dup?'dup':''}">${x.dup?'⚠ ':'✓ '}<span>${esc(x.front)}</span><span>${esc(x.back)}</span><span>${esc(x.cat)}</span></div>`).join('');
        box.style.display='block';
        const ok=rows.filter(x=>!x.err).length;
        const go=r.querySelector('#b-go');
        go.disabled=!ok; go.textContent=`Import ${ok} ใบ`;});
      r.querySelector('#b-go').addEventListener('click',()=>{
        const rows=parse().filter(x=>!x.err);
        let added=0,skipped=0;
        rows.forEach(x=>{
          if(x.dup){skipped++;return;}
          let cid=x.cat;
          let found=categories.find(k=>k.id===cid||k.label===cid);
          if(!found){found={id:uid('cat'),label:cid,color:'#5C7F8A'};categories.push(found);}
          const nc={id:uid('u'),cat:found.id,front:x.front,back:x.back,note:x.note};
          deck.push(nc);cardState[nc.id]=newState();added++;});
        save();close();
        toast(`เพิ่ม ${added} ใบ${skipped?` · ข้ามซ้ำ ${skipped}`:''}`);
        render();});
    }});
}

/* ═══════════ SETTINGS ═══════════ */
function renderSettings(){
  const main=document.getElementById('main');
  const learned=Object.values(cardState).filter(s=>s.phase==='review').length;
  let size='—';
  try{const b=JSON.stringify(snapshot()).length;size=b<1024?b+' B':(b/1024).toFixed(1)+' KB';}catch(e){}
  main.innerHTML=`
    <div class="sect">
      <div class="sect-title">นำเข้า / ส่งออก</div>
      <div class="sect-desc">นำเข้าไฟล์ deck (.json) เพื่อเพิ่มการ์ด · ส่งออกเพื่อสำรองข้อมูลหรือแชร์ให้เพื่อน</div>
      <div class="sect-acts">
        <button class="btn" id="s-import">นำเข้าไฟล์</button>
        <button class="btn out" id="s-paste">วาง JSON</button>
        <button class="btn out" id="s-exp-deck">ส่งออก deck</button>
        <button class="btn out" id="s-exp-full">ส่งออก + progress</button>
        <button class="btn sub sm" id="s-bulk">Bulk paste (TSV)</button>
      </div>
    </div>
    <div class="sect">
      <div class="sect-title">หมวดหมู่</div>
      <div class="sect-desc">แก้ชื่อ/สี หรือลบหมวด · ลบหมวดที่มีการ์ดจะย้ายการ์ดไป "อื่นๆ"</div>
      <div class="cat-list" id="cat-list"></div>
      <button class="btn out sm" id="s-addcat">+ หมวดใหม่</button>
    </div>
    <div class="sect">
      <div class="sect-title">การเรียน</div>
      <div class="sect-desc">Leech = การ์ดที่ตอบผิดซ้ำ ${CONFIG.LEECH_THRESHOLD}+ ครั้ง จะถูกเว้นระยะไม่ให้วนถี่เกินไป</div>
      <div class="frow inline"><label class="check"><input type="checkbox" id="s-leech" ${leechEnabled?'checked':''}> เปิดใช้งาน leech detection</label></div>
    </div>
    <div class="sect">
      <div class="sect-title">ล้างข้อมูล</div>
      <div class="sect-desc">รีเซ็ตความคืบหน้าจะเก็บการ์ดไว้ · ลบการ์ดทั้งหมดจะเหลือระบบเปล่า</div>
      <div class="sect-acts">
        <button class="btn sub" id="s-reset-prog">รีเซ็ตความคืบหน้า</button>
        <button class="btn danger" id="s-wipe">ล้างทุกอย่าง</button>
      </div>
    </div>
    <div class="sect">
      <div class="sect-title">ข้อมูลระบบ</div>
      <div class="sect-desc">การ์ด <strong>${deck.length}</strong> · จำแล้ว <strong>${learned}</strong> · หมวด <strong>${categories.length}</strong> · storage <strong>${size}</strong>
      ${storageOK?'':'<br><span style="color:var(--again)">⚠ บันทึกข้อมูลไม่ได้ — ควรส่งออกไฟล์เก็บไว้</span>'}</div>
    </div>`;
  renderCats();
  const on=(id,fn)=>{const e=document.getElementById(id);if(e)e.addEventListener('click',fn);};
  on('s-import',()=>document.getElementById('file-in').click());
  on('s-paste',openPasteJSON);
  on('s-exp-deck',()=>exportJSON(false));
  on('s-exp-full',()=>exportJSON(true));
  on('s-bulk',openBulkModal);
  const leechCk=document.getElementById('s-leech');
  if(leechCk)leechCk.addEventListener('change',e=>{leechEnabled=e.target.checked;save();
    toast(leechEnabled?'เปิดใช้งาน leech detection':'ปิด leech detection แล้ว');});
  on('s-addcat',()=>askText({title:'หมวดใหม่',label:'ชื่อหมวด',okText:'เพิ่ม',onOk:v=>{
    const colors=['#5C8A3E','#8A5E2E','#2E5C8A','#8A2E5C','#5C2E8A','#2E8A8A','#8A8A2E','#3A7F7A'];
    categories.push({id:uid('cat'),label:v,color:colors[categories.length%colors.length]});
    save();renderSettings();toast('เพิ่มหมวดแล้ว');}}));
  on('s-reset-prog',()=>ask({title:'รีเซ็ตความคืบหน้า',okText:'รีเซ็ต',danger:true,
    body:'รีเซ็ตความคืบหน้าทั้งหมด (การ์ดยังอยู่ครบ)?',
    onOk:()=>{deck.forEach(c=>cardState[c.id]=newState());
      sessionStart=Date.now();sessionReviews=0;sessionCorrect=0;currentCard=null;
      save();renderSettings();updateTabs();toast('รีเซ็ตแล้ว');}}));
  on('s-wipe',()=>ask({title:'ล้างทุกอย่าง',okText:'ล้างทั้งหมด',danger:true,
    body:`ลบการ์ดทั้งหมด <strong>${deck.length}</strong> ใบ, หมวดหมู่ <strong>${categories.length}</strong> หมวด และความคืบหน้า?<br><span class="danger-txt">ทำแล้วกู้คืนไม่ได้ — ควรส่งออกไฟล์ก่อน</span>`,
    onOk:()=>{deck=[];categories=[];cardState={};selectedIds.clear();currentCard=null;showingAnswer=false;
      currentFilter='all';deckFilter='all';
      sessionReviews=0;sessionCorrect=0;save();render();toast('ล้างทั้งหมดแล้ว');}}));
}
function renderCats(){
  const list=document.getElementById('cat-list'); if(!list)return;
  if(!categories.length){list.innerHTML='<div class="fhint">ยังไม่มีหมวดหมู่</div>';return;}
  list.innerHTML=categories.map((c,i)=>{
    const n=deck.filter(x=>x.cat===c.id).length;
    return `<div class="cat-row">
      <input type="color" class="cat-color" value="${esc(c.color)}" data-i="${i}" data-f="color">
      <input type="text" class="cat-name" value="${esc(c.label)}" data-i="${i}" data-f="label">
      <span class="cat-cnt">${n}</span>
      <button class="cat-del" data-i="${i}">ลบ</button></div>`;}).join('');
  list.querySelectorAll('.cat-color,.cat-name').forEach(inp=>inp.addEventListener('change',e=>{
    categories[+e.target.dataset.i][e.target.dataset.f]=e.target.value;save();renderCats();}));
  list.querySelectorAll('.cat-del').forEach(b=>b.addEventListener('click',e=>{
    const i=+e.target.dataset.i, cat=categories[i];
    const n=deck.filter(c=>c.cat===cat.id).length;
    ask({title:'ลบหมวด',okText:'ลบ',danger:true,
      body:`ลบหมวด <strong>${esc(cat.label)}</strong>?${n?`<br>การ์ด ${n} ใบจะย้ายไป "อื่นๆ"`:''}`,
      onOk:()=>{
        if(n){let o=categories.find(c=>c.id==='other');
          if(!o){o={id:'other',label:'อื่นๆ',color:'#8A8E96'};categories.push(o);}
          deck.forEach(c=>{if(c.cat===cat.id)c.cat=o.id;});}
        categories=categories.filter(c=>c.id!==cat.id);
        save();renderSettings();updateTabs();toast('ลบหมวดแล้ว');}});}));
}

/* ═══════════ IMPORT / EXPORT ═══════════ */
function applyImport(data){
  if(!data||!Array.isArray(data.deck)){toast('รูปแบบไฟล์ไม่ถูกต้อง',true);return;}
  if(Array.isArray(data.categories))
    data.categories.forEach(nc=>{if(nc&&nc.id&&!categories.find(c=>c.id===nc.id))categories.push(nc);});
  let added=0,skipped=0;
  data.deck.forEach(nc=>{
    if(!nc||!nc.front||!nc.back){skipped++;return;}
    if(deck.some(c=>c.front===nc.front&&c.back===nc.back)){skipped++;return;}
    const id=(nc.id&&!deck.some(c=>c.id===nc.id))?nc.id:uid('imp');
    const card=Object.assign({},nc,{id});
    if(!categories.find(c=>c.id===card.cat)){
      let o=categories.find(c=>c.id==='other');
      if(!o){o={id:'other',label:'อื่นๆ',color:'#8A8E96'};categories.push(o);}
      card.cat=o.id;}
    deck.push(card);
    cardState[id]=(data.cardState&&data.cardState[nc.id])||newState();
    added++;});
  save();render();
  toast(`นำเข้า ${added} ใบ${skipped?` · ข้าม ${skipped}`:''}`);
}
document.getElementById('file-in').addEventListener('change',e=>{
  const f=e.target.files&&e.target.files[0]; if(!f)return;
  const rd=new FileReader();
  rd.onload=ev=>{try{applyImport(JSON.parse(ev.target.result));}
    catch(err){toast('อ่านไฟล์ไม่ได้ — ลองใช้ "วาง JSON"',true);}
    e.target.value='';};
  rd.onerror=()=>{toast('อ่านไฟล์ไม่ได้',true);e.target.value='';};
  rd.readAsText(f);});

function openPasteJSON(){
  openModal(`<div class="modal">
    <div class="m-head"><div class="m-title">วาง JSON</div><button class="m-close">×</button></div>
    <div class="fhint" style="margin-bottom:9px">ถ้าเลือกไฟล์ไม่ได้ ให้เปิดไฟล์ .json แล้วคัดลอกเนื้อหามาวางที่นี่</div>
    <div class="frow"><textarea class="ftext" id="pj" placeholder='{"deck":[...],"categories":[...]}' style="min-height:190px"></textarea></div>
    <div class="m-acts"><button class="btn sub sm" id="m-cancel">ยกเลิก</button>
      <button class="btn sm" id="pj-go">นำเข้า</button></div></div>`,{after:(r,close)=>{
    r.querySelector('#m-cancel').addEventListener('click',close);
    r.querySelector('#pj-go').addEventListener('click',()=>{
      const v=r.querySelector('#pj').value.trim();
      if(!v){toast('ยังไม่ได้วางข้อมูล',true);return;}
      try{const d=JSON.parse(v);close();applyImport(d);}
      catch(err){toast('JSON ไม่ถูกต้อง',true);}});
    setTimeout(()=>r.querySelector('#pj').focus(),40);}});
}

function exportJSON(full){
  const data=full
    ?{v:3,type:'full',exportedAt:Date.now(),categories,deck,cardState}
    :{v:3,type:'deck',exportedAt:Date.now(),categories,deck};
  const json=JSON.stringify(data,null,2);
  const name=`srs_${full?'backup':'deck'}_${new Date().toISOString().slice(0,10)}.json`;
  let downloaded=false;
  try{
    const blob=new Blob([json],{type:'application/json'});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');
    a.href=url;a.download=name;
    document.body.appendChild(a);a.click();document.body.removeChild(a);
    setTimeout(()=>URL.revokeObjectURL(url),1500);
    downloaded=true;
  }catch(e){}
  openModal(`<div class="modal">
    <div class="m-head"><div class="m-title">ส่งออก deck</div><button class="m-close">×</button></div>
    <div class="m-body" style="margin-bottom:10px">${downloaded
      ?'เริ่มดาวน์โหลดแล้ว — ถ้าไฟล์ไม่ขึ้น ให้คัดลอกข้อความด้านล่างไปเก็บเองได้'
      :'ดาวน์โหลดอัตโนมัติไม่ได้ในหน้านี้ — คัดลอกข้อความด้านล่างไปวางในไฟล์ .json'}
      <br><strong>${deck.length}</strong> การ์ด · <strong>${categories.length}</strong> หมวด</div>
    <div class="frow"><textarea class="ftext" id="ex-txt" readonly style="min-height:170px">${esc(json)}</textarea></div>
    <div class="m-acts"><button class="btn out sm" id="ex-copy">คัดลอกทั้งหมด</button>
      <div style="flex:1"></div><button class="btn sm" id="m-cancel">ปิด</button></div></div>`,{after:(r,close)=>{
    r.querySelector('#m-cancel').addEventListener('click',close);
    r.querySelector('#ex-copy').addEventListener('click',()=>{
      const ta=r.querySelector('#ex-txt');
      ta.select();ta.setSelectionRange(0,json.length);
      let ok=false;
      try{ok=document.execCommand('copy');}catch(e){}
      if(!ok&&navigator.clipboard){navigator.clipboard.writeText(json).then(()=>toast('คัดลอกแล้ว')).catch(()=>toast('คัดลอกไม่ได้ — เลือกเองแล้วกดคัดลอก',true));return;}
      toast(ok?'คัดลอกแล้ว':'คัดลอกไม่ได้ — เลือกเองแล้วกดคัดลอก',!ok);});}});
}

/* ═══════════ EVENTS ═══════════ */
document.querySelectorAll('.tab').forEach(t=>t.addEventListener('click',()=>setView(t.dataset.view)));
document.getElementById('fab').addEventListener('click',()=>openCardModal());
document.addEventListener('keydown',e=>{
  const tag=e.target.tagName;
  if(tag==='INPUT'||tag==='TEXTAREA'||tag==='SELECT')return;
  if(document.getElementById('modal-root').classList.contains('show')){
    if(e.key==='Escape')closeModal(); return;}
  if(view!=='study')return;
  if(e.key===' '||e.key==='Enter'){e.preventDefault();if(!showingAnswer&&currentCard)flip();return;}
  if(showingAnswer&&['1','2','3','4'].includes(e.key)){e.preventDefault();rate(+e.key);}});

function tickClock(){
  const el=document.getElementById('clock'); if(!el)return;
  const d=Date.now()-sessionStart;
  el.textContent=`${Math.floor(d/60000)}:${String(Math.floor(d%60000/1000)).padStart(2,'0')} · ${sessionReviews} rev`;}

/* ═══════════ INIT ═══════════ */
(async()=>{
  await load();
  document.querySelectorAll('.tab').forEach(t=>t.classList.toggle('active',t.dataset.view===view));
  render();
  setInterval(()=>{
    tickClock();
    if(view==='study'&&deck.length){updateStats();updateTabs();
      if(!currentCard){const n=pickNext();if(n)renderStudyCard();}}},1000);
  tickClock();
})();
