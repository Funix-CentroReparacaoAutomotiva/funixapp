import test from 'node:test'
import assert from 'node:assert/strict'
import {montadoraSuggestions,vehicleSuggestions,yearSuggestions,composeVehicleDescription,readVehicleRegistration,extractVehicleYear,validVehicleYear} from '../../src/vehicle-registration.ts'
import {manualComponentSearchLinks} from '../../src/diagnosis-search-links.ts'
import {openDatabase} from '../database.ts'
import {AtendimentoRepository} from '../atendimentos.ts'
import {CustomerRepository} from '../customers.ts'

test('structured vehicle identity persists in the registry and the Atendimento',()=>{
 const db=openDatabase(':memory:')
 try{
  const customers=new CustomerRepository(db)
  const vehicle=customers.save({kind:'vehicle',text:'',brand:'Fiat',model:'Punto',plate:'ABC1D23'})
  const atendimentos=new AtendimentoRepository(db)
  const record=atendimentos.create({references:{person:[],contact:[],payer:[],vehicle:[
   {id:vehicle.id,text:vehicle.text,brand:vehicle.brand,model:vehicle.model},
  ]}},false,true)
  assert.equal(record.brand,'Fiat')
  assert.equal(record.model,'Punto')
  assert.equal(record.vehicle,'Fiat Punto')
  const reference=atendimentos.get(record.id,true).references?.vehicle[0]
  assert.equal(reference?.brand,'Fiat')
  assert.equal(reference?.model,'Punto')
  assert.equal(reference?.plate,'ABC1D23')
 }finally{db.close()}
})

test('Brazilian makers and representative models are suggestions, never closed allowed values',()=>{
 assert(montadoraSuggestions.includes('Fiat'))
 assert(montadoraSuggestions.includes('BYD'))
 assert(montadoraSuggestions.includes('Toyota'))
 assert(vehicleSuggestions('Fiat').includes('Punto'))
 assert(vehicleSuggestions('VOLKSWAGEN').includes('Gol'))
 assert(vehicleSuggestions('VW').includes('Polo'))
 assert.deepEqual(vehicleSuggestions('Marca artesanal'),[])
})

test('year selection supports fabrication/model year without guessing an invalid date',()=>{
 assert(validVehicleYear(''))
 assert(validVehicleYear('2026'))
 assert(validVehicleYear('2019/2020'))
 assert(validVehicleYear('2019 / 2020'))
 assert(!validVehicleYear('2020/'))
 assert(!validVehicleYear('dezembro'))
 assert(!validVehicleYear('2019/2020/2021'))
 assert.deepEqual(yearSuggestions(2026).slice(0,4),['2027','2026/2027','2026','2025/2026'])
 assert.equal(composeVehicleDescription('Punto','2019 / 2020'),'Punto 2019/2020')
})

test('existing records are interpreted for display but are not rewritten implicitly',()=>{
 assert.deepEqual(readVehicleRegistration({brand:'Fiat',model:'2019',vehicle:'Punto'}),{name:'Punto',year:'2019',legacy:true})
 assert.deepEqual(readVehicleRegistration({brand:'Fiat',model:'2019',vehicle:'Fiat Punto'}),{name:'Punto',year:'2019',legacy:true})
 assert.deepEqual(readVehicleRegistration({brand:'Fiat',model:'Punto',vehicle:'Punto 2019/2020'}),{name:'Punto',year:'2019/2020',legacy:false})
 assert.deepEqual(readVehicleRegistration({brand:'Ford',model:'',vehicle:'Escort'}),{name:'Escort',year:'',legacy:false})
 assert.equal(extractVehicleYear('Gol 2020','Gol'),'2020')
})

test('parts searches use model year from a split model/fabrication year record',()=>{
 const vehicle={brand:'Fiat',model:'Punto',vehicle:'Punto 2019/2020'}
 const links=manualComponentSearchLinks(vehicle,'farol dianteiro direito')
 assert(links)
 assert.equal(new URL(links.general).searchParams.get('q'),'Fiat Punto 2020 farol dianteiro direito')
 assert.equal(new URL(links.original).searchParams.get('q'),'Fiat Punto 2020 farol dianteiro direito original')
})

test('Issue #118 usa ano do modelo explicitamente e não confunde fabricação com modelo',()=>{
 const explicit=manualComponentSearchLinks({brand:'Fiat',model:'Punto',vehicle:'Punto 2019/2020',modelYear:'2022'},'farol dianteiro direito')
 assert(explicit)
 assert.equal(new URL(explicit.general).searchParams.get('q'),'Fiat Punto 2022 farol dianteiro direito')
 const noModel=manualComponentSearchLinks({brand:'Fiat',model:'Punto',vehicle:'Punto 2019',modelYear:''},'farol dianteiro direito')
 assert(noModel)
 assert.equal(new URL(noModel.general).searchParams.get('q'),'Fiat Punto farol dianteiro direito')
 const legacy=manualComponentSearchLinks({brand:'Fiat',model:'Punto',vehicle:'Punto 2019/2020',modelYear:null},'farol dianteiro direito')
 assert(legacy)
 assert.equal(new URL(legacy.general).searchParams.get('q'),'Fiat Punto 2020 farol dianteiro direito')
})
