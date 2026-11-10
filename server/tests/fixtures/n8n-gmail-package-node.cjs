// Snapshot of production-disabled n8n node "Montar pacote único Gmail (SEM ENVIO)".
// 2026-11-09: verify the actual node before changing this fixture.
// No Gmail, Coda, Drive or n8n credentials are used by the synthetic runner.
const u=$input.first().json;
const report=$('Concluir triagem do lote dinamico').first().json;
if(u.status!=='EVIDENCIAS_UNIFICADAS_GMAIL_SEM_ENVIO'||
u.send_enabled!==false||u.upload_permitted!==false||
u.inventory?.bodyReviewed!==false||u.inventory?.commercialReviewed!==false||
!Array.isArray(u.inventory?.attachmentIds)||u.inventory.checkedAttachmentIds?.length!==0||
u.identity?.conflict===true||!/^XP[0-9]{3,8}$/.test(String(u.identity?.experienceFromCoda??''))||
!/^([A-Z]{3}[0-9][A-Z0-9][0-9]{2})$/.test(String(u.identity?.plateFromCoda??''))||
!Array.isArray(report.decisions)||u.inventory.attachmentIds.length!==report.decisions.length)
return [{json:{status:'PACOTE_BLOQUEADO',send_enabled:false,upload_permitted:false,reason:'EVIDENCIAS_INCOMPLETAS_OU_CONFLITANTES'}}];
const xp=u.identity.experienceFromCoda,plate=u.identity.plateFromCoda;
const msg=u.inventory.sourceReference;
if(String(report.message_id??'')!==msg ||
   String(report.experience??'')!==xp ||
   String(report.plate??'')!==plate ||
   u.inventory.eventKey!=='gmail:'+msg+':v1 ||
   report.upload_permitted!==false ||
   report.status!=='CONFERENCIA_DOCUMENTAL_CONCLUIDA')
  throw new Error('RELATORIO_EVENTO_DIVERGENTE');
if(!/^[0-9a-f]{15,25}$/i.test(msg)||u.inventory.eventKey!=='gmail:'+msg+':v1')
throw new Error('EVENTO_IDENTIDADE_INVALIDA');
const source='gmail',sourceReference=msg;
const shared={source,sourceReference,experienceId:xp,plate};
const valid=new Set(['NOVO_CANDIDATO','DUPLICADO_BINARIO','REPETIDO_NO_EMAIL','REVISAO']);
const newActions=[],missing=[],hashes=new Set();
for(const d of report.decisions){
 if(!valid.has(d.status)||!/^([0-9a-f]{32})$/i.test(String(d.md5??''))||
 typeof d.filename!=='string'||!d.filename.trim())throw new Error('ANEXO_INCONSISTENTE');
 if(d.status==='REVISAO'){if(!missing.some(f=>f.key==='archiveReview'))missing.push({key:'archiveReview',label:'Conferir documentos',hint:'Há conflito de arquivo, hash ou nome. Conferir antes de aprovar.'});continue;}
 if(d.status!=='NOVO_CANDIDATO')continue;
 const hash=d.md5.toLowerCase();
 if(hashes.has(hash))continue;
 hashes.add(hash);
 newActions.push({id:'drive:'+hash,type:'drive_archive',title:('Arquivar '+d.filename).slice(0,240),
  detail:('Origem Gmail '+msg+'; destino '+report.entry_folder_id+'; MD5 '+hash+'; revalidar arquivo e destino antes de gravar.').slice(0,1000)});
}
const identity={part:'identity',proposal:{...shared,title:'Conferir identidade',summary:'XP/placa associadas ao Coda; verificar contra origem.',actions:[{id:'review:identity',type:'other',title:'Revisar vínculo da XP',detail:'A correspondência textual não constitui autorização de trabalho.'}],missingFields:[]}};
const documents={part:'documents',proposal:{...shared,title:'Documentos',summary:newActions.length+' novo(s) arquivo(s) proposto(s)',actions:newActions,missingFields:missing}};
const commercial={part:'commercial',proposal:{...shared,title:'Dados comerciais',summary:'Conferência de autorização e condições comerciais obrigatória.',actions:[],missingFields:[{key:'commercialReview',label:'Validar informações comerciais',hint:'Conferir mensagem integral, emissor, autorização, valores e escopo na fonte oficial.'}]}};
const parts=[identity,documents,commercial];
const actions=[...identity.proposal.actions,...documents.proposal.actions,...commercial.proposal.actions];
const pending=[...missing,...commercial.proposal.missingFields];
if(actions.length>40||pending.length>15)throw new Error('LIMITE_PACOTE');
const proposal={...shared,title:xp+' · '+plate,summary:(newActions.length+' novos originais; validação comercial pendente.').slice(0,1000),actions,missingFields:pending};
const eventManifest={eventKey:u.inventory.eventKey,expectedParts:['identity','documents','commercial']};
return [{json:{status:'PACOTE_UNICO_RASCUNHO_NAO_PUBLICADO',send_enabled:false,upload_permitted:false,
eventKey:u.inventory.eventKey,eventManifest,inventory:u.inventory,fragments:parts,proposal,
pending:[...u.pending,'VALIDAR_AUTORIZACAO_COMERCIAL'],readiness:'AGUARDANDO_REVALIDACAO_E_APROVACAO_HUMANA'}}];
