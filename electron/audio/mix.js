const level=value=>Number.isFinite(value)?Math.max(0,Math.min(1.5,value)):1
const usesIsolated=(mix,apps)=>apps.some(a=>(mix?.apps?.[a.id]?.volume??1)!==1||mix?.apps?.[a.id]?.muted===true)
function normalizeMix(mix={},tracks=[]){
  return {game:level(mix.game),mic:level(mix.mic),gameMuted:mix.gameMuted===true,micMuted:mix.micMuted===true,
    apps:Object.fromEntries(tracks.map(t=>[t.id,{volume:level(mix.apps?.[t.id]?.volume),muted:mix.apps?.[t.id]?.muted===true}]))}
}
function mixPlan(input,mic,mix,apps=[],cut=[],hasComputer=true,duration=30){
  const m=normalizeMix(mix,apps),computer=m.gameMuted?0:m.game,inputs=[...cut,'-i',input],filters=[],labels=[]
  let index=1
  const add=(source,volume)=>{const name=`a${labels.length}`;filters.push(`[${source}:a]volume=${volume.toFixed(4)}[${name}]`);labels.push(`[${name}]`)}
  if(apps.length&&usesIsolated(m,apps))for(const app of apps){inputs.push(...cut,'-i',app.file);const a=m.apps[app.id];add(index++,computer*(a.muted?0:a.volume))}
  else if(hasComputer)add(0,computer)
  if(mic){inputs.push(...cut,'-i',mic);add(index,m.micMuted?0:m.mic)}
  if(!labels.length)filters.push(`anullsrc=r=48000:cl=stereo,atrim=0:${duration.toFixed(3)}[aout]`)
  else filters.push(labels.join('')+`amix=inputs=${labels.length}:duration=longest:dropout_transition=0:normalize=0,apad,atrim=0:${duration.toFixed(3)}[aout]`)
  return {inputs,filters:filters.join(';')}
}
module.exports={normalizeMix,mixPlan,usesIsolated}
