// Runs in the isolated preload world. Keeping the desktop-only controls here
// lets browser previews use the existing UI without global input privileges.
const { ipcRenderer } = require('electron')
const { attachPlayer } = require('./overlay-player')
window.addEventListener('DOMContentLoaded', () => setTimeout(mount, 800), { once: true })
function mount() {
  const style = document.createElement('style')
  style.textContent = `
    .ci-settings{position:fixed;bottom:14px;left:14px;z-index:45;font:12px system-ui}
    .ci-button,.ci-controls select{font:12px system-ui;color:#e8eaf0;background:#23252d;border:1px solid #424550;border-radius:7px;padding:6px 10px;cursor:pointer}
    .ci-button:hover{background:#313440}.ci-button:focus-visible,.ci-controls select:focus-visible{outline:2px solid #9df3ba;outline-offset:2px}
    .ci-button[aria-pressed=true]{color:#a2f3be;border-color:#70ba89}.ci-button:disabled{opacity:.5;cursor:default}
    .ci-panel{position:absolute;bottom:40px;left:0;width:320px;padding:18px;background:#1a1c23;color:#eef0f5;border:1px solid #424550;border-radius:12px;box-shadow:0 8px 32px #0009;line-height:1.5}
    .ci-panel p{font-size:12px;color:#acb2c3;margin:8px 0 14px}.ci-panel label{display:flex;gap:10px;align-items:center;font-size:13px;font-weight:600}.ci-panel input{accent-color:#95eeb0}.ci-status{font-size:11px;color:#9da8ba;margin-top:12px}
    .ci-controls{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:7px 12px;background:#14161c;border-bottom:1px solid #30333c;font:12px system-ui;color:#b2b7c6}
    .ci-overlay{position:absolute;z-index:12;pointer-events:none;filter:drop-shadow(0 2px 4px #0007);touch-action:none}
    .ci-overlay[hidden],.ci-surface[hidden]{display:none}.ci-surface,.ci-surface>svg,.ci-canvas{width:100%;height:100%;display:block}
    .ci-overlay.ci-editing{pointer-events:auto;cursor:move;outline:2px dashed #9af1b8;outline-offset:0;border-radius:8px;background:#15253455}
    .ci-resize{display:none;position:absolute;right:0;bottom:0;width:24px;height:24px;cursor:nwse-resize;background:linear-gradient(135deg,transparent 45%,#9af1b8 46%,#9af1b8 55%,#16291c 56%);border-radius:3px}
    .ci-editing .ci-resize{display:block}.ci-scale{display:flex;align-items:center;gap:6px}.ci-scale input{width:85px;accent-color:#9af1b8}.ci-scale output{min-width:32px;font-variant-numeric:tabular-nums}
    .ci-color{display:flex;align-items:center;gap:6px}.ci-color input{width:30px;height:27px;padding:2px;border:1px solid #424550;border-radius:6px;background:#23252d;cursor:pointer}.ci-reset-color{padding:4px 7px}
    .ci-message{font-size:11px}.ci-missing:after{content:attr(data-message);position:absolute;inset:0;display:grid;place-items:center;color:#dce3f1;background:#101723df;border-radius:12px;font:12px system-ui}
  `
  document.head.append(style)
  const settings = document.createElement('div')
  settings.className = 'ci-settings'
  settings.innerHTML = `<button class="ci-button" type="button" aria-expanded="false">Inputs · desactivados</button>
    <div class="ci-panel" hidden><strong>Inputs en tus clips</strong><p>Guarda teclado, mouse y control en un archivo separado del video. El mapa empieza oculto en cada reproducción.</p>
    <label><input type="checkbox"> Grabar inputs en nuevos clips</label>
    <p>Captura global mientras Clipper esté grabando, incluso en la bandeja. Se guardan botones y movimientos, sin convertir las teclas a texto. Desactivalo cuando no lo necesites.</p>
    <p>Control: Xbox / XInput y lectura nativa DualSense. El modo de conexión puede limitar los botones especiales.</p>
    <div class="ci-status" role="status"></div></div>`
  document.body.append(settings)
  const pill = settings.querySelector('button'), panel = settings.querySelector('.ci-panel'), checkbox = settings.querySelector('input'), statusText = settings.querySelector('.ci-status')
  pill.onclick = () => { panel.hidden = !panel.hidden; pill.setAttribute('aria-expanded', String(!panel.hidden)); if (!panel.hidden) refresh() }
  document.addEventListener('pointerdown', e => { if (!settings.contains(e.target)) { panel.hidden = true; pill.setAttribute('aria-expanded', 'false') } })
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !panel.hidden) { panel.hidden = true; pill.setAttribute('aria-expanded', 'false'); pill.focus(); e.stopPropagation() } }, true)
  function paintStatus(s) {
    checkbox.checked = s.enabled; checkbox.disabled = !s.supported
    pill.textContent = s.error ? 'Inputs · error' : s.recording ? 'Inputs · grabando' : s.enabled ? 'Inputs · en espera' : 'Inputs · desactivados'
    pill.setAttribute('aria-pressed', String(s.enabled))
    statusText.textContent = s.error || (s.recording ? 'Capturando inputs. Se guardarán cuando hagas un clip.' : s.enabled ? 'Esperando una sesión de grabación activa.' : 'Captura desactivada. Los clips anteriores conservan su pista.')
  }
  async function refresh() { try { paintStatus(await ipcRenderer.invoke('inputs:status')) } catch {} }
  checkbox.onchange = async () => {
    checkbox.disabled = true
    try { paintStatus(await ipcRenderer.invoke('inputs:enable', checkbox.checked)) }
    catch (err) { statusText.textContent = `No se pudo cambiar la captura: ${err.message}` }
    finally { checkbox.disabled = false }
  }
  refresh()
  const players = new Map()
  setInterval(() => {
    if (!document.hidden) refresh()
    for (const [video, player] of players) if (!video.isConnected) { player.destroy(); players.delete(video) }
    for (const video of document.querySelectorAll('.clip-stage-video video')) {
      if (!players.has(video)) players.set(video, attachPlayer(video))
      players.get(video).checkSource()
    }
  }, 600)
}
