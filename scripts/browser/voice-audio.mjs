import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

// Real Chromium microphone/MediaRecorder path, fed a repeatable PCM source.
// No replacement recorder, fabricated WebM blob, or interception of audio requests.
export function createVoiceBrowserAudio(){
 const folder=mkdtempSync(join(tmpdir(),'funix-voice-audio-')),file=join(folder,'source.wav')
 const rate=48000,frames=rate*2,pcm=Buffer.alloc(frames*2)
 for(let i=0;i<frames;i++){
  const t=i/rate,envelope=.65+.35*Math.sin(2*Math.PI*3*t)
  const sample=.3*envelope*(Math.sin(2*Math.PI*(220*t+65*t*t))+.5*Math.sin(2*Math.PI*660*t))
  pcm.writeInt16LE(Math.round(sample*32767),i*2)
 }
 const wav=Buffer.alloc(44+pcm.length)
 wav.write('RIFF',0);wav.writeUInt32LE(36+pcm.length,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16)
 wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(rate,24);wav.writeUInt32LE(rate*2,28)
 wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(pcm.length,40);pcm.copy(wav,44)
 writeFileSync(file,wav)
 const uploads=[]
 const startupDelayMs=Number(process.env.FUNIX_TEST_MIC_STARTUP_MS??0)
 assert(Number.isFinite(startupDelayMs)&&startupDelayMs>=0&&startupDelayMs<=10000,'invalid synthetic microphone delay')
 return {
  args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream','--use-file-for-fake-audio-capture='+file],
  observeUpload(bytes,mime){uploads.push({bytes:bytes.length,mime,hash:createHash('sha256').update(bytes).digest('hex')})},
  verifyUpload(metrics){
   assert.equal(uploads.length,1,'each recording must reach the backend exactly once')
   const uploaded=uploads.shift()
   assert(uploaded.bytes>512,'encoded audio must really reach the backend')
   assert.equal(uploaded.hash,metrics.hash,'backend bytes must equal the native recorded audio')
   assert.match(uploaded.mime,/^audio\//)
  },
  async install(context){
   await context.addInitScript(({startupDelayMs})=>{
    const probe={sequence:0,current:null};window.__funixVoiceAudio=probe
    const start=MediaRecorder.prototype.start
    MediaRecorder.prototype.start=function(...args){
     const attempt={sequence:++probe.sequence,mime:this.mimeType,bytes:0,chunks:0,started:false,stopped:false,parts:[],error:null}
     probe.current=attempt
     this.addEventListener('start',()=>{attempt.started=true})
     this.addEventListener('dataavailable',event=>{attempt.chunks++;attempt.bytes+=event.data.size;if(event.data.size)attempt.parts.push(event.data)})
     this.addEventListener('stop',()=>{attempt.stopped=true})
     this.addEventListener('error',event=>{attempt.error=event.error?.name??'MediaRecorder error'})
     return start.apply(this,args)
    }
    if(startupDelayMs){
     const getMedia=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
     navigator.mediaDevices.getUserMedia=async constraints=>{const stream=await getMedia(constraints);await new Promise(resolve=>setTimeout(resolve,startupDelayMs));return stream}
    }
   },{startupDelayMs})
  },
  dispose(){rmSync(folder,{recursive:true,force:true})}
 }
}

async function capture(page,audio,start,stop,status){
 const after=await page.evaluate(()=>window.__funixVoiceAudio?.sequence??0)
 let stopped=false
 try{
  await start()
  // MediaRecorder.start(1000) is asynchronous. Wait for actual encoded data,
  // not a time measured from pointerdown (which includes the 350ms gesture).
  await page.waitForFunction(after=>{
   const p=window.__funixVoiceAudio?.current
   const error=document.querySelector('.voice-status.error')?.textContent
   if(error)throw Error(error)
   if(p?.sequence>after&&p.error)throw Error(p.error)
   return p?.sequence>after&&p.started&&p.bytes>512
  },after,{timeout:15000})
  const responsePromise=page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname.endsWith('/copiloto/interpretar'),{timeout:15000})
  await stop();stopped=true
  const response=await responsePromise
  assert.equal(response.status(),status,'voice endpoint must finish with the expected status')
  await page.waitForFunction(after=>{const p=window.__funixVoiceAudio?.current;return p?.sequence>after&&p.stopped},after)
  const metrics=await page.evaluate(async()=>{
   const p=window.__funixVoiceAudio.current,blob=new Blob(p.parts,{type:p.mime}),data=await blob.arrayBuffer()
   const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',data))].map(v=>v.toString(16).padStart(2,'0')).join('')
   const audio=new AudioContext()
   try{
    const decoded=await audio.decodeAudioData(data),samples=decoded.getChannelData(0)
    let energy=0;for(const sample of samples)energy+=sample*sample
    return {sequence:p.sequence,bytes:blob.size,chunks:p.chunks,mime:p.mime,hash,duration:decoded.duration,frames:decoded.length,rms:Math.sqrt(energy/samples.length)}
   }finally{await audio.close()}
  })
  audio.verifyUpload(metrics)
  assert(metrics.frames>0&&metrics.duration>.1&&metrics.rms>.001,'audio must decode to non-silent PCM frames')
  assert.match(response.request().headers()['content-type'],/^audio\//)
  await page.locator('.voice-launcher.'+(status===200?'done':'error')).waitFor({timeout:15000})
  console.log('AUDIO '+JSON.stringify({sequence:metrics.sequence,bytes:metrics.bytes,duration:metrics.duration,rms:metrics.rms,status}))
  return response
 }catch(error){
  const diagnostic=await page.evaluate(()=>{const p=window.__funixVoiceAudio?.current;return {sequence:p?.sequence,bytes:p?.bytes,chunks:p?.chunks,started:p?.started,stopped:p?.stopped,error:p?.error,status:document.querySelector('.voice-status')?.textContent}}).catch(()=>({}))
  throw new Error('Native voice capture failed: '+JSON.stringify(diagnostic),{cause:error})
 }finally{if(!stopped)await stop().catch(()=>{})}
}
export async function recordVoice(page,audio){
 await page.locator('.approved-finance').waitFor({state:'attached'})
 const launcher=page.getByRole('button',{name:'Abrir Copiloto FUNIX',exact:true}),box=await launcher.boundingBox()
 assert(box,'voice launcher must have geometry')
 return capture(page,audio,async()=>{await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down()},()=>page.mouse.up(),200)
}
export async function clarifyVoice(page,audio,status=200){
 const panel=page.locator('.voice-panel')
 return capture(page,audio,()=>panel.getByRole('button',{name:'Falar',exact:true}).last().click(),()=>panel.getByRole('button',{name:'Enviar esclarecimento',exact:true}).click(),status)
}
