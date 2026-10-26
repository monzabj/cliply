// Full state frames make seeking, gaps, overlapping clips and cuts deterministic.
const neutral = () => ({ keys: [], mouse: { buttons: [], dx: 0, dy: 0, wheel: 0 }, pads: [] })
function sliceFrames(frames, start, end) {
  let initial = neutral()
  const selected = []
  for (const frame of frames) {
    if (frame.t <= start) initial = frame.state
    else if (frame.t <= end) selected.push({ t: Math.round(frame.t - start), state: frame.state })
  }
  // Movement is a momentary event, not a held input.
  initial = { ...initial, mouse: { ...initial.mouse, dx: 0, dy: 0, wheel: 0 } }
  return [{ t: 0, state: initial }, ...selected]
}
function sliceTrack(track, startMs, endMs) {
  const start = Math.max(0, startMs)
  const end = Math.min(track.durationMs, endMs)
  return { ...track, coverageStartMs: Math.max(0, (track.coverageStartMs || 0) - start), durationMs: Math.max(0, end - start), frames: sliceFrames(track.frames, start, end) }
}
class Timeline {
  constructor(retainMs = 180000) { this.frames = []; this.retainMs = retainMs; this.appendCount = 0 }
  push(t, state) {
    this.frames.push({ t, state })
    if (++this.appendCount % 128 === 0) {
      const first = this.frames.findIndex(f => f.t >= t - this.retainMs)
      if (first > 1) this.frames.splice(0, first - 1)
    }
  }
  snapshot(start, end) {
    if (!this.frames.length || this.frames[0].t > end) return null
    return { version: 1, durationMs: end - start, sampleIntervalMs: 16, frames: sliceFrames(this.frames, start, end) }
  }
  clear() { this.frames = [] }
}
module.exports = { Timeline, neutral, sliceFrames, sliceTrack }
