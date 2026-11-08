const {DEFAULT_COLOR,textOn}=require('./colors')
const off = '#282f3e', ink = '#dce3f1'
function text(c, value, x, y, color = ink, size = 11) { c.fillStyle = color; c.font = `600 ${size}px system-ui`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(String(value), x, y) }
function key(c, label, x, y, w, pressed, on=DEFAULT_COLOR) {
  c.fillStyle = pressed ? on : off; c.beginPath(); c.roundRect(x, y, w, 27, 5); c.fill()
  text(c, label, x + w / 2, y + 14, pressed ? textOn(on) : ink)
}
function keyName(k) {
  if (k >= 48 && k <= 90) return String.fromCharCode(k)
  if (k >= 112 && k <= 135) return `F${k - 111}`
  if (k >= 96 && k <= 105) return `Num${k - 96}`
  if (k === 269) return 'NumEnter'
  return ({ 8:'⌫',9:'Tab',13:'Enter',16:'Shift',17:'Ctrl',18:'Alt',27:'Esc',32:'Space',37:'←',38:'↑',39:'→',40:'↓',160:'LShift',161:'RShift',162:'LCtrl',163:'RCtrl',164:'LAlt',165:'RAlt',91:'Win' })[k] || `K${k}`
}
function drawKeyboard(c, state, transient, on=DEFAULT_COLOR) {
  text(c, 'TECLADO + MOUSE', 91, 15, '#93a0b7', 9)
  const keys = new Set(state.keys), shown = new Set()
  const rows = [ [[9,'Tab',36],[81,'Q',29],[87,'W',29],[69,'E',29],[82,'R',29]], [[160,'Shift',36],[65,'A',29],[83,'S',29],[68,'D',29],[70,'F',29]], [[162,'Ctrl',36],[164,'Alt',29],[32,'Space',96]] ]
  rows.forEach((row, r) => { let x = 14; for (const [code,label,w] of row) { shown.add(code); key(c,label,x,30+r*32,w,keys.has(code),on); x+=w+4 } })
  const other = [...keys].filter(k => !shown.has(k)).map(keyName).join(' + ')
  text(c, other ? other.slice(0, 40) : ' ', 170, 151, on, 11)
  c.strokeStyle = '#71809a'; c.lineWidth = 1.5; c.beginPath(); c.roundRect(234,31,68,91,24); c.stroke()
  key(c,'L',238,39,27,state.mouse.buttons.includes(0),on); key(c,'R',271,39,27,state.mouse.buttons.includes(1),on)
  c.fillStyle=state.mouse.buttons.includes(2)?on:'#66738b'; c.fillRect(265,42,7,19)
  key(c,'M4',207,72,24,state.mouse.buttons.includes(3),on); key(c,'M5',207,103,24,state.mouse.buttons.includes(4),on)
  const dx=transient?state.mouse.dx:0,dy=transient?state.mouse.dy:0
  c.strokeStyle=on;c.lineWidth=2;c.beginPath();c.moveTo(268,84);c.lineTo(268+Math.max(-24,Math.min(24,dx/3)),84+Math.max(-17,Math.min(17,dy/3)));c.stroke()
  if(transient&&state.mouse.wheel)text(c,state.mouse.wheel>0?'SCROLL ↑':'SCROLL ↓',268,134,on,9)
}
function drawPad(c, pads, layout, on=DEFAULT_COLOR) {
  const p = pads[0]
  text(c, p ? `CONTROL ${p.id+1} · ${layout==='ps'?'PLAYSTATION':'XBOX'}` : 'CONTROL · SIN CONEXIÓN',170,15,'#93a0b7',9)
  const pad = p || {buttons:0,lt:0,rt:0,lx:0,ly:0,rx:0,ry:0}, bits=pad.buttons
  c.fillStyle='#202737';c.strokeStyle='#60708a';c.lineWidth=1;c.beginPath();c.moveTo(85,52);c.bezierCurveTo(40,47,22,148,58,151);c.lineTo(119,121);c.lineTo(221,121);c.lineTo(282,151);c.bezierCurveTo(318,148,300,47,255,52);c.closePath();c.fill();c.stroke()
  key(c,'LB',65,29,67,!!(bits&256),on); key(c,'RB',208,29,67,!!(bits&512),on)
  c.fillStyle=off;c.fillRect(66,23,65,3);c.fillRect(209,23,65,3);c.fillStyle=on;c.fillRect(66,23,65*pad.lt/255,3);c.fillRect(209,23,65*pad.rt/255,3)
  const circle=(x,y,r,pressed,label)=>{c.fillStyle=pressed?on:off;c.beginPath();c.arc(x,y,r,0,Math.PI*2);c.fill();if(label)text(c,label,x,y,pressed?textOn(on):ink,10)}
  const stick=(x,y,ax,ay,pressed)=>{circle(x,y,18,false);c.fillStyle=pressed?on:'#64738e';c.beginPath();c.arc(x+ax*10,y-ay*10,10,0,Math.PI*2);c.fill();c.strokeStyle='#71809a';c.beginPath();c.arc(x,y,18,0,Math.PI*2);c.stroke()}
  stick(87,82,pad.lx,pad.ly,!!(bits&64));stick(204,119,pad.rx,pad.ry,!!(bits&128))
  key(c,'↑',125,78,21,!!(bits&1),on);key(c,'←',102,106,21,!!(bits&4),on);key(c,'↓',125,106,21,!!(bits&2),on);key(c,'→',148,106,21,!!(bits&8),on)
  const labels=layout==='ps'?['×','○','□','△']:['A','B','X','Y']
  ;[[255,105,4096],[278,82,8192],[232,82,16384],[255,59,32768]].forEach(([x,y,b],i)=>circle(x,y,11,!!(bits&b),labels[i]))
  circle(152,65,8,!!(bits&32),'−');circle(181,65,8,!!(bits&16),'+')
  text(c,`${pads.length>1?`${pads.length} controles · mostrando el primero`:'Sticks · gatillos · botones'}`,170,163,'#93a0b7',9)
}

module.exports = { text, drawKeyboard, drawPad, keyName }
