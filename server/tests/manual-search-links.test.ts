import test from 'node:test'
import assert from 'node:assert/strict'
import {manualComponentSearchLinks} from '../../src/diagnosis-search-links.ts'

test('manual search links preserve order, add original term and use official channel for mapped maker',()=>{
 const links=manualComponentSearchLinks({brand:'Volkswagen',model:'Gol',vehicle:'Gol 2019'},'farol dianteiro esquerdo')
 assert(links)
 assert.equal(new URL(links.general).searchParams.get('q'),'Volkswagen Gol 2019 farol dianteiro esquerdo')
 assert.equal(new URL(links.original).searchParams.get('q'),'Volkswagen Gol 2019 farol dianteiro esquerdo original')
 assert.equal(links.official,'https://pecas.vw.com.br/')
 assert.equal(new URL(links.general).searchParams.get('tbm'),'shop')
})
test('missing or multiple years are not guessed and unmapped official stores stay unavailable',()=>{
 const noYear=manualComponentSearchLinks({brand:'Hyundai',model:'HB20',vehicle:'HB20'},'maçaneta direita')
 assert(noYear)
 assert.equal(new URL(noYear.general).searchParams.get('q'),'Hyundai HB20 maçaneta direita')
 assert.equal(noYear.official,null)
 const ambiguous=manualComponentSearchLinks({brand:'Volkswagen',model:'Gol',vehicle:'Gol 2018 / 2019'},'farol esquerdo')
 assert(ambiguous)
 assert.equal(new URL(ambiguous.general).searchParams.get('q'),'Volkswagen Gol farol esquerdo')
})
test('reject unsafe and missing technical fields rather than leaking identifiers',()=>{
 const vehicle={brand:'Volkswagen',model:'Gol',vehicle:'Gol 2019'}
 assert.equal(manualComponentSearchLinks(vehicle,'https://unsafe.example/?plate=ABC'),null)
 assert.equal(manualComponentSearchLinks(vehicle,'ABC1D23'),null)
 assert.equal(manualComponentSearchLinks({...vehicle,brand:''},'farol esquerdo'),null)
 assert.equal(manualComponentSearchLinks({...vehicle,model:'Gol & senha'},'farol esquerdo'),null)
})
