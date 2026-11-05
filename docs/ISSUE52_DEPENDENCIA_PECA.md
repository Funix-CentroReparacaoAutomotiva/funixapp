# Issue #52 — peça necessária à inclusão de serviços

## Causa e reprodução

O resolvedor substituía a referência ambígua pelo ID físico escolhido, mas não propunha a inclusão quando o provedor retornava somente `add_service`. O planejador corretamente recusava alterar uma peça ausente com `PIECE_NOT_PRESENT`. Os testes anteriores forneciam `add_piece` explicitamente e não reproduziam o ditado natural.

A regressão usa somente três `add_service` para Funilaria P, Montagem M e Pintura completa, sem `add_piece`, com Motorista ausente e Passageiro já presente com um serviço. Antes da correção, o teste SQLite e o roteiro Chromium falharam na verificação de ausência de `PIECE_NOT_PRESENT` após Motorista. Todos os dados são sintéticos.

## Correção restrita

`server/voice-resolution.ts` prepara a dependência no servidor, tanto na interpretação inicial quanto nas escolhas por botão ou Falar. Para uma inclusão de serviço com peça ausente identificada, valida catálogo ativo, curadoria e vínculo serviço/dimensão; consulta o planejador existente e mantém a dependência somente se houver uma inclusão final de serviço válida e efetiva. O ID do comando necessário é determinístico e o lote continua limitado a 100 comandos. Não são inferidos IDs de catálogo, dimensões, quantidades ou preços.

A peça é proposta como `add_piece` nativo, imediatamente antes do serviço, e aparece como **+ Peça** na revisão antes da confirmação. Nada é persistido ao resolver. Peças/serviços existentes continuam usando as mesmas identidades. Exclusões físicas explícitas impedem a inclusão inferida; notas, flags, alterações de linhas, diagnóstico e remoções nunca geram dependências por si só. Serviços cancelados, conflitantes ou inválidos não deixam uma peça vazia inferida. Dimensão null conserva a semântica anterior de rascunho incompleto, visível e sem emissão.

Nas resoluções sucessivas, IDs privados identificam somente as dependências geradas pelo servidor: elas são removidas e revalidadas, sem tratar comandos originais como inferidos. O lote confiável segue pelo staging e pelo replanejamento transacional existentes. Não há mudança no contrato HTTP de aplicação, SQL, migrações, motor comercial ou emissão.

## Validação

- `npm run check`: **469 testes aprovados**, zero falhas/ignorados; build, tipos e lint aprovados, com avisos preexistentes de lint.
- `node --test --test-isolation=none server/tests/voice-resolution.test.ts`: **34 testes aprovados**, incluindo 18 regressões novas. Motorista/Passageiro/Ambos × peça Passageiro presente/ausente × botão/Falar; serviços existentes e flags de outro cenário; resolução sem writes; replay idempotente; comandos parcialmente válidos; referências obrigatórias incertas; comandos não aditivos; dimensão null esclarecida sucessivamente; serviço cancelado e exclusão explícita.
- O teste de expiração/rollback/snapshot/PDF foi ajustado para o lote **sem add_piece**: erro provocado na última inclusão reverte todas as peças/serviços e o recibo; a tentativa seguinte aplica e preserva o snapshot e os bytes do PDF previamente emitido.
- `node scripts/voice-browser-review.mjs`: Chromium em **320/390/1440 px**, fluxo anterior, erro HTTP controlado, cancelamento/confirmação de exclusão global, negociação R$ 123,45 alterada antes/depois do plano e prévia atualizada.
- `FUNIX_TEST_MIC_STARTUP_MS=700 node scripts/voice-resolution-browser.mjs`: Chromium em **320/390/1440 px**, somente serviços no ditado, um lado existente, escolhas por teclado, peça necessária visível na revisão, Ambos por Falar, preservação do serviço existente, confirmação, aplicação só de alterações seguras e negociação preservada.
- A captura usa getUserMedia/MediaRecorder nativos com WAV sintético; cada gravação deve decodificar para áudio não silencioso e ter hash igual ao recebido pelo provedor simulado. Nenhuma verificação de áudio foi removida.

A execução precisa permitir bind de servidores locais: a primeira tentativa dentro do sandbox foi bloqueada por `listen EPERM`; a suíte foi reexecutada com a permissão de execução local apropriada. Nenhum serviço ou dado publicado foi acessado para estes testes.

## Limites e homologação

Prosseguir para homologação após revisão e checks da PR. Confirmar no aparelho real o ditado natural, os três lados e **+ Peça** antes de Aplicar. Chromium emulado não substitui Android/iOS e microfone real. Lotes no limite de 100 comandos que não comportem as dependências permanecem pendentes para novo ditado, preservando comandos independentes válidos.

Sem componentes por voz, merge, deploy ou acesso a banco publicado. Evidências sintéticas: `docs/evidencias/issue52-dependencia-peca/`.
