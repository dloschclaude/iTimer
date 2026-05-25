// iTimer — countdown / count-up timer for OPD and BP debates.
// Counts down from a target duration. After expiry it keeps running,
// displaying overtime. Optional bell cues mark debate milestones per mode.

(() => {
  "use strict";

  const STORAGE_KEY = "itimer.settings.v3";
  const DEFAULT_MODE = "bp-700";
  const GRACE_MS = 15_000;

  // Each mode: target duration, grace window, and a list of bell cues.
  // `at` is elapsed milliseconds since start. `count` is the number of
  // bell strikes played in sequence.
  const MODES = {
    "bp-700": {
      label: "BP / OPD 7:00",
      targetMs: 7 * 60_000,
      graceMs: GRACE_MS,
      cues: [
        { at: 1 * 60_000,             count: 1 },   // 1:00 elapsed
        { at: 6 * 60_000,             count: 1 },   // 6:00 elapsed (1 min left)
        { at: 7 * 60_000,             count: 2 },   // 7:00 elapsed (time's up)
        { at: 7 * 60_000 + 15_000,    count: 1 },   // 7:15 elapsed (grace end)
      ],
    },
    "opd-330": {
      label: "OPD 3:30",
      targetMs: 3 * 60_000 + 30_000,
      graceMs: GRACE_MS,
      cues: [
        { at: 1 * 60_000,             count: 1 },   // 1:00 elapsed
        { at: 3 * 60_000,             count: 2 },   // 3:00 elapsed
        { at: 3 * 60_000 + 15_000,    count: 1 },   // 3:15 elapsed
      ],
    },
    "opd-100": {
      label: "OPD 1:00",
      targetMs: 60_000,
      graceMs: GRACE_MS,
      cues: [
        { at: 60_000,                 count: 2 },   // 1:00 elapsed
        { at: 75_000,                 count: 1 },   // 1:15 elapsed (grace end)
      ],
    },
    "prep-1500": {
      label: "Prep 15:00",
      targetMs: 15 * 60_000,
      graceMs: GRACE_MS,
      cues: [
        { at: 10 * 60_000,            count: 1 },   // 10:00 elapsed (5 min left)
        { at: 14 * 60_000,            count: 1 },   // 14:00 elapsed (1 min left)
        { at: 15 * 60_000,            count: 2 },   // 15:00 elapsed (time's up)
      ],
    },
  };

  // DOM
  const tiltEl    = document.getElementById("tilt");
  const timeEl    = document.getElementById("time");
  const labelEl   = document.getElementById("label");
  const progress  = document.getElementById("progress");
  const overtime  = document.getElementById("overtime");
  const ticksG    = document.getElementById("ticks");
  const markersG  = document.getElementById("markers");
  const startBtn  = document.getElementById("startBtn");
  const resetBtn  = document.getElementById("resetBtn");
  const soundTgl  = document.getElementById("soundToggle");
  const tiltRange = document.getElementById("tiltRange");
  const flipBtn   = document.getElementById("flipBtn");
  const modesEl   = document.getElementById("modes");
  const stage     = document.getElementById("stage");

  // Settings (persisted)
  const settings = Object.assign(
    { mode: DEFAULT_MODE, sound: true, tilt: 35, flipped: false, digitScale: 1 },
    safeParse(localStorage.getItem(STORAGE_KEY))
  );
  if (!MODES[settings.mode]) settings.mode = DEFAULT_MODE;

  function persist() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); } catch {}
  }
  function safeParse(s) { try { return JSON.parse(s) || {}; } catch { return {}; } }

  function currentMode() { return MODES[settings.mode]; }

  // Apply persisted settings to UI
  soundTgl.checked = !!settings.sound;
  tiltRange.value = settings.tilt;
  setActiveMode(settings.mode);
  applyTilt();
  applyDigitScale();

  // Timer state
  let targetMs   = currentMode().targetMs;
  let startedAt  = 0;
  let running    = false;
  let rafId      = 0;
  let firedCues  = new Set();
  let wakeLock   = null;

  const RING_TOTAL = 1000;

  buildTicks();
  buildMarkers();
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
      buildMarkers();
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

  // -- UI events --------------------------------------------------------

  startBtn.addEventListener("click", () => {
    if (running) stop();
    else { ensureAudio(); start(); }
  });

  resetBtn.addEventListener("click", () => {
    stop();
    firedCues.clear();
    targetMs = currentMode().targetMs;
    buildTicks();
    buildMarkers();
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
      if (g && e.touches.length < 2) {
        g = null;
        persist();
      }
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
      // Overtime ring fills over 60s of overtime regardless of grace length.
      const overFrac = Math.min(1, (elapsed - targetMs) / 60_000);
      overtime.setAttribute("stroke-dashoffset", String(RING_TOTAL * (1 - overFrac)));
    } else {
      overtime.setAttribute("stroke-dashoffset", String(RING_TOTAL));
    }

    // Five colour phases:
    //   first minute      → dark green
    //   middle            → light green
    //   last minute       → orange
    //   overtime ≤ grace  → orange
    //   overtime > grace  → red
    // (For the 1:00 mode this collapses to dark green / orange / red,
    //  because there is no "middle" or "last minute before target".)
    tiltEl.classList.remove("state-darkgreen", "state-lightgreen", "state-orange", "state-red");
    let labelText;
    if (elapsed < 60_000) {
      tiltEl.classList.add("state-darkgreen");
      labelText = running ? "speaking" : "ready";
    } else if (!over && remaining > 60_000) {
      tiltEl.classList.add("state-lightgreen");
      labelText = "speaking";
    } else if (elapsed < targetMs + graceMs) {
      tiltEl.classList.add("state-orange");
      labelText = over ? "overtime" : "1 min left";
    } else {
      tiltEl.classList.add("state-red");
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
      // Warm-up (iOS audio unlock).
      const b = audioCtx.createBuffer(1, 1, 22050);
      const s = audioCtx.createBufferSource();
      s.buffer = b; s.connect(audioCtx.destination); s.start(0);
    } catch (e) { /* ignore */ }
  }

  // Synthesise one bell strike at audioCtx time `t`. Uses several detuned
  // sine partials at non-integer ratios (struck-bell character) plus a
  // short attack transient.
  function playBell(t) {
    const f0 = 520;  // fundamental ~C5
    const partials = [
      { ratio: 0.5,  amp: 0.18, decay: 2.6 },  // hum tone
      { ratio: 1.0,  amp: 0.45, decay: 2.0 },  // strike / prime
      { ratio: 2.0,  amp: 0.28, decay: 1.4 },  // tierce-ish
      { ratio: 2.76, amp: 0.22, decay: 1.0 },  // quint
      { ratio: 4.2,  amp: 0.12, decay: 0.6 },  // upper partial
      { ratio: 5.4,  amp: 0.07, decay: 0.4 },  // upper partial
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

  // Play `count` bell strikes in sequence, ~0.5s apart.
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
    } catch (e) { /* permission may be required */ }
  }
  function releaseWakeLock() {
    if (wakeLock) { try { wakeLock.release(); } catch {} wakeLock = null; }
  }

  // -- SVG decorations --------------------------------------------------

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
      line.setAttribute("class", "major");
      ticksG.appendChild(line);
    }
  }

  function buildMarkers() {
    markersG.innerHTML = "";
    const totalSec = targetMs / 1000;
    const cues = currentMode().cues;
    for (const c of cues) {
      const atSec = c.at / 1000;
      const frac = atSec / totalSec;
      if (frac <= 0 || frac > 1) continue;  // cues past target are on the overtime ring
      const angle = frac * 360;
      const [x, y] = polar(200, 200, 170, angle);
      const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      dot.setAttribute("cx", x); dot.setAttribute("cy", y);
      dot.setAttribute("r", c.count >= 2 ? 5 : 4);
      if (c.count >= 2) dot.setAttribute("class", "warn");
      markersG.appendChild(dot);
    }
  }

  // -- Misc -------------------------------------------------------------

  function applyTilt() {
    tiltEl.style.setProperty("--tilt", settings.tilt + "deg");
    tiltEl.style.setProperty("--tilt-sign", settings.flipped ? "1" : "-1");
  }

  function applyDigitScale() {
    tiltEl.style.setProperty("--digit-scale", String(settings.digitScale));
  }

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    });
  }
})();
