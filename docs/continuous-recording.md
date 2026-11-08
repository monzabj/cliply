# Continuous recordings and highlights

In the desktop app, **Grabación continua** opens a dialog to choose a file name,
destination folder and screen/window. Starting a recording does not stop the
rolling buffers. Existing clip and screenshot shortcuts keep their own actions.

Both new shortcuts are empty by default:

- **Iniciar / detener** optionally starts a new recording with the last chosen
  name, folder and physical screen, or stops the current recording. Missing or
  ambiguous monitors require a fresh selection. The first use without saved
  choices opens the dialog. Nothing starts automatically when Clipper launches.
- **Marcar destacado** adds a timestamp without splitting or stopping the video.
  The **Destacar** button does the same thing. Shortcuts cannot reuse a clip,
  screenshot or other recording shortcut.

**Detener y guardar** flushes the encoders and adds the recording to the regular
library with a **Grabación** badge. Highlights appear on the timeline and in a
scrollable list; clicking either seeks to that moment. Trimming retains and
rebases the highlights inside the selected range. The microphone, computer
master and optional application audio use the existing mixer.

The chosen filename gets `(2)`, `(3)`, etc. when the video or one of its sidecars
already exists. `<name>.highlights.json` stores highlight timestamps separately.
Playback, file rename, reveal, export, trim and deletion work with destinations
outside the usual clips folder. Recordings are indexed in the current library;
keep their sidecars together when moving files manually. Continuous recordings
are excluded from automatic disk-limit cleanup.

## Resource use and recovery

The continuous encoder is independent of the clip buffers. Keeping both enabled
uses additional encoding resources and disk bandwidth. H.264 is preferred when
available; VP9/WebM remains a fallback. One-second video/microphone chunks go to
disk over IPC; the pending write queue is limited to 64 MiB rather than retaining
an entire session in memory. Application isolation streams AAC into separate
files with bounded write queues, up to eight application tracks per recording.
Errors or reaching that limit retain the full computer mix.

Finalization remuxes the video, encodes/aligns audio layers and publishes complete
files without overwriting existing files. This needs temporary disk space for
both the capture and final files. Small hover proxies cover the first ten seconds
of recordings, and timelines over five minutes seek to individual sample frames
instead of decoding the entire video to generate a filmstrip.

Temporary data and journals are kept under
`<chosen folder>/.clipper-recordings/<id>/`; a small registry in the user profile
allows recovery after an interrupted process. Normal app exit requests the final
encoder chunks before saving. Renderer reload/crash salvages chunks already on
disk, and the next launch attempts unfinished journals. A process crash can lose
the most recent chunk. A failed save keeps temporary files and offers retry or
explicit discard. The optional input-map sidecars currently apply to rolling
clips; continuous recordings do not archive an unbounded input history.

## Validation

`node --test test/*.test.js` covers ordered writes, concurrent highlights, repeated
finalization, sidecar filename collisions, cancellation, marker trimming and real
streaming AAC alignment/silence. `node test/continuous.integration.cjs` uses an
isolated Electron profile with generated canvas/audio, real MediaRecorder and
ffmpeg. It exercises button-only defaults, Windows shortcut registration,
streaming capture, simultaneous short-clip save, final chunks, external playback,
microphone audio, highlight seek, rename, trim, shortcut restart, interrupted
renderer and recovery after abruptly terminating the main process. Set
`CLIPPER_ELECTRON_PATH` to run it against a packaged executable.

`node test/capture.integration.cjs` additionally exercises a real continuous display
capture alongside two monitor buffers (native where available, otherwise the
supported Chromium fallback), recovery of a killed native encoder,
F8/F9 clip saves during the continuous session and stopping the session while both
rolling buffers remain armed. This optional Windows test needs two monitors and
writes test captures only to its isolated temporary profile.
