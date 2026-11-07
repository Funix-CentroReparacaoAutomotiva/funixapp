import{openSync,closeSync,readFileSync,writeSync,fsyncSync,unlinkSync}from'node:fs'
import{ServiceError}from'./errors.ts'
export const QUOTE_MODEL='gpt-5.4-mini-2026-03-17'
export const QUOTE_MAX_OUTPUT=4096
// Conservative envelope: full model context 400k at standard input rate, output
// including reasoning, and one tool. Not a claim about measured billing.
export const QUOTE_RESERVE_USD=.33
export function quoteCost(input:number,output:number,calls:number){return input*.75/1e6+output*4.5/1e6+calls*.01}
export function reserveQuoteAttempt(path:string,maximum=10){
 if(!path||!Number.isInteger(maximum)||maximum<1||maximum>10)throw new ServiceError(503,'QUOTE_BUDGET','Teto de cotação indisponível.')
 let lock:number
 try{lock=openSync(path+'.lock','wx',0o600)}catch{throw new ServiceError(429,'QUOTE_BUSY','Cotação em andamento.')}
 try{
  let count:number
  try{const data=JSON.parse(readFileSync(path,'utf8'));if(!Number.isInteger(data.reserved)||data.reserved<0||data.reserved>10)throw Error();count=data.reserved}
  catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')count=0;else throw new ServiceError(503,'QUOTE_BUDGET','Registro do piloto inválido.')}
  if(count>=maximum)throw new ServiceError(429,'QUOTE_BUDGET','Limite do piloto atingido.')
  const fd=openSync(path,'w',0o600)
  try{writeSync(fd,JSON.stringify({reserved:count+1,maxInitialSearches:10,reservedUsd:(count+1)*QUOTE_RESERVE_USD}));fsyncSync(fd)}finally{closeSync(fd)}
 }finally{closeSync(lock);unlinkSync(path+'.lock')}
}
