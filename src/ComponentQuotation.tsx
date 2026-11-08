import {ComponentSearchLinks} from './ComponentSearchLinks'

// Preserve commercial review controls; search links never trigger quotation or writes.
export function ComponentQuotation({value,enabled,parentEnabled,busy,atendimentoId,componentName,onChange,onRevise,onToggle}:{value:{quantity:string;manualPrice:string};enabled:boolean;parentEnabled:boolean;busy:boolean;atendimentoId:string;componentName:string;onChange:(v:{quantity:string;manualPrice:string})=>void;onRevise?:()=>void;onToggle:()=>void}){
 return <div className="voice-component-values">
  <div className="voice-component-line">
   <button type="button" className="voice-component-switch" role="switch" aria-label="Habilitar componente neste cenário" aria-checked={enabled&&parentEnabled} aria-description={!parentEnabled?'Peça desabilitada neste cenário; componente fora do cálculo.':undefined} disabled={busy||!parentEnabled} onClick={onToggle}><span aria-hidden="true"/></button>
   <label>Qtd.<input aria-label="Quantidade do componente" inputMode="decimal" disabled={busy} value={value.quantity} onChange={e=>onChange({...value,quantity:e.target.value})}/></label>
   <label>Preço base (R$)<input aria-label="Preço unitário do componente" aria-description="Preço unitário base, antes da Margem de Referência" inputMode="decimal" disabled={busy} value={value.manualPrice} onChange={e=>onChange({...value,manualPrice:e.target.value})}/></label>
  </div>
  <ComponentSearchLinks atendimentoId={atendimentoId} componentName={componentName} className="voice-inline-search"/>
  {onRevise&&<button className="voice-component-revise" disabled={busy} onClick={onRevise}>Revisar valores</button>}
 </div>
}
