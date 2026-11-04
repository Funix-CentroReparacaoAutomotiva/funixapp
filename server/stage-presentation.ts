// Offline, exact identity mapping supplied by direction. Never matches service/stage names.
import{readFileSync}from'node:fs'
import{STAGE_CLUSTERS,type StageCluster,type StagePresentation}from'../shared/stage-clusters.ts'
import{TABLES,sourceId}from'./coda-import-source.ts'
import type{TechnicalStage}from'../shared/pricing.ts'
interface Relation{relationRowId:string;serviceRowId:string;serviceDimensionRowId:string;stageRowId:string|null;stageDimensionRowId:string|null;clusterRowId:string|null;order:number|string}
const reference=JSON.parse(readFileSync(new URL('./data/coda-stage-clusters.json',import.meta.url),'utf8'))as{stages:{stageRowId:string;clusterRowId:string|null;clusterName:string|null}[];relations:Relation[]}
export const clusterName=(value:unknown):StageCluster|null=>typeof value==='string'&&STAGE_CLUSTERS.includes(value as StageCluster)?value as StageCluster:null
export const clusterById=(id:string|null)=>clusterName(reference.stages.find(s=>s.clusterRowId===id&&id!==null)?.clusterName)
export function referencePresentation(relationId:string,serviceId:string,dimensionId:string):StagePresentation|undefined{
 const r=reference.relations.find(r=>sourceId(TABLES.relations,r.relationRowId)===relationId&&sourceId(TABLES.services,r.serviceRowId)===serviceId&&sourceId(TABLES.dimensions,r.serviceDimensionRowId)===dimensionId)
 if(!r)return
 return{stageId:r.stageRowId,stageDimensionId:r.stageDimensionRowId,clusterId:r.clusterRowId,cluster:r.stageRowId?clusterById(r.clusterRowId):null,order:typeof r.order==='number'?r.order:null}
}
export const sourceStageCluster=(stageId:string|null)=>clusterName(reference.stages.find(s=>s.stageRowId===stageId)?.clusterName)
export function stagePresentation(stage:TechnicalStage,serviceId:string,dimensionId:string):StagePresentation|undefined{
 const p=stage.presentation??referencePresentation(stage.id,serviceId,dimensionId),known=sourceStageCluster(p?.stageId??null)
 return p&&known&&p.cluster!==known?{...p,cluster:null}:p
}
