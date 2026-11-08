# Permanent screen hotkeys and capture recovery

In **Hotkeys & Settings**, every screen hotkey has a **Pin screen / Fijar
pantalla** button. A pin stores its own screen identity and clip duration.
The star chooses the main toolbar button; it does not control persistence.

For example, select the 1920×1080 screen for F8 and the 1366×768 screen for F9,
choose 30 seconds for each, and leave both pinned. Add as many other keys and
durations as needed. Screen hotkeys from older settings migrate automatically
to pins using their existing configured targets. Choosing a different screen
in a row explicitly updates that key's pin. Unpinning restores session-based
behavior.

On Windows, Clipper saves the monitor's device interface path where available.
This takes precedence over display numbers and also recognizes a monitor after
its resolution changes. For older references without that identity, matching
checks compatible display IDs and unique resolution / device-label evidence.
It does not trust a recycled `screen:N` ID or a numbered screen name. If the
intended screen is missing or indistinguishable, Clipper asks for a selection
instead of recording another monitor. A port/driver change that replaces the
physical device path may also require selecting the screen again.

## Recovering capture

Windows can interrupt DXGI capture during login, sleep, lock/unlock, exclusive
fullscreen games, resolution changes or a display-driver restart. Previously,
a failed restart set the recording's lifetime stop flag, so no later attempt
could succeed. The UI continued estimating a full buffer from elapsed time.

Clipper now retries failed capture attempts with a delay capped at ten seconds,
also monitors stalled video progress, and re-resolves the intended physical
screen before restarting. Resume/unlock and display-change events prompt a
fresh resolution of the displays. An explicit Stop cancels pending retries and
startup attempts.

The UI reads actual ffmpeg progress. Interrupted sessions show a reconnecting
notice and zero buffered video. Another monitor that is still recording keeps
its buffer. The interrupted buffer starts filling again once video returns;
footage from the interruption cannot be reconstructed.

Related fixes serialize settings/index writes, retry temporary Windows file
locks, preserve a backup of settings, and reserve names of clips being saved
so simultaneous monitor hotkeys do not overwrite each other's files or index
entries. Screenshots also respect the pinned screen and do not silently fall
back to the first available display.

## Verification

`pnpm test` covers display renumbering, missing/ambiguous monitors, physical
identity, pin migration, retries after repeated failures, truthful buffer health,
concurrent indexes and settings recovery, as well as input-track timelines.

The opt-in Windows test `pnpm test:capture:integration` needs a built renderer,
Playwright (or `CLIPPER_PLAYWRIGHT_MODULE`) and two connected monitors. It uses
an isolated temporary profile. It starts capture hidden, terminates one real
ffmpeg process, checks recovery on the same screen, saves through pinned F8/F9
concurrently, checks actual output resolutions and verifies persistence across
a full restart. Set `CLIPPER_ELECTRON_PATH` to test an unpacked desktop package.
