const DEFAULT_COLOR='#8cf5b5'
const normalizeColor=color=>typeof color==='string'&&/^#[0-9a-f]{6}$/i.test(color)?color.toLowerCase():DEFAULT_COLOR
function textOn(color){const c=normalizeColor(color);const rgb=[1,3,5].map(i=>parseInt(c.slice(i,i+2),16));return rgb[0]*.299+rgb[1]*.587+rgb[2]*.114>150?'#10241a':'#f4f7fc'}
module.exports={DEFAULT_COLOR,normalizeColor,textOn}
