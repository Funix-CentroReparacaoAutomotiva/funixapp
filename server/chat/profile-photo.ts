/** Bounded positive/negative cache. Provider credentials and external URLs stay server-side. */
export function createProfilePhotoGateway(options:{origin:string;apiKey:string;instance:string;fetcher?:typeof fetch;now?:()=>number}) {
 const fetcher=options.fetcher??fetch,now=options.now??Date.now
 const cache=new Map<string,{until:number;value:{bytes:Buffer;mime:string}|null}>(),pending=new Map<string,Promise<{bytes:Buffer;mime:string}|null>>()
 let lastRequest=-Infinity
 return async(pn:string)=>{
  if(!/^[1-9][0-9]{7,14}$/.test(pn))return null
  const known=cache.get(pn);if(known&&known.until>now())return known.value
  if(pending.has(pn))return pending.get(pn)!
  if(pending.size>=2||now()-lastRequest<1000)return null
  lastRequest=now()
  const request=(async()=>{
   let value:{bytes:Buffer;mime:string}|null=null
   try{
    const response=await fetcher(options.origin+'/chat/fetchProfilePictureUrl/'+encodeURIComponent(options.instance),{method:'POST',headers:{apikey:options.apiKey,'Content-Type':'application/json'},body:JSON.stringify({number:pn}),signal:AbortSignal.timeout(5000),redirect:'error'})
    if(response.ok){const raw=await response.text();if(raw.length>8192)throw Error('profile metadata size');const data=JSON.parse(raw)as {profilePictureUrl?:unknown};if(typeof data.profilePictureUrl==='string'){
     const url=new URL(data.profilePictureUrl)
     if(url.protocol!=='https:'||url.username||url.password||url.port||!['pps.whatsapp.net','mmg.whatsapp.net'].includes(url.hostname))throw Error('profile origin')
     const image=await fetcher(url,{signal:AbortSignal.timeout(5000),redirect:'error'})
     if(image.ok&&image.headers.get('content-type')?.split(';')[0]==='image/jpeg'){
      const reader=image.body?.getReader();if(reader){const parts:Uint8Array[]=[];let size=0;try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>512*1024)throw Error('profile size');parts.push(part.value)}}finally{await reader.cancel()}
       const bytes=Buffer.concat(parts);if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)value={bytes,mime:'image/jpeg'}
      }
     }
    }}
   }catch{/* Optional provider capability, privacy and transport failures are negative cached. */}
   if(cache.size>=2048)cache.delete(cache.keys().next().value!)
   cache.set(pn,{value,until:now()+(value?6*3600000:3600000)})
   return value
  })()
  pending.set(pn,request)
  try{return await request}finally{pending.delete(pn)}
 }
}
export type ProfilePhotoGateway=ReturnType<typeof createProfilePhotoGateway>
