const path=require('node:path')
const directory=(clip,library)=>clip.storageDir||library
const mediaPath=(clip,library,file=clip.fileName)=>path.join(directory(clip,library),file)
const originalPath=(clip,library)=>mediaPath(clip,library,path.join('.originals',path.basename(clip.id)+path.extname(clip.fileName)))
function cutMarkers(markers=[],start,end){return markers.filter(m=>Number.isFinite(m.timeSec)&&m.timeSec>=start&&m.timeSec<end).map(m=>({...m,timeSec:Math.max(0,m.timeSec-start)}))}
module.exports={directory,mediaPath,originalPath,cutMarkers}
