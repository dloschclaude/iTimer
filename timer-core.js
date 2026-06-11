"use strict";
/* ============================================================
   Debattentimer — Core
   State · Formate · Signal-Engine · Persistenz · Gesten · Settings
   Vanilla, keine Abhängigkeiten. Views registrieren sich in window.VIEWS.
============================================================ */

window.$ = s => document.querySelector(s);
window.VIEWS = window.VIEWS || {};   // {analog:{build,render}, digital:{build,render}}

/* -------- Formate -------------------------------------------------
   protStart / protEnd : Schutzzeit-Intervalle [a,b] in Sekunden
   bells: Glocken {t, double, name}
------------------------------------------------------------------- */
function buildFormats(mode){
  const opd = mode === 'opd';
  return {
    prep:  { key:'prep', name:'Vorbereitung', dur:900, sub:'Vorbereitungszeit',
             protStart:null, protEnd:[840,900],
             bells:[{t:840,double:false,name:'Noch 1 Minute'},{t:900,double:true,name:'Zeit abgelaufen'}] },
    main:  opd
      ? { key:'main', name:'OPD-Rede', dur:420, sub:'Schutzzeit erste & letzte 30 s',
          protStart:[0,30], protEnd:[390,420],
          bells:[{t:30,double:false,name:'Schutzzeit endet · Fragen frei'},
                 {t:390,double:false,name:'Schutzzeit · letzte 30 s'},
                 {t:420,double:true,name:'Redezeit vorbei'}] }
      : { key:'main', name:'BP Speech', dur:420, sub:'Protected first & last minute',
          protStart:[0,60], protEnd:[360,420],
          bells:[{t:60,double:false,name:'POIs offen'},
                 {t:360,double:false,name:'POIs zu · letzte Minute'},
                 {t:420,double:true,name:'Redezeit vorbei'}] },
    reply: { key:'reply', name:'Schlussrede', dur:210, sub:'Reply · 3:30',
             protStart:null, protEnd:[195,210],
             bells:[{t:195,double:false,name:'Letzte 15 Sekunden'},{t:210,double:true,name:'Vorbei'}] },
    short: { key:'short', name:'Eine Minute', dur:60, sub:'Kurzbeitrag · Stegreif',
             protStart:null, protEnd:[50,60],
             bells:[{t:50,double:false,name:'Letzte 10 Sekunden'},{t:60,double:true,name:'Vorbei'}] },
  };
}

const ACCENTS = [
  {key:'amber', val:'oklch(0.80 0.135 72)'},
  {key:'red',   val:'oklch(0.645 0.19 26)'},
  {key:'blue',  val:'oklch(0.70 0.14 245)'},
  {key:'green', val:'oklch(0.74 0.14 158)'},
  {key:'white', val:'oklch(0.93 0.012 95)'},
];
const THEMES = {
  black:  {bg:'#000000', ink:'#f3f2ed'},
  anthra: {bg:'#17181a', ink:'#edeae4'},
  light:  {bg:'#e9e6df', ink:'#1a1a19'},
};

/* -------- State --------------------------------------------------- */
const LS = 'debattentimer.v3';
window.S = {
  screen:'setup', mode:'opd', formatKey:'main',
  baseElapsed:0, running:false, runStart:0,
  settings:{
    tilt:-15, axis:'x', flip:false,
    display:'analog', dir:'remaining',
    sound:true, vib:true, flash:true,
    theme:'black', accent:'amber',
  },
};
function load(){
  try{ const raw=JSON.parse(localStorage.getItem(LS));
    if(raw) S={...S,...raw,settings:{...S.settings,...(raw.settings||{})}}; }catch(e){}
  // one-time migration: alte, zu steile Neigung auf neuen Standard zurücksetzen
  if(!S.settings.tiltV2){ S.settings.tilt=-15; S.settings.tiltV2=true; }
}
function save(){ try{ localStorage.setItem(LS,JSON.stringify(S)); }catch(e){} }
let lastSave=0;
function saveThrottled(){ const n=Date.now(); if(n-lastSave>900){ lastSave=n; save(); } }

/* -------- Zeit & Phase -------------------------------------------- */
window.elapsed = () => S.baseElapsed + (S.running ? (Date.now()-S.runStart)/1000 : 0);
window.fmt = (t)=>{ t=Math.max(0,Math.floor(t)); const m=Math.floor(t/60),s=t%60; return m+':'+String(s).padStart(2,'0'); };
function inZone(z,e){ return z && e>=z[0] && e<z[1]; }
window.phaseOf = (F,e)=>{
  if(e>=F.dur) return 'over';
  if(inZone(F.protEnd,e)) return 'warn';
  if(inZone(F.protStart,e)) return 'prot';
  return 'open';
};
window.PHASE_VAR = {open:'--c-open',prot:'--c-prot',warn:'--c-warn',over:'--c-over'};
window.phaseColor = (ph)=>getComputedStyle(document.documentElement).getPropertyValue(PHASE_VAR[ph]).trim();

let curFormats = buildFormats(S.mode);
window.F = ()=>curFormats[S.formatKey];

/* -------- Audio (synth bell) -------------------------------------- */
let actx=null;
function ensureAudio(){ if(!actx){ try{ actx=new (window.AudioContext||window.webkitAudioContext)(); }catch(e){} }
  if(actx&&actx.state==='suspended') actx.resume(); }
function strike(when,freq){
  if(!actx) return;
  const o=actx.createOscillator(),o2=actx.createOscillator(),g=actx.createGain(),g2=actx.createGain();
  o.type='triangle'; o.frequency.value=freq; o2.type='sine'; o2.frequency.value=freq*2.01; g2.gain.value=.32;
  o.connect(g); o2.connect(g2); g2.connect(g); g.connect(actx.destination);
  g.gain.setValueAtTime(0,when); g.gain.linearRampToValueAtTime(.5,when+0.006);
  g.gain.exponentialRampToValueAtTime(.0008,when+1.15);
  o.start(when); o2.start(when); o.stop(when+1.25); o2.stop(when+1.25);
}
function bell(double){ if(!S.settings.sound) return; ensureAudio(); if(!actx) return;
  const t=actx.currentTime; strike(t,784); if(double) strike(t+0.27,784); }

/* -------- Signale ------------------------------------------------- */
let firedTimes=new Set();
function syncFired(F,e){ firedTimes=new Set(); F.bells.forEach(b=>{ if(e>=b.t) firedTimes.add(b.t); }); }
function doFlash(){ if(!S.settings.flash) return; const f=$('#flash'); f.classList.remove('go'); void f.offsetWidth; f.classList.add('go'); }
function vibrate(double){ if(S.settings.vib && navigator.vibrate) navigator.vibrate(double?[70,90,70]:[70]); }
let stateTimer=null;
function flashState(msg){ const el=$('#rState'); if(!el) return; el.textContent=msg; el.dataset.sticky='1';
  clearTimeout(stateTimer); stateTimer=setTimeout(()=>{ el.dataset.sticky=''; },2800); }
function signal(b){ bell(b.double); vibrate(b.double); doFlash(); flashState(b.name); }

/* -------- Wake Lock ----------------------------------------------- */
let wake=null;
async function reqWake(){ try{ if('wakeLock' in navigator) wake=await navigator.wakeLock.request('screen'); }catch(e){} }
function relWake(){ try{ wake&&wake.release(); }catch(e){} wake=null; }
document.addEventListener('visibilitychange',()=>{ if(document.visibilityState==='visible'&&S.running) reqWake(); });

/* -------- Settings anwenden --------------------------------------- */
function applyTheme(){
  const t=THEMES[S.settings.theme]||THEMES.black, r=document.documentElement.style;
  r.setProperty('--bg',t.bg); r.setProperty('--ink',t.ink);
  const light=S.settings.theme==='light', base=light?'26,26,25':'243,242,237';
  r.setProperty('--ink-dim',`rgba(${base},.46)`);
  r.setProperty('--ink-faint',`rgba(${base},${light?'.14':'.12'})`);
  r.setProperty('--hair',`rgba(${base},.13)`);
  r.setProperty('--surface',light?'rgba(238,235,228,.82)':'rgba(26,27,30,.74)');
  document.documentElement.dataset.theme=S.settings.theme;
  const m=document.querySelector('meta[name=theme-color]'); if(m) m.setAttribute('content',t.bg);
}
function applyAccent(){
  const a=ACCENTS.find(x=>x.key===S.settings.accent)||ACCENTS[0];
  document.documentElement.style.setProperty('--accent',a.val);
  document.documentElement.style.setProperty('--c-warn',a.val);
}
function applyTilt(){
  const s=S.settings, ax=s.axis==='y'?'rotateY':'rotateX';
  const t = `${ax}(${s.tilt}deg)` + (s.flip?' rotateZ(180deg)':'');
  document.documentElement.style.setProperty('--tilt-tf', t);
}
function applyDisplay(){
  const d=S.settings.display;
  $('#viewAnalog').classList.toggle('on', d==='analog');
  $('#viewDigital').classList.toggle('on', d==='digital');
}
function applySound(){ const b=$('#soundBtn'); if(b) b.classList.toggle('muted', !S.settings.sound); }
function applyAll(){ applyTheme(); applyAccent(); applyTilt(); applyDisplay(); applySound(); refreshViews(); }

/* -------- Views --------------------------------------------------- */
let built={analog:false,digital:false};
function ensureBuilt(){
  if(VIEWS.analog && !built.analog){ VIEWS.analog.build($('#viewAnalog')); built.analog=true; }
  if(VIEWS.digital && !built.digital){ VIEWS.digital.build($('#viewDigital')); built.digital=true; }
}
function refreshViews(){
  ensureBuilt();
  const f=F();
  if(VIEWS.analog && VIEWS.analog.format) VIEWS.analog.format(f);
  if(VIEWS.digital && VIEWS.digital.format) VIEWS.digital.format(f);
}

/* -------- Render-Loop --------------------------------------------- */
let raf=0;
function tick(){
  const f=F(), e=elapsed(), ph=phaseOf(f,e), col=phaseColor(ph);
  document.documentElement.style.setProperty('--phase',col);

  const view = VIEWS[S.settings.display];
  if(view && view.render) view.render(e,f,ph,col);

  // Statuszeile
  const st=$('#rState');
  if(st && st.dataset.sticky!=='1'){
    st.textContent = (!S.running && e===0) ? '' :
      ph==='over' ? 'Überzeit' :
      ph==='prot' ? 'Schutzzeit' :
      ph==='warn' ? (f.protEnd?'Schutzzeit · Ende naht':'Ende naht') :
      S.running ? '' : 'pausiert';
  }
  // Glocken
  if(S.running) f.bells.forEach(b=>{ if(e>=b.t && !firedTimes.has(b.t)){ firedTimes.add(b.t); signal(b); } });

  if(S.running) saveThrottled();
  raf=requestAnimationFrame(tick);
}

/* -------- Steuerung ----------------------------------------------- */
function startPause(){
  ensureAudio();
  if(S.running){ S.baseElapsed=elapsed(); S.running=false; relWake(); }
  else{ S.runStart=Date.now(); S.running=true; reqWake(); hideHint(); }
  updateHint(); save();
}
function reset(){
  S.running=false; S.baseElapsed=0; relWake(); syncFired(F(),0);
  const st=$('#rState'); if(st){ st.dataset.sticky=''; st.textContent=''; }
  showHint(); vibrate(false); save();
}
function hideHint(){ const h=$('#runhint'); if(h) h.style.opacity='0'; }
function showHint(){ const h=$('#runhint'); if(h){ h.style.opacity=''; h.innerHTML='<b>Tippen</b> · Start'; } }
function updateHint(){ const h=$('#runhint'); if(!h) return; if(S.running) h.style.opacity='0'; else { h.style.opacity=''; h.innerHTML='<b>Tippen</b> · Fortsetzen'; } }

/* -------- Navigation ---------------------------------------------- */
function go(screen){
  S.screen=screen;
  $('#setup').classList.toggle('active',screen==='setup');
  $('#timer').classList.toggle('active',screen==='timer');
  if(screen==='timer'){ refreshViews(); if(S.running) reqWake(); }
  save();
}
function openTimer(key){
  S.formatKey=key; S.running=false; S.baseElapsed=0; syncFired(F(),0);
  showHint(); const st=$('#rState'); if(st){ st.dataset.sticky=''; st.textContent=''; }
  go('timer');
}

/* -------- Setup-Liste --------------------------------------------- */
function renderFormats(){
  curFormats=buildFormats(S.mode);
  const order=['prep','main','reply','short'], box=$('#formats'); box.innerHTML='';
  order.forEach(k=>{ const f=curFormats[k];
    const el=document.createElement('div'); el.className='fmt'; el.dataset.key=k;
    el.innerHTML=`<div class="fmt-l"><div class="name">${f.name}</div><div class="sub">${f.sub}</div></div>
      <div class="time">${fmt(f.dur).replace(':','<small>:</small>')}</div>`;
    el.addEventListener('click',()=>openTimer(k)); box.appendChild(el);
  });
  $('#segNote').textContent = S.mode==='opd'
    ? 'OPD · Glocke nach 30 s (Schutzzeit endet), erneut 30 s vor Schluss, Doppelglocke bei 7:00.'
    : 'BP · Knock nach 1:00 (POIs offen), nach 6:00 (POIs zu), Doppelglocke bei 7:00.';
  $('#seg').querySelectorAll('button').forEach(b=>b.classList.toggle('on',b.dataset.mode===S.mode));
  refreshViews();
}

/* -------- Settings-UI --------------------------------------------- */
function setSeg(sel,val,fn){ $(sel).querySelectorAll('button').forEach(b=>{
  b.classList.toggle('on',b.dataset.v===val); }); }
function setTiltVal(){ const v=$('#tiltVal'); if(v) v.textContent=Math.abs(S.settings.tilt)+'°'; }
function syncSettingsUI(){
  $('#tiltRange').value=S.settings.tilt; setTiltVal();
  setSeg('#axisSeg',S.settings.axis); setSeg('#dispSeg',S.settings.display);
  setSeg('#dirSeg',S.settings.dir); setSeg('#themeSeg',S.settings.theme);
  $('#togFlip').classList.toggle('on',S.settings.flip);
  $('#togSound').classList.toggle('on',S.settings.sound);
  $('#togVib').classList.toggle('on',S.settings.vib);
  $('#togFlash').classList.toggle('on',S.settings.flash);
  const sw=$('#swatches'); sw.innerHTML='';
  ACCENTS.forEach(a=>{ const d=document.createElement('div');
    d.className='sw'+(a.key===S.settings.accent?' on':''); d.style.background=a.val; d.dataset.k=a.key;
    d.addEventListener('click',()=>{ S.settings.accent=a.key; applyAccent(); refreshViews(); syncSettingsUI(); save(); });
    sw.appendChild(d); });
}
function openSheet(){ $('#scrim').classList.add('on'); $('#sheet').classList.add('on'); syncSettingsUI(); }
function closeSheet(){ $('#scrim').classList.remove('on'); $('#sheet').classList.remove('on'); }

/* -------- Zwei-Finger-Neigung (HUD) ------------------------------- */
let tiltHud=null, hudTimer=null;
function tiltHUD(show,val){
  if(!tiltHud){ tiltHud=document.createElement('div'); tiltHud.id='tiltHud'; $('#stage').appendChild(tiltHud); }
  if(val!=null) tiltHud.textContent='Neigung  '+Math.abs(val)+'°';
  clearTimeout(hudTimer);
  if(show){ tiltHud.classList.add('on'); }
  else { hudTimer=setTimeout(()=>tiltHud.classList.remove('on'),650); }
}

/* -------- Gesten -------------------------------------------------- */
function bindGestures(){
  const stage=$('#stage'); let lp=null,longFired=false,downAt=0;
  let gesturing=false, startY=0, startTilt=0, suppressTapUntil=0;
  const ignore=(t)=>t.closest('.chrome')||t.closest('.sheet');
  const avgY=(touches)=>{ let y=0; for(const t of touches) y+=t.clientY; return y/touches.length; };

  stage.addEventListener('pointerdown',e=>{ if(ignore(e.target))return;
    if(gesturing){ clearTimeout(lp); return; }
    longFired=false; downAt=Date.now(); lp=setTimeout(()=>{ longFired=true; reset(); },650); });
  stage.addEventListener('pointerup',e=>{ if(ignore(e.target))return; clearTimeout(lp);
    if(gesturing || Date.now()<suppressTapUntil) return;
    if(!longFired && Date.now()-downAt<650) startPause(); });
  stage.addEventListener('pointercancel',()=>clearTimeout(lp));

  // Zwei Finger vertikal ziehen = Tisch virtuell aufrichten/neigen
  stage.addEventListener('touchstart',e=>{ if(ignore(e.target))return;
    if(e.touches.length===2){ gesturing=true; clearTimeout(lp);
      startY=avgY(e.touches); startTilt=S.settings.tilt; tiltHUD(true,startTilt); }
  },{passive:false});
  stage.addEventListener('touchmove',e=>{ if(!gesturing)return;
    if(e.touches.length>=2){ e.preventDefault();
      const dy=avgY([e.touches[0],e.touches[1]])-startY;
      let t=Math.round(startTilt - dy*0.32);
      t=Math.max(-70,Math.min(70,t));
      if(t!==S.settings.tilt){ S.settings.tilt=t; applyTilt(); tiltHUD(true,t);
        const r=$('#tiltRange'); if(r) r.value=t; setTiltVal(); }
    }
  },{passive:false});
  const endTwo=(e)=>{ if(!gesturing)return;
    if(e.touches.length<2){ gesturing=false; suppressTapUntil=Date.now()+450; tiltHUD(false); save(); }
  };
  stage.addEventListener('touchend',endTwo);
  stage.addEventListener('touchcancel',endTwo);
}

/* -------- Init ---------------------------------------------------- */
function init(){
  load(); applyAll(); renderFormats(); syncSettingsUI(); syncFired(F(),elapsed());

  $('#seg').addEventListener('click',e=>{ const b=e.target.closest('button'); if(!b)return;
    S.mode=b.dataset.mode; renderFormats(); save(); });
  $('#backBtn').addEventListener('click',()=>{ if(S.running) startPause(); go('setup'); });
  $('#gearBtn').addEventListener('click',openSheet);
  $('#soundBtn').addEventListener('click',()=>{ S.settings.sound=!S.settings.sound; if(S.settings.sound) ensureAudio(); applySound(); syncSettingsUI(); save(); });
  $('#scrim').addEventListener('click',closeSheet);

  $('#tiltRange').addEventListener('input',e=>{ S.settings.tilt=+e.target.value; setTiltVal(); applyTilt(); save(); });
  $('#axisSeg').addEventListener('click',e=>{ const b=e.target.closest('button'); if(!b)return;
    S.settings.axis=b.dataset.v; applyTilt(); syncSettingsUI(); save(); });
  $('#dispSeg').addEventListener('click',e=>{ const b=e.target.closest('button'); if(!b)return;
    S.settings.display=b.dataset.v; applyDisplay(); refreshViews(); syncSettingsUI(); save(); });
  $('#dirSeg').addEventListener('click',e=>{ const b=e.target.closest('button'); if(!b)return;
    S.settings.dir=b.dataset.v; syncSettingsUI(); save(); });
  $('#themeSeg').addEventListener('click',e=>{ const b=e.target.closest('button'); if(!b)return;
    S.settings.theme=b.dataset.v; applyTheme(); refreshViews(); syncSettingsUI(); save(); });
  $('#togFlip').addEventListener('click',()=>{ S.settings.flip=!S.settings.flip; applyTilt(); syncSettingsUI(); save(); });
  $('#togSound').addEventListener('click',()=>{ S.settings.sound=!S.settings.sound; if(S.settings.sound) ensureAudio(); applySound(); syncSettingsUI(); save(); });
  $('#togVib').addEventListener('click',()=>{ S.settings.vib=!S.settings.vib; syncSettingsUI(); save(); });
  $('#togFlash').addEventListener('click',()=>{ S.settings.flash=!S.settings.flash; syncSettingsUI(); save(); });

  bindGestures();

  if(S.screen==='timer'){ go('timer'); if(S.running){ hideHint(); reqWake(); } else updateHint(); }
  else go('setup');

  raf=requestAnimationFrame(tick);
}
document.addEventListener('DOMContentLoaded',init);
