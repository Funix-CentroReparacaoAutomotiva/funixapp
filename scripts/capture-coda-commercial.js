/* global tools, text */
// Execute this source in Codex functions.exec (not in Node or a GitHub workflow).
// Only change repoPath when the checkout is elsewhere. No token is read or saved.
const repoPath='/workspace/funixapp';
const destination=await tools.exec_command({cmd:'test ! -e .runtime/coda-export/capture.json',workdir:repoPath,max_output_tokens:500});
if(destination.exit_code!==0)throw new Error('Captura já existe: preserve-a antes de repetir a coleta.');
const metadata=await tools.exec_command({cmd:"node --input-type=module -e 'import{DOCUMENT,TABLES}from\"./server/coda-import-source.ts\";console.log(JSON.stringify({documentId:DOCUMENT,tables:Object.values(TABLES)}))'",workdir:repoPath,max_output_tokens:2000});
if(metadata.exit_code!==0)throw new Error('Não foi possível ler a allowlist versionada.');
const {documentId,tables}=JSON.parse(metadata.output);
const captured={format:'funix-coda-connector-capture-v1',documentId,exportedAt:new Date().toISOString(),tables:[]};
function unpack(response){
 let v=response;
 for(let depth=0;depth<10;depth++){
  if(typeof v==='string'){v=JSON.parse(v);continue;}
  if(v?.isError||v?.error||v?.error_code)throw new Error('Erro de leitura Coda; captura não salva.');
  if(v?.result)return v.result;
  if(v?.content?.[0]?.text){v=v.content[0].text;continue;}
  if(v?.structuredContent){v=v.structuredContent;continue;}
  throw new Error('Envelope de leitura desconhecido.');
 }
 throw new Error('Envelope aninhado inválido.');
}
const uri=id=>'coda://docs/'+documentId+'/tables/'+id;
const pricingBefore=await tools.mcp__codex_apps__superhuman_docs_table_columns_read({uri:uri('grid-aHz1ZDVlfK')});
unpack(pricingBefore);
for(const id of tables){
 const before=await tools.mcp__codex_apps__superhuman_docs_table_columns_read({uri:uri(id)}),s=unpack(before),pages=[];
 if(!Number.isSafeInteger(s.rowCount)||!Array.isArray(s.columns))throw new Error('Esquema incompleto.');
 // Do not collect canvas text or attachments; they are not inputs to the importer.
 const columnsToInclude=s.columns.filter(c=>!['canvas','imageAttachments'].includes(c.format?.type)).map(c=>c.columnId);
 let offset=0;
 while(offset<s.rowCount){
  const response=await tools.mcp__codex_apps__superhuman_docs_table_rows_read({uri:uri(id),rowLimit:100,rowOffset:offset,columnsToInclude}),page=unpack(response);
  if(!Array.isArray(page.rows)||!page.rows.length||page.totalRows!==s.rowCount)throw new Error('Página incompleta.');
  pages.push({offset,response});offset+=page.rows.length;
  if(!page.hasMore)break;
 }
 const after=await tools.mcp__codex_apps__superhuman_docs_table_columns_read({uri:uri(id)});unpack(after);
 captured.tables.push({id,before,pages,after});
 text({table:id,capturedRows:offset});
}
const pricingAfter=await tools.mcp__codex_apps__superhuman_docs_table_columns_read({uri:uri('grid-aHz1ZDVlfK')});unpack(pricingAfter);
captured.pricingFormulaSchema={before:pricingBefore,after:pricingAfter};
const directory=await tools.exec_command({cmd:'mkdir -p .runtime/coda-export && chmod 700 .runtime .runtime/coda-export',workdir:repoPath,max_output_tokens:500});
if(directory.exit_code!==0)throw new Error('Não foi possível preparar diretório privado.');
// Preserve raw response strings. Normalization/decimal parsing is done by the versioned CLI.
await tools.apply_patch('*** Begin Patch\n*** Add File: '+repoPath+'/.runtime/coda-export/capture.json\n+'+JSON.stringify(captured)+'\n*** End Patch');
const protect=await tools.exec_command({cmd:'chmod 600 .runtime/coda-export/capture.json',workdir:repoPath,max_output_tokens:500});
if(protect.exit_code!==0)throw new Error('Verificar proteção da captura privada.');
text('Captura privada salva em .runtime/coda-export/capture.json. Normalizar com o CLI; não adicionar ao Git.');
