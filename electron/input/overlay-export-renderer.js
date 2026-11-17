const { ipcRenderer } = require('electron')
const { overlayRect } = require('./overlay-layout')

async function overlayImage(svg, width, height) {
  const copy = svg.cloneNode(true)
  copy.setAttribute('width', width)
  copy.setAttribute('height', height)
  copy.style.width = width + 'px'
  copy.style.height = height + 'px'
  const blob = new Blob([new XMLSerializer().serializeToString(copy)], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  try {
    const image = new Image()
    image.src = url
    await image.decode()
    return image
  } finally {
    URL.revokeObjectURL(url)
  }
}

async function exportInputs({ video, src, prefs, track, sample, createRenderer, canceled, report }) {
  const width = video.videoWidth, height = video.videoHeight
  if (!width || !height || !Number.isFinite(video.duration)) throw Error('Esperá a que cargue el video.')
  const duration = Math.ceil(video.duration * 1000)
  const shownWidth = Math.min(video.clientWidth, video.clientHeight * width / height) || width
  const ratio = width / shownWidth
  const picture = { left: 0, top: 0, width: shownWidth, height: height / ratio }
  const keys = new Set()
  if (prefs.mode !== 'pad') keys.add(prefs.keyboard === 'compact' ? 'basic' : prefs.keyboard)
  if (prefs.mode !== 'kbm') keys.add(prefs.skin)
  const maps = new Map([...keys].map(key => {
    const renderer = createRenderer(key)
    const rect = overlayRect(picture, renderer.ratio, prefs)
    return [key, { renderer, rect }]
  }))
  const rectangles = [...maps.values()].map(map => map.rect)
  const x = Math.max(0, Math.floor(Math.min(...rectangles.map(r => r.left * ratio)) - 8 * ratio))
  const y = Math.max(0, Math.floor(Math.min(...rectangles.map(r => r.top * ratio)) - 8 * ratio))
  const right = Math.min(width, Math.ceil(Math.max(...rectangles.map(r => (r.left + r.width) * ratio)) + 8 * ratio))
  const bottom = Math.min(height, Math.ceil(Math.max(...rectangles.map(r => (r.top + r.height) * ratio)) + 8 * ratio))
  const mix = JSON.parse(video.dataset.inputExportMix || 'null')
  const job = await ipcRenderer.invoke('inputs:export:start', src, { width, height, x, y, mix })
  if (!job) return false

  const canvas = document.createElement('canvas')
  canvas.width = right - x
  canvas.height = bottom - y
  const ctx = canvas.getContext('2d')
  const stage = document.createElement('div')
  Object.assign(stage.style, { position: 'fixed', left: '-10000px', top: '0', opacity: '0', pointerEvents: 'none' })
  document.body.append(stage)
  for (const { renderer, rect } of maps.values()) {
    Object.assign(renderer.root.style, { display: 'block', width: `${rect.width}px`, height: `${rect.height}px` })
    stage.append(renderer.root)
  }

  try {
    const times = new Set([0, Math.ceil(track.coverageStartMs || 0), Math.floor(track.durationMs) + 1])
    for (const frame of track.frames) {
      times.add(Math.ceil(frame.t))
      // Only relative mouse movement expires without a new frame.
      if (frame.state.mouse.dx || frame.state.mouse.dy || frame.state.mouse.wheel) times.add(Math.ceil(frame.t + 100))
    }
    const events = [...times].filter(t => t >= 0 && t < duration).sort((a, b) => a - b)
    let previous
    let nextProgress = 0
    for (const time of events) {
      if (canceled()) return false
      const frame = sample(time)
      const available = time >= (track.coverageStartMs || 0) && time <= track.durationMs
      const motion = frame.transient && !!(frame.state.mouse.dx || frame.state.mouse.dy || frame.state.mouse.wheel)
      const signature = !available ? 'empty' : frame.kind === 'pad'
        ? JSON.stringify([frame.key, frame.pad])
        : JSON.stringify([frame.key, frame.state.keys, frame.state.mouse.buttons, motion && frame.state.mouse])
      if (signature === previous) continue
      previous = signature
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      if (available) {
        const { renderer, rect } = maps.get(frame.key)
        const w = Math.round(rect.width * ratio), h = Math.round(rect.height * ratio)
        renderer.update(frame.state, frame.transient, frame.kind, frame.pad)
        const source = renderer.root instanceof HTMLCanvasElement ? renderer.root : await overlayImage(renderer.root, w, h)
        ctx.filter = `drop-shadow(0px ${2 * ratio}px ${4 * ratio}px rgba(0,0,0,.47))`
        ctx.drawImage(source, Math.round(rect.left * ratio) - x, Math.round(rect.top * ratio) - y, w, h)
        ctx.filter = 'none'
      }
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'))
      if (!blob) throw Error('No se pudo dibujar el mapa.')
      await ipcRenderer.invoke('inputs:export:frame', job, time, await blob.arrayBuffer())
      if (time >= nextProgress) {
        report(`Preparando mapa · ${Math.floor(time * 100 / duration)}%`)
        nextProgress = time + 500
      }
    }
    if (canceled()) return false
    report('Guardando video con inputs…')
    await ipcRenderer.invoke('inputs:export:finish', job)
    return true
  } finally {
    stage.remove()
    await ipcRenderer.invoke('inputs:export:cancel', job)
  }
}

module.exports = { exportInputs }
