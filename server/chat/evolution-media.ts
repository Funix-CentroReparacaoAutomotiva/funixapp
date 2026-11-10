/** Media gateway to the existing Evolution instance. No external URLs or Coda writes. */
export type MediaKind = 'image' | 'video' | 'audio'
export type MediaInput = { kind: MediaKind; mimeType: string; base64: string; caption?: string }
export type MediaOutput = { kind: MediaKind; mimeType: string; base64: string }
export type MediaGateway = {
  send: (jid: string, media: MediaInput) => Promise<{ messageId: string }>
  get: (id: string, kind: MediaKind) => Promise<MediaOutput>
}
const limits: Record<MediaKind, readonly string[]> = {
  image: ['image/jpeg', 'image/png', 'image/webp'],
  video: ['video/mp4', 'video/webm'],
  audio: ['audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/webm'],
}
const maxBytes = 12 * 1024 * 1024
function obj(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('MEDIA_INVALID')
  return value as Record<string, unknown>
}
export function validateMedia(kind: MediaKind, mime: string, base64: string): Buffer {
  if (!limits[kind]?.includes(mime) || typeof base64 !== 'string' || base64.length > Math.ceil(maxBytes/3)*4+4 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)) throw Error('MEDIA_INVALID')
  const b = Buffer.from(base64, 'base64')
  if (!b.length || b.length > maxBytes || b.toString('base64') !== base64) throw Error('MEDIA_INVALID')
  const at = (from: number, n: number) => b.subarray(from, from+n).toString('ascii')
  const okay = mime === 'image/jpeg' ? b[0]===255 && b[1]===216 && b[2]===255 :
    mime === 'image/png' ? b.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')) :
    mime === 'image/webp' ? at(0,4)==='RIFF' && at(8,4)==='WEBP' :
    mime === 'video/mp4' || mime === 'audio/mp4' ? at(4,4)==='ftyp' :
    mime === 'video/webm' || mime === 'audio/webm' ? b.subarray(0,4).equals(Buffer.from('1a45dfa3','hex')) :
    mime === 'audio/ogg' ? at(0,4)==='OggS' :
    mime === 'audio/mpeg' ? at(0,3)==='ID3' || (b[0]===255 && (b[1]! & 224)===224) : false
  if (!okay) throw Error('MEDIA_INVALID')
  return b
}
async function jsonResponse(response: Response): Promise<Record<string,unknown>> {
  if (![200,201].includes(response.status)) {
    await response.body?.cancel().catch(() => undefined)
    throw Error('MEDIA_PROVIDER_REJECTED')
  }
  if (!response.body) throw Error('MEDIA_PROVIDER_INVALID')
  const reader=response.body.getReader(),parts:Uint8Array[]=[]
  let length=0
  try {
    for (;;) {
      const result=await reader.read()
      if(result.done)break
      length+=result.value.byteLength
      if(length>18*1024*1024){await reader.cancel();throw Error('MEDIA_PROVIDER_TOO_LARGE')}
      parts.push(result.value)
    }
  } finally {reader.releaseLock()}
  try{return obj(JSON.parse(Buffer.concat(parts,length).toString('utf8')))}
  catch{throw Error('MEDIA_PROVIDER_INVALID')}
}
export function createMediaGateway(config:{origin:string;apiKey:string;instance:string;fetcher?:typeof fetch}):MediaGateway {
  let url:URL
  try {url=new URL(config.origin)} catch {throw Error('MEDIA_CONFIG_INVALID')}
  if(!['http:','https:'].includes(url.protocol)||![url.origin,url.origin+'/'].includes(config.origin)||
    url.username||url.password||url.search||url.hash||!/^[A-Za-z0-9_-]{1,80}$/.test(config.instance)||
    typeof config.apiKey!=='string'||!config.apiKey||config.apiKey.length>2048||/[\r\n]/.test(config.apiKey))
    throw Error('MEDIA_CONFIG_INVALID')
  const fetcher=config.fetcher??fetch
  async function post(path:string,data:unknown){
    const r=await fetcher(new URL(path,url),{
      method:'POST',headers:{apikey:config.apiKey,'Content-Type':'application/json',Accept:'application/json'},
      body:JSON.stringify(data),cache:'no-store',redirect:'error',signal:AbortSignal.timeout(30000),
    })
    return jsonResponse(r)
  }
  return {
    async send(jid,item){
      if(!/^[0-9]{8,15}@s\.whatsapp\.net$/.test(jid)||
        !['image','video','audio'].includes(item.kind))throw Error('MEDIA_INVALID')
      validateMedia(item.kind,item.mimeType,item.base64)
      const caption=item.caption??''
      if(typeof caption!=='string'||[...caption].length>1024||/[\u0000-\u001f\u007f]/.test(caption))
        throw Error('MEDIA_INVALID')
      const number=jid.split('@')[0],data='data:'+item.mimeType+';base64,'+item.base64
      const response=item.kind==='audio'
        ? await post('/message/sendWhatsAppAudio/'+config.instance,{number,audio:data})
        : await post('/message/sendMedia/'+config.instance,{
          number,mediatype:item.kind,mimetype:item.mimeType,media:data,
          fileName:item.kind==='image'?'imagem.jpg':'video.mp4',caption})
      const key=response.key && typeof response.key==='object'?obj(response.key):null
      const nested=response.data && typeof response.data==='object'?obj(response.data):null
      const info=nested?.Info&&typeof nested.Info==='object'?obj(nested.Info):null
      const messageId=key?.id??info?.ID
      if(typeof messageId!=='string'||!messageId||messageId.length>256||/[\u0000-\u001f\u007f]/.test(messageId))
        throw Error('MEDIA_PROVIDER_INVALID')
      return {messageId}
    },
    async get(id,kind){
      if(typeof id!=='string'||!/^[A-Za-z0-9_:-]{1,200}$/.test(id)||
        !['image','video','audio'].includes(kind))throw Error('MEDIA_INVALID')
      // Caller must verify this ID against the canonical conversation history.
      const response=await post('/chat/getBase64FromMediaMessage/'+config.instance,{
        message:{key:{id}},convertToMp4:kind==='video'})
      const body=response.data&&typeof response.data==='object'?obj(response.data):response
      const data=body.base64
      if(typeof data!=='string')throw Error('MEDIA_PROVIDER_INVALID')
      const match=/^data:([A-Za-z0-9.+/-]+);base64,(.+)$/s.exec(data)
      const mime=(typeof body.mimetype==='string'?body.mimetype.split(';')[0]:null)??match?.[1]??''
      const base64=match?match[2]!:data
      if(!limits[kind].includes(mime))throw Error('MEDIA_PROVIDER_INVALID')
      validateMedia(kind,mime,base64)
      return {kind,mimeType:mime,base64}
    },
  }
}
