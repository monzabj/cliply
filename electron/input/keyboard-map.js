// Physical Windows key positions, independent of the text/layout selected in Windows.
const {DEFAULT_COLOR,normalizeColor,textOn}=require('./colors')
const {keyName}=require('./basic-renderer')
const NS = 'http://www.w3.org/2000/svg'
function el(name, attrs = {}, text) {
  const n = document.createElementNS(NS, name)
  for (const [k,v] of Object.entries(attrs)) n.setAttribute(k, String(v))
  if (text !== undefined) n.textContent = text
  return n
}
function createKeyboardMap(layout='full', highlight=DEFAULT_COLOR) {
  const color=normalizeColor(highlight)
  const config=layout==='sixty'?{width:940,height:306,mouseX:744,mouseY:32,title:'TECLADO 60%'}:
    layout==='gaming'?{width:620,height:310,mouseX:424,mouseY:44,title:'COMPACTO AMPLIADO'}:
    {width:1280,height:350,mouseX:1080,mouseY:56,title:'TECLADO COMPLETO'}
  const {width,height,mouseX,mouseY}=config
  const root = el('svg',{viewBox:`0 0 ${width} ${height}`,width:'100%',height:'100%','aria-hidden':true,'data-keyboard':layout})
  root.append(el('rect',{width,height,rx:20,fill:'#101723','fill-opacity':.94,stroke:'#607087'}))
  root.append(el('text',{x:22,y:24,fill:'#acb9cc','font-family':'system-ui','font-size':14,'font-weight':650},`${config.title} + MOUSE`))
  const keys=[]
  function key(code,label,x,y,w=42,h=39) {
    const g=el('g',{'data-key':code}), box=el('rect',{x,y,width:w,height:h,rx:5,fill:'#293345',stroke:'#61718b','stroke-width':.6})
    const labelNode=el('text',{x:x+w/2,y:y+h/2+1,'text-anchor':'middle','dominant-baseline':'middle',fill:'#e2eaf6','font-family':'system-ui','font-size':label.length>5?10:12},label)
    g.append(box,labelNode);root.append(g);keys.push({code,box,label:labelNode,g})
  }
  function row(items,y) {let x=18;for(const [code,label,units=1] of items){const w=units*46-4;key(code,label,x,y,w);x+=units*46}}
  if(layout==='gaming') {
    row([[27,'Esc'],...[49,50,51,52,53,54].map(c=>[c,String.fromCharCode(c)])],42)
    row([[9,'Tab',1.5],...[81,87,69,82,84,89].map(c=>[c,String.fromCharCode(c)])],86)
    row([[20,'Caps',1.5],...[65,83,68,70,71,72].map(c=>[c,String.fromCharCode(c)])],130)
    row([[160,'Shift',1.5],...[90,88,67,86,66,78].map(c=>[c,String.fromCharCode(c)])],174)
    row([[162,'Ctrl',1.5],[91,'Win'],[164,'Alt',1.25],[32,'Space',3.75]],218)
  } else {
    const shift=layout==='sixty'?-44:0
    if(layout==='full')row([[27,'Esc'],[112,'F1'],[113,'F2'],[114,'F3'],[115,'F4'],[116,'F5'],[117,'F6'],[118,'F7'],[119,'F8'],[120,'F9'],[121,'F10'],[122,'F11'],[123,'F12']],42)
    row([[layout==='sixty'?27:192,layout==='sixty'?'Esc':'`'],...[49,50,51,52,53,54,55,56,57,48].map(c=>[c,String.fromCharCode(c)]),[189,'−'],[187,'='],[8,'⌫',2]],86+shift)
    row([[9,'Tab',1.5],...[81,87,69,82,84,89,85,73,79,80].map(c=>[c,String.fromCharCode(c)]),[219,'['],[221,']'],[220,'\\',1.5]],130+shift)
    row([[20,'Caps',1.75],...[65,83,68,70,71,72,74,75,76].map(c=>[c,String.fromCharCode(c)]),[186,';'],[222,"'"],[13,'Enter',2.25]],174+shift)
    row([[160,'Shift',2.25],...[90,88,67,86,66,78,77].map(c=>[c,String.fromCharCode(c)]),[188,','],[190,'.'],[191,'/'],[161,'Shift',2.75]],218+shift)
    row([[162,'Ctrl',1.25],[91,'Win',1.25],[164,'Alt',1.25],[32,'Space',6.25],[165,'Alt',1.25],[92,'Win',1.25],[93,'Menu',1.25],[163,'Ctrl',1.25]],262+shift)
  }
  if(layout==='full') {
  const nav=[[44,'PrtSc',0,0],[145,'Scroll',1,0],[19,'Pause',2,0],[45,'Ins',0,1],[36,'Home',1,1],[33,'PgUp',2,1],[46,'Del',0,2],[35,'End',1,2],[34,'PgDn',2,2],[38,'↑',1,4],[37,'←',0,5],[40,'↓',1,5],[39,'→',2,5]]
  for(const [c,l,x,y] of nav)key(c,l,724+x*46,42+y*44)
  const num=[[144,'Num',0,0],[111,'/',1,0],[106,'×',2,0],[109,'−',3,0],[103,'7',0,1],[104,'8',1,1],[105,'9',2,1],[107,'+',3,1,1,2],[100,'4',0,2],[101,'5',1,2],[102,'6',2,2],[97,'1',0,3],[98,'2',1,3],[99,'3',2,3],[269,'Enter',3,3,1,2],[96,'0',0,4,2],[110,'.',2,4]]
  for(const [c,l,x,y,w=1,h=1] of num)key(c,l,878+x*46,86+y*44,w*46-4,h*44-5)
  }
  root.append(el('rect',{x:mouseX,y:mouseY,width:176,height:245,rx:54,fill:'#182231',stroke:'#71859e','stroke-width':2}))
  const mouse=[]
  for(const [code,label,x,y,w,h] of [[0,'L',mouseX+10,mouseY+12,71,82],[1,'R',mouseX+91,mouseY+12,71,82],[2,'M3',mouseX+72,mouseY+102,36,38],[3,'M4',mouseX+8,mouseY+136,46,36],[4,'M5',mouseX+8,mouseY+180,46,36]]) {
    const box=el('rect',{x,y,width:w,height:h,rx:10,fill:'#293345','data-mouse-button':code}),txt=el('text',{x:x+w/2,y:y+h/2+5,'text-anchor':'middle',fill:'#dce6f5','font-family':'system-ui','font-size':14},label)
    root.append(box,txt);mouse.push({code,box,txt})
  }
  const motion=el('path',{stroke:color,'stroke-width':4,fill:'none'}),scroll=el('text',{x:mouseX+90,y:mouseY+226,'text-anchor':'middle',fill:color,'font-family':'system-ui','font-size':17})
  const other=el('text',{x:22,y:height-14,fill:color,'font-family':'system-ui','font-size':13})
  root.append(motion,scroll,other)
  const known=new Set(keys.map(k=>k.code))
  function update(state,transient) {
    const held=new Set(state.keys)
    for(const k of keys){const down=held.has(k.code);k.box.setAttribute('fill',down?color:'#293345');k.label.setAttribute('fill',down?textOn(color):'#e2eaf6');k.g.setAttribute('data-pressed',String(down))}
    for(const m of mouse){const down=state.mouse.buttons.includes(m.code);m.box.setAttribute('fill',down?color:'#293345');m.txt.setAttribute('fill',down?textOn(color):'#dce6f5');m.box.setAttribute('data-pressed',String(down))}
    motion.setAttribute('d',`M${mouseX+90} ${mouseY+179} l${transient?Math.max(-45,Math.min(45,state.mouse.dx/2)):0} ${transient?Math.max(-30,Math.min(30,state.mouse.dy/2)):0}`)
    scroll.textContent=transient&&state.mouse.wheel?(state.mouse.wheel>0?'Scroll ↑':'Scroll ↓'):''
    const extras=state.keys.filter(c=>!known.has(c));other.textContent=extras.length?`Otras teclas: ${extras.map(keyName).join(' + ')}`:layout==='gaming'?'WASD · 1–6 · QWERTY · M4 / M5':'QWERTY · las leyendas pueden variar según el idioma'
  }
  return {root,ratio:width/height,update}
}
module.exports={createKeyboardMap}
