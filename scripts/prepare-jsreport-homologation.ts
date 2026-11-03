// Preparation only. No external calls, credentials, installed database or real PDF output.
import assert from'node:assert/strict'
import{existsSync,mkdirSync,writeFileSync}from'node:fs'
import{createHash}from'node:crypto'
import{execFileSync}from'node:child_process'
import{isAbsolute,relative,resolve}from'node:path'
import{templateCase}from'../server/tests/fixtures/template-cases.ts'
import{toJsreportData}from'../server/jsreport-adapter.ts'
const approved='85d8659e0b6bcadb2a18c220e374c63a431334d7',args=process.argv.slice(2)
if(args.length!==1)throw Error('Uso: node scripts/prepare-jsreport-homologation.ts .runtime/PASTA_QA_NOVA')
const output=resolve(args[0]),rel=relative(resolve('.runtime'),output)
if(!rel||rel.startsWith('..')||isAbsolute(rel)||existsSync(output))throw Error('Saída deve ser uma pasta nova dentro de .runtime.')
assert.equal(execFileSync('git',['diff',approved,'--','server','shared'],{encoding:'utf8'}).trim(),'','Código funcional difere do commit de referência; revisar antes de preparar os dados.')
mkdirSync(output,{recursive:true,mode:0o700})
const cases=[['01-duas-categorias','empty-details'],['02-servicos-componentes-desconto','discount'],['03-extenso-21-pecas','long']]as const,results=[]
for(const[name,fixture]of cases){
 const{version,preview}=await templateCase(fixture),data=toJsreportData(version)
 assert(preview.canEmit);assert.deepEqual(data,version.snapshot.document!.data)
 const body={template:{name:'FUNIX - Orcamento'},data},text=JSON.stringify(body,null,2)+'\n'
 assert(!text.includes('Authorization')&&!text.includes('password'))
 const categories=[...new Set(data.diagnosticos.flatMap(d=>d.clusters.filter(c=>c.tipo==='servico').map(c=>c.nome)))]
 assert(categories.includes('Preparação técnica')&&categories.includes('Pintura e acabamento'))
 if(fixture==='long')assert.equal(data.diagnosticos.length,21)
 if(fixture==='discount'){assert.equal(data.financeiro.desconto,'R$ 50,00');assert.equal(data.financeiro.totalVista,'R$ 450,15')}
 writeFileSync(resolve(output,name+'.json'),text,{mode:0o600,flag:'wx'})
 results.push({file:name+'.json',sha256:createHash('sha256').update(text).digest('hex'),bytes:Buffer.byteLength(text),fixture,categories,diagnosticos:data.diagnosticos.length,adapterEqualsFrozenJson:true,canEmit:preview.canEmit})
}
const manifest={revision:approved,synthetic:true,status:'prepared-not-sent',realJsreportRequests:0,realPdfs:0,preparation:'Existing in-memory QA fixtures use a mock renderer solely to reserve/freeze adapter data. No mock PDF is delivered as a real document.',results}
writeFileSync(resolve(output,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{mode:0o600,flag:'wx'});console.log(JSON.stringify({prepared:results.length,realJsreportRequests:0,realPdfs:0}))
