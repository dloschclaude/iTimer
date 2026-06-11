"use strict";
/* ============================================================
   Debattentimer — Analog-Ansicht (minimal · präzise · flach)
   Flaches Zifferblatt · feiner Tick-Ring · dünner Akzent-Zeiger
   · dünner Fortschrittsbogen mit Schutzzonen & Glocken-Marken
   Keine Fake-Materialien — Ruhe & Präzision.
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

    const dial=document.createElement('div'); dial.className='ana-dial';
    const svg=el('svg',{viewBox:'0 0 400 400',class:'chrono'});

    // subtle outline (definition on light theme)
    svg.appendChild(el('circle',{cx:200,cy:200,r:189,class:'dial-ring'}));

    // outer progress: track · zones · arc
    const rOut=189;
    svg.appendChild(el('circle',{cx:200,cy:200,r:rOut,class:'arc-track'}));
    refs.zoneStart=el('circle',{cx:200,cy:200,r:rOut,class:'arc-zone',pathLength:1,transform:'rotate(-90 200 200)'});
    refs.zoneEnd  =el('circle',{cx:200,cy:200,r:rOut,class:'arc-zone',pathLength:1,transform:'rotate(-90 200 200)'});
    svg.appendChild(refs.zoneStart); svg.appendChild(refs.zoneEnd);
    refs.arc=el('circle',{cx:200,cy:200,r:rOut,class:'arc-prog',pathLength:1,'stroke-dasharray':1,'stroke-dashoffset':0,transform:'rotate(-90 200 200)'});
    svg.appendChild(refs.arc);

    refs.bells=el('g',{class:'bell-marks'}); svg.appendChild(refs.bells);

    // tick ring — 120 ticks: seconds + half-seconds, 5-s major + numeral
    const ticks=el('g',{class:'ticks'});
    for(let i=0;i<120;i++){
      const deg=i*3, sup=i%10===0, sec=i%2===0;
      const r1= sup?148: sec?161:170, r2=178;
      const [x1,y1]=POL(200,200,r1,deg),[x2,y2]=POL(200,200,r2,deg);
      ticks.appendChild(el('line',{x1,y1,x2,y2,class:'tk'+(sup?' sup':sec?' sec':' sub')}));
    }
    svg.appendChild(ticks);

    // numerals 5..60
    const nums=el('g',{class:'nums'});
    for(let k=1;k<=12;k++){ const s=k*5; const deg=(s%60)*6; const [x,y]=POL(200,200,130,deg);
      const t=el('text',{x,y:y+1,class:'num','text-anchor':'middle','dominant-baseline':'central'}); t.textContent=s; nums.appendChild(t); }
    svg.appendChild(nums);

    // seconds hand (thin needle + counterweight)
    const hand=el('g',{class:'hand'}); refs.hand=hand;
    hand.appendChild(el('polygon',{points:'200,40 201.9,200 198.1,200',class:'hand-blade'}));
    hand.appendChild(el('line',{x1:200,y1:200,x2:200,y2:232,class:'hand-tail'}));
    svg.appendChild(hand);
    svg.appendChild(el('circle',{cx:200,cy:200,r:7,class:'cap-base'}));
    svg.appendChild(el('circle',{cx:200,cy:200,r:3,class:'cap-dot'}));

    dial.appendChild(svg); col.appendChild(dial);

    // readout below dial
    const read=document.createElement('div'); read.className='ana-read';
    refs.time=document.createElement('div'); refs.time.className='ana-time'; refs.time.textContent='7:00';
    read.appendChild(refs.time);
    col.appendChild(read);

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
    // sweeping seconds hand — one revolution / minute
    const secAng=((e%60)/60)*360;
    refs.hand.setAttribute('transform',`rotate(${secAng} 200 200)`);
    // remaining arc depletes
    const frac=Math.min(e/f.dur,1);
    if(e>=f.dur){ refs.arc.setAttribute('stroke-dasharray','1 0'); refs.arc.setAttribute('stroke-dashoffset','0'); }
    else{ refs.arc.setAttribute('stroke-dasharray','1'); refs.arc.setAttribute('stroke-dashoffset',frac.toFixed(4)); }
    refs.arc.style.stroke=col;
    refs.arc.style.filter=(ph==='over'||ph==='warn')?'drop-shadow(0 0 4px '+col+')':'none';
    // readout
    if(S.settings.dir==='elapsed') refs.time.textContent=fmt(e);
    else { const rem=f.dur-e; refs.time.textContent = rem>=0?fmt(rem):'+'+fmt(-rem); }
    refs.time.style.color=(ph==='over')?col:'';
  }

  window.VIEWS.analog={build,format,render};
})();
