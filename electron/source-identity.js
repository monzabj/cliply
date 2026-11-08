// Shared with the renderer. Numbered screen names and desktopCapturer IDs are
// presentation details: Windows can give them to another monitor after boot.
function sizeMatches(a, b) {
  return !a.width || !a.height || !b.width || !b.height || (a.width === b.width && a.height === b.height)
}
function sourceRef(source) {
  if (!source) return null
  const { id, name, type, displayId = null, width = null, height = null, devicePath = null, displayLabel = null } = source
  return { id, name, type, displayId, width, height, devicePath, displayLabel }
}
function matchSourceIdentity(sources, ref) {
  if (!ref) return null
  const candidates = sources.filter(s => s.type === ref.type)
  const unique = list => list.length === 1 ? list[0] : null
  if (ref.type !== 'screen') return unique(candidates.filter(s => s.id === ref.id)) || unique(candidates.filter(s => s.name === ref.name))
  if (ref.devicePath) {
    const hardware = unique(candidates.filter(s => s.devicePath?.toLowerCase() === ref.devicePath.toLowerCase()))
    if (hardware) return hardware
    // An identified but disconnected monitor must never become another screen.
    if (candidates.some(s => s.devicePath)) return null
  }
  const compatible = candidates.filter(s => sizeMatches(ref, s))
  if (ref.displayId) {
    const display = unique(compatible.filter(s => String(s.displayId) === String(ref.displayId)))
    if (display) return display
  }
  if (ref.width && ref.height) {
    const sized = compatible.filter(s => s.width === ref.width && s.height === ref.height)
    const label = ref.displayLabel && unique(sized.filter(s => s.displayLabel === ref.displayLabel))
    return label || unique(sized)
  }
  // No durable evidence: ask for a selection instead of trusting screen:N.
  return null
}
function samePhysicalSource(a, b) {
  if (!a || !b || a.type !== b.type) return false
  if (a.type !== 'screen') return a.id === b.id
  if (a.devicePath && b.devicePath) return a.devicePath.toLowerCase() === b.devicePath.toLowerCase()
  return sizeMatches(a, b) && Boolean(a.displayId && b.displayId && String(a.displayId) === String(b.displayId))
}
function pinHotkeys(settings) {
  return settings.hotkeys.map(h => {
    if (h.pinned === false) return h
    const source = settings.sessions.find(s => s.id === h.sessionId)?.source
    if (h.target?.type === 'screen') return { ...h, pinned: true }
    return source?.type === 'screen' ? { ...h, pinned: true, target: sourceRef(source) } : h
  })
}
function configureScreens(settings, chosen) {
  if (!chosen.length) return { sessions: settings.sessions, hotkeys: settings.hotkeys }
  const usedIds = new Set(settings.sessions.map(s => s.id))
  const sessions = chosen.map((source, index) => {
    const existing = settings.sessions.find(s => matchSourceIdentity(chosen, s.source)?.id === source.id)
      || (index === 0 ? settings.sessions.find(s => !s.source) : null)
    let id = existing?.id || `screen-${index}`
    if (!existing) { while (usedIds.has(id)) id += '-new'; usedIds.add(id) }
    return { ...existing, id, name: existing?.name || source.name, source: sourceRef(source), autoArm: true }
  })
  // Unselected pins remain available to their key, without automatically
  // recording a screen the user just unticked in the setup dialog.
  for (const old of settings.sessions) {
    if (!sessions.some(s => s.id === old.id) && settings.hotkeys.some(h => h.pinned && h.sessionId === old.id)) {
      sessions.push({ ...old, autoArm: false })
    }
  }
  const hotkeys = settings.hotkeys.map(h => ({ ...h }))
  const used = new Set(hotkeys.map(h => h.accelerator))
  for (const session of sessions.filter(s => s.autoArm)) {
    if (hotkeys.some(h => h.action === 'clip' && (h.sessionId === session.id || matchSourceIdentity([session.source], h.target)))) continue
    const accelerator = ['F8', 'F9', 'F6', 'F4', 'F2', 'F3'].find(key => !used.has(key))
    if (!accelerator) continue
    used.add(accelerator)
    hotkeys.push({ id: `hk-${session.id}`, accelerator, action: 'clip', durationSec: 30, sessionId: session.id, pinned: true, target: session.source })
  }
  return { sessions, hotkeys: pinHotkeys({ sessions, hotkeys }) }
}
module.exports = { sizeMatches, sourceRef, matchSourceIdentity, samePhysicalSource, pinHotkeys, configureScreens }
