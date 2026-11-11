import test from 'node:test'
import assert from 'node:assert/strict'
import {classifyGmailCandidate} from '../gmail-intake-classifier.ts'

let next=0
function email(subject:string,snippet='',extra:Record<string,string>={}){
  next++
  return {messageId:(next.toString(16).padStart(16,'0')),subject,snippet,...extra}
}
function is(subject:string,snippet:string,expected:string,extra:Record<string,string>={}){
  const result=classifyGmailCandidate(email(subject,snippet,extra))
  assert.equal(result.relevance,expected,subject)
  return result
}
test('e-mails não relacionados não geram aviso',()=>{
  for(const [subject,body] of [
    ['Promoção de Natal da Riachuelo','Aproveite nossos descontos imperdíveis'],
    ['Folha de pagamento novembro','Segue o holerite da equipe'],
    ['Compra aprovada Mercado Livre','Seu pedido de equipamento foi confirmado'],
    ['Oferta de serviços de marketing','Temos uma proposta de marketing digital'],
    ['Newsletter semanal','Novidades e ofertas especiais'],
    ['Entrega do pedido confirmada','Rastreamento de pedido de peças']
  ]) {
    assert.equal(is(subject,body,'irrelevant').notice,null)
  }
})
test('serviços de veículos e potenciais leads geram aviso antes de qualquer XP',()=>{
  for(const [subject,body] of [
    ['Solicitação de orçamento','Preciso reparar o para-choque do carro'],
    ['Cotação','Preciso de funilaria e pintura para meu automóvel'],
    ['Autorização complementar','Liberado o complemento de reparo do veículo'],
    ['Aviso de sinistro','Veículo sinistrado aguardando avaliação'],
    ['Retorno sobre o reparo','A oficina pode me atualizar sobre o conserto?']
  ]) {
    const result=is(subject,body,'relevant')
    assert.equal(result.notice?.xpHint,null)
    assert.equal(result.notice?.plateHint,null)
  }
})
test('pistas de XP e placa não dependem de assunto e são tratadas como não verificadas',()=>{
  const result=is('Mensagem recebida','Associação informa XP1945 veículo RVD7A93','relevant')
  assert.equal(result.notice?.xpHint,'XP1945')
  assert.equal(result.notice?.plateHint,'RVD7A93')
  const body=is('Encaminho os detalhes','','relevant',{bodyText:'Cliente solicita reparo na XP1234, placa ABC1D23'})
  assert.equal(body.notice?.xpHint,'XP1234')
  assert.equal(body.notice?.plateHint,'ABC1D23')
})
test('ambiguidades não são descartadas',()=>{
  assert.ok(is('Atualização de atendimento','Estamos aguardando a vistoria do veículo','uncertain').notice)
  const result=is('Dúvida sobre reparo','XP1234 e XP1945: confirmar a placa antes de avançar','uncertain')
  assert.equal(result.reason,'MULTIPLE_VEHICLE_IDENTIFIERS')
  assert.equal(result.notice?.xpHint,null)
  assert.equal(is('Cotação','Gostaria de informações','uncertain').notice!==null,true)
  assert.equal(is('Informações sobre o veículo','Gostaria de saber mais','uncertain').notice!==null,true)
})
test('promoção sobre serviços de carro continua para revisão humana',()=>{
  const result=is('Promoção de pintura automotiva','Desconto especial em reparos e funilaria','uncertain')
  assert.equal(result.reason,'SERVICE_MENTION_IN_MARKETING')
})
test('payload inválido e excesso de dados são rejeitados em vez de classificados silenciosamente',()=>{
  assert.throws(()=>classifyGmailCandidate({messageId:'bad',subject:'Teste',snippet:''}),/GMAIL_CANDIDATE_INVALID/)
  assert.throws(()=>classifyGmailCandidate(email('teste','',{bodyText:'x'.repeat(8001)})),/GMAIL_CANDIDATE_INVALID/)
  assert.throws(()=>classifyGmailCandidate({...email('teste'),unknownField:'ignored'}),/GMAIL_CANDIDATE_INVALID/)
})
test('notificações não contêm corpo integral e respeitam limite do título e resumo',()=>{
  const result=is('Autorização reparo veículo','Y'.repeat(750),'relevant',{bodyText:'Z'.repeat(4000)})
  assert.ok(result.notice)
  assert.ok(result.notice!.summary.length<=300)
  assert.ok(result.notice!.title.length<=200)
  assert.equal(JSON.stringify(result.notice).includes('ZZZZZZZZZZZZZZ'),false)
})
