/** Frozen, price-free projection of an issued budget for workshop execution. */
export interface WorkOrderLine {
  id:string; pieceId:string; kind:'service'|'component'; pieceName:string; name:string;
  diagnosis:string; dimension:string; quantity:string; notes:string;
  stages:{name:string;dimension:string;cluster?:import('./stage-clusters.ts').StageCluster|null}[]
}
export interface WorkOrderScope {
  customer:{name:string};
  vehicle:{description:string;plate:string};
  diagnostics:{pieceId:string;pieceName:string;diagnosis:string;intensity:string|null;notes:string}[];
  lines:WorkOrderLine[];
  deadlineDays:number|null;
  /** Fixed at each document issue; independent from the budget's estimated working days. */
  deliveryDate?:string|null;
}
export interface WorkOrder {
  cancellation?: {cancelledAt:string;reason:string};
  id:string;number:string;atendimentoId:string;budgetVersionId:string;
  /** Document revision. Older records without revision are revision 1. */
  revision?:number; revisionId?:string; revisionReason?:string;
  budgetNumber:string;budgetLabel:string;createdAt:string;
  authorization:{confirmedAt:string;source:'authenticated-session-confirmation';operatorId:null};
  scope:WorkOrderScope;
}
