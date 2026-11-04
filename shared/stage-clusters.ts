export const STAGE_CLUSTERS=['Preparação técnica','Correção estrutural','Pintura e acabamento','Estética e revitalização','Serviços complementares']as const
export type StageCluster=typeof STAGE_CLUSTERS[number]
export interface StagePresentation{stageId:string|null;stageDimensionId:string|null;clusterId:string|null;cluster:StageCluster|null;order:number|null}
