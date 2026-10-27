import {money} from './money'
import type {NegotiationDraft,NegotiationState} from './negotiation'
export function NegotiationEditor({state,onChange,onPreview,busy,fresh,reviewable}:{state:NegotiationState;onChange:(draft:NegotiationDraft)=>void;onPreview:()=>Promise<void>;busy:boolean;fresh:boolean;reviewable:boolean}){
 const d=state.draft,c=fresh?state.preview?.snapshot.calculation:null,residual=state.preview?.snapshot.calculation
 return <details className="negotiation-disclosure"><summary>Negociação comercial</summary><div className="negotiation-fields">
  <label className="at-field">Modalidade<select aria-label="Modalidade de negociação" disabled={busy} value={d.mode} onChange={e=>onChange({mode:e.target.value as NegotiationDraft['mode'],value:'',acknowledgeResidual:false})}><option value="none">Sem ajuste</option><option value="discount">Desconto</option><option value="adjust">Negociação comercial</option></select></label>
  {d.mode!=='none'&&<label className="at-field">{d.mode==='discount'?'Desconto em serviços (R$)':'Total final desejado (R$)'}<input aria-label={d.mode==='discount'?'Desconto em serviços (R$)':'Total final desejado (R$)'} inputMode="decimal" disabled={busy} value={d.value} onChange={e=>onChange({...d,value:e.target.value,acknowledgeResidual:false})}/></label>}
  {d.mode!=='none'&&<p className="at-form-hint">{d.mode==='discount'?'Desconto absoluto somente sobre serviços.':'O total informado inclui os componentes, que permanecem inalterados.'}</p>}
  {d.mode!=='none'&&<button type="button" className="fh-filter" disabled={busy} onClick={onPreview}>Atualizar prévia</button>}
  {d.mode!=='none'&&!fresh&&<p className="at-form-hint" role="status">Negociação pendente de cálculo. Atualize a prévia para confirmar o total efetivo.</p>}
  {reviewable&&d.mode==='adjust'&&residual&&residual.residual!=='0'&&<div className="negotiation-residual"><p>{fresh?'Prévia atual':'Última prévia'} · Diferença residual: {money(residual.residual)}. Total efetivo: {money(residual.total)}.</p><label className="commercial-check"><input type="checkbox" disabled={busy} checked={d.acknowledgeResidual} onChange={e=>onChange({...d,acknowledgeResidual:e.target.checked})}/> Estou ciente da diferença residual informada e do total efetivo a emitir.</label></div>}
  {c&&c.errors.length>0&&<ul className="form-error">{c.errors.map((e,i)=><li key={i}>{e}</li>)}</ul>}
 </div></details>
}
