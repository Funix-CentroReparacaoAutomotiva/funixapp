import test from 'node:test';
import assert from 'node:assert/strict';
import {FRONTS,EXPECTED_IDS,cleanIssues,isBlocked,mapData,statusOf,safeGitHubUrl,formattedDate,parseIssueSearch,summaryOf,recentRecords} from '../app.mjs';
const mk=(id,overrides={})=>({number:id,title:`Registro ${id}`,state:'open',updated_at:'2026-11-21T18:00:00Z',labels:[],...overrides});
const complete=()=>EXPECTED_IDS.map(id=>mk(id));
test('mapa contém seis iniciativas, 22 registros distintos e nenhum épico duplicado',()=>{
  assert.equal(FRONTS.length,6);assert.equal(EXPECTED_IDS.length,22);assert.equal(new Set(EXPECTED_IDS).size,EXPECTED_IDS.length);
});
test('não confunde PR com issue e mantém desconhecido quando falta evidência',()=>{
  const data=[mk(291),mk(292,{state:'closed'}),mk(299,{updated_at:'2026-11-22T18:00:00Z'}),mk(999,{pull_request:{url:'https://api.github.com/pr/999'}})];
  const m=mapData(data);assert.equal(cleanIssues(data).length,3);assert.equal(m.find(x=>x.id===291).status.label,'Em acompanhamento');assert.equal(m.find(x=>x.id===291).validEpics,1);assert.equal(m.find(x=>x.id===291).updated,'2026-11-22T18:00:00Z');assert.equal(m.find(x=>x.id===292).status.label,'Encerrada no GitHub');assert.equal(m.find(x=>x.id===293).status.label,'Estado não verificado');
});
test('somente label explícita determina bloqueio',()=>{
  assert.equal(isBlocked({labels:[{name:'blocked'}]}),true);assert.equal(isBlocked({labels:[{name:'enhancement'}]}),false);assert.equal(statusOf({state:'open',labels:['bloqueado']}).key,'blocked');assert.equal(statusOf({state:'pending'}).key,'unknown');
});
test('não cria autorização, aceite, porcentagem ou progresso por estado',()=>{
  const value=JSON.stringify(mapData([mk(291,{state:'closed'})]));
  for(const forbidden of ['homologado','percentual','concluído','publicado'])assert.ok(!value.includes(forbidden));
});
test('links externos aceitos apenas na origem pública GitHub segura',()=>{
  assert.equal(safeGitHubUrl('https://github.com/a/b'),'https://github.com/a/b');assert.equal(safeGitHubUrl('https://github.com.evil.test/a'),null);assert.equal(safeGitHubUrl('javascript:alert(1)'),null);assert.equal(safeGitHubUrl('https://user:pass@github.com/a'),null);
});
test('data inválida é explicitada',()=>assert.equal(formattedDate('invalid'),'data não informada'));
test('busca estável: aceita somente 22 registros esperados mesmo fora da última página de issues',()=>{
  const payload={total_count:22,incomplete_results:false,items:[...complete(),mk(999)]};
  const issues=parseIssueSearch({...payload,total_count:23});
  assert.equal(issues.length,22);assert.equal(new Set(issues.map(x=>x.number)).size,22);
});
test('rejeita resposta de busca truncada, incompleta ou sem iniciativa, sem exibir dado parcial como válido',()=>{
  const all=complete();
  assert.throws(()=>parseIssueSearch({total_count:120,incomplete_results:false,items:all}),/excedeu/);
  assert.throws(()=>parseIssueSearch({total_count:22,incomplete_results:true,items:all}),/incompleta/);
  assert.throws(()=>parseIssueSearch({total_count:21,incomplete_results:false,items:all.slice(1)}),/não foram retornadas/);
});
test('resumo só computa bloqueios explícitos; zero não é ausência comprovada de bloqueios',()=>{
  const model=mapData([mk(291),mk(299,{labels:[{name:'blocked'}]}),mk(300,{state:'closed'})]);
  assert.deepEqual({tracked:summaryOf(model).tracked,blocked:summaryOf(model).blocked},{tracked:3,blocked:1});
  assert.equal(summaryOf(mapData([])).tracked,0);
});
test('histórico de alterações ordena datas e não fabrica eventos de conclusão',()=>{
  const model=mapData([mk(291,{updated_at:'2026-11-19T12:00:00Z'}),mk(292,{updated_at:'2026-11-22T12:00:00Z'}),mk(299,{updated_at:'bad'})]);
  assert.deepEqual(recentRecords(model).map(x=>x.number),[292,291]);
});