import {readFileSync} from 'node:fs'
import type {WorkOrder} from '../shared/work-order.ts'
import {deliveryDateLabel} from '../shared/delivery-date.ts'
import {type StageCluster} from '../shared/stage-clusters.ts'
// Ordem de apresentação da OS: não altera IDs ou categorias do cadastro comercial.
const PRINT_CLUSTERS:readonly StageCluster[]=[
  'Preparação técnica','Correção estrutural','Pintura e acabamento',
  'Serviços complementares','Estética e revitalização'
]

/** V1.1 isolates the three Chromium document contexts. V1 remains a regression fixture. */
const master=readFileSync(new URL('./templates/FUNIX_OS_V1_1.html',import.meta.url),'utf8')
type Part='header'|'body'|'footer'|'margins'
function section(part:Part,kind:'style'|'template'):string{
 const marker=kind==='style'?'<style data-os="'+part+'">':'<template id="os-'+part+'">'
 const start=master.indexOf(marker)
 const end=master.indexOf('</'+kind+'>',start+marker.length)
 if(start<0||end<0||master.indexOf(marker,start+1)>=0)throw Error('Seção inválida da OS V1.1: '+part+'/'+kind)
 return master.slice(start+marker.length,end).trim()
}
// Native Chromium margins are sensitive to the original complete cascade.
// Retain that exact cascade until independent render regression proves a reduction.
const bodyCss=section('body','style'),marginCss=section('margins','style')
const header=section('header','template'),main=section('body','template'),footer=section('footer','template')
function fill(source:string,values:Record<string,string>):string{
 const seen=new Set<string>()
 const output=source.replace(/\{\{([A-Z_]+)\}\}/g,(_token,key:string)=>{
   if(!Object.hasOwn(values,key))throw Error('Campo desconhecido na OS V1.1: '+key)
   seen.add(key)
   return values[key]!
 })
 for(const key of Object.keys(values))if(!seen.has(key))throw Error('Campo ausente na OS V1.1: '+key)
 return output
}
const icons=new Map<string,string>()
for(const svg of footer.match(/<svg\b[\s\S]*?<\/svg>/g)??[]){
 const name=svg.match(/aria-label="([^"]+)"/)?.[1]
 if(name)icons.set(name,svg)
}
const commentIcon='<svg aria-hidden="true" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M5 3h14a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H9l-6 4v-4a3 3 0 0 1-1-3V6a3 3 0 0 1 3-3Z"/></svg>'
const esc=(value:string)=>value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;')
const html=(value:string)=>esc(value||'')
function letter(index:number):string{
 let text=''
 for(let n=index+1;n>0;n=Math.floor((n-1)/26))text=String.fromCharCode(65+(n-1)%26)+text
 return text
}
function rows(order:WorkOrder):string{
 const {diagnostics,lines}=order.scope
 // Preserve the original first-seen order and first diagnosis per piece.
 const pieces=new Map<string,{diag?:typeof diagnostics[number];items:typeof lines}>()
 for(const diag of diagnostics){
  if(!pieces.has(diag.pieceId))pieces.set(diag.pieceId,{diag,items:[]})
 }
 for(const line of lines){
  let piece=pieces.get(line.pieceId)
  if(!piece){piece={items:[]};pieces.set(line.pieceId,piece)}
  piece.items.push(line)
 }
 return [...pieces.values()].map(({diag,items},index)=>{
  const name=diag?.pieceName||items[0]?.pieceName||'Peça não identificada'
  const symbol=letter(index),components=items.filter(l=>l.kind==='component')
  const grouped=new Map<StageCluster,string[]>(PRINT_CLUSTERS.map(c=>[c,[]]))
  // A OS é um plano de execução: diagnóstico não é uma observação operacional.
  const notes=diag?.notes?[diag.notes]:[]
  for(const item of items){
   if(item.kind==='component'&&item.notes)notes.push(item.name+': '+item.notes)
   if(item.kind!=='service')continue
   if(item.notes)notes.push(item.name+': '+item.notes)
   if(item.quantity!=='1')notes.push(item.name+': quantidade '+item.quantity)
   if(!item.stages.length)notes.push('Serviço sem etapas cadastradas: '+item.name)
   for(const stage of item.stages){
    // A dimensão permanece no escopo congelado; a matriz mostra apenas o nome da etapa.
    const label=stage.name
    if(stage.cluster&&grouped.has(stage.cluster))grouped.get(stage.cluster)!.push(label)
    else notes.push('Etapa sem categoria ('+item.name+'): '+label)
   }
  }
  const active=PRINT_CLUSTERS.filter(c=>grouped.get(c)!.length)
  const rowIcons=[...(components.length?['Requer componentes']:[]),...active]
    .map(category=>icons.get(category)||'').join('')
  const componentHtml=components.map((item,i)=>{
    const code=symbol+(i+1)
    const variant=i===0?' piece-ladder-code--first':i===components.length-1?' piece-ladder-code--last':''
    const quantity=item.quantity?item.quantity+' un.':''
    return '<div class="piece-ladder-code'+variant+'">'+html(code)+'</div>'+
      '<div class="piece-ladder-component'+(i===0?' piece-ladder-component--first':'')+'">'+
      '<span class="piece-ladder-desc">'+html(item.name)+'</span>'+
      '<span class="piece-ladder-qty">'+html(quantity)+'</span></div>'
  }).join('')
  const uniqueNotes=[...new Set(notes.map(note=>note.trim()).filter(Boolean))]
  const remarks=uniqueNotes.length?
    '<div class="piece-ladder-comment-marker" aria-label="Observações da peça">'+commentIcon+'</div>'+
    '<div class="piece-ladder-comment-content"><span class="piece-comment-text">'+uniqueNotes.map(html).join(' • ')+'</span></div>':''
  const first='<th class="piece-block-cell" scope="row"><div class="piece-ladder">'+
    '<span class="piece-letter">'+symbol+'</span>'+
    '<div class="piece-ladder-head"><div class="piece-ladder-name">'+html(name)+'</div>'+
    '<div class="piece-ladder-icons">'+rowIcons+'</div></div>'+
    componentHtml+remarks+'</div></th>'
  const cols=PRINT_CLUSTERS.map(category=>{
   const stages=grouped.get(category)!
   return '<td data-cluster="'+html(category)+'">'+
     (stages.length?'<ul class="service-group stage-list">'+stages.map(name=>
       '<li class="stage-entry"><span class="stage-name">'+html(name)+'</span></li>').join('')+'</ul>':
       '<span class="empty">—</span>')+'</td>'
  }).join('')
  return '<tr data-piece-ref="'+symbol+'">'+first+cols+'</tr>'
 }).join('')
}

export interface OrderPrintTemplate{content:string;headerTemplate:string;footerTemplate:string}

export function renderOrderV1(order:WorkOrder):OrderPrintTemplate{
 const vehicle=[order.scope.vehicle.description,order.scope.vehicle.plate?'('+order.scope.vehicle.plate+')':''].filter(Boolean).join(' ')||'Veículo não informado'
 const number=order.number+(order.scope.deliveryDate!==undefined||order.revision?' R'+String(order.revision??1).padStart(2,'0'):'')
 const delivery=deliveryDateLabel(order.scope.deliveryDate)
 const headerHtml=fill(header,{
  VEHICLE_CLASS:vehicle.length>=55?' vehicle-field--long':'',
  VEHICLE:html(vehicle),NUMBER:html(number),DELIVERY:html(delivery)
 })
 const body=fill(main,{ROWS:rows(order)})
 // V1 foi fornecida com elementos fixed e overflow hidden para uma página.
 // No Chromium, somente a área da matriz flui por várias páginas.
 const chromePrint='@page plan{size:A4 landscape;margin:23mm 5mm 15mm 5mm}'+
  'html,body{height:auto!important;width:auto!important;margin:0!important;padding:0!important;overflow:visible!important;background:#fff!important;}'+
  '.plan-page{position:static!important;top:auto!important;left:auto!important;width:100%!important;max-width:100%!important;margin:0!important;padding:0!important;box-shadow:none!important;}'+
  '.execution{margin:0!important;padding:0!important;}'+
  '.main-matrix tbody tr{break-inside:avoid!important;page-break-inside:avoid!important;}'
 const content='<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><style>'+bodyCss+'\n'+chromePrint+
  '</style></head><body>'+body+'</body></html>'
 const chromeHeader='html,body{height:auto!important;width:auto!important;overflow:visible!important;margin:0!important;padding:0!important;background:transparent!important;}'+
  'body .running-header.plan-header{position:static!important;top:auto!important;left:auto!important;width:287mm!important;max-width:287mm!important;margin:0!important;transform:none!important;}'
 const chromeFooter='html,body{height:auto!important;width:auto!important;overflow:visible!important;margin:0!important;padding:0!important;background:transparent!important;}'+
  '.footer-legend{position:fixed!important;top:198.4mm!important;left:5mm!important;width:287mm!important;height:8.7mm!important;min-height:8.7mm!important;margin:0!important;transform:none!important;}'+
  '.footer-legend .legend-item{transform:none!important;}'
 const wrap=(fragment:string,styles:string,extraCss:string)=>
  '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><style>'+
   styles+'\n'+extraCss+'</style></head><body>'+fragment+'</body></html>'
 return{content,headerTemplate:wrap(headerHtml,marginCss,chromeHeader),footerTemplate:wrap(footer,marginCss,chromeFooter)}
}
