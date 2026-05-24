// iTimer — countdown / count-up timer for OPD and BP debates.
// Counts down from a target duration (default 7:00). After expiry it keeps
// running, displaying overtime. Optional audio cues mark debate milestones.

(() => {
  "use strict";

  const TARGET_DEFAULT_MIN = 7;
  const STORAGE_KEY = "itimer.settings.v1";

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
  const minutesIn = document.getElementById("minutes");
  const tiltRange = document.getElementById("tiltRange");
  const flipBtn   = document.getElementById("flipBtn");

  // Settings (persisted)
  const settings = Object.assign(
    { minutes: TARGET_DEFAULT_MIN, sound: true, tilt: 35, flipped: false },
    safeParse(localStorage.getItem(STORAGE_KEY))
  );

  function persist() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); } catch {}
  }
  function safeParse(s) { try { return JSON.parse(s) || {}; } catch { return {}; } }

  // Apply persisted settings to UI
  minutesIn.value = settings.minutes;
  soundTgl.checked = !!settings.sound;
  tiltRange.value = settings.tilt;
  applyTilt();

  // Timer state
  let targetMs   = settings.minutes * 60_000;
  let startedAt  = 0;       // performance.now() at start
  let baseElapsed = 0;      // elapsed accumulated before a pause (currently always 0; reserved)
  let running    = false;
  let rafId      = 0;
  let firedCues  = new Set();
  let wakeLock   = null;

  // SVG ring math: pathLength=1000 → dashoffset 0..1000 maps to 0..100%
  const RING_TOTAL = 1000;

  buildTicks();
  buildMarkers();
  updateDisplay(0);

  // -- UI events --------------------------------------------------------

  startBtn.addEventListener("click", () => {
    if (running) {
      stop();
    } else {
      // first-touch audio unlock
      ensureAudio();
      start();
    }
  });

  resetBtn.addEventListener("click", () => {
    stop();
    firedCues.clear();
    targetMs = clampMinutes(parseInt(minutesIn.value, 10)) * 60_000;
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

  minutesIn.addEventListener("change", () => {
    const v = clampMinutes(parseInt(minutesIn.value, 10));
    minutesIn.value = v;
    settings.minutes = v;
    persist();
    if (!running) {
      targetMs = v * 60_000;
      firedCues.clear();
      updateDisplay(0);
      buildMarkers();
    }
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

  // Re-acquire wake lock when returning to the tab.
  document.addEventListener("visibilitychange", () => {
    if (running && document.visibilityState === "visible") requestWakeLock();
  });

  // -- Core timer loop --------------------------------------------------

  function start() {
    targetMs = clampMinutes(parseInt(minutesIn.value, 10)) * 60_000;
    startedAt = performance.now();
    baseElapsed = 0;
    running = true;
    startBtn.textContent = "Stop";
    startBtn.classList.remove("primary");
    requestWakeLock();
    tick();
  }

  function stop() {
    if (!running) return;
    running = false;
    cancelAnimationFrame(rafId);
    startBtn.textContent = "Start";
    startBtn.classList.add("primary");
    releaseWakeLock();
  }

  function tick() {
    rafId = requestAnimationFrame(tick);
    const elapsed = baseElapsed + (performance.now() - startedAt);
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

    // ring progress
    const frac = Math.min(1, Math.max(0, elapsed / targetMs));
    progress.setAttribute("stroke-dashoffset", String(RING_TOTAL * (1 - frac)));

    if (over) {
      // Overtime ring grows over its own minute window
      const overFrac = Math.min(1, (elapsed - targetMs) / 60_000);
      overtime.setAttribute("stroke-dashoffset", String(RING_TOTAL * (1 - overFrac)));
    } else {
      overtime.setAttribute("stroke-dashoffset", String(RING_TOTAL));
    }

    // state colors / labels
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

  // Cue table: { id, atSecElapsed, type }
  // Triggers are evaluated against the integer second of elapsed time.
  function cues() {
    const t = Math.round(targetMs / 1000);
    return [
      { id: "6min-left", at: t - 6 * 60, type: "peep"  }, // peep at 6 min left
      { id: "1min-left", at: t - 60,    type: "ping"  }, // ping at 1 min left
      { id: "last-3a",   at: t - 3,     type: "ping"  }, // last three seconds
      { id: "last-3b",   at: t - 2,     type: "ping"  },
      { id: "last-3c",   at: t - 1,     type: "ping"  },
      { id: "plus-15",   at: t + 15,    type: "peep"  }, // peep at +15s overtime
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
      // Warm-up: silent 1-sample buffer to unlock iOS audio.
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
      // "ping" — brighter, bell-like with fast decay
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
    } catch (e) { /* user gesture/permission may be required */ }
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
    const minutes = Math.max(1, Math.round(targetMs / 60_000));
    // 60 minor ticks would be too noisy at small target; show ticks every minute.
    for (let i = 0; i < minutes; i++) {
      const angle = (i / minutes) * 360;
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
      const angle = frac * 360;
      const [x, y] = polar(200, 200, 170, angle);
      const c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      c.setAttribute("cx", x); c.setAttribute("cy", y); c.setAttribute("r", 4);
      if (cls) c.setAttribute("class", cls);
      markersG.appendChild(c);
    };
    // 6-min-left and 1-min-left milestones, when they fit inside the target
    if (total > 6 * 60) addDot(total - 6 * 60, "");
    if (total > 60)     addDot(total - 60, "warn");
    // expiry mark
    addDot(total - 0.001, "warn");
  }

  // -- Misc -------------------------------------------------------------

  function applyTilt() {
    tiltEl.style.setProperty("--tilt", settings.tilt + "deg");
    tiltEl.style.setProperty("--tilt-sign", settings.flipped ? "1" : "-1");
  }

  function clampMinutes(v) {
    if (!Number.isFinite(v)) return TARGET_DEFAULT_MIN;
    return Math.max(1, Math.min(30, v));
  }

  // Service worker registration (offline support after Add to Home Screen)
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    });
  }
})();
