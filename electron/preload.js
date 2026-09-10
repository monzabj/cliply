const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('clipper', {
  platform: process.platform,
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  on: (channel, cb) => {
    const handler = (_event, ...args) => cb(...args)
    ipcRenderer.on(channel, handler)
    return () => ipcRenderer.removeListener(channel, handler)
  },
})
