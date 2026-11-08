const clamp = (n, low, high) => Math.max(low, Math.min(high, n))
const DEFAULTS = { mode: 'auto', skin: 'basic', keyboard: 'compact', preset: 'left', x: 0, y: 1, scale: 45, controller: 'auto' }
function preferences(value = {}) {
  const pick = (key, choices) => choices.includes(value[key]) ? value[key] : DEFAULTS[key]
  const number = (key, min, max) => Number.isFinite(value[key]) ? clamp(value[key], min, max) : DEFAULTS[key]
  return { mode: pick('mode', ['auto', 'kbm', 'pad']), skin: pick('skin', ['basic', 'xbox', 'ps']),
    keyboard: pick('keyboard', ['compact', 'full']), preset: pick('preset', ['left', 'right', 'free']),
    x: number('x', 0, 1), y: number('y', 0, 1), scale: number('scale', 20, 100),
    controller: value.controller === 'auto' || /^\d+$/.test(String(value.controller)) ? String(value.controller) : 'auto' }
}
function overlayRect(picture, ratio, prefs) {
  const margin = Math.min(12, picture.width * .015)
  const width = Math.max(0, Math.min(picture.width * prefs.scale / 100, picture.width - margin * 2, (picture.height - margin * 2) * ratio))
  const height = width / ratio
  const travelX = Math.max(0, picture.width - width - margin * 2), travelY = Math.max(0, picture.height - height - margin * 2)
  const x = prefs.preset === 'left' ? 0 : prefs.preset === 'right' ? 1 : prefs.x
  const y = prefs.preset === 'free' ? prefs.y : 1
  return { left: picture.left + margin + x * travelX, top: picture.top + margin + y * travelY, width, height, margin, travelX, travelY }
}
function dragPosition(rect, dx, dy, startX, startY) {
  return { preset: 'free', x: rect.travelX ? clamp(startX + dx / rect.travelX, 0, 1) : 0, y: rect.travelY ? clamp(startY + dy / rect.travelY, 0, 1) : 0 }
}
module.exports = { preferences, overlayRect, dragPosition, clamp, DEFAULTS }
