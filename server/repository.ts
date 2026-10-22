import type { WorkRecord, WorkspaceQuery, WorkspaceResponse } from '../shared/contracts.ts'

export interface ReadRepository {
  configured: boolean
  workspace(query: WorkspaceQuery): Promise<WorkspaceResponse>
  record(kind: WorkRecord['kind'], rowId: string): Promise<WorkRecord>
}
