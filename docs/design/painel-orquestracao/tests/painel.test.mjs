import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateSnapshot,childrenOf,recordsOf,branchOf,metrics,repoUrl,safeRepoUrl,stateOfRecord,inspectPublishedFile,publishedSnapshotUrl,PUBLISHED_BRANCH,PUBLISHED_PATH} from '../model.mjs';
const base=JSON.parse(readFileSync(new URL('../snapshot.json',import.meta.url),'utf8'));
const clone=()=>structuredClone(base);
test('snapshot atual é válido sem impor frentes ou quantidade fixa',()=>{const m=validateSnapshot(base);assert.equal(m.nodes.length,base.nodes.length);assert.equal(childrenOf(m,m.root.id).length,metrics(m).fronts);assert.equal(metrics(m).nodes,base.nodes.length);assert.equal(metrics(m).groups,base.nodes.filter(x=>x.presentation==='group').length);assert.equal(recordsOf(m,m.root.id).length,base.records.length)});
test('estrutura dinâmica com zero frentes não é erro',()=>{const r=clone();r.nodes=[];r.records=[];r.relations=[];const m=validateSnapshot(r);assert.deepEqual(metrics(m),{fronts:0,groups:0,cards:0,nodes:0,blocked:0,unknown:0});assert.deepEqual(childrenOf(m,m.root.id),[])});
test('estrutura com profundidade arbitrária sem IDs fixos',()=>{const r=clone();r.nodes=[{id:'produto-x',parentId:null,title:'Produto X',status:'planejado'},{id:'equipa-a',parentId:'produto-x',title:'Equipe A',status:'em_execucao'},{id:'entrega-1',parentId:'equipa-a',title:'Entrega 1',status:'nao_verificado'}];r.records=[{nodeId:'entrega-1',kind:'bug',number:289,title:'Bug',url:'https://github.com/Funix-CentroReparacaoAutomotiva/funixapp/issues/289'}];r.relations=[];const m=validateSnapshot(r);assert.equal(metrics(m).fronts,1);assert.equal(branchOf(m,'entrega-1').length,3);assert.equal(recordsOf(m,'produto-x').length,1)});
test('referência ao pai inexistente e ciclos falham fechados',()=>{const a=clone();a.nodes[0].parentId='inexistente';assert.throws(()=>validateSnapshot(a),/pai inexistente/);const b=clone();b.nodes[0].parentId='ep-300';assert.throws(()=>validateSnapshot(b),/Ciclo/)});
test('IDs de nós repetidos e refs duplicadas são rejeitados',()=>{const a=clone();a.nodes.push(structuredClone(a.nodes[0]));assert.throws(()=>validateSnapshot(a),/duplicados/);const b=clone();b.records.push(structuredClone(b.records[0]));assert.throws(()=>validateSnapshot(b),/duplicado/)});
test('links GitHub devem corresponder ao número e repositório autorizado',()=>{const a=clone();a.records[0].url='https://github.com/evil/repo/issues/44';assert.throws(()=>validateSnapshot(a),/URL/);assert.equal(safeRepoUrl('https://github.com.evil.test/x','Funix-CentroReparacaoAutomotiva/funixapp'),null);assert.equal(repoUrl(base.repository,'pr',318),'https://github.com/Funix-CentroReparacaoAutomotiva/funixapp/pull/318')});
test('estado de PR integrada não equivale a publicada',()=>{assert.equal(stateOfRecord({kind:'pr'},{merged:true,state:'closed'}),'Integrada ao GitHub');assert.equal(stateOfRecord({kind:'pr'},{merged:false,state:'closed'}),'PR encerrada sem merge');assert.equal(stateOfRecord({kind:'issue'},{state:'closed'}),'Encerrada no GitHub')});
test('status desconhecido, snapshots inválidos e registros apontando nós inexistentes falham',()=>{const a=clone();a.nodes[0].status='99%';assert.throws(()=>validateSnapshot(a),/desconhecido/);const b=clone();b.schemaVersion=2;assert.throws(()=>validateSnapshot(b),/não suportada/);const c=clone();c.records[0].nodeId='falso';assert.throws(()=>validateSnapshot(c),/Vínculo/)});

test('projetos são contêineres opcionais, não tipos de negócio fixos',()=>{
  const a=clone(),model=validateSnapshot(a);
  assert.equal(model.byId.get('proj-funixapp').presentation,'group');
  assert.equal(childrenOf(model,'proj-funixapp').length,6);
  assert.equal(metrics(model).cards,model.nodes.length-1);
  assert.ok(recordsOf(model,'proj-funixapp').some(x=>x.kind==='bug'&&x.number===289));
  const alternative=clone(); alternative.nodes=[
    {id:'g1',title:'Programa particular',presentation:'group',type:'qualquer nome',status:'planejado'},
    {id:'g2',title:'Projeto B',presentation:'group',parentId:null,status:'planejado'},
    {id:'f1',title:'Frente avulsa',status:'planejado'},
    {id:'t1',title:'Atividade X',parentId:'g1',status:'nao_verificado'},
  ];alternative.records=[];alternative.relations=[];
  const other=validateSnapshot(alternative);assert.equal(metrics(other).groups,2);
  assert.equal(metrics(other).cards,2);assert.equal(childrenOf(other,other.root.id).length,3);
  alternative.nodes[0].presentation='invento';assert.throws(()=>validateSnapshot(alternative),/Apresentação desconhecida/);
});


function publishedFile(raw,{sha='a'.repeat(40)}={}){
  const content=Buffer.from(JSON.stringify(raw),'utf8');
  return {type:'file',path:PUBLISHED_PATH,sha,encoding:'base64',size:content.length,
    content:content.toString('base64')};
}
test('endereço publicado aponta só para a branch de dados, não para main',()=>{
  assert.equal(PUBLISHED_BRANCH,'painel-publicado');
  assert.equal(publishedSnapshotUrl(),
    'https://api.github.com/repos/Funix-CentroReparacaoAutomotiva/funixapp/contents/docs/design/painel-orquestracao/snapshot.json?ref=painel-publicado');
});
test('clique com mesma versão não pede novo desenho nem troca os cards',()=>{
  const file=publishedFile(base);
  assert.deepEqual(inspectPublishedFile(file,base),{changed:false,sha:file.sha});
  const sameSha={...file,content:undefined};
  assert.deepEqual(inspectPublishedFile(sameSha,base,file.sha),{changed:false,sha:file.sha});
});
test('nova publicação válida passa a ser visível somente após confirmação de versão',()=>{
  const next=clone();
  next.snapshotId='funix-cto-nova-versao';
  next.publishedAt='2026-11-23T08:00:00-03:00';
  next.nodes[0].title='Projeto atualizado pelo CTO';
  const result=inspectPublishedFile(publishedFile(next,{sha:'b'.repeat(40)}),base);
  assert.equal(result.changed,true);
  assert.equal(result.model.nodes[0].title,'Projeto atualizado pelo CTO');
  assert.equal(result.sha,'b'.repeat(40));
});
test('não aceita mudança silenciosa sem novo snapshotId',()=>{
  const draft=clone();draft.nodes[0].title='Alteração não versionada';
  assert.throws(()=>inspectPublishedFile(publishedFile(draft),base),/snapshotId/);
});
test('publicação mais antiga, outro repositório ou JSON inválido não substituem o atual',()=>{
  const older=clone();older.snapshotId='versao-anterior';older.publishedAt='2026-11-01T00:00:00-03:00';
  assert.throws(()=>inspectPublishedFile(publishedFile(older),base),/anterior/);
  const other=clone();other.snapshotId='falso';other.repository='outro/repo';other.publishedAt='2026-11-23T08:00:00-03:00';
  assert.throws(()=>inspectPublishedFile(publishedFile(other),base),/URL|Repositório/);
  const broken=clone();broken.snapshotId='novo';broken.nodes[0].status='sem_evidencia';
  assert.throws(()=>inspectPublishedFile(publishedFile(broken),base),/desconhecido/);
});
test('rejeita objeto remoto alterado ou truncado antes de renderizar',()=>{
  const file=publishedFile(base);
  assert.throws(()=>inspectPublishedFile({...file,path:'outro.json'},base),/inesperado/);
  assert.throws(()=>inspectPublishedFile({...file,size:350001},base),/limite/);
  assert.throws(()=>inspectPublishedFile({...file,content:'not-base64'},base),/decodificar/);
  assert.throws(()=>inspectPublishedFile({...file,size:file.size+1},base),/decodificar/);
});
