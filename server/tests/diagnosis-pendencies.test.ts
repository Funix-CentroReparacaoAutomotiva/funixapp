import test from 'node:test'
import assert from 'node:assert/strict'
import type {DiagnosisItem} from '../../shared/commercial.ts'
import type {ComponentItem} from '../../shared/pricing.ts'
import {piecePendingFields} from '../../src/diagnosis-pendencies.ts'

const piece={enabled:true,services:[{id:'1',serviceId:'',dimensionId:null,quantity:'1',enabled:true},{id:'2',serviceId:'svc',dimensionId:null,quantity:'0',enabled:true}]} as DiagnosisItem
const component={name:'',quantity:'2',manualPrice:null,enabled:true} as ComponentItem&{enabled:boolean}
test('pending fields have navigable targets without changing prices',()=>{
 const pending=piecePendingFields(piece,[component])
 assert.deepEqual(pending.map(p=>p.key),['service:1','dimension:2','quantity:2','component-name:1','component-price:1'])
 assert(pending.every(p=>p.inputId.startsWith('issue-')))
})
test('disabling a piece does not demand pricing for excluded components',()=>{
 const fields=piecePendingFields({...piece,enabled:false},[{...component,enabled:false}])
 assert(fields.some(f=>f.key==='service:1'))
 assert(!fields.some(f=>f.key.startsWith('component-price')))
 assert(!fields.some(f=>f.key.startsWith('dimension:')))
})
