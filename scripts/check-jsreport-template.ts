// QA only: Handlebars lives in an ignored local prefix, never a runtime dependency.
import assert from'node:assert/strict'
import{createRequire}from'node:module'
import{mkdirSync,readFileSync,writeFileSync}from'node:fs'
import{isAbsolute,relative,resolve}from'node:path'
import{createHash}from'node:crypto'
import{TEMPLATE_CASES,templateCase}from'../server/tests/fixtures/template-cases.ts'
const[modulePath,destination]=process.argv.slice(2)
if(!modulePath||!destination||process.argv.length!==4)throw Error('Uso QA: node scripts/check-jsreport-template.ts CAMINHO_HANDLEBARS PASTA_RUNTIME_QA')
const root=resolve('.runtime'),output=resolve(destination),rel=relative(root,output)
if(!rel||rel.startsWith('..')||isAbsolute(rel))throw Error('Saída QA deve ficar em subdiretório de .runtime.')
const Handlebars=createRequire(import.meta.url)(resolve(modulePath))as{VERSION:string;compile:(source:string)=>(data:unknown)=>string}
assert.equal(Handlebars.VERSION,'4.7.9')
const source=readFileSync(new URL('../docs/referencias/pdf/FUNIX_ORCAMENTO_TEMPLATE_FORNECIDO.html',import.meta.url),'utf8'),render=Handlebars.compile(source)
mkdirSync(output,{recursive:true})
const results=[]
for(const name of TEMPLATE_CASES){
 const{version}=await templateCase(name),data=version.snapshot.document!.data,html=render(data)
 assert(!/undefined|NaN|{{/.test(html));assert(!html.includes('<script>alert(1)</script>'))
 assert(html.includes(data.meta.id));assert(html.includes(data.financeiro.totalVista));assert(html.includes(data.condicoes.prazo+' dias úteis'))
 for(const plan of Object.values(data.parcelamento)){assert(html.includes(plan.total));assert(html.includes(plan.valorParcela))}
 if(name==='empty-details')assert(html.includes('Não informado'))
 if(name==='free')assert(html.includes('Sem cobrança'))
 if(name==='discount')assert(/- R\$ 50,00/.test(html))
 if(name==='normal')assert(!/- R\$ 0,00/.test(html))
 writeFileSync(resolve(output,name+'.html'),html);writeFileSync(resolve(output,name+'.json'),JSON.stringify(data,null,2)+'\n')
 const cents=(value:string)=>BigInt(value.replace(/[^\d-]/g,'')),f=data.financeiro
 results.push({case:name,pass:true,pieces:data.diagnosticos.length,displayedSumDifferenceCents:String(cents(f.servicos)+cents(f.pecas)-cents(f.totalVista))})
}
writeFileSync(resolve(output,'results.json'),JSON.stringify({synthetic:true,handlebars:Handlebars.VERSION,templateSha256:createHash('sha256').update(source).digest('hex'),results},null,2)+'\n');console.log(JSON.stringify({synthetic:true,rendered:results.length,results}))
