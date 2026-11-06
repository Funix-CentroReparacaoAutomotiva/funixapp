import test from 'node:test'
import assert from 'node:assert/strict'
import {voiceReviewName} from '../../src/voice-review-name.ts'
test('Issue66 names are sentence case only in presentation, preserving technical acronyms/codes',()=>{
 for(const [raw,display]of [['FAROL DIANTEIRO ESQUERDO','Farol dianteiro esquerdo'],['maçaneta EXTERNA','Maçaneta externa'],['VIDRO LATERAL TRASEIRO','Vidro lateral traseiro'],['FAROL LED H4 ABS','Farol LED H4 ABS'],['PARAFUSO M10x1,5 VW','Parafuso M10x1,5 VW'],['','']]){
  assert.equal(voiceReviewName(raw!),display);assert.equal(voiceReviewName(display!),display)
 }
})
