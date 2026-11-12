import test from 'node:test'
import assert from 'node:assert/strict'
import {manualComponentSearchLinks} from '../../src/diagnosis-search-links.ts'

test('manual search links preserve order, add original term and use official channel for mapped maker',()=>{
 const links=manualComponentSearchLinks({brand:'Volkswagen',model:'Gol',vehicle:'Gol 2019'},'farol dianteiro esquerdo')
 assert(links)
 assert.equal(new URL(links.general).searchParams.get('q'),'Volkswagen Gol 2019 farol dianteiro esquerdo')
 assert.equal(new URL(links.original).searchParams.get('q'),'Volkswagen Gol 2019 farol dianteiro esquerdo original')
 assert.equal(links.official,'https://lista.mercadolivre.com.br/loja/volkswagen/farol-dianteiro-esquerdo?sb=storefront_url')
 assert.equal(links.montadora,'https://pecas.vw.com.br/todas-categorias?q=farol+dianteiro+esquerdo+Gol+2019')
 assert.equal(new URL(links.general).searchParams.get('tbm'),'shop')
})
test('missing or multiple years are not guessed and unmapped official stores stay unavailable',()=>{
 const noYear=manualComponentSearchLinks({brand:'Hyundai',model:'HB20',vehicle:'HB20'},'maçaneta direita')
 assert(noYear)
 assert.equal(new URL(noYear.general).searchParams.get('q'),'Hyundai HB20 maçaneta direita')
 assert.equal(noYear.official,'https://lista.mercadolivre.com.br/loja/hyundai-mobis/macaneta-direita?sb=storefront_url')
 assert.equal(noYear.montadora,null)
 const ambiguous=manualComponentSearchLinks({brand:'Volkswagen',model:'Gol',vehicle:'Gol 2018 / 2019'},'farol esquerdo')
 assert(ambiguous)
 assert.equal(new URL(ambiguous.general).searchParams.get('q'),'Volkswagen Gol 2019 farol esquerdo')
 assert.equal(ambiguous.montadora,'https://pecas.vw.com.br/todas-categorias?q=farol+esquerdo+Gol+2019')
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
 assert.equal(fiat.official,'https://lista.mercadolivre.com.br/loja/fiat/lanterna-traseira-direita?sb=storefront_url')
 assert.equal(fiat.montadora,null)
 const vw=manualComponentSearchLinks({brand:'VW',model:'Gol',vehicle:'Gol 2019'},'farol esquerdo')
 assert(vw)
 assert.equal(vw.montadora,'https://pecas.vw.com.br/todas-categorias?q=farol+esquerdo+Gol+2019')
 assert.equal(vw.official,'https://lista.mercadolivre.com.br/loja/volkswagen/farol-esquerdo?sb=storefront_url')
})

test('operator-observed store search pattern isolates Chevrolet and Jeep routes',()=>{
 for(const [brand,store] of [['Chevrolet','chevrolet'],['Jeep','jeep']] as const){
  const result=manualComponentSearchLinks({brand,model:'Modelo',vehicle:'Modelo 2020'},'farol dianteiro direito')
  assert(result)
  assert.equal(result.official,'https://lista.mercadolivre.com.br/loja/'+store+'/farol-dianteiro-direito?sb=storefront_url')
 }
 const unknown=manualComponentSearchLinks({brand:'Nissan',model:'Versa',vehicle:'Versa 2020'},'farol dianteiro direito')
 assert(unknown)
 assert.equal(unknown.official,null)
 for(const brand of ['Nissan','Toyota','Honda']){
  const other=manualComponentSearchLinks({brand,model:'Modelo',vehicle:'Modelo 2020'},'farol dianteiro direito')
  assert(other)
  assert.equal(other.official,null,'an unverified official store must stay disabled')
 }
})

test('verified additional official shops get store-scoped links, with accent normalization',()=>{
 const stores=[['Ford','ford'],['Renault','renault'],['Citroën','citroen'],['Peugeot','peugeot'],['Ram','ram'],['Audi','audi']] as const
 for(const [brand,store] of stores){
  const result=manualComponentSearchLinks({brand,model:'Teste',vehicle:'Teste 2021'},'farol dianteiro direito')
  assert(result)
  assert.equal(result.official,'https://lista.mercadolivre.com.br/loja/'+store+'/farol-dianteiro-direito?sb=storefront_url')
  assert.equal(result.montadora,null,'do not show unverified deep link for automaker web store')
 }
})


test('issue 128: part descriptions with technical punctuation remain searchable and correctly encoded',()=>{
 const vehicle={brand:'Volkswagen',model:'Gol',vehicle:'Gol 2019'}
 for(const part of ['Moldura (lado esquerdo)','Bateria 70%','Peça (50%) + suporte','Maçaneta, frente (direita)','Cabo A&B','Fixador #2']){
  const links=manualComponentSearchLinks(vehicle,part)
  assert(links,'links missing for '+part)
  assert.equal(new URL(links.general).protocol,'https:')
  assert.equal(new URL(links.general).searchParams.get('q'),'Volkswagen Gol 2019 '+part)
  assert.equal(new URL(links.original).searchParams.get('q'),'Volkswagen Gol 2019 '+part+' original')
  assert(links.official&&new URL(links.official).protocol==='https:')
  assert(links.montadora&&new URL(links.montadora).searchParams.get('q')===part+' Gol 2019')
 }
 for(const part of ['','   ','https://evil.example','foo?x=1','foo<script>','ABC1D23','123456789']){
  assert.equal(manualComponentSearchLinks(vehicle,part),null,'unsafe/empty search must be rejected: '+part)
 }
})
