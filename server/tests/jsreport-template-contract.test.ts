import test from'node:test'
import assert from'node:assert/strict'
import{readFileSync}from'node:fs'
import{toJsreportData}from'../jsreport-adapter.ts'
import{centAmount,exactAmount}from'../budget-terms.ts'
import{TEMPLATE_CASES,templateCase}from'./fixtures/template-cases.ts'

for(const name of TEMPLATE_CASES)test('supplied PDF template contract: '+name,async()=>{
 const{version,preview}=await templateCase(name),frozen=JSON.stringify(version.snapshot),data=toJsreportData(version),c=version.snapshot.calculation
 assert.equal(data.financeiro.servicos,'R$ '+centAmount(exactAmount(c.serviceNet!)).replace(/\B(?=(\d{3})+\.)/g,'.').replace(/\.(\d{2})$/,',$1'))
 // The printed plus/equal expression uses net services, not gross minus discount again.
 assert.equal(exactAmount(c.serviceNet!).add(exactAmount(c.componentSubtotal!)).toString(),c.total)
 assert.deepEqual(data,version.snapshot.document!.data);assert.equal(JSON.stringify(version.snapshot),frozen);assert.deepEqual(c,preview.snapshot.calculation)
 assert(data.diagnosticos.every(d=>d.clusters.length>0));assert.equal(data.meta.id,version.documentNumber);assert.equal(data.condicoes.prazo,String(version.snapshot.executionDeadline!.effectiveDays))
 if(name==='discount'||name==='adjust-down')assert.equal(data.financeiro.servicos,'R$ 250,15')
 if(name==='discount')assert.equal(data.financeiro.desconto,'R$ 50,00')
 if(name==='normal'||name==='adjust-up')assert.equal(data.financeiro.desconto,'')
 if(name==='free'){assert.equal(c.lines[0]!.unit,null);assert.equal(c.lines[0]!.total,null);assert.equal(data.diagnosticos[0]!.clusters[0]!.valor,'Sem cobrança');assert.equal(data.diagnosticos[0]!.totalServicos,'')}
 if(name==='components'){assert.equal(data.diagnosticos[0]!.totalServicos,'');assert.equal(data.diagnosticos[0]!.clusters[0]!.tipo,'itens')}
 if(name==='empty-details'){assert.equal(data.cliente.nome,'');assert.equal(data.veiculo.placa,'');assert.equal(data.veiculo.modelo,'')}
 if(name==='fractional')assert.equal(c.lines[0]!.quantity,'0.1')
})
test('supplied template contains only the adapter contract and no hidden financial calculations',()=>{
 const template=readFileSync(new URL('../../docs/referencias/pdf/FUNIX_ORCAMENTO_TEMPLATE_FORNECIDO.html',import.meta.url),'utf8')
 const values=[...template.matchAll(/{{\s*([\w.@]+)\s*}}/g)].map(m=>m[1]!).filter(v=>v!=='else')
 assert.deepEqual([...new Set(values)].sort(),['meta.id','meta.dataCriacao','cliente.nome','cliente.contato','veiculo.placa','veiculo.modelo','nome','resumo','totalServicos','totalComponentes','this','valorTotal','valor','condicoes.prazo','financeiro.desconto','financeiro.servicos','financeiro.pecas','financeiro.totalVista',...['tres','seis','nove','doze'].flatMap(k=>['valorParcela','total'].map(f=>'parcelamento.'+k+'.'+f))].sort())
 assert(template.includes('{{financeiro.servicos}}'));assert(template.includes('{{#if financeiro.desconto}}'));assert(!template.includes('{{valorUnitario}}'));assert(!template.includes('{{quantidade}}'))
})

test('already frozen renderer JSON is sent literally, not remapped by the new template presentation',async()=>{
 const{renderJsreportPdf}=await import('../jsreport-client.ts'),{frozenTerms}=await import('../jsreport-adapter.ts'),{version}=await templateCase('discount')
 // Represents a document frozen by the preceding commit; never rewrite historical data.
 version.snapshot.document!.data.financeiro.servicos='R$ 300,15'
 const before=JSON.stringify(version.snapshot),data=structuredClone(version.snapshot.document!.data);let sent:unknown
 const pdf=await renderJsreportPdf(version,frozenTerms(version.snapshot),{endpoint:'https://renderer.invalid/api/report',username:'synthetic',password:'synthetic',template:'FUNIX - Orcamento'},async(_url,init)=>{sent=JSON.parse(String(init?.body));return new Response('%PDF-1.7\nSYNTHETIC\n%%EOF',{headers:{'Content-Type':'application/pdf'}})})
 assert.deepEqual(sent,{template:{name:'FUNIX - Orcamento'},data});assert.equal(JSON.stringify(version.snapshot),before);assert(pdf.subarray(0,5).equals(Buffer.from('%PDF-')))
})
