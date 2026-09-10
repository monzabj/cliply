// Waits for the Next.js dev server, then launches Electron pointed at it.
// Cross-platform replacement for `ELECTRON_RENDERER_URL=... electron .`.
const { spawn } = require('node:child_process')
const waitOn = require('wait-on')
const electron = require('electron')

const url = process.env.ELECTRON_RENDERER_URL || 'http://localhost:3000'

waitOn({ resources: [url], timeout: 60_000 })
  .then(() => {
    const child = spawn(electron, ['.'], {
      stdio: 'inherit',
      env: { ...process.env, ELECTRON_RENDERER_URL: url },
    })
    child.on('exit', (code) => process.exit(code ?? 0))
  })
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
