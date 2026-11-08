const fs = require('node:fs')
const path = require('node:path')
const NS = 'http://www.w3.org/2000/svg'
const GREEN = '#8cf5b5'
const cache = new Map()
function element(name, attrs = {}, text) {
  const node = document.createElementNS(NS, name)
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value))
  if (text !== undefined) node.textContent = text
  return node
}
const skins = {
  ps: {
    asset: 'dualsense.svg',
    buttons: [[4096,'path1875'],[8192,'path1879'],[16384,'path1871'],[32768,'path1867'],[256,'path40949-1'],[512,'path34635-4'],
      [32,'path58460'],[16,'path58460-3'],[1,'path1887'],[4,'path1889'],[2,'path1883'],[8,'path1885']],
    sticks: ['g5800','g5696'], triggers: ['path1863-4','path1865-5'],
    extras: { guide: 'path1961', mute: 'path76576' },
  },
  xbox: {
    asset: 'xbox.svg',
    buttons: [[4096,'path34469'],[8192,'path34661'],[16384,'path34765'],[32768,'path34870'],[32,'path29787'],[16,'path29913']],
    sticks: ['g95973','g4173'], triggers: ['path25529','path27128'],
    extras: { guide: 'path23416-7', share: 'rect94547' },
  },
}
let nextId = 0
function createControllerSkin(kind) {
  const config = skins[kind], prefix = `ci-${++nextId}-`
  if (!cache.has(kind)) cache.set(kind, fs.readFileSync(path.join(__dirname, 'assets', config.asset), 'utf8'))
  const root = element('svg', { viewBox: '0 0 720 500', width: '100%', height: '100%', 'aria-hidden': true, 'data-skin': kind })
  const defs = element('defs'); root.append(defs)
  const parsed = new DOMParser().parseFromString(cache.get(kind), 'image/svg+xml').documentElement
  const art = document.importNode(parsed, true)
  art.setAttribute('x', '8'); art.setAttribute('y', '88'); art.setAttribute('width', '704'); art.setAttribute('height', '395')
  root.append(art)
  const lookup = id => art.querySelector(`[id="${id}"]`)
  const highlights = config.buttons.map(([mask,id]) => ({mask,node:lookup(id),fill:lookup(id)?.style.fill}))
  const special = Object.entries(config.extras).map(([name,id]) => ({name,node:lookup(id),fill:lookup(id)?.style.fill}))
  function clonedHighlight(id, mask, points) {
    const source = lookup(id)
    if (!source) return
    const clipId = `${prefix}clip-${mask}`
    const clip = element('clipPath', {id:clipId,clipPathUnits:'objectBoundingBox'})
    clip.append(element('polygon', {points})); defs.append(clip)
    const clone = source.cloneNode(true)
    clone.removeAttribute('id'); clone.querySelectorAll('[id]').forEach(n=>n.removeAttribute('id'))
    clone.setAttribute('clip-path',`url(#${clipId})`)
    clone.style.pointerEvents = 'none'
    for (const n of [clone,...clone.querySelectorAll('path,ellipse,circle,rect')]) { n.style.fill = GREEN; n.style.stroke = 'none' }
    source.after(clone); highlights.push({mask,node:clone,overlay:true})
  }
  if (kind === 'xbox') {
    clonedHighlight('rect35488',256,'0,0 .5,0 .5,1 0,1')
    clonedHighlight('rect35488',512,'.5,0 1,0 1,1 .5,1')
    for (const [mask,points] of [[1,'.5,.5 0,0 1,0'],[2,'.5,.5 0,1 1,1'],[4,'.5,.5 0,0 0,1'],[8,'.5,.5 1,0 1,1']]) clonedHighlight('g26670',mask,points)
  }
  // The source graphic paints its touch surface as part of the white shell.
  // A translucent inset makes a recorded touchpad click visible independently.
  let touch
  if (kind === 'ps') {
    touch = element('path',{d:'M165 61 H379 Q392 63 387 80 L374 153 Q371 170 355 170 H188 Q173 169 170 153 L156 80 Q153 64 165 61 Z',fill:GREEN,opacity:0})
    art.append(touch)
  }
  const sticks = config.sticks.map((id,index) => {
    const node = lookup(id), wrapper = element('g', {'data-stick':index?'right':'left'})
    node.before(wrapper); wrapper.append(node)
    return { node,wrapper,mask:index?128:64 }
  })
  const meters = config.triggers.map((id,index) => {
    const gradient = element('linearGradient',{id:`${prefix}trigger-${index}`,x1:0,y1:1,x2:0,y2:0})
    const a=element('stop',{'stop-color':GREEN,offset:'0%'}), b=element('stop',{'stop-color':'#171b20',offset:'0%'})
    gradient.append(element('stop',{'stop-color':GREEN,offset:'0%'}),a,b,element('stop',{'stop-color':'#171b20',offset:'100%'}));defs.append(gradient)
    const node = lookup(id); node.style.fill=`url(#${prefix}trigger-${index})`
    const x=index?402:34, group=element('g',{'data-trigger':index?'rt':'lt'})
    group.append(element('rect',{x,y:8,width:284,height:66,rx:16,fill:'#0e1520',stroke:'#657589','stroke-width':1.5}))
    const label=element('text',{x:x+16,y:32,fill:'#c3cddd','font-family':'system-ui','font-size':18,'font-weight':700},kind==='ps'?(index?'R2':'L2'):(index?'RT':'LT'))
    const percentage=element('text',{x:x+265,y:34,fill:GREEN,'text-anchor':'end','font-family':'system-ui','font-size':24,'font-weight':750},'0%')
    const bar=element('rect',{x:x+16,y:49,width:0,height:11,rx:5,fill:GREEN})
    group.append(label,percentage,element('rect',{x:x+16,y:49,width:252,height:11,rx:5,fill:'#2b3746'}),bar);root.append(group)
    return {a,b,bar,percentage}
  })
  const status=element('text',{x:360,y:496,fill:'#bec9dc','text-anchor':'middle','font-family':'system-ui','font-size':12},'')
  root.append(status)
  function update(pad) {
    const bits=pad?.buttons||0, extra=pad?.extra||{}
    for (const h of highlights) {
      if (!h.node) continue
      const pressed=!!(bits&h.mask)
      if(h.overlay)h.node.style.display=pressed?'':'none'
      else h.node.style.fill=pressed?GREEN:h.fill
      h.node.setAttribute('data-pressed',String(pressed))
    }
    for(const s of special) if(s.node){s.node.style.fill=extra[s.name]?GREEN:s.fill;s.node.setAttribute('data-pressed',String(extra[s.name]===true))}
    if(touch)touch.setAttribute('opacity',extra.touchpad ? .55 : 0)
    for (let index=0;index<2;index++) {
      const value=Math.max(0,Math.min(255,Number(pad?.[index?'rt':'lt'])||0))/255, percent=Math.round(value*100),m=meters[index]
      m.a.setAttribute('offset',`${percent}%`);m.b.setAttribute('offset',`${percent}%`)
      m.bar.setAttribute('width',String(252*value));m.percentage.textContent=`${percent}%`
      root.querySelector(`[data-trigger="${index?'rt':'lt'}"]`).setAttribute('data-value',String(percent))
      const stick=sticks[index], ax=pad?.[index?'rx':'lx']||0, ay=pad?.[index?'ry':'ly']||0
      const matrix=stick.wrapper.parentNode.getScreenCTM()
      if(matrix){const inverse=matrix.inverse(),zero=new DOMPoint(0,0).matrixTransform(inverse),point=new DOMPoint(ax*root.clientWidth*.024,-ay*root.clientWidth*.024).matrixTransform(inverse);stick.wrapper.setAttribute('transform',`translate(${point.x-zero.x} ${point.y-zero.y})`)}
      stick.node.style.filter=bits&stick.mask?'drop-shadow(0 0 5px #8cf5b5)':''
      stick.wrapper.setAttribute('data-pressed',String(!!(bits&stick.mask)))
    }
    const unknown=kind==='ps'?[['guide','PS'],['touchpad','touchpad'],['mute','silencio']].filter(([key])=>extra[key]==null).map(([,label])=>label):[['guide','Guía'],['share','Compartir']].filter(([key])=>extra[key]==null).map(([,label])=>label)
    status.textContent=!pad?'Sin control conectado':unknown.length?`${unknown.join(' / ')}: sin datos en esta pista`:`Control ${Number(pad.id)+1} · botones, sticks y gatillos`
  }
  return { root,ratio:720/500,update }
}
module.exports={createControllerSkin}
