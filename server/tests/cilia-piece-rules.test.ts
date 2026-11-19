import test from 'node:test'
import assert from 'node:assert/strict'
import {CILIA_PIECE_RULE_COUNT,normalizeCiliaPieceTitle,suggestCiliaPiece} from '../cilia-piece-rules.ts'
const entry=(code:string,active=true,id=code)=>({id,code,kind:'peca',name:code,active})
const catalog=['capo','para_lama_dianteiro__motorista','para_lama_dianteiro__passageiro','para_barro_dianteiro__passageiro','para_choque_dianteiro','spoiler_dianteiro','moldura_farol_milha__passageiro','farol__passageiro','longarina_dianteira__motorista','veiculo_completo'].map(c=>entry(c))

test('Cilia piece rules: versioned seed and exact controlled normalization',()=>{
 assert.equal(CILIA_PIECE_RULE_COUNT,80)
 assert.equal(normalizeCiliaPieceTitle('  Para-lama DIANT. DIR '),'PARALAMA DIANTEIRO. DIREITO')
 const p=suggestCiliaPiece('para-lama dianteiro direita',catalog,'left')
 assert.equal(p.state,'candidate')
 assert.deepEqual(p.candidates,[{code:'para_lama_dianteiro__passageiro',pieceId:'para_lama_dianteiro__passageiro'}])
 assert.equal(p.canWrite,false)
 assert.equal(p.requiresOperatorReview,true)
 assert.equal(suggestCiliaPiece('capo',catalog).state,'candidate')
 assert.equal(suggestCiliaPiece('parabarro diant dir',catalog,'left').candidates[0]!.code,'para_barro_dianteiro__passageiro')
})
test('Cilia piece rules: do not infer side or erase qualifiers',()=>{
 for(const steering of ['unknown','right'] as const){
  const p=suggestCiliaPiece('FAROL DIREITO',catalog,steering)
  assert.equal(p.state,'review');assert.equal(p.candidates.length,0);assert.ok(p.issues.includes('STEERING_REVIEW'))
 }
 assert.equal(suggestCiliaPiece('MOLDURA DO FAROL DE MILHA DIR',catalog,'left').candidates[0]!.code,'moldura_farol_milha__passageiro')
 assert.equal(suggestCiliaPiece('FAROL DIREITO INTERNO',catalog,'left').state,'unmapped')
 assert.equal(suggestCiliaPiece('PARALAMA DIANT',catalog,'left').state,'unmapped')
 assert.equal(suggestCiliaPiece('ANTES CAPÔ',catalog,'left').state,'unmapped')
})
test('Cilia piece rules: group and ambiguous identities never become direct mappings',()=>{
 const p=suggestCiliaPiece('DOBRADIÇA DIR DO CAPÔ',catalog,'left')
 assert.equal(p.classification,'G');assert.equal(p.state,'review');assert.ok(p.issues.includes('GROUP_SCOPE_REVIEW'))
 const a=suggestCiliaPiece('PARACHOQUE DIANT INFERIOR',catalog,'left')
 assert.equal(a.classification,'R');assert.equal(a.candidates.length,2);assert.equal(a.state,'review')
 assert.equal(suggestCiliaPiece('RADIADOR',catalog,'left').state,'review')
 assert.equal(suggestCiliaPiece('REM E INST CONJUNTO MOTRIZ',catalog,'left').state,'review')
 assert.equal(suggestCiliaPiece('LONGARINA DIANTEIRA ESQ',catalog,'left').requiresOperatorReview,true)
})
test('Cilia piece rules: only unique usable native piece codes, never name matching or new records',()=>{
 assert.deepEqual(suggestCiliaPiece('CAPÔ',[]).issues,['CATALOG_CODE_MISSING:capo'])
 assert.deepEqual(suggestCiliaPiece('CAPÔ',[entry('capo',false)]).issues,['CATALOG_CODE_UNUSABLE:capo'])
 assert.deepEqual(suggestCiliaPiece('CAPÔ',[entry('capo'),entry('capo',false,'other')]).issues,['CATALOG_CODE_AMBIGUOUS:capo'])
 assert.equal(suggestCiliaPiece('CAPÔ',[{...entry('capo'),kind:'servico'}]).candidates.length,0)
 assert.equal(suggestCiliaPiece('CAPÔ',[{...entry('not-capo'),name:'Capô'}]).candidates.length,0)
 const before=JSON.stringify(catalog);suggestCiliaPiece('CAPÔ',Object.freeze(catalog));assert.equal(JSON.stringify(catalog),before)
})
