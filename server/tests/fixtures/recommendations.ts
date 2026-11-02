import type{DatabaseSync}from'node:sqlite'
import{planImport,applyImport}from'../../coda-import.ts'
import{DOCUMENT,TABLES,sourceId}from'../../coda-import-source.ts'
import{RECOMMENDATIONS_FORMAT}from'../../diagnosis-recommendations.ts'
import{codaFixture}from'./coda-import.ts'
export function recommendationsFixture(db:DatabaseSync){
 const source=codaFixture(),p=planImport(db,source);applyImport(db,source,p.planHash)
 const diagnosisId=sourceId(TABLES.diagnoses,'i-synthetic-diagnosis'),serviceId=sourceId(TABLES.services,'i-XDTMBmueos'),dimensionId=sourceId(TABLES.dimensions,'i-synthetic-dimension'),other=sourceId(TABLES.services,'i-qa-other'),wrong=sourceId(TABLES.dimensions,'i-qa-wrong')
 const now=new Date().toISOString(),insert=db.prepare("INSERT INTO catalog_items(id,kind,name,service_id,status,source,created_at,updated_at)VALUES(?,?,?,?,'proposta','operador',?,?)")
 insert.run(other,'servico','Serviço auxiliar SINTÉTICO',null,now,now);insert.run(wrong,'dimensao','Dimensão divergente SINTÉTICA',other,now,now)
 const rows=['leve','moderado','severo'].flatMap((intensity,i)=>[{id:'i-qa-valid-'+i,diagnosisId,intensity,serviceId,dimensionId,selectedByDefault:i!==1},{id:'i-qa-pending-'+i,diagnosisId,intensity,serviceId,dimensionId:wrong,selectedByDefault:i===1}])
 return{source:{format:RECOMMENDATIONS_FORMAT,documentId:DOCUMENT,tableId:TABLES.diagnosisServices,rows},diagnosisId,serviceId,dimensionId,wrong}
}
