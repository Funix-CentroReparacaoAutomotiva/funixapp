# PR59 — fechamento da revisão de privacidade

Atende aos comentários [6674668458](https://github.com/Funix-CentroReparacaoAutomotiva/funixapp/pull/59#issuecomment-6674668458) e [6675228834](https://github.com/Funix-CentroReparacaoAutomotiva/funixapp/pull/59#issuecomment-6675228834).

## Defeito reproduzido

A função anterior concatenava `event.text`. Catálogos editáveis e rótulos de opções podiam conter informações pessoais. Remover caracteres de controle não impedia que nomes, telefone, placa ou tokens fossem copiados. Uma execução isolada da função anterior confirmou o vazamento com nome/rótulo sintético; os testes anteriores só protegiam transcrição e observações.

## Correção pontual

Cada evento pode ter texto local detalhado e metadados técnicos separados. O histórico visível mantém nomes, valores de catálogo, opções oferecidas/escolhidas, transcrição e mensagens. A fronteira do clipboard, em `shared/voice-diagnostic-export.ts`, **não lê o texto visível** e reconstrói somente uma projeção fechada dos metadados. Não usa regex de telefone/placa para tentar limpar nomes livres.

A exportação permite:

- Operações e estados de conjuntos explícitos, índices de comandos/perguntas/opções e contagens inteiras limitadas.
- Referências por aliases numéricos, sem nomes, códigos livres ou IDs de catálogo/Atendimento/linha.
- Quantidades decimais validadas pelo formato do contrato de voz e alterações antes→depois de quantidade, dimensão por alias e habilitação booleana. Alterações de notas indicam somente o nome fixo do campo, sem conteúdo.
- Decisões conhecidas, erros de uma lista explícita e status HTTP 400–599; códigos desconhecidos viram `UNKNOWN_CODE`.
- Eventos de captura, esclarecimento, seleção, replanejamento, confirmação e replay, na ordem em que ocorreram.

Campos adicionais, rótulos, nomes, textos livres, identificadores e valores malformados são ignorados. Se faltar metadado técnico, não há fallback para exportar o texto detalhado. O aviso de falha do clipboard também não recomenda copiar manualmente o histórico como se ele fosse sanitizado. O histórico continua efêmero e limitado; nenhuma persistência, migração ou armazenamento automático de áudio foi adicionado.

## Main e escopo

A própria branch da PR59 incorporou `origin/main` em `d0995d4`, incluindo a PR57 de Chat, sem conflitos. Nenhum arquivo de Chat/WhatsApp foi editado nesta correção. Motor, SQL/transações, contratos de Apply/resolução, cenários, idempotência e orçamentos emitidos continuam pelos mesmos caminhos. As mudanças no servidor acrescentam apenas metadados de diagnóstico e representam decisões existentes de forma estruturada; não alteram o planejamento ou as gravações.

## Testes e evidências

- `npm run check`: **509 testes aprovados**, zero falhas/ignorados; build, tipos e lint aprovados com os avisos existentes. Inclui os testes de Chat trazidos pela main.
- Quatro regressões novas: catálogos/opções com PII sintética no fluxo real; exportador sem leitura do texto (getter que lança se lido); valores livres/estruturas/códigos malformados rejeitados; metadados úteis, quantidades e alterações preservados exatamente e na ordem correta.
- `node scripts/voice-browser-review.mjs`: 320/390/1440 px, incluindo negociação de R$ 123,45 e exclusão global.
- `FUNIX_TEST_MIC_STARTUP_MS=700 node scripts/voice-resolution-browser.mjs`: 320/390/1440 px, regressões de seleção, replanejamento, Ambos e aplicação parcial segura.
- `FUNIX_TEST_MIC_STARTUP_MS=700 node scripts/voice-clarification-browser.mjs`: 320/390/1440 px, clipboard real por teclado, nomes pessoais/telefones/placas/tokens sintéticos nos nomes de peça, serviço, dimensões e opção efetivamente selecionada. O histórico local conserva esses detalhes; nenhuma dessas strings aparece na cópia, antes ou depois de erro 422 e Apply. Permanecem operações, estados, decisões, aliases antes/depois e quantidade.

Os três roteiros continuam verificando MediaRecorder nativo, áudio decodificável não silencioso e hash igual no backend, com provedores e bancos exclusivamente sintéticos. Evidências complementares: `docs/evidencias/pr59-privacidade/`. Resultados remotos devem corresponder ao SHA final da PR, não a uma revisão anterior.

## Limites e recomendação

O histórico local continua detalhado e pode conter nomes livres; somente o botão de cópia utiliza a projeção sanitizada. Novos códigos de erro exigem inclusão explícita na lista para aparecerem nominalmente na exportação; até lá, permanecem desconhecidos no arquivo copiado e detalhados na tela. A emulação Chromium não substitui homologação de microfone/clipboard em aparelho físico.

Revisar a própria PR59 após os checks finais. Sem componentes por voz, merge da PR, deploy ou acesso a dados publicados.
