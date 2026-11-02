import{createHash}from'node:crypto'
import{COMMERCIAL_CURATION}from'../shared/commercial-curation.ts'
export const CURATION_STAMP={version:COMMERCIAL_CURATION.version,digest:createHash('sha256').update(JSON.stringify(COMMERCIAL_CURATION)).digest('hex')}
