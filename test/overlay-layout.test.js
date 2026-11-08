const {test}=require('node:test')
const assert=require('node:assert/strict')
const {preferences,overlayRect,dragPosition}=require('../electron/input/overlay-layout')
test('layout preferences validate corrupt data and preserve user selections',()=>{
  assert.deepEqual(preferences({skin:'x',scale:NaN,x:-3,y:50,preset:'no'}),{mode:'auto',skin:'basic',keyboard:'compact',preset:'left',scale:45,x:0,y:1,controller:'auto'})
  assert.equal(preferences({skin:'ps',scale:1000,controller:'16'}).skin,'ps')
  assert.equal(preferences({scale:1000}).scale,100)
})
test('corner presets stay at the picture bottom, including letterboxing',()=>{
  const picture={left:140,top:23,width:800,height:450}
  const left=overlayRect(picture,720/500,preferences()),right=overlayRect(picture,720/500,preferences({preset:'right'}))
  assert.equal(left.top,right.top);assert.equal(left.left,152)
  assert.equal(right.left+right.width,928);assert.equal(left.top+left.height,461)
})
test('dragging is normalized, clamps at every edge and survives resizing',()=>{
  const picture={left:40,top:50,width:500,height:300},prefs=preferences({preset:'right'})
  const rect=overlayRect(picture,1.44,prefs)
  const dragged=dragPosition(rect,-rect.travelX/2,-rect.travelY/2,1,1)
  assert.deepEqual(dragged,{preset:'free',x:.5,y:.5})
  assert.deepEqual(dragPosition(rect,10000,-10000,0,1),{preset:'free',x:1,y:0})
  const resized=overlayRect({left:10,top:10,width:250,height:150},1.44,{...prefs,...dragged})
  assert.equal(resized.left+resized.width/2,135)
  assert.equal(resized.top+resized.height/2,85)
})
test('all scales, presets and shapes stay inside portrait and small pictures',()=>{
  for(const [width,height] of [[1920,1080],[320,900],[80,45],[640,360]])for(const ratio of [1.44,340/176,1280/350])for(const preset of ['left','right','free'])for(const scale of [20,45,100]){
    const picture={left:15,top:33,width,height},r=overlayRect(picture,ratio,preferences({preset,scale,x:.8,y:.9}))
    assert.ok(r.left>=picture.left&&r.top>=picture.top)
    assert.ok(r.left+r.width<=picture.left+width+.00001&&r.top+r.height<=picture.top+height+.00001)
  }
})
