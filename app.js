// iTimer — countdown / count-up timer for OPD and BP debates.
// Counts down from a target duration (default 7:00). After expiry it keeps
// running, displaying overtime. Optional audio cues mark debate milestones.

(() => {
  "use strict";

  const STORAGE_KEY = "itimer.settings.v2";
  const MODES = ["07:15", "07:00", "03:30", "01:00"];
  const DEFAULT_MODE = "07:00";

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
  if (!MODES.includes(settings.mode)) settings.mode = DEFAULT_MODE;

  function persist() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); } catch {}
  }
  function safeParse(s) { try { return JSON.parse(s) || {}; } catch { return {}; } }

  function modeToMs(mode) {
    const [mm, ss] = mode.split(":").map(Number);
    return (mm * 60 + ss) * 1000;
  }

  // Apply persisted settings to UI
  soundTgl.checked = !!settings.sound;
  tiltRange.value = settings.tilt;
  setActiveMode(settings.mode);
  applyTilt();
  applyDigitScale();

  // Timer state
  let targetMs   = modeToMs(settings.mode);
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
    if (!MODES.includes(mode)) return;
    settings.mode = mode;
    persist();
    setActiveMode(mode);
    if (!running) {
      targetMs = modeToMs(mode);
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
    targetMs = modeToMs(settings.mode);
    buildTicks();
    buildMarkers();
    updateDisplay(0);
    tiltEl.classList.remove("state-amber", "state-red", "state-over");
    tiltEl.classList.add("state-green");
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
      const dy = midY - g.midY;     // positive = fingers moved down
      const dd = dist - g.dist;     // positive = fingers spread apart

      // Vertical swipe up (negative dy) increases tilt. 3 px ≈ 1°.
      const nextTilt = clamp(g.startTilt - dy / 3, 0, 60);
      // Pinch out (positive dd) increases digit size. 200 px swing ≈ 1.0.
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
    targetMs = modeToMs(settings.mode);
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

    tiltEl.classList.remove("state-green", "state-amber", "state-red", "state-over");
    if (over) {
      tiltEl.classList.add("state-over");
      labelEl.textContent = "overtime";
    } else if (remaining <= 3_000) {
      tiltEl.classList.add("state-red");
      labelEl.textContent = "time!";
    } else if (remaining <= 60_000) {
      tiltEl.classList.add("state-amber");
      labelEl.textContent = "1 min left";
    } else {
      tiltEl.classList.add("state-green");
      labelEl.textContent = running ? "speaking" : "ready";
    }
  }

  // -- Audio cues -------------------------------------------------------

  function cues() {
    const t = Math.round(targetMs / 1000);
    return [
      { id: "6min-left", at: t - 6 * 60, type: "peep" },
      { id: "1min-left", at: t - 60,    type: "ping" },
      { id: "last-3a",   at: t - 3,     type: "ping" },
      { id: "last-3b",   at: t - 2,     type: "ping" },
      { id: "last-3c",   at: t - 1,     type: "ping" },
      { id: "plus-15",   at: t + 15,    type: "peep" },
    ].filter(c => c.at > 0);
  }

  function fireCues(elapsedMs) {
    const sec = Math.floor(elapsedMs / 1000);
    for (const c of cues()) {
      if (sec >= c.at && !firedCues.has(c.id)) {
        firedCues.add(c.id);
        if (settings.sound) playCue(c.type);
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
      s.buffer = b;
      s.connect(audioCtx.destination);
      s.start(0);
    } catch (e) { /* ignore */ }
  }

  function playCue(kind) {
    if (!audioCtx) ensureAudio();
    if (!audioCtx) return;
    if (audioCtx.state === "suspended") audioCtx.resume();

    const now = audioCtx.currentTime;
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.connect(g).connect(audioCtx.destination);

    if (kind === "peep") {
      o.type = "sine";
      o.frequency.value = 880;
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(0.5, now + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
      o.start(now);
      o.stop(now + 0.24);
    } else {
      o.type = "triangle";
      o.frequency.setValueAtTime(1480, now);
      o.frequency.exponentialRampToValueAtTime(1100, now + 0.18);
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(0.55, now + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.32);
      o.start(now);
      o.stop(now + 0.34);
    }
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
    const total = targetMs / 1000;
    const addDot = (atSec, cls) => {
      const frac = atSec / total;
      if (frac <= 0 || frac > 1) return;
      const angle = frac * 360;
      const [x, y] = polar(200, 200, 170, angle);
      const c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      c.setAttribute("cx", x); c.setAttribute("cy", y); c.setAttribute("r", 4);
      if (cls) c.setAttribute("class", cls);
      markersG.appendChild(c);
    };
    if (total > 6 * 60) addDot(total - 6 * 60, "");
    if (total > 60)     addDot(total - 60, "warn");
    addDot(total - 0.001, "warn");
  }

  // -- Misc -------------------------------------------------------------

  function applyTilt() {
    tiltEl.style.setProperty("--tilt", settings.tilt + "deg");
    tiltEl.style.setProperty("--tilt-sign", settings.flipped ? "1" : "-1");
  }

  function applyDigitScale() {
    tiltEl.style.setProperty("--digit-scale", String(settings.digitScale));
  }

  // Service worker registration (offline support after Add to Home Screen)
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    });
  }
})();
