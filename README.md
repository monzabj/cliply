# Clipper

Local, ad-free game clipping for PC. Keeps a rolling buffer of your screen or a game window in memory; press a hotkey (F8 by default) to save the last 30 seconds to disk. No accounts, no uploads, no subscriptions.

[Download Clipper for Windows](https://github.com/monzabj/cliply/releases/download/installer/Clipper-Installer.exe). This installer downloads and verifies the latest stable version from GitHub. The same file works for a new installation and can update an existing one.

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

To release an app update, bump `version` in `package.json` and push to `main`.
[GitHub Actions](https://github.com/monzabj/cliply/actions/workflows/release.yml)
tests the code, builds the Windows package and publishes the installer,
blockmap and `latest.yml` under `vX.Y.Z`. Installed copies offer updates in
Settings → Version.

The reusable downloader is published separately under the `installer` tag.
Build it with `pnpm build:online-installer` when its own code changes. Run
`dist/Clipper-Installer.exe --verify-download` to test the real download and
SHA-256 check without running setup.

## How it works

- **Capture (screens)** — ffmpeg reads the desktop with DXGI Desktop Duplication (`ddagrab`) and encodes on the GPU (NVENC, AMF, Quick Sync, or x264 as a last resort) into a ring of 2-second MPEG-TS segments in the temp folder (`electron/native-recorder.js`). A clip is the last few segments joined byte for byte — one continuous encoder stream, so no seams and no frames lost to restarts. Chromium's own screen capture tops out around 30–40 fps on many machines (it falls back to GDI whenever duplication fails, e.g. on virtual displays such as Parsec's); this path holds a steady 60.
- **Capture (windows, fallback)** — window sources, and any machine where ffmpeg cannot start, use Chromium's `getDisplayMedia` + `MediaRecorder` with Windows Graphics Capture enabled. Set `CLIPPER_NO_NATIVE=1` to force this path when diagnosing.
- **Continuous recording** — choose a name, folder and screen, record a full session independently of rolling clips and mark highlights with a separate optional shortcut. Start/stop is button-only by default. Saved recordings appear in the library with clickable highlights. See [continuous recordings](docs/continuous-recording.md) for shortcuts, resource use and recovery.
- **Audio** — computer sound and microphone retain their original separate layers. On Windows, application isolation is enabled by default: apps heard during each clip also have independently editable AAC soundtracks. The editor offers Microphone, a Computer master and an expandable horizontal app mixer. Settings can disable isolation for the original two-layer mode. Capture uses one bounded RAM history across monitors; errors retain the full computer mix. See [application audio](docs/application-audio.md) for resource use, compatibility and tests.
- **Input tracks (Windows, optional)** — records keyboard/mouse, XInput and native DualSense button states beside each new clip as `<clip>.inputs.json`. The player offers basic, Xbox and PS5 maps, basic/extended/60%/full keyboards, visual trigger fill, custom highlight colors, drag placement and saved size. **Guardar cambios** writes the visible map, audio mix and selected range into the shareable video. Clipper retains the original and its tracks for re-editing or restoring. See [input recording](docs/input-recording.md) for setup, device limitations, artwork credits and tests.
- **Hotkeys** — registered system-wide with `globalShortcut`, so they work while a game is fullscreen. Add as many as you like, each with its own duration (10s – 5min). F8 → 30s ships as the default.
- **Pinned monitors and recovery** — screen hotkeys remember a physical monitor and duration across restarts, independently of the star used for the main button. Capture reconnects after DXGI failures and shows actual buffered video. See [permanent hotkeys and recovery](docs/permanent-hotkeys.md).
- **Save** — on hotkey press the matching segments are stitched with the bundled `ffmpeg` (stream copy, near-instant) and written to `Videos/Clipper/`. The foreground process name is captured so each clip records the game / app it came from, plus screen vs. window, time and date.
- **Gallery** — clips grouped by day, searchable by game or window. Open one to play it with audio; drag the amber handles on the timeline to trim, then choose **Overwrite this clip** or **Save as new clip** (frame-accurate ffmpeg re-encode).
- **Tray** — closing the window keeps the buffer alive in the tray; quit from the tray menu.

## Select and manage clips (desktop)

Click the circle at the top right of a clip to enter selection mode. Click anywhere
on another clip to toggle it, or hold the left mouse button and drag across clips;
holding near the top or bottom scrolls the library. Escape or **Cancel selection**
returns to normal playback. **Select all visible** respects the current filters.

**Copy to…** keeps the originals. **Move to…** asks for confirmation and removes
successfully moved clips from this library and its previews. Both preserve associated
audio, input tracks, markers and edit originals, and avoid overwriting existing files.
Choose a destination outside the library. **Delete selected** confirms the count and
uses the Recycle Bin; a trash failure never falls back to permanent deletion.
Failures remain selected for retry. Active recordings cannot be selected.

Run `pnpm test:selection:integration` for the pointer/keyboard regression in an
isolated Electron window with generated clips; it never modifies the real library.

## Browser preview

The same UI runs in a plain browser (`pnpm dev`) with a fallback adapter: the OS share picker replaces the source list, clips live in IndexedDB, trims are re-recorded in real time, and hotkeys only fire while the tab is focused. Useful for developing the UI; the desktop app is the real product.

## Project layout

```
electron/          main process: window, tray, global hotkeys, capture handler, ffmpeg, clip index
lib/clipper/       platform-agnostic core: types, rolling recorder, desktop + web adapters, React provider
components/clipper UI: shell, gallery, viewer + trim bar, capture page, settings
```
