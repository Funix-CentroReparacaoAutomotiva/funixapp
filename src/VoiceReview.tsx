import {useState} from 'react'
import {ComponentQuotation} from './ComponentQuotation'
import {voiceReviewName} from './voice-review-name'
import {componentDecimal} from '../shared/voice-components'
import type {VoiceReviewGroup} from '../shared/voice-review'
const symbols={add:'+',remove:'−',change:'↔',pending:'!',warning:'!',noop:'✓'}
const labels={add:'Inclusão ou habilitação',remove:'Remoção ou desabilitação',change:'Alteração',pending:'Pendência — não será aplicada',warning:'Atenção operacional',noop:'Já está assim'}
export function VoiceReview({groups,onResolve,onClarify,onComponentChange,onComponentRevise,onComponentToggle,atendimentoId,componentDrafts={},decisionsDisabled=false,busy=false}:{atendimentoId:string;groups:VoiceReviewGroup[];onResolve?:(id:string)=>void;onClarify?:(id:string)=>void;busy?:boolean;decisionsDisabled?:boolean;componentDrafts?:Record<string,{quantity:string;manualPrice:string}>;onComponentChange?:(id:string,value:{quantity:string;manualPrice:string})=>void;onComponentRevise?:(id:string)=>void;onComponentToggle?:(id:string,enabled:boolean)=>void}){
 const[expanded,setExpanded]=useState<Record<string,number>>({})
 return <section className="voice-review" aria-label="Alterações previstas">
  {groups.length===0&&<p>Nenhuma alteração.</p>}
  {groups.map(group=><section className="voice-piece" key={group.id} aria-label={voiceReviewName(group.piece)}>
   <h3>{voiceReviewName(group.piece)}</h3>
   <ul>{group.entries.map((entry,index)=><li key={index} className={'voice-entry '+entry.kind}>
    <span className="voice-symbol" aria-label={labels[entry.kind]}>{symbols[entry.kind]}</span>
    <div className="voice-entry-body"><span className="voice-entry-label">{entry.component||entry.nameKind==='component'?voiceReviewName(entry.label):entry.label}</span>
     {entry.scope!=='shared'&&entry.kind!=='pending'&&entry.kind!=='warning'&&<small className="voice-scope">{entry.scope==='global'?'Excluir em todos os cenários':'Só neste cenário'}</small>}
     {entry.fields.length>0&&<dl>{entry.fields.map((field,i)=><div key={i}><dt>{field.label}</dt><dd>{field.before!==undefined&&<><span className="voice-before">{field.before}</span><span aria-label="para"> → </span></>}{field.namePrefix?voiceReviewName(field.namePrefix)+field.after.slice(field.namePrefix.length):field.after}</dd></div>)}</dl>}
     {entry.component&&(()=>{const c=entry.component!,draft=componentDrafts[c.commandId],value=draft??{quantity:c.quantity,manualPrice:displayPrice(c.manualPrice)};return <ComponentQuotation key={c.commandId} value={value} enabled={c.enabled??true} parentEnabled={c.parentEnabled!==false} busy={busy} atendimentoId={atendimentoId} componentName={entry.label} onChange={v=>onComponentChange?.(c.commandId,v)} onRevise={draft?()=>onComponentRevise?.(c.commandId):undefined} onToggle={()=>onComponentToggle?.(c.commandId,!(c.enabled??true))}/>})()}
     {entry.pendingId&&<div className="voice-options">
      {(entry.options??[]).slice(0,expanded[entry.pendingId]??3).map(option=><button key={option.id} disabled={busy||decisionsDisabled} onClick={()=>onResolve?.(option.id)}>{option.label}</button>)}
      {(entry.options?.length??0)>(expanded[entry.pendingId]??3)&&<button disabled={busy} onClick={()=>setExpanded(old=>({...old,[entry.pendingId!]:(old[entry.pendingId!]??3)+3}))}>Mais opções</button>}
      <button disabled={busy||decisionsDisabled} onClick={()=>onClarify?.(entry.pendingId!)} aria-label={'Falar sobre '+group.piece+' — '+entry.label}>Falar</button>
     </div>}
     {entry.kind==='pending'&&<small className="voice-warning">Não será aplicado sem resolver.</small>}
     {entry.warning&&<small className="voice-warning">{entry.warning}</small>}
    </div>
   </li>)}</ul>
  </section>)}
 </section>
}

function displayPrice(value:string){if(!componentDecimal(value))return value;const [whole,fraction='']=value.split('.');return whole+','+fraction.padEnd(2,'0')}
