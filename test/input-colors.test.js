const {test}=require('node:test'),assert=require('node:assert/strict')
const {normalizeColor,textOn}=require('../electron/input/colors')
const {drawKeyboard}=require('../electron/input/basic-renderer')
const {neutral}=require('../electron/input/timeline')
test('pressed labels remain legible on light and dark selected colors',()=>{
  assert.equal(normalizeColor('#AABBCC'),'#aabbcc');assert.equal(normalizeColor('not-a-color'),'#8cf5b5')
  assert.equal(textOn('#000000'),'#f4f7fc');assert.equal(textOn('#ffffff'),'#10241a')
})
test('basic keyboard always draws both thumb buttons and highlights both independently',()=>{
  const fills=[],labels=[];let rect
  const c={beginPath(){},roundRect(...r){rect=r},fill(){fills.push({rect,color:this.fillStyle})},fillRect(){},stroke(){},moveTo(){},lineTo(){},fillText(label){labels.push(label)}}
  const state=neutral();state.mouse.buttons=[3,4]
  drawKeyboard(c,state,false,'#dd55ff')
  for(const y of [72,103])assert.ok(fills.some(f=>f.rect[0]===207&&f.rect[1]===y&&f.color==='#dd55ff'))
  assert.ok(labels.includes('M4')&&labels.includes('M5'))
  labels.length=0;drawKeyboard(c,neutral(),false)
  assert.ok(labels.includes('M4')&&labels.includes('M5'))
})
