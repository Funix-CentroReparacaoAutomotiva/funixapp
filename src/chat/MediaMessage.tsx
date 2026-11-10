import { useEffect, useState } from 'react'
import { api } from '../api'
import type { RequestFailure } from '../api'

type Kind = 'image' | 'video' | 'audio'
export function MediaMessage({ atendimentoId, conversationId, messageId, page, kind, enabled }:{
  atendimentoId:string; conversationId:string;messageId:string;page:number;kind:Kind;enabled:boolean
}) {
  const [uri,setUri]=useState('')
  const [error,setError]=useState('')
  const [busy,setBusy]=useState(false)
  const [expanded,setExpanded]=useState(false)
  useEffect(()=>{setUri('');setError('');setExpanded(false)},[messageId,page,conversationId,atendimentoId])
  async function open() {
    if(!enabled||busy||uri)return
    setBusy(true);setError('')
    try{
      const result=await api<{kind:Kind;mimeType:string;base64:string}>(
        '/api/atendimentos/'+encodeURIComponent(atendimentoId)+
        '/evolution-conversations/'+encodeURIComponent(conversationId)+
        '/messages/'+encodeURIComponent(messageId)+'/media?page='+page)
      if(result.kind!==kind || !result.mimeType.startsWith(kind+'/') ||
          !result.base64 || result.base64.length>17*1024*1024)throw Error('Invalid media')
      setUri('data:'+result.mimeType+';base64,'+result.base64)
    }catch(e){
      setError((e as RequestFailure).status===413?
        'Arquivo acima do limite de tamanho do Chat.':'Mídia indisponível. Ela pode ter expirado no WhatsApp.')
    }finally{setBusy(false)}
  }
  return <div className="chat-media">
    {!uri && <button type="button" className="fh-filter" onClick={()=>void open()} disabled={!enabled||busy}>
      {busy?'Carregando…':kind==='image'?'Abrir foto':kind==='video'?'Reproduzir vídeo':'Ouvir áudio'}
    </button>}
    {uri && kind==='image' && <>
      <button type="button" className="chat-image-expand" aria-label="Ampliar foto" onClick={()=>setExpanded(true)}>
        <img alt="Foto recebida pelo WhatsApp" src={uri}/>
      </button>
      {expanded && <div role="dialog" aria-modal="true" aria-label="Foto ampliada" className="chat-image-overlay">
        <button type="button" className="fh-filter" onClick={()=>setExpanded(false)}>Fechar foto</button>
        <img alt="Foto ampliada recebida pelo WhatsApp" src={uri}/>
      </div>}
    </>}
    {uri && kind==='video' && <video aria-label="Vídeo do WhatsApp" controls preload="metadata" src={uri}/>}
    {uri && kind==='audio' && <audio aria-label="Áudio do WhatsApp" controls preload="metadata" src={uri}/>}
    {error && <p role="alert">{error}</p>}
    {!enabled&&<span>Mídias desativadas neste servidor.</span>}
  </div>
}
