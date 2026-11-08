# Application audio layers (Windows)

**Separate audio by application** is enabled by default. In Settings it can be
turned off at any time to use only the original **Microphone + Computer** mode.
Turning it off stops the helper and clears its unsaved RAM history. Previously
saved application tracks remain editable. System audio must also be enabled.

New clips retain the complete computer soundtrack inside the video and the
microphone in its existing `.mic.m4a` sidecar. With separation enabled, each
application heard during the clip also gets a `<clip>.app-<id>.m4a` file; the
clip index stores its readable name and executable. Silent applications and
applications heard only outside the clip's time window have no fader.

The editor shows **Microphone**, then **Computer**, followed by an expander for
the applications. The app list scrolls horizontally with the mouse wheel,
trackpad or keyboard. Computer is a master for desktop sound and does not
affect the microphone. Each application has independent volume and mute.
The playback master applies to all sound. Levels are remembered with the clip.

Until an application fader is edited, playback/export use the original full
computer soundtrack. When an application is adjusted, the computer bus is
replaced by the sum of its isolated tracks, avoiding duplicate audio. Microphone
remains separate. Trimming renders the selected mix, as did the previous
two-layer editor; the resulting trim has a single mixed soundtrack. Export,
clipboard sharing and hover previews use the same mixer. Renaming moves audio
sidecars; deletion and disk-limit cleanup remove them. Their sizes count toward
the disk limit.

## Capture and compatibility

The locally built .NET Framework helper uses Windows Core Audio session
enumeration and WASAPI process-loopback capture. It discovers applications
dynamically on all active playback endpoints; it has no Discord/Spotify
allowlist. Processes of the same executable are grouped under their application
root, and independent roots of the same executable share a fader. A browser is
an application, not an independently editable list of tabs. Clipper's own
process tree is excluded to avoid recording its clip playback and sound cues.

Process loopback requires a compatible Windows build (the app targets Windows
11 / builds 20348+). It does not replace drivers, inject code, change Windows
volumes, or bypass protected audio. Some protected or unusual audio paths may
be unavailable. For activation errors, reported discontinuities, memory limits,
or a new capture starting inside a clip, the clip keeps its complete computer
soundtrack and shows why app faders are unavailable. No partial isolated mix is
silently substituted. Old clips cannot gain isolated tracks after recording.

References: Microsoft's [application loopback sample](https://learn.microsoft.com/en-us/samples/microsoft/windows-classic-samples/applicationloopbackaudio-sample/),
[audio session enumeration](https://learn.microsoft.com/en-us/windows/win32/api/audiopolicy/nf-audiopolicy-iaudiosessionmanager2-getsessionenumerator),
and [asynchronous WASAPI activation](https://learn.microsoft.com/en-us/windows/win32/api/mmdeviceapi/nf-mmdeviceapi-activateaudiointerfaceasync).

## Resource use

One helper serves all screen recordings. PCM is buffered in RAM rather than
written continuously to disk. At 48 kHz stereo 16-bit, 30 seconds is 5.76 MB per
audible app; the default 10-second safety margin brings a continuously sounding
app's rolling buffer to about 7.68 MB. Retention follows the longest clip hotkey,
up to five minutes plus the margin. Aggregate PCM history is capped at 192 MiB;
the helper, IPC and in-flight saves use additional memory. Silent buffers are
not sent or retained. Longer clips/more active applications cost more.

Only saving a clip encodes these tracks to AAC at 128 kbit/s, roughly 0.48 MB
per app for 30 seconds. Encoding runs below normal priority. Discovery, sample
copying and playback mixing add CPU cost; this is not an FPS guarantee. Turning
separation off avoids the helper, PCM buffers and app-track encoding entirely.

## Validation

`pnpm build:audio` builds `AudioWorker.exe` using the Windows .NET Framework C#
compiler. Packaging scripts build and unpack it automatically. `pnpm test`
covers binary framing, time windows, silence, bounds and mixer gains.

`pnpm test:audio:integration` uses an isolated Electron profile and generated
tone applications. Only the test PIDs are captured. It verifies frequency
isolation, silent-app filtering, default-on settings, explicit off mode, fault
fallback, AAC sidecars, live playback, independent gains, saved mix, horizontal
controls, rename, trim and sidecar cleanup. Diagnostics stay in ignored
`.test-artifacts/`; no user recordings are used.

Set `CLIPPER_TEST_NATIVE=1` to additionally capture a real screen into the
temporary test profile and verify the native screen-save path against the
same generated application audio. This optional check reads the desktop;
its clips stay local to the temporary profile.
