import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { diagnosisListLabel } from '../../src/diagnosis-list-label.ts'

test('intensidade mestre e capitalização sem alterar o cadastro', () => {
  assert.deepEqual(diagnosisListLabel('Porta dianteira Passageiro', 'Amassado', 'severo'), {piece:'Porta dianteira passageiro',diagnosis:'amassado severo'})
  assert.deepEqual(diagnosisListLabel('Porta traseira Motorista', 'Amassado', 'leve'), {piece:'Porta traseira motorista',diagnosis:'amassado leve'})
})
test('sem intensidade não inventa grau e siglas não são normalizadas', () => {
  assert.deepEqual(diagnosisListLabel('Sensor LED', 'LED', null), {piece:'Sensor LED',diagnosis:'LED'})
  assert.deepEqual(diagnosisListLabel('Para-choque traseiro', null, 'moderado'), {piece:'Para-choque traseiro',diagnosis:'Diagnóstico pendente'})
})
