import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createMediaGateway,validateMedia } from '../chat/evolution-media.ts'
const origin='http://evolution-api:8080',key='SYNTHETIC-ONLY',instance='funix_comercial'
const jpeg=Buffer.from([0xff,0xd8,0xff,0xe0,1,2,3,4]).toString('base64')
const mp4=Buffer.from([0,0,0,24,102,116,121,112,105,115,111,109,0,0,0,0]).toString('base64')
const ogg=Buffer.from('OggSxxxxxxxxxx').toString('base64')
const jid='5531999990001@s.whatsapp.net'
test('media gateway routes image/video/audio through existing Evolution, with no client URL',async()=>{
  const calls:Array<{url:string;body:Record<string,unknown>}>=[]
  const gateway=createMediaGateway({origin,apiKey:key,instance,fetcher:async(input,init)=>{
    const body=JSON.parse(String(init?.body))
    calls.push({url:String(input),body})
    assert.equal(new Headers(init?.headers).get('apikey'),key)
    return new Response(JSON.stringify({key:{id:'SEND-123'}}),{status:201})
  }})
  for(const [kind,mime,base64] of [
    ['image','image/jpeg',jpeg],['video','video/mp4',mp4],['audio','audio/ogg',ogg],
  ] as const){
    assert.deepEqual(await gateway.send(jid,{kind,mimeType:mime,base64}),{messageId:'SEND-123'})
  }
  assert.equal(calls.length,3)
  assert.equal(calls[0]!.url,origin+'/message/sendMedia/funix_comercial')
  assert.equal(calls[0]!.body.number,'5531999990001')
  assert.equal(calls[0]!.body.mediatype,'image')
  assert.equal(calls[1]!.body.mediatype,'video')
  assert.equal(calls[2]!.url,origin+'/message/sendWhatsAppAudio/funix_comercial')
  assert.equal(typeof calls[2]!.body.audio,'string')
})
test('media gateway scopes full provider envelope and returns bounded mime/base64',async()=>{
  let observed:Record<string,unknown>|null=null
  const gateway=createMediaGateway({origin,apiKey:key,instance,fetcher:async(_input,init)=>{
    observed=JSON.parse(String(init?.body))
    return new Response(JSON.stringify({mimetype:'image/jpeg',base64:jpeg}),{status:200})
  }})
  const envelope={key:{id:'REAL-MESSAGE-1',remoteJid:jid},messageType:'imageMessage',
    message:{imageMessage:{mimetype:'image/jpeg'}}}
  assert.deepEqual(await gateway.get(envelope,'image'),{kind:'image',mimeType:'image/jpeg',base64:jpeg})
  assert.deepEqual((observed as unknown as {message:unknown}).message,envelope)
})
test('media rejects MIME spoof, invalid signature, too large, bad provider and non-PN recipient',async()=>{
  let calls=0
  const gateway=createMediaGateway({origin,apiKey:key,instance,fetcher:async()=>{
    calls++;return new Response(JSON.stringify({key:{id:'OK'}}),{status:200})
  }})
  assert.throws(()=>validateMedia('image','image/png',jpeg),/MEDIA_INVALID/)
  assert.throws(()=>validateMedia('video','video/mp4',jpeg),/MEDIA_INVALID/)
  await assert.rejects(gateway.send('12345678@lid',{kind:'image',mimeType:'image/jpeg',base64:jpeg}),/MEDIA_INVALID/)
  await assert.rejects(gateway.send(jid,{kind:'image',mimeType:'image/png',base64:jpeg}),/MEDIA_INVALID/)
  await assert.rejects(gateway.send(jid,{kind:'video',mimeType:'video/mp4',base64:mp4,caption:'x'.repeat(1025)}),/MEDIA_INVALID/)
  assert.equal(calls,0)
  assert.throws(()=>createMediaGateway({origin:'file:///tmp/a',apiKey:key,instance}),/MEDIA_CONFIG_INVALID/)
  const missing=createMediaGateway({origin,apiKey:key,instance,fetcher:async()=>new Response('{}',{status:200})})
  await assert.rejects(missing.get({key:{id:'MSG-1',remoteJid:jid},messageType:'imageMessage',message:{}},'image'),/MEDIA_PROVIDER_INVALID/)
})

test('received MP4 video is fetched without conversion, preserving provider envelope',async()=>{
  let posted: Record<string,unknown>|null=null
  const gateway=createMediaGateway({origin,apiKey:key,instance,fetcher:async(_input,init)=>{
    posted=JSON.parse(String(init?.body)) as Record<string,unknown>
    return new Response(JSON.stringify({base64:mp4}),{status:200})
  }})
  const envelope={key:{id:'VIDEO-123',remoteJid:jid},messageType:'videoMessage',
    message:{videoMessage:{mimetype:'video/mp4',fileLength:16}}}
  assert.deepEqual(await gateway.get(envelope,'video'),{kind:'video',mimeType:'video/mp4',base64:mp4})
  assert.equal(posted?.convertToMp4,false)
  assert.deepEqual(posted?.message,envelope)
})
test('video failure categories do not expose provider response bodies',async()=>{
  const envelope={key:{id:'VIDEO-123',remoteJid:jid},messageType:'videoMessage',
    message:{videoMessage:{mimetype:'video/mp4'}}}
  const oversized=createMediaGateway({origin,apiKey:key,instance,fetcher:async()=>
    new Response('provider-secret', {status:413})})
  await assert.rejects(oversized.get(envelope,'video'),(error:unknown)=>{
    assert.equal(String(error),'Error: MEDIA_PROVIDER_TOO_LARGE')
    return true
  })
  const wrongFormat=createMediaGateway({origin,apiKey:key,instance,fetcher:async()=>
    new Response(JSON.stringify({mimetype:'application/octet-stream',base64:mp4}),{status:200})})
  await assert.rejects(wrongFormat.get(envelope,'video'),/MEDIA_FORMAT_UNSUPPORTED/)
  const invalidFile=createMediaGateway({origin,apiKey:key,instance,fetcher:async()=>
    new Response(JSON.stringify({mimetype:'video/mp4',base64:jpeg}),{status:200})})
  await assert.rejects(invalidFile.get(envelope,'video'),/MEDIA_CONTENT_INVALID/)
})
