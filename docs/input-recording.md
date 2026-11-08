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
device. Controls offer three controller drawings: **Clásico · básico** (the
original), **Xbox · universal** (asymmetric sticks) and **PS5 · DualSense**
(symmetric sticks). Xbox and PS5 show analog trigger pressure by filling the
trigger shapes themselves, without external bars or textual percentages.
Buttons highlight, sticks move and stick clicks are visible.

Choose **Teclado completo** for a physical QWERTY keyboard with function keys,
navigation and numpad. **Teclado 60%** keeps the 61-key main block without
function/nav/numpad sections. **Compacto ampliado** shows 1–6, QWERTY, more keys
around WASD and common modifiers; **Básico · WASD** preserves the original map.
Every keyboard layout includes both mouse thumb buttons (M4/M5), alongside
left/right/middle, wheel and movement. Keyboard legends describe physical positions; they are not
text entered into the game, and can differ from the active keyboard language.

**Pulsación** selects the highlight color for keys, mouse buttons, controller
buttons, stick clicks and analog trigger fill. Mint green is the default;
the reset button restores it. The color persists with the layout, and pressed
key labels adapt to light/dark colors. These are playback preferences; existing
input tracks do not need to be recorded again.

**Posición del mapa** anchors it at either bottom corner. Enable **Mover /
tamaño** to select and drag the map, or drag its bottom-right handle to resize.
The size slider also works directly. With the map selected, arrow keys move it
(Shift moves faster), +/− resize and Escape finishes editing. Position and size
are relative to the actual video picture, including letterboxing and fullscreen.
Layout, drawing, highlight color and size persist locally across restarts. Visibility never
persists: every clip still opens with its input map hidden. When multiple
controllers occur in a track, choose one or follow the last active controller.

The video itself stays unchanged. Existing export/copy actions produce a clean
video without baking in an overlay. To move an editable input track elsewhere,
keep the video and its `.inputs.json` together. Older clips have no input data;
it cannot be reconstructed after recording.

## Devices and storage

- Windows Raw Input captures physical keyboard state, mouse buttons, wheel and
  relative movement, including when a game locks the cursor.
- XInput captures standard controller buttons, d-pad, analog sticks and triggers.
  Its documented API does not expose Xbox Guide/Share or PlayStation PS,
  touchpad and mute buttons. These appear as unavailable when the track has no
  data for them, rather than inventing a released state.
- Native Raw Input also reads Sony DualSense / DualSense Edge HID button
  reports, including PS, touchpad click and mute when exposed by the device.
  USB and enhanced Bluetooth reports are supported; Bluetooth basic reports
  lack mute. Clipper does not change the controller mode or send output reports.
  HID-hiding drivers can make the physical device unavailable; in that case an
  XInput output from DS4Windows/Steam Input retains standard controls.
  Touch gestures, motion sensors, adaptive trigger effects and Edge rear
  paddles are outside this button map. The pairing button is not a game input.
- Selecting PS5 changes the drawing and labels, and works with existing
  XInput tracks. Extra PS buttons require a newly recorded native HID track.
- The compact keyboard map highlights common movement/action keys and lists
  other held keys below it; the extended/60% maps also list held keys outside
  their visible area, using readable function/numpad names.
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
`electron/input/InputWorker.cs` and `DualSenseInput.cs` on Windows using the installed .NET Framework
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
Unit tests also cover native USB/Bluetooth report parsing and normalized overlay
placement/clamping. Integration tests cover both stick layouts, pressure meters,
the full keyboard, drag/resize, persisted settings and hidden-on-reopen behavior.

## Artwork

The bundled controller SVGs are adapted from Al. Lopez's
[Gamepad Asset Pack](https://github.com/AL2009man/Gamepad-Asset-Pack), MIT license.
Metadata and author-local paths were removed; the static shapes are animated
locally by recorded input states. See the bundled
[license](../electron/input/assets/LICENSE-Gamepad-Asset-Pack.txt) and
[asset credits](../electron/input/assets/README.md). No runtime download occurs.

The extended keyboard arrangements were informed by the WASD/QWERTY presets in
[Input Overlay](https://github.com/univrsal/input-overlay/tree/master/presets)
and [NohBoard](https://github.com/ThoNohT/NohBoard). Clipper draws these maps
itself; no assets or layout files from those projects are bundled.
