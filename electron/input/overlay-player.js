const {ipcRenderer}=require('electron')
const {neutral}=require('./timeline')
const {text,drawKeyboard,drawPad}=require('./basic-renderer')
const {createControllerSkin}=require('./controller-skins')
const {createKeyboardMap}=require('./keyboard-map')
const {preferences,overlayRect,dragPosition,clamp}=require('./overlay-layout')
const STORAGE='clipper-input-overlay-v2'
function frameAt(frames,time){let lo=0,hi=frames.length-1,best=-1;while(lo<=hi){const mid=(lo+hi)>>1;if(frames[mid].t<=time){best=mid;lo=mid+1}else hi=mid-1}return best<0?null:frames[best]}
function readPreferences(){try{return preferences(JSON.parse(localStorage.getItem(STORAGE))||{})}catch{return preferences()}}
function attachPlayer(video){
  const stage=video.closest('.clip-stage'),host=video.parentElement,prefs=readPreferences()
  const bar=document.createElement('div');bar.className='ci-controls'
  bar.innerHTML=`<button type="button" class="ci-button ci-toggle" aria-pressed="false" disabled>Mostrar inputs</button>
    <select aria-label="Tipo de mapa"><option value="auto">Automático</option><option value="kbm">Teclado y mouse</option><option value="pad">Control</option></select>
    <select aria-label="Estilo de control"><option value="basic">Clásico · básico</option><option value="xbox">Xbox · universal</option><option value="ps">PS5 · DualSense</option></select>
    <select aria-label="Diseño de teclado"><option value="compact">Teclado compacto</option><option value="full">Teclado completo</option></select>
    <select aria-label="Control grabado"><option value="auto">Control automático</option></select>
    <select aria-label="Posición del mapa"><option value="left">Abajo izquierda</option><option value="right">Abajo derecha</option><option value="free">Personalizada</option></select>
    <button type="button" class="ci-button ci-edit" aria-pressed="false" disabled>Mover / tamaño</button>
    <label class="ci-scale">Tamaño <input type="range" min="20" max="100" step="1" aria-label="Tamaño del mapa"><output></output></label>
    <span role="status" class="ci-message">Cargando inputs…</span>`
  const overlay=document.createElement('div');overlay.className='ci-overlay';overlay.hidden=true;overlay.tabIndex=-1
  overlay.setAttribute('role','group');overlay.setAttribute('aria-label','Mapa de inputs. Arrastrá para mover; flechas para ajustar y más o menos para cambiar tamaño.')
  const surface=document.createElement('div');surface.className='ci-surface'
  const handle=document.createElement('div');handle.className='ci-resize';handle.setAttribute('aria-hidden','true');handle.title='Arrastrá para cambiar el tamaño'
  overlay.append(surface,handle);stage.prepend(bar);host.append(overlay)
  const button=bar.querySelector('.ci-toggle'),edit=bar.querySelector('.ci-edit'),message=bar.querySelector('.ci-message'),scale=bar.querySelector('input'),output=bar.querySelector('output')
  const [mode,skin,keyboard,controller,position]=bar.querySelectorAll('select')
  mode.value=prefs.mode;skin.value=prefs.skin;keyboard.value=prefs.keyboard;position.value=prefs.preset
  let src='',track=null,visible=false,editing=false,request=0,raf=0,destroyed=false,renderer=null,renderKey='',kindChanges=[],controllerChanges=[],rect=null,drag=null
  let lastFrame=null,lastTransient=null,lastPad=null,missing=false
  function persist(){try{localStorage.setItem(STORAGE,JSON.stringify(prefs))}catch{}}
  function sync(){position.value=prefs.preset;scale.value=String(prefs.scale);output.value=`${Math.round(prefs.scale)}%`}
  function setEditing(value){editing=value&&visible;overlay.classList.toggle('ci-editing',editing);overlay.tabIndex=editing?0:-1;edit.setAttribute('aria-pressed',String(editing));if(editing)overlay.focus({preventScroll:true})}
  function setVisible(value){visible=value;overlay.hidden=!value;button.textContent=value?'Ocultar inputs':'Mostrar inputs';button.setAttribute('aria-pressed',String(value));edit.disabled=!value;if(!value)setEditing(false);else draw()}
  button.onclick=()=>setVisible(!visible);edit.onclick=()=>setEditing(!editing)
  function changed(){Object.assign(prefs,{mode:mode.value,skin:skin.value,keyboard:keyboard.value,controller:controller.value,preset:position.value});persist();draw()}
  for(const select of [mode,skin,keyboard,controller,position])select.onchange=changed
  scale.oninput=()=>{prefs.scale=Number(scale.value);sync();persist();draw()}
  // Editing gestures never reach the video player's seek/pause shortcuts.
  bar.addEventListener('keydown',e=>e.stopPropagation())
  overlay.addEventListener('click',e=>e.stopPropagation())
  overlay.addEventListener('dblclick',e=>e.stopPropagation())
  overlay.addEventListener('pointerdown',e=>{
    if(!editing||e.button!==0||!rect)return
    e.preventDefault();e.stopPropagation();overlay.focus({preventScroll:true});overlay.setPointerCapture(e.pointerId)
    drag={id:e.pointerId,x:e.clientX,y:e.clientY,rect:{...rect},scale:prefs.scale,resize:e.target===handle,
      startX:prefs.preset==='right'?1:prefs.preset==='left'?0:prefs.x,startY:prefs.preset==='free'?prefs.y:1}
  })
  overlay.addEventListener('pointermove',e=>{
    if(!drag||e.pointerId!==drag.id)return
    e.preventDefault();e.stopPropagation()
    if(drag.resize){const dx=e.clientX-drag.x,dy=(e.clientY-drag.y)*renderer.ratio,delta=Math.abs(dx)>=Math.abs(dy)?dx:dy;prefs.scale=clamp(drag.scale*(drag.rect.width+delta)/drag.rect.width,20,100)}
    else Object.assign(prefs,dragPosition(drag.rect,e.clientX-drag.x,e.clientY-drag.y,drag.startX,drag.startY))
    sync();draw()
  })
  function endDrag(e){if(drag&&e.pointerId===drag.id){drag=null;persist()}}
  overlay.addEventListener('pointerup',endDrag);overlay.addEventListener('pointercancel',endDrag);overlay.addEventListener('lostpointercapture',endDrag)
  overlay.addEventListener('keydown',e=>{
    if(!editing)return
    const arrows={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]},step=e.shiftKey ? .05 : .01
    if(arrows[e.key]){prefs.x=(prefs.preset==='right'?1:prefs.preset==='left'?0:prefs.x);prefs.y=prefs.preset==='free'?prefs.y:1;prefs.preset='free';prefs.x=clamp(prefs.x+arrows[e.key][0]*step,0,1);prefs.y=clamp(prefs.y+arrows[e.key][1]*step,0,1)}
    else if(['+','=','-','_'].includes(e.key))prefs.scale=clamp(prefs.scale+(['-','_'].includes(e.key)?-2:2),20,100)
    else if(e.key==='Escape')setEditing(false)
    else return
    e.preventDefault();e.stopPropagation();sync();persist();draw()
  })
  async function checkSource(){
    const next=video.currentSrc||video.src;if(next===src)return
    src=next;track=null;setVisible(false);button.disabled=true;message.textContent='Cargando inputs…';const token=++request
    try{
      const url=new URL(next)
      if(url.protocol!=='clip:'||url.host!=='local'){message.textContent='Sin pista de inputs';return}
      const loaded=await ipcRenderer.invoke('inputs:read',decodeURIComponent(url.pathname.slice(1)))
      if(destroyed||token!==request)return
      track=loaded;button.disabled=!track;kindChanges=[];controllerChanges=[];let previous=neutral();const pads=new Map()
      if(track)for(const f of track.frames){
        const a=f.state,b=previous
        const kbm=JSON.stringify(a.keys)!==JSON.stringify(b.keys)||JSON.stringify(a.mouse.buttons)!==JSON.stringify(b.mouse.buttons)||a.mouse.dx||a.mouse.dy||a.mouse.wheel
        let activePad=null
        // Prefer a native DualSense over its virtual XInput duplicate.
        for(const p of [...a.pads].sort((l,r)=>(l.kind==='dualsense')-(r.kind==='dualsense'))){
          pads.set(String(p.id),p)
          if(JSON.stringify(p)!==JSON.stringify(b.pads.find(q=>q.id===p.id))&&(p.buttons||p.lt||p.rt||p.lx||p.ly||p.rx||p.ry||Object.values(p.extra||{}).some(Boolean)))activePad=p
        }
        if(activePad||kbm)kindChanges.push({t:f.t,kind:activePad?'pad':'kbm'})
        if(activePad)controllerChanges.push({t:f.t,id:activePad.id})
        previous=a
      }
      controller.replaceChildren(new Option('Control automático','auto'))
      for(const [id,p] of pads)controller.append(new Option(`${p.kind==='dualsense'?'DualSense':'Control'} ${Number(id)+1}`,id))
      controller.value=pads.has(prefs.controller)?prefs.controller:'auto';controller.hidden=pads.size<2
      lastFrame=null;lastPad=null;message.textContent=track?'Pista disponible · oculta por defecto':'Este clip no tiene inputs grabados'
    }catch{if(token===request)message.textContent='No se pudo cargar la pista de inputs'}
  }
  function createRenderer(key){
    surface.replaceChildren();renderKey=key;lastFrame=null;lastPad=null;lastTransient=null
    if(key==='ps'||key==='xbox')renderer=createControllerSkin(key)
    else if(key==='keyboard')renderer=createKeyboardMap()
    else{
      const canvas=document.createElement('canvas');canvas.className='ci-canvas';canvas.width=1020;canvas.height=528
      const ctx=canvas.getContext('2d');ctx.scale(3,3)
      renderer={root:canvas,ratio:340/176,update(state,transient,kind,pad){
        ctx.clearRect(0,0,340,176);ctx.fillStyle='rgba(12,15,23,.88)';ctx.beginPath();ctx.roundRect(0,0,340,176,14);ctx.fill();ctx.strokeStyle='#68758b66';ctx.stroke()
        if(kind==='pad')drawPad(ctx,pad?[pad]:[],'xbox');else drawKeyboard(ctx,state,transient)
      }}
    }
    surface.append(renderer.root)
  }
  function draw(){
    if(!visible||!track||destroyed)return
    const time=video.currentTime*1000,f=frameAt(track.frames,time),state=f?.state||neutral(),change=frameAt(kindChanges,time)
    const kind=mode.value==='auto'?(change?.kind||(state.pads.length?'pad':'kbm')):mode.value
    const chosen=controller.value==='auto'?frameAt(controllerChanges,time)?.id:Number(controller.value)
    const pad=state.pads.find(p=>p.id===chosen)||(controller.value==='auto'?state.pads[0]:null)
    const key=kind==='pad'?(skin.value==='basic'?'basic':skin.value):(keyboard.value==='full'?'keyboard':'basic')
    if(key!==renderKey)createRenderer(key)
    const videoRect=video.getBoundingClientRect(),outer=host.getBoundingClientRect()
    if(!videoRect.width||!videoRect.height)return
    const ratio=video.videoWidth&&video.videoHeight?video.videoWidth/video.videoHeight:videoRect.width/videoRect.height
    const width=Math.min(videoRect.width,videoRect.height*ratio),height=width/ratio
    const picture={left:videoRect.left-outer.left+(videoRect.width-width)/2,top:videoRect.top-outer.top+(videoRect.height-height)/2,width,height}
    rect=overlayRect(picture,renderer.ratio,prefs)
    Object.assign(overlay.style,{left:`${rect.left}px`,top:`${rect.top}px`,width:`${rect.width}px`,height:`${rect.height}px`})
    const noData=time>track.durationMs||time<(track.coverageStartMs||0)
    overlay.classList.toggle('ci-missing',noData);surface.hidden=noData
    overlay.setAttribute('data-kind',kind)
    if(noData){if(!missing){overlay.dataset.message='Sin inputs en este tramo';missing=true}return}
    missing=false;delete overlay.dataset.message
    const transient=!!f&&time-f.t<100
    if(lastFrame!==f||lastTransient!==transient||lastPad!==pad||renderer.root.clientWidth!==renderer.width||renderer.kind!==kind){
      if(key==='ps'||key==='xbox')renderer.update(pad)
      else if(key==='keyboard')renderer.update(state,transient)
      else renderer.update(state,transient,kind,pad)
      renderer.width=renderer.root.clientWidth;renderer.kind=kind;lastFrame=f;lastTransient=transient;lastPad=pad
    }
    skin.hidden=kind!=='pad';keyboard.hidden=kind==='pad';controller.hidden=kind!=='pad'||controller.options.length<3
  }
  function tick(){if(destroyed)return;draw();raf=requestAnimationFrame(tick)}
  sync();tick();checkSource()
  return {checkSource,destroy(){destroyed=true;++request;cancelAnimationFrame(raf);bar.remove();overlay.remove()}}
}
module.exports={attachPlayer}
