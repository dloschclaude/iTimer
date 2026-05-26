// iTimer — countdown / count-up timer for OPD and BP debates.

(() => {
  "use strict";

  const STORAGE_KEY = "itimer.settings.v5";
  const DEFAULT_MODE = "bp-700";
  const GRACE_MS = 15_000;

  const MODES = {
    "bp-700": {
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
      targetMs: 3 * 60_000 + 30_000,
      graceMs: GRACE_MS,
      cues: [
        { at: 1 * 60_000,             count: 1 },
        { at: 3 * 60_000,             count: 2 },
        { at: 3 * 60_000 + 15_000,    count: 1 },
      ],
    },
    "opd-100": {
      targetMs: 60_000,
      graceMs: GRACE_MS,
      cues: [
        { at: 60_000,                 count: 2 },
        { at: 75_000,                 count: 1 },
      ],
    },
    "prep-1500": {
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
  const stage     = document.getElementById("stage");
  const panel     = document.getElementById("panel");
  const timeEl    = document.getElementById("time");
  const labelEl   = document.getElementById("label");
  const progress  = document.getElementById("progress");
  const overtime  = document.getElementById("overtime");
  const ticksG    = document.getElementById("ticks");
  const startBtn  = document.getElementById("startBtn");
  const resetBtn  = document.getElementById("resetBtn");
  const soundTgl  = document.getElementById("soundToggle");
  const tiltRange = document.getElementById("tiltRange");
  const flipBtn   = document.getElementById("flipBtn");
  const modesEl   = document.getElementById("modes");

  const settings = Object.assign(
    { mode: DEFAULT_MODE, sound: true, tilt: 35, flipped: false, digitScale: 1 },
    safeParse(localStorage.getItem(STORAGE_KEY))
  );
  if (!MODES[settings.mode]) settings.mode = DEFAULT_MODE;

  function persist() { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); } catch {} }
  function safeParse(s) { try { return JSON.parse(s) || {}; } catch { return {}; } }
  function currentMode() { return MODES[settings.mode]; }

  soundTgl.checked = !!settings.sound;
  tiltRange.value = settings.tilt;
  setActiveMode(settings.mode);
  applyTilt();
  applyDigitScale();

  let targetMs   = currentMode().targetMs;
  let startedAt  = 0;
  let running    = false;
  let rafId      = 0;
  let firedCues  = new Set();
  let wakeLock   = null;
  const RING_TOTAL = 1000;

  buildTicks();
  updateDisplay(0);

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
    labelEl.textContent = "ready";
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

  // -- Timer loop --------------------------------------------------

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

  function updateDisplay(elapsed) {
    const mode = currentMode();
    const graceMs = mode.graceMs;
    const remaining = targetMs - elapsed;
    const over = remaining < 0;
    const absMs = Math.abs(over ? -remaining : remaining);
    const totalSec = Math.floor(absMs / 1000);
    const mm = Math.floor(totalSec / 60);
    const ss = totalSec % 60;
    timeEl.textContent = `${over ? "+" : ""}${mm}:${ss.toString().padStart(2, "0")}`;

    const frac = Math.min(1, Math.max(0, elapsed / targetMs));
    progress.setAttribute("stroke-dashoffset", String(RING_TOTAL * (1 - frac)));
    if (over) {
      const overFrac = Math.min(1, (elapsed - targetMs) / 60_000);
      overtime.setAttribute("stroke-dashoffset", String(RING_TOTAL * (1 - overFrac)));
    } else {
      overtime.setAttribute("stroke-dashoffset", String(RING_TOTAL));
    }

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
    labelEl.textContent = labelText;
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

  // -- Ring decorations -------------------------------------------------

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
