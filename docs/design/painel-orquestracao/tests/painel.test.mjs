import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateSnapshot,childrenOf,recordsOf,branchOf,metrics,repoUrl,safeRepoUrl,stateOfRecord,inspectPublishedFile,publishedSnapshotUrl,PUBLISHED_BRANCH,PUBLISHED_PATH,cardCounts,projectOverview,attentionOverview,workfrontOverview} from '../model.mjs';
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

test('publicação recusa estado material sem data, justificativa ou evidência',()=>{
  const draft=clone();
  draft.snapshotId='versao-nova-sem-evidencia';
  draft.publishedAt='2026-11-23T08:00:00-03:00';
  draft.nodes[0].status='concluido';
  assert.throws(()=>inspectPublishedFile(publishedFile(draft),base),/sem justificativa/);
  draft.nodes[0].status='bloqueado';draft.nodes[0].statusReason='Falha com evidência';
  draft.nodes[0].updatedAt='2026-11-23T08:00:00-03:00';
  draft.nodes[0].evidence=[{kind:'issue',number:301}];
  assert.throws(()=>inspectPublishedFile(publishedFile(draft),base),/Bloqueio sem motivo/);
});

test('card compacto: conta filhos diretos e folhas distintas, sem duplicar status do pai',()=>{
  const r=clone();
  r.nodes=[
    {id:'g',title:'Projeto',presentation:'group',status:'acompanhamento'},
    {id:'f',parentId:'g',title:'Frente',status:'em_execucao'},
    {id:'a',parentId:'f',title:'Ativo',status:'em_execucao',decisionPending:true},
    {id:'b',parentId:'f',title:'Bloqueio',status:'bloqueado',decisionPending:false},
    {id:'c',parentId:'g',title:'Entregue',status:'concluido',decisionPending:false},
    {id:'u',parentId:'f',title:'Não verificado',status:'nao_verificado'}
  ];
  r.records=[];r.relations=[];
  const m=validateSnapshot(r),card=cardCounts(m,'g');
  assert.equal(card.fronts,2);
  assert.deepEqual(card.active,{value:1,complete:false,display:'1+'});
  assert.deepEqual(card.blocked,{value:1,complete:false,display:'1+'});
  assert.deepEqual(card.done,{value:1,complete:false,display:'1+'});
  assert.deepEqual(card.decisions,{value:1,complete:false,display:'1+'});
  assert.equal(cardCounts(m,'f').fronts,3);
  assert.deepEqual(cardCounts(m,'a').active,{value:1,complete:true,display:'1'});
});
test('card compacto: zero somente quando todas as folhas relevantes têm classificação',()=>{
  const r=clone();r.nodes=[
    {id:'g',title:'Projeto',presentation:'group',status:'acompanhamento'},
    {id:'a',parentId:'g',title:'Planejado',status:'planejado',decisionPending:false}
  ];r.records=[];r.relations=[];
  let m=validateSnapshot(r),card=cardCounts(m,'g');
  assert.equal(card.fronts,1);
  for(const k of ['active','blocked','done','decisions'])assert.deepEqual(card[k],{value:0,complete:true,display:'0'});
  delete r.nodes[1].decisionPending;
  r.nodes[1].status='nao_verificado';m=validateSnapshot(r);card=cardCounts(m,'g');
  for(const k of ['active','blocked','done','decisions'])assert.deepEqual(card[k],{value:0,complete:false,display:'—'});
});
test('card compacto: projeto vazio e decisão explicitamente ausente são distinguíveis de dado faltante',()=>{
  const r=clone();r.nodes=[{id:'g',title:'Projeto',presentation:'group',status:'planejado'}];r.records=[];r.relations=[];
  const card=cardCounts(validateSnapshot(r),'g');
  assert.equal(card.fronts,0);
  assert.equal(card.decisions.display,'0');
  r.nodes.push({id:'a',parentId:'g',title:'Frente sem decisão classificada',status:'planejado'});
  assert.equal(cardCounts(validateSnapshot(r),'g').decisions.display,'—');
});
test('card compacto: decisão só aceita true, false ou ausente; número inventado não é aceito',()=>{
  const r=clone();r.nodes[0].decisionPending=2;
  assert.throws(()=>validateSnapshot(r),/decisionPending/);
  r.nodes[0].decisionPending='false';
  assert.throws(()=>validateSnapshot(r),/decisionPending/);
  r.nodes[0].decisionPending=false;
  assert.equal(validateSnapshot(r).nodes[0].decisionPending,false);
});

test('resumo de projeto conta frentes, não total de tarefas, e não duplica o ramo',()=>{
  const r=clone();r.nodes=[
    {id:'proj',title:'Projeto',presentation:'group',status:'acompanhamento'},
    {id:'f1',parentId:'proj',title:'Frente 1',status:'acompanhamento'},
    {id:'f2',parentId:'proj',title:'Frente 2',status:'acompanhamento'},
    {id:'a',parentId:'f1',title:'Entrega ativa A',status:'em_execucao',decisionPending:true},
    {id:'b',parentId:'f1',title:'Entrega ativa B',status:'em_execucao',decisionPending:false},
    {id:'c',parentId:'f2',title:'Entrega bloqueada',status:'bloqueado',decisionPending:false}
  ];r.records=[];r.relations=[];
  const x=projectOverview(validateSnapshot(r),'proj');
  assert.equal(x.fronts,2);
  assert.deepEqual(x.activeFronts,{value:1,complete:true,display:'1'});
  assert.deepEqual(x.blockedFronts,{value:1,complete:true,display:'1'});
  assert.deepEqual(x.decisions,{value:1,complete:true,display:'1'});
});
test('resumo de projeto não transforma frente sem conferência em zero',()=>{
  const r=clone();r.nodes=[
    {id:'proj',title:'Projeto',presentation:'group',status:'acompanhamento'},
    {id:'f1',parentId:'proj',title:'Frente 1',status:'em_execucao',decisionPending:null},
    {id:'f2',parentId:'proj',title:'Frente 2',status:'nao_verificado',decisionPending:null},
  ];r.records=[];r.relations=[];
  const x=projectOverview(validateSnapshot(r),'proj');
  assert.equal(x.fronts,2);
  assert.deepEqual(x.activeFronts,{value:1,complete:false,display:'1+'});
  assert.deepEqual(x.blockedFronts,{value:0,complete:false,display:'—'});
  assert.deepEqual(x.decisions,{value:0,complete:false,display:'—'});
});

test('resumo: confirmação numa frente vence incerteza da mesma categoria, sem mascarar outras',()=>{
  const r=clone();r.nodes=[
    {id:'proj',title:'Projeto',presentation:'group',status:'acompanhamento'},
    {id:'f1',parentId:'proj',title:'Frente mista',status:'acompanhamento'},
    {id:'f2',parentId:'proj',title:'Frente bloqueada',status:'acompanhamento'},
    {id:'t1',parentId:'f1',title:'Trabalho ativo',status:'em_execucao',decisionPending:true},
    {id:'t2',parentId:'f1',title:'Trabalho sem confirmação',status:'nao_verificado'},
    {id:'t3',parentId:'f2',title:'Trabalho bloqueado',status:'bloqueado',decisionPending:false},
  ];r.records=[];r.relations=[];
  const x=projectOverview(validateSnapshot(r),'proj');
  assert.equal(x.fronts,2);
  // f1 já é comprovadamente ativa, embora t2 ainda não tenha sido verificada.
  assert.deepEqual(x.activeFronts,{value:1,complete:true,display:'1'});
  // t2 pode estar bloqueada: o mínimo confirmado é f2, nunca um zero fictício.
  assert.deepEqual(x.blockedFronts,{value:1,complete:false,display:'1+'});
  // Decisões são contadas em trabalhos confirmados, e ausência de campo é incerteza.
  assert.deepEqual(x.decisions,{value:1,complete:false,display:'1+'});
});

test('minha atenção agrega motivos em um único trabalho e conserva contexto de projeto',()=>{
  const r=clone();r.nodes=[
    {id:'g1',title:'Projeto 1',presentation:'group',status:'acompanhamento'},
    {id:'g2',title:'Projeto 2',presentation:'group',status:'acompanhamento'},
    {id:'f1',title:'Frente A',parentId:'g1',status:'bloqueado'},
    {id:'a',title:'Tarefa com decisão e bloqueio',parentId:'f1',status:'bloqueado',decisionPending:true,nextResult:'Validar contrato'},
    {id:'b',title:'Sem verificação',parentId:'f1',status:'nao_verificado'},
    {id:'c',title:'Bloqueado B',parentId:'g2',status:'bloqueado',decisionPending:false},
    {id:'d',title:'Concluído',parentId:'g2',status:'concluido',decisionPending:false}
  ];r.records=[];r.relations=[];
  const overview=attentionOverview(validateSnapshot(r));
  assert.equal(overview.items.length,3); // status do pai não vira outra tarefa
  assert.deepEqual(overview.counts,{decision:1,blocked:2,unverified:1,decisionsUnknown:1});
  assert.deepEqual(overview.items.map(x=>x.id),['a','c','b']);
  assert.deepEqual(overview.items[0].reasons,['decision','blocked']);
  assert.equal(overview.items[0].context,'Projeto 1');
  assert.equal(overview.items[0].nextResult,'Validar contrato');
  assert.equal(overview.items[1].context,'Projeto 2');
  assert.equal(overview.items[2].nextResult,null);
});
test('minha atenção não cria decisão pendente de dados ausentes nem de texto livre',()=>{
  const r=clone();r.nodes=[
    {id:'p',title:'Projeto',presentation:'group',status:'bloqueado',decisionPending:true},
    {id:'a',parentId:'p',title:'Trabalho em andamento',status:'em_execucao',nextResult:'Decidir depois'},
    {id:'b',parentId:'p',title:'Planejado',status:'planejado',decisionPending:false}
  ];r.records=[];r.relations=[];
  const overview=attentionOverview(validateSnapshot(r));
  assert.deepEqual(overview.items,[]);
  assert.deepEqual(overview.counts,{decision:0,blocked:0,unverified:0,decisionsUnknown:1});
});
test('minha atenção aceita mapa vazio sem emitir pendências fictícias',()=>{
  const r=clone();r.nodes=[];r.records=[];r.relations=[];
  const overview=attentionOverview(validateSnapshot(r));
  assert.equal(overview.items.length,0);
  assert.deepEqual(overview.counts,{decision:0,blocked:0,unverified:0,decisionsUnknown:0});
});

test('diretório mostra apenas frentes diretas de projetos, sem duplicar subfrentes',()=>{
  const r=clone();r.nodes=[
    {id:'p1',title:'Projeto A',presentation:'group',status:'acompanhamento'},
    {id:'f1',title:'Frente um',parentId:'p1',status:'acompanhamento',nextResult:'Revisar integração',updatedAt:'2026-11-24T01:00:00-03:00'},
    {id:'child',title:'Atividade filha',parentId:'f1',status:'em_execucao',nextResult:'Entregar código'},
    {id:'p2',title:'Projeto vazio',presentation:'group',status:'planejado'},
    {id:'single',title:'Trabalho avulso',status:'nao_verificado'}
  ];r.records=[];r.relations=[];
  const overview=workfrontOverview(validateSnapshot(r));
  assert.equal(overview.projectsWithoutFronts,1);
  assert.deepEqual(overview.items.map(x=>x.id),['f1','single']);
  assert.deepEqual(overview.items[0],{
    id:'f1',title:'Frente um',project:'Projeto A',status:'acompanhamento',
    nextResult:'Revisar integração',updatedAt:'2026-11-24T01:00:00-03:00',standalone:false
  });
  assert.equal(overview.items[1].standalone,true);
  assert.equal(overview.items[1].nextResult,null);
  assert.equal(overview.items[1].status,'nao_verificado');
});
test('diretório de frentes não inventa registros em projeto vazio ou mapa vazio',()=>{
  const r=clone();r.nodes=[{id:'empty',title:'Vazio',presentation:'group',status:'planejado'}];
  r.records=[];r.relations=[];
  assert.deepEqual(workfrontOverview(validateSnapshot(r)).items,[]);
  assert.equal(workfrontOverview(validateSnapshot(r)).projectsWithoutFronts,1);
  r.nodes=[];
  assert.deepEqual(workfrontOverview(validateSnapshot(r)),{items:[],projectsWithoutFronts:0});
});
