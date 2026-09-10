# Clipper

Local, ad-free game clipping for PC. Keeps a rolling buffer of your screen or a game window in memory; press a hotkey (F8 by default) to save the last 30 seconds to disk. No accounts, no uploads, no subscriptions.

## Run the desktop app

```bash
pnpm install
pnpm electron:dev        # Next.js dev server + Electron window with HMR
```

## Build an installer

```bash
pnpm electron:build:win  # -> dist/Clipper Setup x.y.z.exe and a portable .exe
pnpm electron:build      # current platform
```

## How it works

- **Capture** — pick a screen or window (Electron `desktopCapturer`). Video is recorded in 5-second WebM segments by `MediaRecorder` and kept in RAM for as long as your longest hotkey needs. System audio is captured via WASAPI loopback on Windows.
- **Hotkeys** — registered system-wide with `globalShortcut`, so they work while a game is fullscreen. Add as many as you like, each with its own duration (10s – 5min). F8 → 30s ships as the default.
- **Save** — on hotkey press the matching segments are stitched with the bundled `ffmpeg` (stream copy, near-instant) and written to `Videos/Clipper/`. The foreground process name is captured so each clip records the game / app it came from, plus screen vs. window, time and date.
- **Gallery** — clips grouped by day, searchable by game or window. Open one to play it with audio; drag the amber handles on the timeline to trim, then choose **Overwrite this clip** or **Save as new clip** (frame-accurate ffmpeg re-encode).
- **Tray** — closing the window keeps the buffer alive in the tray; quit from the tray menu.

## Browser preview

The same UI runs in a plain browser (`pnpm dev`) with a fallback adapter: the OS share picker replaces the source list, clips live in IndexedDB, trims are re-recorded in real time, and hotkeys only fire while the tab is focused. Useful for developing the UI; the desktop app is the real product.

## Project layout

```
electron/          main process: window, tray, global hotkeys, capture handler, ffmpeg, clip index
lib/clipper/       platform-agnostic core: types, rolling recorder, desktop + web adapters, React provider
components/clipper UI: shell, gallery, viewer + trim bar, capture page, settings
```
