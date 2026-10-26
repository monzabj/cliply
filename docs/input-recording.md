# Input tracks

Input recording is optional and disabled by default. In the Windows desktop
app, click **Inputs · desactivados** at the bottom left and enable
**Grabar inputs en nuevos clips**. Capture runs only while a recording session
is armed, including while Clipper is in the tray. It is global, so switching to
another application still records physical key codes and mouse activity.
Disable it when it is not needed. Key codes are not translated into text.

New clips get a matching `<name>.inputs.json` beside the video. Open a clip and
click **Mostrar inputs** to display its keyboard/mouse or controller map.
The map starts hidden every time a clip is opened. It follows seeking,
pausing and playback speed, and can switch automatically to the last active
device. Controls choose the map, Xbox/PlayStation labels and corner placement.

The video itself stays unchanged. Existing export/copy actions produce a clean
video without baking in an overlay. To move an editable input track elsewhere,
keep the video and its `.inputs.json` together. Older clips have no input data;
it cannot be reconstructed after recording.

## Devices and storage

- Windows Raw Input captures physical keyboard state, mouse buttons, wheel and
  relative movement, including when a game locks the cursor.
- XInput captures controller buttons, d-pad, analog sticks and triggers.
  PlayStation controllers require an XInput output such as DS4Windows or Steam
  Input. The PlayStation selector changes labels; it is not a controller driver.
  If several controllers are connected, the first one is displayed.
- The compact keyboard map highlights common movement/action keys and lists
  other held keys below it.
- The worker runs locally without injecting code into games. Only saved clips
  write input tracks to disk; unsaved history stays in a bounded memory buffer.
- `%APPDATA%/clipper/input-settings.json` persists the opt-in separately from
  the settings rewritten by the existing renderer. Disabling capture stops the
  worker and clears unsaved history; previously saved tracks remain.

Renaming a video renames its input file. Trimming, both overwrite and save as
new, rebases the input timeline and preserves held buttons at the new start.
Deleting a clip or pruning it for the disk limit also removes its input file.
Input capture errors appear in the Inputs indicator and app log without
preventing the video from being saved.

The native recorder uses the same wall-clock cut as the input track. The
Chromium fallback reports its actual chunk boundaries and retains the existing
recorder's keyframe-based cut precision.

## Build and tests

Desktop development and packaging scripts automatically compile
`electron/input/InputWorker.cs` on Windows using the installed .NET Framework
C# compiler. Set `CLIPPER_CSC` to use another compatible compiler. The generated
executable is ignored by Git and unpacked by electron-builder. Non-Windows
desktop builds skip it and report input capture as unsupported.

```sh
pnpm build:inputs
pnpm test
pnpm build
```

`test/timeline.test.js` covers held keys, cut boundaries, overlapping clips,
bounded retention, transient mouse movement, controller state and trims.

The optional desktop integration test needs a built renderer, Electron and
Playwright. Install Playwright separately without changing the project
dependencies, or set `CLIPPER_PLAYWRIGHT_MODULE` to an existing installation.
Then run `pnpm test:inputs:integration`. It uses an isolated temporary profile
and synthetic clip, does not touch the user's library or startup settings,
and saves diagnostics under `.test-artifacts/`. Set `CLIPPER_TEST_NATIVE=1`
to exercise an actual desktop recording as well. Controller drawings are
verified with a synthetic track; a physical controller needs a hardware check.
