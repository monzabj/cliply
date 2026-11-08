const listeners = new Map<string, Set<() => void>>()

export function registerMediaRelease(id: string, listener: () => void) {
  if (!listeners.has(id)) listeners.set(id, new Set())
  listeners.get(id)!.add(listener)
  return () => {
    listeners.get(id)?.delete(listener)
    if (!listeners.get(id)?.size) listeners.delete(id)
  }
}

export function releaseClipMedia(id: string) {
  for (const listener of listeners.get(id) ?? []) listener()
}

export function unloadMedia(media: HTMLMediaElement | null) {
  if (!media) return
  media.pause()
  media.removeAttribute('src')
  media.load()
}
