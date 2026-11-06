# Issue #64 — inclusão de componentes pelo Copiloto

## Entrega e decisões

Branch independente baseada na main `caf8406`, incluindo PR59 e as frentes Chat/WhatsApp já integradas. Nenhuma carga ou dado comercial real foi acessado; não houve acesso a VPS ou banco publicado, nem alteração de ambiente. Não há migração nem dependência nova.

O novo comando semântico é `add_component`: descrição livre, referência física da peça, quantidade e preço manual em texto decimal. Não existe catálogo de componentes; o nome nunca é usado como ID ou como peça pai. A referência física continua sendo resolvida pelo fluxo homologado; o planejador a associa ao `diagnosis_item.id` pertencente ao Atendimento. Se a peça estiver ausente, o servidor propõe **+ Peça** no mesmo plano, uma vez por peça e somente para uma inclusão válida. Motorista/Passageiro/Ambos/Falar permanecem pelas opções e pares reais existentes. Ambos gera comandos independentes por peça, com valores revisáveis separadamente.

Valores omitidos viram **quantity `'1'` e manualPrice `'0'`**, persistido literalmente, nunca null. O schema do modelo exige strings para componentes; defaults também são aplicados pelo planejador. O modelo não pode enviar decisões de duplicação. O domínio decimal coincide com `ComponentRepository`/`Q.from`: até 12 dígitos inteiros e 6 casas, quantidade positiva e preço não negativo, sem sinal/expoente. A normalização é textual exata, sem Number, arredondamento ou cálculo financeiro no frontend. Valores numéricos inválidos retornados pelo modelo podem ficar pendentes e editáveis; isso não torna o comando aplicável, não infere zero e não cria sua peça como dependência vazia. Outros erros de contrato continuam recusados.

A revisão existente agrupa cada componente por peça com **+ Nome**, quantidade e preço unitário editáveis. O operador usa **Revisar valores** para validar a edição no servidor e depois **Aplicar alterações** para confirmar o plano atualizado. Edições locais ainda não revisadas bloqueiam Apply e escolhas concorrentes, com explicação visível. Valores inválidos são preservados para correção. Não se calcula total/MR na revisão; valores oficiais aparecem a partir do estado persistido após Apply. O painel não foi separado em outra tela.

## Duplicação e identidade

Nomes iguais normalizados e nomes lexicalmente próximos, dentro da mesma peça, geram pendência. A comparação ignora caixa/acentos/pontuação, considera ordem de palavras e proximidade lexical; não presume equivalência de catálogo nem substitui cadastro. Inclui componentes já persistidos e inclusões anteriores do próprio lote.

A revisão identifica o componente solicitado e mostra, somente para leitura, nome/quantidade/preço dos candidatos existentes (ou do próprio ditado). As alternativas são **Manter existente** e **Adicionar outro**, também reconhecidas pelo esclarecimento dirigido. Manter dispensa a inclusão, com aviso de que quantidade/preço existentes permanecem; não atualiza o registro. Adicionar outro autoriza somente um novo lançamento, ainda sujeito à revisão e Apply. A decisão é emitida pelo servidor, vinculada ao conjunto exato de candidatos e revalidada ao replanejar. Alteração de contexto invalida a revisão. Tokens internos de comandos conservam a identidade das duplicatas no mesmo lote, mesmo após edição de preço/quantidade e nova chave.

Não há operação de atualização ou exclusão de componente existente por voz. Um componente com o mesmo nome em outra peça não é deduplicado com esta. Demais intenções válidas e independentes continuam aplicáveis enquanto houver pendência.

## Aplicação e invariantes comerciais

A edição usa `POST /copiloto/revisar`, que altera somente o lote efêmero do servidor: exige autenticação, origem, sessão, cenário, revisão existente e comando de componente da própria tentativa. Aceita exclusivamente quantidade/preço; não aceita IDs de registros, troca de peça, nome, alterações arbitrárias ou autorização de duplicação. Cada revisão produz nova chave, invalida a revisão anterior e preserva a expiração original de 15 minutos. Ditado, escolha e revisão não escrevem no SQLite.

A gravação continua exclusivamente no **Apply existente**: replanejamento dentro de `BEGIN IMMEDIATE`, guardas/digest, SQL parametrizado, uma transação com peças/serviços/componentes e recibo durável, COMMIT ou rollback integral. Não há POST independente de componentes pelo navegador nem transação aninhada. O insert reutiliza a tabela, defaults e triggers existentes. Componentes novos ficam habilitados só no cenário ativo; máscaras e confirmações existentes são preservadas. Pai desabilitado não é habilitado implicitamente: a revisão avisa que o componente ficará fora do cálculo.

O contexto do backend agora contém nome, quantidade, preço e revisão dos componentes para duplicatas e stale; esses dados não foram acrescentados ao contexto enviado ao modelo. A regra comercial que impede recomendações automáticas em peça com conteúdo considera também o componente recém-planejado. Não altera curadoria/regras de recomendações ou cria serviços inventados.

O único ajuste no repositório normal é o desempate de leitura `ORDER BY created_at,rowid`, em vez de UUID aleatório quando componentes são criados no mesmo milissegundo. Isso preserva a ordem de inclusão de um lote, sem mudar IDs, campos ou dados existentes. O motor de MR, negociação, emissão e PDFs não foi alterado.

## Privacidade e segurança

O nome do componente aparece na revisão e no histórico local como texto React, sem HTML executável. A projeção de clipboard permanece fechada: operação `add_component`, aliases, estados, decisões, contagens e quantidade válida. **Não exporta nome livre, transcrição, PII, preço, manualPrice, tokens ou payload bruto.** Preços são omitidos também dos metadados técnicos antes do clipboard; a whitelist não permite campos monetários. Nada de log/áudio é persistido automaticamente.

## Testes executados

- `npm run check`: **545 testes aprovados**, zero falhas/ignorados; build, tipos e lint aprovados com avisos preexistentes.
- 23 regressões de componentes com SQLite sintético, planejamento e privacidade: peça existente/ausente, preço zero literal, ordem, peça+serviço+componentes, Motorista/Passageiro/Ambos por botão/Falar, edição exata, limites/valores inválidos, duplicatas exatas/próximas e no mesmo lote, nomes parecidos com peças, IDs falsos, sessão/cenário, expiração/stale, rollback da última operação, recibo após perda de resposta/reinício, snapshot/PDF imutáveis, MR oficial, máscara de pai desabilitado e regra de recomendações.
- Dois testes HTTP novos: autenticação/origem/shape, edição read-only, duas revisões simultâneas (uma vence; outra expira), invalidação da chave anterior, dois Apply simultâneos com um efeito e um replay; componente numérico inválido editável e independente de outra intenção; preço null e decisão de duplicação enviada pelo modelo recusados.
- `FUNIX_TEST_MIC_STARTUP_MS=700 node scripts/voice-components-browser.mjs`: **320/390/1440 px**. Ditado principal; campos 1→2 e 0→35,90; rejeição de preço negativo sem perder edição; banco inalterado até Apply; preço zero persistido; subtotal oficial **143,60** com MR sintético 2; três escolhas de lado, Ambos por Falar, serviço junto, edição por peça, keep/new, negociação **R$ 123,45**, XSS e cópia sem nome/PII/preço. Verifica que não houve POST de componentes independente.
- Roteiros anteriores `voice-browser-review.mjs`, `voice-resolution-browser.mjs` e `voice-clarification-browser.mjs`: aprovados em **320/390/1440 px**, preservando o fluxo homologado, exclusão global, privacidade, Falar, recuperação e negociação.
- Todos os roteiros usam getUserMedia/MediaRecorder nativos com WAV sintético, espera por bytes, decodificação não silenciosa e hash igual ao recebido pelo backend. Sem gravações fabricadas ou retry cego. O workflow executa os quatro roteiros de voz.

Evidências: `docs/evidencias/issue64-componentes/`. Bancos, contatos, valores, credenciais e provedores usados nos testes são sintéticos. Checks remotos devem ser conferidos no SHA final da PR.

## Limitações e riscos residuais

- A detecção de duplicatas é lexical e conservadora. Pode pedir confirmação para componentes diferentes com nomes próximos; sinônimos/descrições totalmente diferentes não constituem identidade verificável. A revisão humana continua necessária. Não há estoque, fornecedor, preço externo ou catálogo semântico.
- O limite existente de 100 comandos inclui dependências. Lotes que excedam o contrato ou mais de 200 candidatos semelhantes exigem ditado menor/editor, mantendo intenções independentes seguras. Não são reduzidos silenciosamente nem autorizados em bloco.
- O operador deve concluir **Revisar valores** antes de Apply. Não há autosave comercial nem alterações de registros existentes pela prévia.
- A captura/interpretação real pode errar descrições ou números; os valores são propostas visíveis e editáveis, sem autoridade sobre regras comerciais. A emulação Chromium não substitui homologação do microfone, teclado virtual e clipboard em Android/iOS físicos.

Recomenda-se revisão técnica da PR e, depois dos checks finais, homologação do fluxo no celular. **Sem merge nem deploy.**
