import {useCallback,useEffect,useRef,useState} from 'react'
import type {CatalogResponse} from '../shared/commercial'
import type {PricingConfiguration} from '../shared/pricing'
import {api} from './api'
import{InstallmentEditor}from'./InstallmentEditor'
import type {RequestFailure} from './api'
import {CatalogManager} from './CommercialPanel'
import {PricingEditor} from './PricingEditor'
import {Login} from './ui'

export function SettingsPage({onDirty,onBusy}:{onDirty:(v:boolean)=>void;onBusy:(v:boolean)=>void}){
 const [section,setSection]=useState<'catalogos'|'precos'|'parcelamento'>('catalogos')
 const [catalog,setCatalog]=useState<CatalogResponse|null>(null),[pricing,setPricing]=useState<PricingConfiguration|null>(null)
 const [error,setError]=useState(''),[reauth,setReauth]=useState(false),[busy,setBusy]=useState(false)
 const dirty=useRef(false)
 const handleDirty=useCallback((v:boolean)=>{dirty.current=v;onDirty(v)},[onDirty])
 const handleBusy=useCallback((v:boolean)=>{setBusy(v);onBusy(v)},[onBusy])
 const requireAuth=useCallback(()=>setReauth(true),[])
 const load=useCallback(async()=>{
  const [c,p]=await Promise.all([api<CatalogResponse>('/api/catalogos'),api<PricingConfiguration>('/api/precificacao')])
  setCatalog(c);setPricing(p);setError('')
 },[])
 useEffect(()=>{let active=true;Promise.resolve().then(load).catch((e:RequestFailure)=>{if(active){setError(e.message);if(e.status===401)setReauth(true)}});return()=>{active=false}},[load])
 useEffect(()=>()=>{onDirty(false);onBusy(false)},[onDirty,onBusy])
 function select(next:typeof section){if(next===section||busy)return;if(dirty.current&&!window.confirm('Há alterações não salvas. Deseja descartá-las?'))return;handleDirty(false);setSection(next)}
 return <section className="settings-page commercial-page" aria-label="Configurações globais"><h1>Configurações</h1><nav className="fh-tabs settings-tabs" aria-label="Seções de Configurações"><button className={section==='catalogos'?'selected':''} aria-pressed={section==='catalogos'} disabled={busy} onClick={()=>select('catalogos')}>Catálogos</button><button className={section==='precos'?'selected':''} aria-pressed={section==='precos'} disabled={busy} onClick={()=>select('precos')}>Precificação</button><button className={section==='parcelamento'?'selected':''} aria-pressed={section==='parcelamento'} disabled={busy} onClick={()=>select('parcelamento')}>Parcelamento</button></nav>
 {reauth&&<div className="commercial-reauth"><p>Entre novamente. Os campos foram preservados.</p><Login session={{authenticated:false,configured:true}} error="" refresh={()=>{}} onSession={()=>{setReauth(false);if(!catalog||!pricing)void load().catch(e=>setError(e.message))}}/></div>}
 {error&&<p className="form-error" role="alert">{error}<button className="fh-filter" disabled={busy} onClick={()=>{void load().catch(e=>setError(e.message))}}>Tentar novamente</button></p>}
 {section==='parcelamento'?<InstallmentEditor onDirty={handleDirty} onBusy={handleBusy} onAuthRequired={requireAuth}/>:!catalog||!pricing?<p className="at-form-hint">Carregando configurações…</p>:section==='catalogos'?<CatalogManager catalog={catalog} onChanged={load} onDirty={handleDirty} onBusy={handleBusy} onAuthRequired={requireAuth}/>:<PricingEditor key={pricing.revision} initial={pricing} catalog={catalog.items} onSaved={async()=>{await load();handleDirty(false)}} onDirty={handleDirty} onBusy={handleBusy} onAuthRequired={requireAuth}/>}
 </section>
}
