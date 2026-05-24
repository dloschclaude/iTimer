# iTimer

A tiny installable PWA timer for **OPD** and **BP** debates. Designed to live on
an iPhone lying flat on the desk while you speak — the whole UI is tilted via
CSS perspective so the circle looks roughly upright when you glance down at it.

## Features

- Default 7:00 countdown, configurable from 1–30 minutes.
- After the target hits 0:00 the timer keeps counting **upward** (overtime
  shown as `+M:SS` with a red pulsing ring and a thin outer overtime ring).
- **Screen stays on** while the timer runs (Wake Lock API; iOS 16.4+ / Safari).
- Optional **sound cues**:
  - 🔔 *peep* — at **6 minutes left** (protected time over)
  - 🔔 *ping* — at **1 minute left**
  - 🔔🔔🔔 three *pings* — at the **last 3 seconds**
  - 🔔 *peep* — at **+15 seconds** overtime
- Sounds are synthesised with the Web Audio API — no external files.
- Big circular progress ring with minute ticks and milestone dots.
- **Tilt slider** (0–55°) and a **Flip** button to reverse tilt direction
  depending on whether the phone is oriented with the home edge towards or
  away from you.
- Works offline once added to the home screen (service worker caches the
  shell).

## Running locally

```
cd iTimer
npx http-server -p 8123 .
```

Then open `http://<your-laptop-ip>:8123/` on the iPhone, **share → Add to
Home Screen**, and launch from the icon so you get full-screen, status-bar
hiding, and wake-lock behaviour.

> Wake Lock only works over **HTTPS** (or `http://localhost`). If you serve
> from a LAN address, the screen will still sleep — use a tunnel or self-signed
> TLS for proper behaviour. Once installed as a PWA over HTTPS, wake lock
> works on iOS 16.4+.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | App shell |
| `styles.css` | Layout, theme, tilt transform |
| `app.js` | Timer loop, audio cues, wake lock, settings |
| `manifest.webmanifest` | PWA install metadata |
| `sw.js` | Offline cache |
| `icon.svg`, `icon-*.png` | App icons |
