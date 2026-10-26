// Runs in the isolated preload world. Keeping the desktop-only controls here
// lets browser previews use the existing UI without global input privileges.
const { ipcRenderer } = require('electron')
const { neutral } = require('./timeline')
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
    .ci-canvas{position:absolute;pointer-events:none;z-index:12;max-width:50%;height:auto;filter:drop-shadow(0 2px 4px #0007)}
  `
  document.head.append(style)
  const settings = document.createElement('div')
  settings.className = 'ci-settings'
  settings.innerHTML = `<button class="ci-button" type="button" aria-expanded="false">Inputs · desactivados</button>
    <div class="ci-panel" hidden><strong>Inputs en tus clips</strong><p>Guarda teclado, mouse y control en un archivo separado del video. El mapa empieza oculto en cada reproducción.</p>
    <label><input type="checkbox"> Grabar inputs en nuevos clips</label>
    <p>Captura global mientras Clipper esté grabando, incluso en la bandeja. Se guardan botones y movimientos, sin convertir las teclas a texto. Desactivalo cuando no lo necesites.</p>
    <p>Control: Xbox y mandos compatibles con XInput (PlayStation mediante DS4Windows o Steam Input).</p>
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
function frameAt(frames, time) {
  let lo = 0, hi = frames.length - 1, best = -1
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (frames[mid].t <= time) { best = mid; lo = mid + 1 } else hi = mid - 1 }
  return best < 0 ? null : frames[best]
}
function attachPlayer(video) {
  const stage = video.closest('.clip-stage'), host = video.parentElement
  const bar = document.createElement('div'); bar.className = 'ci-controls'
  bar.innerHTML = `<button type="button" class="ci-button" aria-pressed="false" disabled>Mostrar inputs</button>
    <select aria-label="Tipo de mapa"><option value="auto">Automático</option><option value="kbm">Teclado y mouse</option><option value="pad">Control</option></select>
    <select aria-label="Estilo de control"><option value="xbox">Xbox</option><option value="ps">PlayStation</option></select>
    <select aria-label="Posición del mapa"><option value="left">Abajo izquierda</option><option value="right">Abajo derecha</option></select>
    <span role="status">Cargando inputs…</span>`
  const canvas = document.createElement('canvas'); canvas.className = 'ci-canvas'; canvas.width = 680; canvas.height = 352; canvas.style.width = '340px'; canvas.hidden = true
  stage.prepend(bar); host.append(canvas)
  const button = bar.querySelector('button'), [mode, layout, position] = bar.querySelectorAll('select'), message = bar.querySelector('span')
  const ctx = canvas.getContext('2d'); ctx.scale(2, 2)
  let src = '', track = null, visible = false, request = 0, raf = 0, destroyed = false
  let activeKind = 'kbm', previous = null, kindChanges = []
  const setVisible = value => { visible = value; canvas.hidden = !value; button.textContent = value ? 'Ocultar inputs' : 'Mostrar inputs'; button.setAttribute('aria-pressed', String(value)); if (value) draw() }
  button.onclick = () => setVisible(!visible)
  async function checkSource() {
    const next = video.currentSrc || video.src
    if (next === src) return
    src = next; track = null; setVisible(false); button.disabled = true; message.textContent = 'Cargando inputs…'
    const token = ++request
    try {
      const url = new URL(next)
      if (url.protocol !== 'clip:' || url.host !== 'local') { message.textContent = 'Sin pista de inputs'; return }
      const loaded = await ipcRenderer.invoke('inputs:read', decodeURIComponent(url.pathname.slice(1)))
      if (destroyed || token !== request) return
      track = loaded; button.disabled = !track
      kindChanges = []; previous = neutral(); activeKind = 'kbm'
      if (track) for (const f of track.frames) {
        const a = f.state, b = previous
        const kbm = JSON.stringify(a.keys) !== JSON.stringify(b.keys) || JSON.stringify(a.mouse.buttons) !== JSON.stringify(b.mouse.buttons) || a.mouse.dx || a.mouse.dy || a.mouse.wheel
        const pad = JSON.stringify(a.pads) !== JSON.stringify(b.pads) && a.pads.some(p => p.buttons || p.lt || p.rt || p.lx || p.ly || p.rx || p.ry)
        if (pad || kbm) kindChanges.push({ t: f.t, kind: pad ? 'pad' : 'kbm' })
        previous = a
      }
      message.textContent = track ? 'Pista disponible · oculta por defecto' : 'Este clip no tiene inputs grabados'
    } catch { if (token === request) message.textContent = 'No se pudo cargar la pista de inputs' }
  }
  function draw() {
    if (!visible || !track || destroyed) return
    const time = video.currentTime * 1000, f = frameAt(track.frames, time), state = f?.state || neutral()
    const change = frameAt(kindChanges, time)
    activeKind = change?.kind || (state.pads.length ? 'pad' : 'kbm')
    ctx.clearRect(0, 0, 340, 176)
    ctx.fillStyle = 'rgba(12,15,23,.88)'; ctx.beginPath(); ctx.roundRect(0, 0, 340, 176, 14); ctx.fill()
    ctx.strokeStyle = '#68758b66'; ctx.stroke()
    const kind = mode.value === 'auto' ? activeKind : mode.value
    if (time > track.durationMs || (track.coverageStartMs && time < track.coverageStartMs)) {
      text(ctx, 'Sin inputs en este tramo', 170, 90, '#b5bece', 13)
    } else if (kind === 'pad') drawPad(ctx, state.pads, layout.value)
    else drawKeyboard(ctx, state, f && time - f.t < 100)
    // Follow the picture itself when object-contain adds black bars.
    const rect = video.getBoundingClientRect(), outer = host.getBoundingClientRect()
    const ratio = video.videoWidth && video.videoHeight ? video.videoWidth / video.videoHeight : rect.width / rect.height
    const width = Math.min(rect.width, rect.height * ratio), height = width / ratio
    const left = rect.left - outer.left + (rect.width - width) / 2
    const bottom = outer.bottom - rect.top - (rect.height + height) / 2
    canvas.style.width = `${Math.min(340, width * .48)}px`
    canvas.style.bottom = `${Math.max(8, bottom + 12)}px`
    canvas.style.left = position.value === 'left' ? `${left + 12}px` : 'auto'
    canvas.style.right = position.value === 'right' ? `${outer.width - left - width + 12}px` : 'auto'
  }
  function tick() { if (destroyed) return; draw(); raf = requestAnimationFrame(tick) }
  mode.onchange = layout.onchange = position.onchange = draw
  tick(); checkSource()
  return { checkSource, destroy() { destroyed = true; ++request; cancelAnimationFrame(raf); bar.remove(); canvas.remove() } }
}
const on = '#9af1b8', off = '#282f3e', ink = '#dce3f1'
function text(c, value, x, y, color = ink, size = 11) { c.fillStyle = color; c.font = `600 ${size}px system-ui`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(String(value), x, y) }
function key(c, label, x, y, w, pressed) {
  c.fillStyle = pressed ? on : off; c.beginPath(); c.roundRect(x, y, w, 27, 5); c.fill()
  text(c, label, x + w / 2, y + 14, pressed ? '#10241a' : ink)
}
function keyName(k) {
  if (k >= 48 && k <= 90) return String.fromCharCode(k)
  if (k >= 112 && k <= 135) return `F${k - 111}`
  return ({ 8:'⌫',9:'Tab',13:'Enter',16:'Shift',17:'Ctrl',18:'Alt',27:'Esc',32:'Space',37:'←',38:'↑',39:'→',40:'↓',160:'LShift',161:'RShift',162:'LCtrl',163:'RCtrl',164:'LAlt',165:'RAlt',91:'Win' })[k] || `K${k}`
}
function drawKeyboard(c, state, transient) {
  text(c, 'TECLADO + MOUSE', 91, 15, '#93a0b7', 9)
  const keys = new Set(state.keys), shown = new Set()
  const rows = [ [[9,'Tab',36],[81,'Q',29],[87,'W',29],[69,'E',29],[82,'R',29]], [[160,'Shift',36],[65,'A',29],[83,'S',29],[68,'D',29],[70,'F',29]], [[162,'Ctrl',36],[164,'Alt',29],[32,'Space',96]] ]
  rows.forEach((row, r) => { let x = 14; for (const [code,label,w] of row) { shown.add(code); key(c,label,x,30+r*32,w,keys.has(code)); x+=w+4 } })
  const other = [...keys].filter(k => !shown.has(k)).map(keyName).join(' + ')
  text(c, other ? other.slice(0, 40) : ' ', 170, 151, on, 11)
  c.strokeStyle = '#71809a'; c.lineWidth = 1.5; c.beginPath(); c.roundRect(234,31,68,91,24); c.stroke()
  key(c,'L',238,39,27,state.mouse.buttons.includes(0)); key(c,'R',271,39,27,state.mouse.buttons.includes(1))
  c.fillStyle=state.mouse.buttons.includes(2)?on:'#66738b'; c.fillRect(265,42,7,19)
  if(state.mouse.buttons.includes(3)||state.mouse.buttons.includes(4)) text(c,state.mouse.buttons.includes(3)?'M4':'M5',266,103,on)
  const dx=transient?state.mouse.dx:0,dy=transient?state.mouse.dy:0
  c.strokeStyle=on;c.lineWidth=2;c.beginPath();c.moveTo(268,84);c.lineTo(268+Math.max(-24,Math.min(24,dx/3)),84+Math.max(-17,Math.min(17,dy/3)));c.stroke()
  if(transient&&state.mouse.wheel)text(c,state.mouse.wheel>0?'SCROLL ↑':'SCROLL ↓',268,134,on,9)
}
function drawPad(c, pads, layout) {
  const p = pads[0]
  text(c, p ? `CONTROL ${p.id+1} · ${layout==='ps'?'PLAYSTATION':'XBOX'}` : 'CONTROL · SIN CONEXIÓN',170,15,'#93a0b7',9)
  const pad = p || {buttons:0,lt:0,rt:0,lx:0,ly:0,rx:0,ry:0}, bits=pad.buttons
  c.fillStyle='#202737';c.strokeStyle='#60708a';c.lineWidth=1;c.beginPath();c.moveTo(85,52);c.bezierCurveTo(40,47,22,148,58,151);c.lineTo(119,121);c.lineTo(221,121);c.lineTo(282,151);c.bezierCurveTo(318,148,300,47,255,52);c.closePath();c.fill();c.stroke()
  key(c,'LB',65,29,67,!!(bits&256)); key(c,'RB',208,29,67,!!(bits&512))
  c.fillStyle=off;c.fillRect(66,23,65,3);c.fillRect(209,23,65,3);c.fillStyle=on;c.fillRect(66,23,65*pad.lt/255,3);c.fillRect(209,23,65*pad.rt/255,3)
  const circle=(x,y,r,pressed,label)=>{c.fillStyle=pressed?on:off;c.beginPath();c.arc(x,y,r,0,Math.PI*2);c.fill();if(label)text(c,label,x,y,pressed?'#10241a':ink,10)}
  const stick=(x,y,ax,ay,pressed)=>{circle(x,y,18,false);c.fillStyle=pressed?on:'#64738e';c.beginPath();c.arc(x+ax*10,y-ay*10,10,0,Math.PI*2);c.fill();c.strokeStyle='#71809a';c.beginPath();c.arc(x,y,18,0,Math.PI*2);c.stroke()}
  stick(87,82,pad.lx,pad.ly,!!(bits&64));stick(204,119,pad.rx,pad.ry,!!(bits&128))
  key(c,'↑',125,78,21,!!(bits&1));key(c,'←',102,106,21,!!(bits&4));key(c,'↓',125,106,21,!!(bits&2));key(c,'→',148,106,21,!!(bits&8))
  const labels=layout==='ps'?['×','○','□','△']:['A','B','X','Y']
  ;[[255,105,4096],[278,82,8192],[232,82,16384],[255,59,32768]].forEach(([x,y,b],i)=>circle(x,y,11,!!(bits&b),labels[i]))
  circle(152,65,8,!!(bits&32),'−');circle(181,65,8,!!(bits&16),'+')
  text(c,`${pads.length>1?`${pads.length} controles · mostrando el primero`:'Sticks · gatillos · botones'}`,170,163,'#93a0b7',9)
}
