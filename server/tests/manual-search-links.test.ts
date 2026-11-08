import test from 'node:test'
import assert from 'node:assert/strict'
import {manualComponentSearchLinks} from '../../src/diagnosis-search-links.ts'

test('manual search links preserve order, add original term and use official channel for mapped maker',()=>{
 const links=manualComponentSearchLinks({brand:'Volkswagen',model:'Gol',vehicle:'Gol 2019'},'farol dianteiro esquerdo')
 assert(links)
 assert.equal(new URL(links.general).searchParams.get('q'),'Volkswagen Gol 2019 farol dianteiro esquerdo')
 assert.equal(new URL(links.original).searchParams.get('q'),'Volkswagen Gol 2019 farol dianteiro esquerdo original')
 assert.equal(links.official,'https://www.mercadolivre.com.br/loja/volkswagen/pecas-e-acessorios')
 assert.equal(links.montadora,'https://pecas.vw.com.br/todas-categorias?q=farol+dianteiro+esquerdo+Gol+2019')
 assert.equal(new URL(links.general).searchParams.get('tbm'),'shop')
})
test('missing or multiple years are not guessed and unmapped official stores stay unavailable',()=>{
 const noYear=manualComponentSearchLinks({brand:'Hyundai',model:'HB20',vehicle:'HB20'},'maçaneta direita')
 assert(noYear)
 assert.equal(new URL(noYear.general).searchParams.get('q'),'Hyundai HB20 maçaneta direita')
 assert.equal(noYear.official,null)
 assert.equal(noYear.montadora,null)
 const ambiguous=manualComponentSearchLinks({brand:'Volkswagen',model:'Gol',vehicle:'Gol 2018 / 2019'},'farol esquerdo')
 assert(ambiguous)
 assert.equal(new URL(ambiguous.general).searchParams.get('q'),'Volkswagen Gol farol esquerdo')
 assert.equal(ambiguous.montadora,'https://pecas.vw.com.br/todas-categorias?q=farol+esquerdo+Gol')
})
test('reject unsafe and missing technical fields rather than leaking identifiers',()=>{
 const vehicle={brand:'Volkswagen',model:'Gol',vehicle:'Gol 2019'}
 assert.equal(manualComponentSearchLinks(vehicle,'https://unsafe.example/?plate=ABC'),null)
 assert.equal(manualComponentSearchLinks(vehicle,'ABC1D23'),null)
 assert.equal(manualComponentSearchLinks({...vehicle,brand:''},'farol esquerdo'),null)
 assert.equal(manualComponentSearchLinks({...vehicle,model:'Gol & senha'},'farol esquerdo'),null)
})

test('other automakers use official marketplace when mapped, no unverified manufacturer storefront',()=>{
 const fiat=manualComponentSearchLinks({brand:'Fiat',model:'Argo',vehicle:'Argo 2022'},'lanterna traseira direita')
 assert(fiat)
 assert.equal(fiat.official,'https://www.mercadolivre.com.br/loja/fiat')
 assert.equal(fiat.montadora,null)
 const vw=manualComponentSearchLinks({brand:'VW',model:'Gol',vehicle:'Gol 2019'},'farol esquerdo')
 assert(vw)
 assert.equal(vw.montadora,'https://pecas.vw.com.br/todas-categorias?q=farol+esquerdo+Gol+2019')
 assert.equal(vw.official,'https://www.mercadolivre.com.br/loja/volkswagen/pecas-e-acessorios')
})
