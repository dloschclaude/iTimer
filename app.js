// iTimer — countdown / count-up timer for OPD and BP debates.
// Three views (ring, digital, segmented) selectable by horizontal swipe.

(() => {
  "use strict";

  const STORAGE_KEY = "itimer.settings.v4";
  const DEFAULT_MODE = "bp-700";
  const GRACE_MS = 15_000;

  // -- Segmented display constants (used at init, must come first) -----

  const SEG_W = 100, COLON_W = 40;

  const SEG_PATHS = {
    a: "M20,4 H80 L74,14 H26 Z",
    b: "M86,18 L96,8 V72 L86,76 Z",
    c: "M86,84 L96,88 V152 L86,142 Z",
    d: "M26,146 H74 L80,156 H20 Z",
    e: "M4,88 L14,84 V142 L4,152 Z",
    f: "M4,8 L14,18 V76 L4,72 Z",
    g: "M14,80 L24,72 H76 L86,80 L76,88 H24 Z",
  };
  const CORNER_PATHS = {
    h: "M0,0 H10 V10 H0 Z",
    i: "M90,0 H100 V10 H90 Z",
    j: "M0,150 H10 V160 H0 Z",
    k: "M90,150 H100 V160 H90 Z",
  };
  const DIGIT_PATTERN = {
    "0": { segs: "abcdef",  corners: "hijk" },
    "1": { segs: "bc",      corners: "ik"   },
    "2": { segs: "abdeg",   corners: "hi"   },
    "3": { segs: "abcdg",   corners: "ik"   },
    "4": { segs: "bcfg",    corners: "hi"   },
    "5": { segs: "acdfg",   corners: "hk"   },
    "6": { segs: "acdefg",  corners: "hjk"  },
    "7": { segs: "abc",     corners: "ik"   },
    "8": { segs: "abcdefg", corners: "hijk" },
    "9": { segs: "abcdfg",  corners: "hik"  },
    " ": { segs: "",        corners: ""     },
  };

  const MODES = {
    "bp-700": {
      label: "BP / OPD 7:00",
      targetMs: 7 * 60_000,
      graceMs: GRACE_MS,
      cues: [
        { at: 1 * 60_000,             count: 1 },
        { at: 6 * 60_000,             count: 1 },
        { at: 7 * 60_000,             count: 2 },
        { at: 7 * 60_000 + 15_000,    count: 1 },
      ],
    },
    "opd-330": {
      label: "OPD 3:30",
      targetMs: 3 * 60_000 + 30_000,
      graceMs: GRACE_MS,
      cues: [
        { at: 1 * 60_000,             count: 1 },
        { at: 3 * 60_000,             count: 2 },
        { at: 3 * 60_000 + 15_000,    count: 1 },
      ],
    },
    "opd-100": {
      label: "OPD 1:00",
      targetMs: 60_000,
      graceMs: GRACE_MS,
      cues: [
        { at: 60_000,                 count: 2 },
        { at: 75_000,                 count: 1 },
      ],
    },
    "prep-1500": {
      label: "Prep 15:00",
      targetMs: 15 * 60_000,
      graceMs: GRACE_MS,
      cues: [
        { at: 10 * 60_000,            count: 1 },
        { at: 14 * 60_000,            count: 1 },
        { at: 15 * 60_000,            count: 2 },
      ],
    },
  };

  // DOM
  const stage      = document.getElementById("stage");
  const carousel   = document.getElementById("carousel");
  const dotsEl     = document.getElementById("dots");
  const panel      = document.getElementById("panel");
  const timeRing   = document.getElementById("timeRing");
  const timeDigital= document.getElementById("timeDigital");
  const segmented  = document.getElementById("segmented");
  const segSlots   = document.getElementById("segSlots");
  const labelEl    = document.getElementById("label");
  const labelDigit = document.getElementById("labelDigital");
  const labelSeg   = document.getElementById("labelSeg");
  const progress   = document.getElementById("progress");
  const overtime   = document.getElementById("overtime");
  const ticksG     = document.getElementById("ticks");
  const startBtn   = document.getElementById("startBtn");
  const resetBtn   = document.getElementById("resetBtn");
  const soundTgl   = document.getElementById("soundToggle");
  const tiltRange  = document.getElementById("tiltRange");
  const flipBtn    = document.getElementById("flipBtn");
  const modesEl    = document.getElementById("modes");

  // Settings (persisted)
  const settings = Object.assign(
    { mode: DEFAULT_MODE, sound: true, tilt: 35, flipped: false, digitScale: 1, view: 0 },
    safeParse(localStorage.getItem(STORAGE_KEY))
  );
  if (!MODES[settings.mode]) settings.mode = DEFAULT_MODE;

  function persist() { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); } catch {} }
  function safeParse(s) { try { return JSON.parse(s) || {}; } catch { return {}; } }
  function currentMode() { return MODES[settings.mode]; }

  // Apply persisted settings to UI
  soundTgl.checked = !!settings.sound;
  tiltRange.value = settings.tilt;
  setActiveMode(settings.mode);
  applyTilt();
  applyDigitScale();
  buildSegmentedDisplay();

  // Timer state
  let targetMs   = currentMode().targetMs;
  let startedAt  = 0;
  let running    = false;
  let rafId      = 0;
  let firedCues  = new Set();
  let wakeLock   = null;
  const RING_TOTAL = 1000;

  buildTicks();
  updateDisplay(0);
  setView(settings.view, false);

  // -- Mode buttons -----------------------------------------------------

  modesEl.addEventListener("click", (e) => {
    const btn = e.target.closest(".mode");
    if (!btn || btn.disabled) return;
    const mode = btn.dataset.mode;
    if (!MODES[mode]) return;
    settings.mode = mode;
    persist();
    setActiveMode(mode);
    if (!running) {
      targetMs = MODES[mode].targetMs;
      firedCues.clear();
      buildTicks();
      updateDisplay(0);
    }
  });

  function setActiveMode(mode) {
    for (const b of modesEl.querySelectorAll(".mode")) {
      b.classList.toggle("active", b.dataset.mode === mode);
    }
  }
  function setModeButtonsDisabled(disabled) {
    for (const b of modesEl.querySelectorAll(".mode")) {
      b.disabled = disabled && b.dataset.mode !== settings.mode;
    }
  }

  // -- Controls ---------------------------------------------------------

  startBtn.addEventListener("click", () => {
    if (running) stop();
    else { ensureAudio(); start(); }
  });

  resetBtn.addEventListener("click", () => {
    stop();
    firedCues.clear();
    targetMs = currentMode().targetMs;
    buildTicks();
    updateDisplay(0);
    setLabel("ready");
  });

  soundTgl.addEventListener("change", () => {
    settings.sound = soundTgl.checked;
    persist();
    if (settings.sound) ensureAudio();
  });

  tiltRange.addEventListener("input", () => {
    settings.tilt = parseInt(tiltRange.value, 10);
    persist();
    applyTilt();
  });

  flipBtn.addEventListener("click", () => {
    settings.flipped = !settings.flipped;
    persist();
    applyTilt();
  });

  document.addEventListener("visibilitychange", () => {
    if (running && document.visibilityState === "visible") requestWakeLock();
  });

  // -- View selection ---------------------------------------------------

  // Sync the active dot with the carousel's current scroll position.
  function viewIndexFromScroll() {
    const w = carousel.clientWidth;
    if (!w) return 0;
    return Math.round(carousel.scrollLeft / w);
  }

  let scrollSyncRaf = 0;
  carousel.addEventListener("scroll", () => {
    if (scrollSyncRaf) return;
    scrollSyncRaf = requestAnimationFrame(() => {
      scrollSyncRaf = 0;
      const i = viewIndexFromScroll();
      if (i !== settings.view) {
        settings.view = i;
        persist();
        updateDots(i);
      }
    });
  }, { passive: true });

  dotsEl.addEventListener("click", (e) => {
    const dot = e.target.closest(".dot");
    if (!dot) return;
    const i = parseInt(dot.dataset.view, 10);
    setView(i, true);
  });

  function setView(i, smooth) {
    settings.view = i;
    persist();
    updateDots(i);
    const x = i * carousel.clientWidth;
    carousel.scrollTo({ left: x, behavior: smooth ? "smooth" : "auto" });
  }
  function updateDots(i) {
    for (const d of dotsEl.querySelectorAll(".dot")) {
      d.classList.toggle("active", parseInt(d.dataset.view, 10) === i);
    }
  }
  // After a layout settle / resize, snap to the persisted view.
  window.addEventListener("resize", () => {
    carousel.scrollTo({ left: settings.view * carousel.clientWidth, behavior: "auto" });
  });

  // -- Two-finger gestures: vertical pan → tilt, pinch → digit size -----

  setupGestures();

  function setupGestures() {
    let g = null;
    const onStart = (e) => {
      if (e.touches.length === 2) {
        const [a, b] = e.touches;
        g = {
          midY: (a.clientY + b.clientY) / 2,
          dist: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
          startTilt: settings.tilt,
          startScale: settings.digitScale,
        };
        e.preventDefault();
      } else {
        g = null;
      }
    };
    const onMove = (e) => {
      if (!g || e.touches.length !== 2) return;
      const [a, b] = e.touches;
      const midY = (a.clientY + b.clientY) / 2;
      const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      const dy = midY - g.midY;
      const dd = dist - g.dist;
      const nextTilt  = clamp(g.startTilt  - dy / 3,   0, 60);
      const nextScale = clamp(g.startScale + dd / 220, 0.5, 2.2);
      if (Math.abs(nextTilt - settings.tilt) > 0.1) {
        settings.tilt = nextTilt;
        tiltRange.value = Math.round(nextTilt);
        applyTilt();
      }
      if (Math.abs(nextScale - settings.digitScale) > 0.005) {
        settings.digitScale = nextScale;
        applyDigitScale();
      }
      e.preventDefault();
    };
    const onEnd = (e) => {
      if (g && e.touches.length < 2) { g = null; persist(); }
    };
    stage.addEventListener("touchstart",  onStart, { passive: false });
    stage.addEventListener("touchmove",   onMove,  { passive: false });
    stage.addEventListener("touchend",    onEnd);
    stage.addEventListener("touchcancel", onEnd);
  }

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  // -- Core timer loop --------------------------------------------------

  function start() {
    targetMs = currentMode().targetMs;
    startedAt = performance.now();
    running = true;
    startBtn.textContent = "Stop";
    startBtn.classList.remove("primary");
    setModeButtonsDisabled(true);
    panel.classList.add("running");
    requestWakeLock();
    tick();
  }

  function stop() {
    if (!running) return;
    running = false;
    cancelAnimationFrame(rafId);
    startBtn.textContent = "Start";
    startBtn.classList.add("primary");
    setModeButtonsDisabled(false);
    panel.classList.remove("running");
    releaseWakeLock();
  }

  function tick() {
    rafId = requestAnimationFrame(tick);
    const elapsed = performance.now() - startedAt;
    updateDisplay(elapsed);
    fireCues(elapsed);
  }

  function setLabel(text) {
    labelEl.textContent = text;
    labelDigit.textContent = text;
    labelSeg.textContent = text;
  }

  function updateDisplay(elapsed) {
    const mode = currentMode();
    const graceMs = mode.graceMs;
    const remaining = targetMs - elapsed;
    const over = remaining < 0;
    const absMs = Math.abs(over ? -remaining : remaining);
    const totalSec = Math.floor(absMs / 1000);
    const mm = Math.floor(totalSec / 60);
    const ss = totalSec % 60;

    // Ring view keeps the compact "M:SS" / "+M:SS" formatting.
    timeRing.textContent    = `${over ? "+" : ""}${mm}:${ss.toString().padStart(2, "0")}`;
    // Digital view: zero-padded MM:SS plus + sign.
    timeDigital.textContent = `${over ? "+" : ""}${mm.toString().padStart(2, "0")}:${ss.toString().padStart(2, "0")}`;

    // Segmented view: render MM:SS, plus indicator visible in overtime.
    renderSegmented(mm, ss, over);

    // Ring progress
    const frac = Math.min(1, Math.max(0, elapsed / targetMs));
    progress.setAttribute("stroke-dashoffset", String(RING_TOTAL * (1 - frac)));
    if (over) {
      const overFrac = Math.min(1, (elapsed - targetMs) / 60_000);
      overtime.setAttribute("stroke-dashoffset", String(RING_TOTAL * (1 - overFrac)));
    } else {
      overtime.setAttribute("stroke-dashoffset", String(RING_TOTAL));
    }

    // Five colour phases (state lives on .stage so all views inherit)
    stage.classList.remove("state-darkgreen", "state-lightgreen", "state-orange", "state-red");
    let labelText;
    if (elapsed < 60_000) {
      stage.classList.add("state-darkgreen");
      labelText = running ? "speaking" : "ready";
    } else if (!over && remaining > 60_000) {
      stage.classList.add("state-lightgreen");
      labelText = "speaking";
    } else if (elapsed < targetMs + graceMs) {
      stage.classList.add("state-orange");
      labelText = over ? "overtime" : "1 min left";
    } else {
      stage.classList.add("state-red");
      labelText = "stop!";
    }
    if (!running && elapsed === 0) labelText = "ready";
    setLabel(labelText);
  }

  // -- Audio cues -------------------------------------------------------

  function fireCues(elapsedMs) {
    const cues = currentMode().cues;
    for (const c of cues) {
      if (elapsedMs >= c.at && !firedCues.has(c.at)) {
        firedCues.add(c.at);
        if (settings.sound) playBellSequence(c.count);
      }
    }
  }

  let audioCtx = null;
  function ensureAudio() {
    if (audioCtx) {
      if (audioCtx.state === "suspended") audioCtx.resume();
      return;
    }
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      audioCtx = new Ctx();
      const b = audioCtx.createBuffer(1, 1, 22050);
      const s = audioCtx.createBufferSource();
      s.buffer = b; s.connect(audioCtx.destination); s.start(0);
    } catch (e) { /* ignore */ }
  }

  function playBell(t) {
    const f0 = 520;
    const partials = [
      { ratio: 0.5,  amp: 0.18, decay: 2.6 },
      { ratio: 1.0,  amp: 0.45, decay: 2.0 },
      { ratio: 2.0,  amp: 0.28, decay: 1.4 },
      { ratio: 2.76, amp: 0.22, decay: 1.0 },
      { ratio: 4.2,  amp: 0.12, decay: 0.6 },
      { ratio: 5.4,  amp: 0.07, decay: 0.4 },
    ];
    for (const p of partials) {
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.connect(g).connect(audioCtx.destination);
      o.type = "sine";
      o.frequency.value = f0 * p.ratio;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(p.amp, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t + p.decay);
      o.start(t);
      o.stop(t + p.decay + 0.05);
    }
  }

  function playBellSequence(count) {
    if (!audioCtx) ensureAudio();
    if (!audioCtx) return;
    if (audioCtx.state === "suspended") audioCtx.resume();
    const t0 = audioCtx.currentTime;
    for (let i = 0; i < count; i++) playBell(t0 + i * 0.5);
  }

  // -- Wake Lock --------------------------------------------------------

  async function requestWakeLock() {
    if (!("wakeLock" in navigator)) return;
    try {
      wakeLock = await navigator.wakeLock.request("screen");
      wakeLock.addEventListener("release", () => { wakeLock = null; });
    } catch (e) {}
  }
  function releaseWakeLock() {
    if (wakeLock) { try { wakeLock.release(); } catch {} wakeLock = null; }
  }

  // -- SVG ring ticks (orange/red marker dots removed) ------------------

  function polar(cx, cy, r, deg) {
    const rad = (deg - 90) * Math.PI / 180;
    return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
  }

  function buildTicks() {
    ticksG.innerHTML = "";
    const totalSec = targetMs / 1000;
    const minutes = Math.floor(totalSec / 60);
    for (let i = 1; i <= minutes; i++) {
      const frac = (i * 60) / totalSec;
      if (frac >= 1) break;
      const angle = frac * 360;
      const [x1, y1] = polar(200, 200, 156, angle);
      const [x2, y2] = polar(200, 200, 144, angle);
      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.setAttribute("x1", x1); line.setAttribute("y1", y1);
      line.setAttribute("x2", x2); line.setAttribute("y2", y2);
      ticksG.appendChild(line);
    }
  }

  // -- Segmented display (11 elements per digit) ------------------------
  //
  // Each digit is built from 11 SVG shapes: 7 standard segments (a-g)
  // and 4 corner accents (h-k). For every digit 0-9 a subset is lit; the
  // remainder stays as a dim ghost outline so the structure of all 11
  // elements remains visible.

  function buildSegmentedDisplay() {
    segSlots.innerHTML = "";
    const NS = "http://www.w3.org/2000/svg";
    // Centre the MM:SS layout in the 560-wide viewBox.
    // Layout: digit  digit  colon  digit  digit
    // Widths:  100    100    40    100    100   = 440 + gaps
    const gap = 20;
    const totalW = 4 * SEG_W + COLON_W + 4 * gap;
    let x = (560 - totalW) / 2;

    const makeDigit = (slotIndex) => {
      const g = document.createElementNS(NS, "g");
      g.setAttribute("transform", `translate(${x}, 20)`);
      g.setAttribute("class", "digit");
      g.dataset.slot = String(slotIndex);
      // 7 segments
      for (const seg of "abcdefg") {
        const p = document.createElementNS(NS, "path");
        p.setAttribute("d", SEG_PATHS[seg]);
        p.setAttribute("class", "seg");
        p.dataset.seg = seg;
        g.appendChild(p);
      }
      // 4 corner accents
      for (const c of "hijk") {
        const p = document.createElementNS(NS, "path");
        p.setAttribute("d", CORNER_PATHS[c]);
        p.setAttribute("class", "corner");
        p.dataset.seg = c;
        g.appendChild(p);
      }
      segSlots.appendChild(g);
      x += SEG_W + gap;
    };

    const makeColon = () => {
      const g = document.createElementNS(NS, "g");
      g.setAttribute("transform", `translate(${x}, 20)`);
      g.setAttribute("class", "colon");
      for (const cy of [50, 110]) {
        const dot = document.createElementNS(NS, "circle");
        dot.setAttribute("cx", "20");
        dot.setAttribute("cy", String(cy));
        dot.setAttribute("r", "8");
        dot.setAttribute("class", "colon-dot");
        g.appendChild(dot);
      }
      segSlots.appendChild(g);
      x += COLON_W + gap;
    };

    makeDigit(0);
    makeDigit(1);
    makeColon();
    makeDigit(2);
    makeDigit(3);
  }

  function renderSegmented(mm, ss, over) {
    const digits = [
      Math.floor(mm / 10),
      mm % 10,
      Math.floor(ss / 10),
      ss % 10,
    ].map(d => String(d));
    const slots = segSlots.querySelectorAll(".digit");
    slots.forEach((slot, i) => {
      const pat = DIGIT_PATTERN[digits[i]] || DIGIT_PATTERN[" "];
      for (const path of slot.querySelectorAll("path")) {
        const seg = path.dataset.seg;
        const lit = pat.segs.includes(seg) || pat.corners.includes(seg);
        path.classList.toggle("on", lit);
      }
    });
    segmented.classList.add("lit");
    segmented.classList.toggle("overtime", over);
  }

  // -- Misc -------------------------------------------------------------

  function applyTilt() {
    stage.style.setProperty("--tilt", settings.tilt + "deg");
    stage.style.setProperty("--tilt-sign", settings.flipped ? "1" : "-1");
  }

  function applyDigitScale() {
    stage.style.setProperty("--digit-scale", String(settings.digitScale));
  }

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    });
  }
})();
