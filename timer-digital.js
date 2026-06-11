"use strict";
/* ============================================================
   Debattentimer — Digital-Ansicht (Sieben-Segment, LED/LCD)
   Authentische Optik: schwach sichtbare „Geister"-Segmente,
   blinkender Doppelpunkt, Bloom auf aktiven Segmenten.
============================================================ */
(function(){
  window.VIEWS = window.VIEWS || {};
  const NS='http://www.w3.org/2000/svg';
  const el=(t,a)=>{ const e=document.createElementNS(NS,t); for(const k in a) e.setAttribute(k,a[k]); return e; };

  // Segment-Geometrie in einer 100×196-Zelle, Halbdicke h=8.5
  const h=8.5;
  const hbar=(Y,X1,X2)=>`${X1},${Y} ${X1+h},${Y-h} ${X2-h},${Y-h} ${X2},${Y} ${X2-h},${Y+h} ${X1+h},${Y+h}`;
  const vbar=(X,Y1,Y2)=>`${X},${Y1} ${X+h},${Y1+h} ${X+h},${Y2-h} ${X},${Y2} ${X-h},${Y2-h} ${X-h},${Y1+h}`;
  const SEG={
    a:hbar(10,20,80), g:hbar(98,20,80), d:hbar(186,20,80),
    f:vbar(10,20,90),  b:vbar(90,20,90),
    e:vbar(10,106,176),c:vbar(90,106,176),
  };
  const MAP={
    '0':'abcdef','1':'bc','2':'abged','3':'abgcd','4':'fgbc','5':'afgcd',
    '6':'afgecd','7':'abc','8':'abcdefg','9':'abcdfg','-':'g',' ':'',
  };

  // Slot-Layout (zwei Minutenstellen : zwei Sekundenstellen)
  const SLOTS=[0,118,/*colon*/-1,294,412];
  let refs={slots:[],colon:null};

  function buildDigit(parent,tx){
    const g=el('g',{transform:`translate(${tx},0)`,class:'digit'});
    const map={};
    for(const s in SEG){ const p=el('polygon',{points:SEG[s],class:'seg','data-s':s}); map[s]=p; g.appendChild(p); }
    parent.appendChild(g); return map;
  }

  function build(root){
    root.innerHTML='';
    refs={slots:[],colon:null};
    const wrap=document.createElement('div'); wrap.className='seg-wrap';

    const label=document.createElement('div'); label.className='seg-label'; label.textContent='OPD-REDE';
    refs.label=label; wrap.appendChild(label);

    const panel=document.createElement('div'); panel.className='seg-panel';
    const svg=el('svg',{viewBox:'-30 -6 572 214',class:'seg-svg'});
    const slant=el('g',{transform:'translate(20,0) skewX(-6)'});
    // digits + colon
    refs.slots.push(buildDigit(slant,SLOTS[0]));
    refs.slots.push(buildDigit(slant,SLOTS[1]));
    const colon=el('g',{class:'colon'});
    colon.appendChild(el('circle',{cx:248,cy:74,r:9}));
    colon.appendChild(el('circle',{cx:248,cy:134,r:9}));
    refs.colon=colon; slant.appendChild(colon);
    refs.slots.push(buildDigit(slant,SLOTS[3]));
    refs.slots.push(buildDigit(slant,SLOTS[4]));
    svg.appendChild(slant); panel.appendChild(svg); wrap.appendChild(panel);

    root.appendChild(wrap);
  }

  function setDigit(map,ch){
    const on=MAP[ch]||'';
    for(const s in map) map[s].classList.toggle('on', on.indexOf(s)>=0);
  }

  function format(f){ if(refs.label) refs.label.textContent=f.name.toUpperCase(); }

  function render(e,f,ph,col){
    let total, over=false;
    if(S.settings.dir==='elapsed'){ total=e; over=e>=f.dur; }
    else{ const rem=f.dur-e; total=rem>=0?rem:(over=true,-rem); }
    total=Math.max(0,Math.floor(total));
    // immer führende Null zeigen (klassischer Stoppuhr-Look): MM:SS
    const M=String(Math.min(99,Math.floor(total/60))).padStart(2,'0');
    const Sx=String(total%60).padStart(2,'0');
    const seq=[M[0],M[1],Sx[0],Sx[1]];
    refs.slots.forEach((mp,i)=>setDigit(mp,seq[i]));

    // Doppelpunkt blinkt im Lauf (1 Hz)
    const blink = S.running ? ((e%1)<0.5) : true;
    refs.colon.classList.toggle('lit',blink);

    // LED-Farbe: klassisch warmes Leuchten (Akzent), rot in der Überzeit
    const css=getComputedStyle(document.documentElement);
    const led = over ? css.getPropertyValue('--c-over').trim()
              : (ph==='warn') ? css.getPropertyValue('--c-warn').trim()
              : css.getPropertyValue('--accent').trim();
    const panel=refs.colon.ownerSVGElement;
    panel.style.setProperty('--seg-on', led);
    panel.style.setProperty('--seg-off', `color-mix(in oklch, ${led} 13%, transparent)`);
    panel.classList.toggle('over', over);
  }

  window.VIEWS.digital={build,format,render};
})();
