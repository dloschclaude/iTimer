"use strict";
/* ============================================================
   Debattentimer — Bahnhofsuhr (station-clock style)
   Klassische Bahnsteig-Optik: helles Zifferblatt, fette
   Balken-Marken, keine Ziffern, schlanker roter Sekundenzeiger.
   Funktioniert als Countdown: Minutenzeiger = Restminuten,
   Sekundenzeiger fegt die Sekunden, Schutzzonen/Glocken/Fortschritt
   liegen als feiner Ring direkt außerhalb des Zifferblatts.
============================================================ */
(function(){
  window.VIEWS = window.VIEWS || {};
  const NS='http://www.w3.org/2000/svg';
  const POL=(cx,cy,r,deg)=>{ const a=(deg-90)*Math.PI/180; return [cx+r*Math.cos(a), cy+r*Math.sin(a)]; };
  const el=(t,a)=>{ const e=document.createElementNS(NS,t); for(const k in a) e.setAttribute(k,a[k]); return e; };
  let refs={};

  function build(root){
    root.innerHTML='';
    const col=document.createElement('div'); col.className='ana-col';

    const dial=document.createElement('div'); dial.className='ana-dial st-dial';
    const svg=el('svg',{viewBox:'0 0 400 400',class:'chrono'});

    // outer ring (full duration): track · protected zones · depleting progress
    const rOut=196;
    svg.appendChild(el('circle',{cx:200,cy:200,r:rOut,class:'arc-track'}));
    refs.zoneStart=el('circle',{cx:200,cy:200,r:rOut,class:'arc-zone',pathLength:1,transform:'rotate(-90 200 200)'});
    refs.zoneEnd  =el('circle',{cx:200,cy:200,r:rOut,class:'arc-zone',pathLength:1,transform:'rotate(-90 200 200)'});
    svg.appendChild(refs.zoneStart); svg.appendChild(refs.zoneEnd);
    refs.arc=el('circle',{cx:200,cy:200,r:rOut,class:'arc-prog',pathLength:1,'stroke-dasharray':1,'stroke-dashoffset':0,transform:'rotate(-90 200 200)'});
    svg.appendChild(refs.arc);
    refs.bells=el('g',{class:'bell-marks'}); svg.appendChild(refs.bells);

    // bright station face
    svg.appendChild(el('circle',{cx:200,cy:200,r:186,class:'st-face'}));
    svg.appendChild(el('circle',{cx:200,cy:200,r:186,class:'st-rim'}));

    // minute strokes + bold 5-minute batons (no numerals)
    const ticks=el('g',{class:'st-ticks'});
    for(let i=0;i<60;i++){
      const deg=i*6, major=i%5===0;
      if(major){ const [x1,y1]=POL(200,200,148,deg),[x2,y2]=POL(200,200,178,deg);
        ticks.appendChild(el('line',{x1,y1,x2,y2,class:'st-baton'})); }
      else{ const [x1,y1]=POL(200,200,168,deg),[x2,y2]=POL(200,200,178,deg);
        ticks.appendChild(el('line',{x1,y1,x2,y2,class:'st-min'})); }
    }
    svg.appendChild(ticks);

    // minute hand (broad black baton)
    refs.mhand=el('polygon',{points:'200,40 207,196 193,196',class:'st-mhand'});
    svg.appendChild(refs.mhand);
    // second hand (slim red, plain tip — no lollipop)
    refs.shand=el('line',{x1:200,y1:228,x2:200,y2:30,class:'st-shand'});
    svg.appendChild(refs.shand);
    // hub
    svg.appendChild(el('circle',{cx:200,cy:200,r:9,class:'st-cap'}));
    svg.appendChild(el('circle',{cx:200,cy:200,r:4.4,class:'st-scap'}));

    dial.appendChild(svg); col.appendChild(dial);

    const read=document.createElement('div'); read.className='ana-read';
    refs.time=document.createElement('div'); refs.time.className='ana-time'; refs.time.textContent='7:00';
    read.appendChild(refs.time); col.appendChild(read);

    root.appendChild(col);
  }

  function setZone(node,z,dur,kind){
    if(!z){ node.style.display='none'; return; }
    node.style.display='';
    const f0=z[0]/dur, f1=z[1]/dur;
    node.setAttribute('stroke-dasharray',`${(f1-f0).toFixed(4)} 1`);
    node.setAttribute('stroke-dashoffset',(-f0).toFixed(4));
    node.dataset.kind=kind;
  }
  function format(f){
    setZone(refs.zoneStart,f.protStart,f.dur,'prot');
    setZone(refs.zoneEnd,f.protEnd,f.dur,'warn');
    refs.bells.innerHTML='';
    f.bells.forEach(b=>{ const deg=(b.t/f.dur)*360; const [x,y]=POL(200,200,196,deg);
      refs.bells.appendChild(el('circle',{cx:x,cy:y,r:b.double?3.4:2.2,class:'bell-mark'+(b.double?' end':'')})); });
  }

  function render(e,f,ph,col){
    // displayed value (respects Restzeit / Verstrichen)
    let showVal, over=false;
    if(S.settings.dir==='elapsed'){ showVal=e; over=e>=f.dur; }
    else{ const rem=f.dur-e; if(rem>=0) showVal=rem; else { showVal=-rem; over=true; } }
    // hands reflect the shown value (countdown sweeps backwards, count-up forwards)
    const secAng=((showVal%60)/60)*360;
    const minAng=((showVal/10)%360);
    refs.shand.setAttribute('transform',`rotate(${secAng} 200 200)`);
    refs.mhand.setAttribute('transform',`rotate(${minAng} 200 200)`);

    // depleting progress ring over the full duration
    const frac=Math.min(e/f.dur,1);
    if(e>=f.dur){ refs.arc.setAttribute('stroke-dasharray','1 0'); refs.arc.setAttribute('stroke-dashoffset','0'); }
    else{ refs.arc.setAttribute('stroke-dasharray','1'); refs.arc.setAttribute('stroke-dashoffset',frac.toFixed(4)); }
    const css=getComputedStyle(document.documentElement);
    if(ph==='over'){ refs.arc.style.stroke=col; refs.arc.style.opacity='1'; }
    else if(ph==='warn'){ refs.arc.style.stroke=col; refs.arc.style.opacity='.95'; }
    else if(ph==='prot'){ refs.arc.style.stroke=css.getPropertyValue('--c-prot').trim(); refs.arc.style.opacity='.9'; }
    else{ refs.arc.style.stroke=''; refs.arc.style.opacity=''; }
    refs.arc.style.filter=(ph==='over'||ph==='warn')?'drop-shadow(0 0 5px '+col+')':'none';

    // readout
    if(S.settings.dir==='elapsed') refs.time.textContent=fmt(e);
    else{ const rem=f.dur-e; refs.time.textContent = rem>=0?fmt(rem):'+'+fmt(-rem); }
    refs.time.style.color=(ph==='over')?col:'';
  }

  window.VIEWS.station={build,format,render};
})();
