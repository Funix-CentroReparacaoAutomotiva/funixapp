import test from 'node:test'
import assert from 'node:assert/strict'
import {detailScreen,parentDetail,swipeTab} from '../../src/detail-navigation.ts'

test('Etapa B internal routes preserve the main tab and return one level from budget versions',()=>{
 assert.equal(detailScreen('?aba=mapa&tela=peca&peca=stable-id'),'peca')
 assert.equal(detailScreen('?tela=comparacao'),'comparacao')
 assert.equal(detailScreen('?tela=orcamentos&versao=stable-version'),'orcamentos')
 assert.equal(detailScreen('?tela=unknown'),null)
 assert.equal(parentDetail('?aba=diagnosticos&tela=peca&peca=stable-id'),'aba=diagnosticos')
 assert.equal(parentDetail('?aba=mapa&tela=orcamentos&versao=stable-version'),'aba=mapa&tela=orcamentos')
 assert.equal(parentDetail('?aba=mapa&tela=orcamentos'),'aba=mapa')
})

test('Etapa B swipe follows the three main tabs, ignores vertical, short and long gestures, and stops at bounds',()=>{
 assert.equal(swipeTab('chat',-100,4,150),'diagnosticos')
 assert.equal(swipeTab('diagnosticos',-100,4,150),'mapa')
 assert.equal(swipeTab('mapa',100,-4,150),'diagnosticos')
 assert.equal(swipeTab('diagnosticos',100,-4,150),'chat')
 assert.equal(swipeTab('chat',100,0,150),null)
 assert.equal(swipeTab('mapa',-100,0,150),null)
 assert.equal(swipeTab('chat',-60,0,150),null)
 assert.equal(swipeTab('chat',-100,150,150),null)
 assert.equal(swipeTab('chat',-100,4,1000),null)
})
