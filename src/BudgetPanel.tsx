import {useCallback,useEffect,useRef,useState} from 'react'
import type {CatalogItem} from '../shared/commercial'
import type {BudgetPreview,BudgetVersion,PricingConfiguration} from '../shared/pricing'
import {api} from './api'
import type {RequestFailure} from './api'
import {PricingEditor} from './PricingEditor'
import {money} from './money'
type VersionMeta=Omit<BudgetVersion,'snapshot'>&{total:string}
export function BudgetPanel({at,catalog,onRefresh,onDirty,onBusy,onAuthRequired,externalBusy,onBack}:{at:string;catalog:CatalogItem[];onRefresh:()=>Promise<void>;onDirty:(v:boolean)=>void;onBusy:(v:boolean)=>void;onAuthRequired:()=>void;externalBusy:boolean;onBack:()=>void}){
 const [configuration,setConfiguration]=useState<PricingConfiguration|null>(null),[versions,setVersions]=useState<VersionMeta[]>([]),[version,setVersion]=useState<BudgetVersion|null>(null),[configuring,setConfiguring]=useState(false),[error,setError]=useState(''),[ownBusy,setBusy]=useState(false)
 const dirty=useRef(false),busy=ownBusy||externalBusy
 const childDirty=useCallback((v:boolean)=>{dirty.current=v;onDirty(v)},[onDirty])
 const childBusy=useCallback((v:boolean)=>{setBusy(v);onBusy(v)},[onBusy])
 useEffect(()=>()=>onDirty(false),[onDirty])
 const load=useCallback(async()=>{const [c,v]=await Promise.all([api<PricingConfiguration>('/api/precificacao'),api<VersionMeta[]>(`/api/atendimentos/${at}/orcamentos`)]);setConfiguration(c);setVersions(v)},[at])
 useEffect(()=>{let active=true;Promise.resolve().then(load).catch(e=>{if(active)setError(e.message)});return()=>{active=false}},[load])
 async function operation(action:()=>Promise<void>){if(busy)return;childBusy(true);setError('');try{await action()}catch(e){setError((e as Error).message);if((e as RequestFailure).status===401)onAuthRequired()}finally{childBusy(false)}}
 function back(){if(busy||(dirty.current&&!window.confirm('Há alterações não salvas. Deseja descartá-las?')))return;childDirty(false);setConfiguring(false);setVersion(null)}
 return <section aria-label="Histórico e configuração comercial"><div className="commercial-toolbar"><h2>{configuring?'Configuração comercial':version?'Versão emitida':'Histórico de orçamentos'}</h2><button className="fh-filter" disabled={busy} onClick={configuring||version?back:onBack}>Voltar aos Diagnósticos</button>{!configuring&&!version&&<button className="fh-filter" disabled={busy||!configuration} onClick={()=>setConfiguring(true)}>Configuração comercial</button>}</div>{error&&<p role="alert" className="form-error">{error}</p>}
 {configuring&&configuration?<PricingEditor initial={configuration} catalog={catalog} onSaved={async()=>{await onRefresh();await load();childDirty(false);setConfiguring(false)}} onDirty={childDirty} onBusy={childBusy} onAuthRequired={onAuthRequired}/>:version?<><p>Documento imutável, emitido em {new Date(version.createdAt).toLocaleString('pt-BR')}. Não utiliza o catálogo atual.</p><CalculationView preview={{snapshot:version.snapshot,token:'',canEmit:true}}/><button className="primary-btn" disabled={busy} onClick={()=>operation(async()=>{const r=await fetch(`/api/atendimentos/${at}/orcamentos/${version.id}/pdf`,{credentials:'same-origin'});if(!r.ok||!r.headers.get('content-type')?.includes('application/pdf'))throw new Error('Não foi possível baixar o PDF.');const u=URL.createObjectURL(await r.blob()),a=document.createElement('a');a.href=u;a.download=`FUNIX-${version.label}.pdf`;a.click();setTimeout(()=>URL.revokeObjectURL(u),1000)})}>Baixar PDF {version.label}</button></>:<>{versions.map(v=><button className="catalog-row" key={v.id} disabled={busy} onClick={()=>operation(async()=>{setVersion(await api<BudgetVersion>(`/api/atendimentos/${at}/orcamentos/${v.id}`))})}>Orçamento {v.label} · {new Date(v.createdAt).toLocaleString('pt-BR')} · {money(v.total)}</button>)}{!versions.length&&<p className="at-form-hint">Nenhuma versão emitida.</p>}<p className="at-form-hint">A composição e a emissão ficam nos Diagnósticos. A configuração comercial é global; os parâmetros Tabela, FC, FR e MR do Atendimento ficam no painel financeiro.</p></>}
 </section>
}

export function CalculationView({preview,scenarioName}:{preview:BudgetPreview;scenarioName?:string}){
 const c=preview.snapshot.calculation
 return <section className="budget-preview" aria-label="Prévia de orçamento"><h3>{scenarioName??c.scenarioName}</h3>{c.errors.length>0&&<ul className="form-error">{c.errors.map((e,i)=><li key={i}>{e}</li>)}</ul>}
 {c.lines.map(l=><article className={`diagnosis-card ${l.included?'':'excluded'}`} key={l.id}><strong>{l.pieceName} · {l.name}</strong><p>{l.dimension} {l.diagnosis} {l.notes}</p>{l.included?<p>{l.quantity} × {money(l.finalUnit)} = {money(l.total)}</p>:<p>{l.quantity} · Fora deste cenário: não integra totais ou PDF.</p>}{l.finalUnit!==l.unit&&<small>Unitário de referência: {money(l.unit)}</small>}</article>)}
 <dl className="budget-summary"><div><dt>Serviços originais</dt><dd>{money(c.originalServiceSubtotal)}</dd></div><div><dt>Serviços efetivos</dt><dd>{money(c.serviceSubtotal)}</dd></div><div><dt>Desconto em serviços</dt><dd>{money(c.discount)}</dd></div><div><dt>Componentes</dt><dd>{money(c.componentSubtotal)}</dd></div><div><dt>Total efetivo</dt><dd>{money(c.total)}</dd></div><div><dt>Energia / dias técnicos</dt><dd>{c.energy??'Pendente'} / {c.days??'Pendente'}</dd></div></dl>
 {preview.snapshot.requestedTotal!==undefined&&<p>Total final desejado: {money(preview.snapshot.requestedTotal)}.</p>}
 {c.target!==null&&<p>{preview.snapshot.requestedTotal!==undefined?'Meta do subtotal de serviços':'Subtotal de serviços informado'}: {money(c.target)}. Resíduo (informado − efetivo): {money(c.residual)}.</p>}
 <p className="at-form-hint">Dias técnicos são estimativa de escopo, não data de entrega nem autorização de execução.</p><p>{preview.snapshot.conditions||'Condições comerciais ainda não informadas.'}</p></section>
}
