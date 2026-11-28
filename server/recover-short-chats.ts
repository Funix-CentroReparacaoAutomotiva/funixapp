import {lstatSync} from 'node:fs'
import {resolve} from 'node:path'
import {DatabaseSync} from 'node:sqlite'
import {backupDatabase} from './database.ts'
import {registerCustomerPhoneFunction} from './customer-identity-schema.ts'
import {applyShortNumberRecovery,planShortNumberRecovery} from './chat/short-number-recovery.ts'

const [source,mode='--preview',expected,backupPath,...extra]=process.argv.slice(2)
const applying=mode==='--apply'
if(!source||extra.length||(!applying&&(mode!=='--preview'||expected!==undefined))||
  (applying&&(!expected||!/^[0-9a-f]{64}$/.test(expected)||!backupPath)))
  throw Error('Uso: node server/recover-short-chats.ts BANCO [--preview | --apply SHA_DO_PLANO NOVO_BACKUP]')
const cutoff=process.env.FUNIX_CHAT_AUTONOMOUS_SINCE??''
const input=resolve(source)
if(!lstatSync(input).isFile())throw Error('A origem deve ser um arquivo SQLite regular existente.')
if(applying&&resolve(backupPath!)===input)throw Error('O destino do backup deve ser um arquivo novo.')
const db=new DatabaseSync(input,{readOnly:!applying})
try{
  registerCustomerPhoneFunction(db)
  db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=3000;')
  if(!applying)db.exec('PRAGMA query_only=ON;')
  db.exec('BEGIN')
  const version=db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get()?.v
  if(version!==25&&version!==26&&version!==27&&version!==28&&version!==29&&version!==30&&version!==31&&version!==32)throw Error('A recuperação exige um banco V25 a V32.')
  const {digest,counts}=planShortNumberRecovery(db,cutoff)
  db.exec('COMMIT')
  if(!applying){
    process.stdout.write(JSON.stringify({mode:'preview',digest,...counts})+'\n')
  }else{
    if(digest!==expected)throw Error('O plano mudou. Confira uma nova prévia antes de aplicar.')
    if(!counts.eligible){
      process.stdout.write(JSON.stringify({mode:'apply',digest,...counts,applied:0})+'\n')
    }else{
      await backupDatabase(db,backupPath!)
      const check=new DatabaseSync(backupPath!,{readOnly:true})
      try{
        if(check.prepare('PRAGMA integrity_check').get()?.integrity_check!=='ok'||check.prepare('PRAGMA foreign_key_check').all().length)
          throw Error('A verificação do backup falhou. A recuperação não começou.')
      }finally{check.close()}
      const result=applyShortNumberRecovery(db,cutoff,expected!)
      process.stdout.write(JSON.stringify({mode:'apply',digest,...counts,applied:result.applied})+'\n')
    }
  }
}finally{db.close()}
