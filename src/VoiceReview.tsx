import {useState} from 'react'
import type {VoiceReviewGroup} from '../shared/voice-review'
const symbols={add:'+',remove:'−',change:'↔',pending:'!',warning:'!'}
const labels={add:'Inclusão ou habilitação',remove:'Remoção ou desabilitação',change:'Alteração',pending:'Pendência — não será aplicada',warning:'Atenção operacional'}
export function VoiceReview({groups,onResolve,onClarify,busy=false}:{groups:VoiceReviewGroup[];onResolve?:(id:string)=>void;onClarify?:(id:string)=>void;busy?:boolean}){
 const[expanded,setExpanded]=useState<Record<string,number>>({})
 return <section className="voice-review" aria-label="Alterações previstas">
  {groups.length===0?<p>Nenhuma alteração.</p>:<p className="voice-review-scope">Dados compartilhados; habilitação por cenário.</p>}
  {groups.map(group=><section className="voice-piece" key={group.id} aria-label={group.piece}>
   <h3>{group.piece}</h3>
   <ul>{group.entries.map((entry,index)=><li key={index} className={'voice-entry '+entry.kind}>
    <span className="voice-symbol" aria-label={labels[entry.kind]}>{symbols[entry.kind]}</span>
    <div className="voice-entry-body"><span className="voice-entry-label">{entry.label}</span>
     {entry.scope!=='shared'&&entry.kind!=='pending'&&entry.kind!=='warning'&&<small className="voice-scope">{entry.scope==='global'?'Excluir em todos os cenários':'Só neste cenário'}</small>}
     {entry.fields.length>0&&<dl>{entry.fields.map((field,i)=><div key={i}><dt>{field.label}</dt><dd>{field.before!==undefined&&<><span className="voice-before">{field.before}</span><span aria-label="para"> → </span></>}{field.after}</dd></div>)}</dl>}
     {entry.pendingId&&<div className="voice-options">
      {(entry.options??[]).slice(0,expanded[entry.pendingId]??3).map(option=><button key={option.id} disabled={busy} onClick={()=>onResolve?.(option.id)}>{option.label}</button>)}
      {(entry.options?.length??0)>(expanded[entry.pendingId]??3)&&<button disabled={busy} onClick={()=>setExpanded(old=>({...old,[entry.pendingId!]:(old[entry.pendingId!]??3)+3}))}>Mais opções</button>}
      <button disabled={busy} onClick={()=>onClarify?.(entry.pendingId!)} aria-label={'Falar sobre '+group.piece+' — '+entry.label}>Falar</button>
     </div>}
     {entry.kind==='pending'&&<small className="voice-warning">Não será aplicado sem resolver.</small>}
     {entry.warning&&<small className="voice-warning">{entry.warning}</small>}
    </div>
   </li>)}</ul>
  </section>)}
 </section>
}
