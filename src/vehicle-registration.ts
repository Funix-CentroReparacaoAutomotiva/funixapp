// Curated convenience suggestions for the MVP; never a closed catalog or a vehicle identity verifier.
// Includes currently sold and legacy brands/models commonly seen in Brazilian repair shops.
export const montadoraSuggestions=[
 'Alfa Romeo','Agrale','Audi','BMW','BYD','Caoa Changan','Caoa Chery',
 'Chevrolet','Chrysler','Citroën','Dodge','Effa','Fiat','Ford','GAC','Geely',
 'GWM','Honda','Hyundai','Iveco','JAC','Jeep','Jetour','Kia','Land Rover',
 'Leapmotor','Lexus','Lifan','Mercedes-Benz','Mini','Mitsubishi','Nissan',
 'Omoda Jaecoo','Peugeot','Porsche','Ram','Renault','Subaru','Suzuki',
 'Toyota','Troller','Volkswagen','Volvo'
] as const

const models:Record<string,string[]>={
 'audi':['A1','A3','A4','A5','Q3','Q5','Q7'],
 'bmw':['Série 1','Série 3','Série 5','X1','X3','X5'],
 'byd':['Dolphin Mini','Dolphin','Seal','Song Plus','Yuan Plus','King'],
 'caoa chery':['Tiggo 2','Tiggo 3X','Tiggo 5X','Tiggo 7','Tiggo 8','Arrizo 5','Arrizo 6'],
 'chevrolet':['Onix','Onix Plus','Prisma','Celta','Corsa','Classic','Astra','Vectra','Cruze','Spin','Tracker','Montana','S10','Trailblazer','Agile','Meriva','Zafira'],
 'citroen':['C3','C3 Aircross','Aircross','Basalt','C4','C4 Cactus','C4 Pallas','Xsara Picasso','Jumper'],
 'fiat':['Uno','Mobi','Palio','Siena','Grand Siena','Punto','Argo','Cronos','Pulse','Fastback','Toro','Strada','Fiorino','Doblò','Idea','Linea','Bravo','500'],
 'ford':['Ka','Fiesta','Focus','EcoSport','Fusion','Ranger','Territory','Maverick','Bronco','F-150'],
 'gwm':['Haval H6','Haval H9','Ora 03','Tank 300','Poer'],
 'honda':['Fit','City','Civic','HR-V','WR-V','CR-V','Accord'],
 'hyundai':['HB20','HB20S','Creta','Tucson','ix35','Santa Fe','Elantra','Azera','i30'],
 'jeep':['Renegade','Compass','Commander','Wrangler','Grand Cherokee'],
 'kia':['Picanto','Rio','Cerato','Soul','Sportage','Sorento','Carnival','Bongo','Niro','EV5'],
 'mercedes-benz':['Classe A','Classe C','Classe E','GLA','GLB','GLC','Sprinter'],
 'mitsubishi':['Lancer','ASX','Eclipse Cross','Outlander','Pajero','L200'],
 'nissan':['March','Versa','Sentra','Kicks','Frontier','Livina','Tiida'],
 'peugeot':['206','207','208','2008','3008','307','308','408','Partner','Expert'],
 'ram':['Rampage','1500','2500','3500'],
 'renault':['Kwid','Sandero','Logan','Stepway','Duster','Oroch','Captur','Kardian','Fluence','Clio','Megane','Master'],
 'suzuki':['Jimny','Vitara','S-Cross','Swift'],
 'toyota':['Etios','Yaris','Corolla','Corolla Cross','Hilux','SW4','RAV4','Prius'],
 'volkswagen':['Gol','Fox','Polo','Virtus','Voyage','Saveiro','T-Cross','Nivus','Taos','Tiguan','Jetta','Golf','Up!','Passat','Amarok','Fusca','Kombi'],
 'volvo':['XC40','XC60','XC90','S60','EX30']
}
function fold(value:string){return value.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-BR').trim()}
export function vehicleSuggestions(montadora:string):string[]{
 const key=fold(montadora)
 const alias=key==='vw'?'volkswagen':key==='gm'?'chevrolet':key
 return models[alias]??[]
}

export function composeVehicleDescription(model:string,year:string):string{
 return [model.trim(),year.trim().replace(/\s*\/\s*/g,'/')].filter(Boolean).join(' ')
}

const yearValue=/^(?:19\d{2}|20\d{2})(?:\s*\/\s*(?:19\d{2}|20\d{2}))?$/
export function validVehicleYear(value:string):boolean{return !value.trim()||yearValue.test(value.trim())}

export function extractVehicleYear(description:string,model:string):string{
 const raw=description.trim(),name=model.trim()
 if(!raw)return ''
 const withoutModel=name&&fold(raw).startsWith(fold(name)+' ')?raw.slice(name.length).trim():raw
 return yearValue.test(withoutModel)?withoutModel.replace(/\s*\/\s*/g,'/'):''
}

export function yearSuggestions(currentYear=new Date().getFullYear()):string[]{
 const options:string[]=[]
 for(let year=currentYear+1;year>=1995;year--){
  options.push(String(year))
  if(year>1995)options.push((year-1)+'/'+year)
 }
 return options
}

export function readVehicleRegistration(record:{vehicle:string;model:string;brand:string}):{name:string;year:string;legacy:boolean}{
 const model=record.model.trim(),description=record.vehicle.trim()
 // Some historical records used "model" for the year and "vehicle" for the car name.
 // Keep persisted fields untouched until the operator actually edits vehicle identity.
 if(yearValue.test(model)){
  const withoutYear=description.replace(/\s+(?:19\d{2}|20\d{2})(?:\s*\/\s*(?:19\d{2}|20\d{2}))?$/,'').trim()
  return {name:withoutYear||description,year:model.replace(/\s*\/\s*/g,'/'),legacy:true}
 }
 const year=extractVehicleYear(description,model)
 return {name:model||(!year?description:''),year,legacy:false}
}
