# Clipper

Local, ad-free game clipping for PC. Keeps a rolling buffer of your screen or a game window in memory; press a hotkey (F8 by default) to save the last 30 seconds to disk. No accounts, no uploads, no subscriptions.

## Run the desktop app

```bash
pnpm install
pnpm electron:dev        # Next.js dev server + Electron window with HMR
```

## Build an installer

```bash
pnpm electron:build:win  # -> dist/Clipper-Setup-x.y.z.exe, its .blockmap and latest.yml
pnpm electron:build      # current platform
```

## Release

The app updates itself from GitHub releases (`electron-updater`). Bump `version`
in `package.json`, build, then publish a release tagged `vX.Y.Z` with
`Clipper-Setup-X.Y.Z.exe`, `Clipper-Setup-X.Y.Z.exe.blockmap` and `latest.yml`
attached. Installed copies see it about 20 seconds after launch and offer it in
Settings → Version; nothing downloads until the user says so.

## How it works

- **Capture (screens)** — ffmpeg reads the desktop with DXGI Desktop Duplication (`ddagrab`) and encodes on the GPU (NVENC, AMF, Quick Sync, or x264 as a last resort) into a ring of 2-second MPEG-TS segments in the temp folder (`electron/native-recorder.js`). A clip is the last few segments joined byte for byte — one continuous encoder stream, so no seams and no frames lost to restarts. Chromium's own screen capture tops out around 30–40 fps on many machines (it falls back to GDI whenever duplication fails, e.g. on virtual displays such as Parsec's); this path holds a steady 60.
- **Capture (windows, fallback)** — window sources, and any machine where ffmpeg cannot start, use Chromium's `getDisplayMedia` + `MediaRecorder` with Windows Graphics Capture enabled. Set `CLIPPER_NO_NATIVE=1` to force this path when diagnosing.
- **Audio** — system sound (WASAPI loopback via `getDisplayMedia`) and the microphone are each recorded by overlapping `MediaRecorder`s, so there is always a complete file covering the clip window. Both are cut on the wall clock at the moment the key was pressed; the mic is kept as its own layer (`<clip>.mic.m4a`) so the editor can balance voice against game.
- **Input tracks (Windows, optional)** — records keyboard/mouse and XInput controller states beside each new clip as `<clip>.inputs.json`. The player can show or hide a synchronized input map; it starts hidden and never changes the video pixels. Tracks follow renames, trims and deletion. See [input recording](docs/input-recording.md) for setup, controller support, capture scope and tests.
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
