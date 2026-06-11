# Debattentimer

An installable iOS PWA timer for **OPD** and **BP** parliamentary debates,
built from a Claude Design handoff. Designed to lie flat on a desk while the
speaker glances down — the clock face sits on a 3D-tilted plane so it reads
upright from a standing angle.

## Features

- **Setup screen** — pick the format family (OPD / BP), then a format:
  Vorbereitung (15:00), Hauptrede (7:00), Schlussrede (3:30), Eine Minute (1:00).
  OPD and BP have their own protected-time zones and bell schedules.
- **Two clock faces** (switchable in settings):
  - **Analog** — flat minimal dial, sweeping seconds hand, depleting progress
    arc with coloured protected-time zones and bell markers.
  - **Digital** — authentic seven-segment LED with ghost segments, bloom, and
    a blinking colon.
- **Tilt-to-read** — the plane tilts via CSS 3D perspective. Adjust with a
  **two-finger vertical drag** on the clock, or the slider in settings; choose
  the axis (Längs/Quer) and flip 180° for a view from the opposite side.
- **Protected-time bells** — synthesised bell strikes (single / double) at each
  format's milestones, plus optional **vibration** and an **edge light flash**.
- **Counts up into overtime** after the target, shown as `+M:SS`.
- **Direction** — show remaining time or elapsed time.
- **Themes** (Schwarz / Anthrazit / Hell) and an **accent colour** picker.
- **Screen stays awake** while running (Wake Lock API).
- Works offline once added to the home screen (service worker).

## Architecture

Vanilla HTML/CSS/JS, no dependencies. Views register themselves into
`window.VIEWS`; the core owns state, formats, the signal engine, persistence,
gestures and settings.

| File | Purpose |
| --- | --- |
| `index.html` | App shell + markup, PWA meta, service-worker registration |
| `styles.css` | All styling and design tokens |
| `timer-core.js` | State, formats, signals, persistence, gestures, settings |
| `timer-analog.js` | Analog dial view (`VIEWS.analog`) |
| `timer-digital.js` | Seven-segment view (`VIEWS.digital`) |
| `manifest.webmanifest` | PWA install metadata |
| `sw.js` | Offline cache |
| `icon.svg`, `icon-*.png` | App icons |

## Running locally

```
npx http-server -p 8128 .
```

Open on the iPhone, **Share → Add to Home Screen**, and launch from the icon for
full-screen and wake-lock behaviour. Wake Lock requires HTTPS (or `localhost`).
