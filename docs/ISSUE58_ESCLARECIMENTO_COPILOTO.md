# Issue #58 — concluir o esclarecimento e diagnosticar a tentativa

## Causa comprovada

A seleção de peça substituía a referência, mas `add_service` encontrava a linha existente e terminava em `EXISTING_SERVICE_DIFFERENT`. O planejador não devia escolher outra linha nem duplicar o serviço; faltava ao resolvedor reconstruir a intenção com operações direcionadas já existentes. A revisão chamava a referência da linha cadastrada de **Opção**, embora não houvesse ação vinculada. No frontend, Falar também aparecia com resultados pendentes e nenhuma pergunta suportada.

Os testes sintéticos de para-lama Passageiro/Funilaria P e caixa de ar Passageiro/Funilaria M falharam com o resolvedor original da `main`. O primeiro solicita M e o segundo P. Não foram consultados Atendimentos reais nem inferido o que o ASR ouviu no relato de produção. A reprodução separada “transcrição P, modelo M, linha existente P” prova que os três valores podem ter origens diferentes; **Opção não era evidência da interpretação da IA**.

## Correção

O servidor guarda as intenções de origem e as decisões de referência/linha, separadas do lote efetivo. A cada escolha ou esclarecimento, reconstrói esse lote, reconcilia serviços e passa novamente pelo planejador existente. Uma linha única do mesmo serviço recebe `set_dimension` e, somente quando expressamente informada e diferente, `set_quantity` absoluta. Referências dependentes por comando conservam a associação à linha real. ID, notas, quantidade não informada, diagnóstico, recomendação e flags permanecem. Dimensão omitida de uma inclusão preserva a dimensão de uma linha existente; `set_dimension null` explícito conserva seu contrato de limpeza. Na ausência de serviço, a inclusão normal continua; na ausência de peça, a dependência da PR55 continua aparecendo como **+ Peça** antes de aplicar.

Serviços repetidos pedem seleção de uma linha cadastrada antes da correção. Intenção reconhecida de lançamento adicional não é convertida em edição: permanece pendente, orientando o editor para linhas repetidas. Remoções explícitas não são revertidas. Referência/dimensão obrigatória incerta impede aplicar parcialmente a quantidade da mesma inclusão. Conflitos continuam passando pelas regras nativas. Se a projeção exceder 100 operações, oferece novo ditado menor e mantém somente mudanças independentes válidas.

Há esclarecimento dirigido estrito para dimensão real do serviço, por exemplo **Funilaria P**, **corrige funilaria para P**, ou uma dimensão oferecida. Para total de quantidade: **quantidade 2**, **quantidade 2,5**, **quantidade duas unidades**. Essa fala não é enviada novamente ao interpretador de intenções: é comparada com contexto/pergunta no servidor. Frases com exclusão, emissão, referências incompatíveis, quantidades inválidas ou correspondência múltipla são recusadas sem substituir a revisão anterior. Nenhum catálogo, dimensão, preço ou identificador é inventado.

A revisão mostra mudanças efetivas, valores anteriores/novos, noop **Já está assim** e o estado **Já cadastrado**. Falar depende de uma pergunta emitida pelo servidor; uma linha sem alternativas reais não gera pergunta inerte. Pendências sem alvo recebem Novo ditado explícito, com gravação funcional. Sem alterações seguras, o motivo é mostrado e nenhum Apply é enviado. Com pendências e mudanças independentes, informa que as pendências ficam de fora. Confirmação adicional de exclusões globais permanece.

## Diagnóstico compacto e privacidade

O ícone de transcrição abre **O que foi dito** e **O que aconteceu**, com Copiar diagnóstico. A transcrição original é visível em texto separado. O histórico cronológico registra captura, interpretação por comando, referências/opções, seleção, pedido revisado, estado já cadastrado, resultados `valid/noop/pending/conflict`, códigos, contagem de mudanças e resultado do Apply. O resultado do Apply pode ser consultado reabrindo o painel. Uma nova tentativa inicia novo histórico; a navegação descarta o anterior. Há um limite de 180 eventos em memória.

A cópia contém uma projeção de campos permitidos: nomes de catálogo, operações, números ordinais dos comandos, dimensões/quantidades operacionais, status/códigos e contagens. **Não copia transcrição bruta, nomes/telefone/placa do Atendimento, observações, valores monetários, IDs do Atendimento, cookies, tokens, prompts, áudio ou JSON bruto.** Falhas copiam código/status, não a mensagem/payload arbitrário. A transcrição não é incluída automaticamente nem existe um botão de consentimento adicional que a exporte por engano. Se o clipboard estiver indisponível, o texto visível pode ser selecionado manualmente.

Nada é gravado automaticamente em SQLite, analytics ou serviço externo para esse histórico. Não há migração, arquivo de áudio produtivo ou infraestrutura nova. O cache de revisão existente continua efêmero, limitado e sujeito à sessão, expiração e digest do contexto.

## Validação reproduzível

Comandos locais, somente SQLite sintético e provedores simulados:

- `npm run check`: **499 testes aprovados**, zero falhas/ignorados; build, tipos e lint aprovados. Avisos de lint existentes permanecem.
- `node --test --test-isolation=none server/tests/voice-clarification.test.ts`: 16 regressões SQLite/diagnóstico: para-lama, caixa de ar, voz dirigida em duas formas, Ambos misto, noop/omissão, linhas repetidas, quantidades exatas e repetição, falas inseguras, dimensão/quantidade inválidas, escolha falsa, sessão/stale/expiração, conflito, rollback na última operação, snapshots/PDF imutáveis, exclusão global, privacidade, quantidade atômica com dimensão incerta, alvo inexistente, limite de lote e comandos dependentes sem incremento duplicado.
- Teste HTTP novo em `voice-input.test.ts`: captura → seleção de Passageiro → correção dirigida → confirmação simultânea. Uma interpretação original, nenhuma escrita na resolução, uma gravação efetiva e replay idempotente; linha/quantidade preservadas.
- `node scripts/voice-browser-review.mjs`: regressão anterior 320/390/1440, negociação **R$ 123,45**, prévia atualizada, erro HTTP e exclusão global com cancelamento/confirmação.
- `FUNIX_TEST_MIC_STARTUP_MS=700 node scripts/voice-resolution-browser.mjs`: resolvedor anterior 320/390/1440, peça ausente, serviço existente, Ambos, Falar e aplicação parcial segura. As esperas de opções pendentes agora distinguem os controles de correção de uma revisão já válida.
- `FUNIX_TEST_MIC_STARTUP_MS=700 node scripts/voice-clarification-browser.mjs`: novo ciclo 320/390/1440, P→M, “modelo M / transcrição P”, correção dirigida/noop, clipboard real por teclado, ausência de PII/segredos sintéticos na cópia, histórico de erro/Apply, caixa de ar em Ambos e Novo ditado realmente gravando.

Os roteiros usam getUserMedia/MediaRecorder nativos, WAV sintético, decodificação não silenciosa e hash igual ao áudio recebido no backend, inclusive no Novo ditado. O roteiro antigo expôs uma corrida ao iniciar o próximo gesto antes da recarga do contexto comercial após Apply. O helper agora aguarda o marcador de contexto pronto da interface; não aumenta sleeps, não repete a gravação e não remove verificações de áudio. O workflow Chromium executa os três roteiros.

Evidências sintéticas: `docs/evidencias/issue58-esclarecimento/`.

## Limites e recomendação

A fala dirigida é uma gramática conservadora sobre referências reais, não uma interpretação livre de novas ordens. Quando não há vínculo verificável ou há pedido de linha adicional fora do contrato de voz, orienta novo ditado/editor. A cópia não permite determinar retroativamente o áudio real; permite comparar a transcrição disponível com a interpretação e o cadastro.

Após revisão e checks verdes, homologar o ciclo em Android/iOS reais, inclusive permissões de microfone/clipboard e teclado virtual. Chromium emulado não comprova comportamento de aparelho físico. Motor comercial, contratos de Apply, SQL/transações, recibos duráveis, orçamentos emitidos e a frente Chat/WhatsApp não foram alterados. Componentes por voz continuam fora desta entrega. **Sem merge ou deploy.**
