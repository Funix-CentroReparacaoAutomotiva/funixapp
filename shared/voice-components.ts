// Same unsigned decimal domain as ComponentRepository/Q.from: 12 + 6 digits.
export const componentDecimal=(v:unknown,positive=false):v is string=>typeof v==='string'&&/^\d{1,12}(?:\.\d{1,6})?$/.test(v)&&(!positive||/[1-9]/.test(v))
export const componentName=(v:unknown):v is string=>typeof v==='string'&&Boolean(v.trim())&&v.length<=250&&!Array.from(v).some(c=>c.charCodeAt(0)<32)
export function normalizedComponentDecimal(v:string){const [whole,fraction='']=v.split('.');const tail=fraction.replace(/0+$/,'');return whole!.replace(/^0+(?=\d)/,'')+(tail?'.'+tail:'')}
const key=(name:string)=>name.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim()
// A conservative duplicate warning, never an automatic identity/name merge.
export function possibleSameComponent(a:string,b:string){
 const x=key(a),y=key(b);if(x===y)return true
 const wx=new Set(x.split(' ')),wy=new Set(y.split(' ')),common=[...wx].filter(w=>wy.has(w)).length
 if(Math.min(wx.size,wy.size)>=2&&common/Math.max(wx.size,wy.size)>=.75)return true
 if(Math.min(x.length,y.length)<8)return false
 const grams=(v:string)=>new Set(Array.from({length:v.length-1},(_,i)=>v.slice(i,i+2)))
 const gx=grams(x),gy=grams(y);return 2*[...gx].filter(g=>gy.has(g)).length/(gx.size+gy.size)>=.85
}
