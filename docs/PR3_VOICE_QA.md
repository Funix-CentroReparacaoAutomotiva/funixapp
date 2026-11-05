# PR3 — roteiro de homologação da confirmação por voz

## Ambiente e autorização

- Executar **somente em ambiente local/isolado**, com Atendimento e catálogo sintéticos.
- Não liberar em produção nem aprovar o merge até a passagem manual em dispositivo real.
- Rodar `npm run check` e verificar CI verde; as confirmações de voz exigem login e a origem autorizada.

## Matriz de revisão visual — pendente de validação em navegador real

| Cenário | 320 px | 390 px | Desktop (janela 1440 px) | Comportamento esperado |
| --- | --- | --- | --- | --- |
| Abrir o painel e visualizar lista com 6 mudanças | Pendente | Pendente | Pendente | Rolagem interna; transcrição e confirmação acessíveis sem corte |
| Corrigir quantidade de serviço existente | Pendente | Pendente | Pendente | Mostrar peça, serviço e quantidade final; preservar demais linhas |
| Diagnóstico + intensidade + recomendação | Pendente | Pendente | Pendente | Mostrar alterações compartilhadas e serviços elegíveis |
| Comando válido e referência ambígua | Pendente | Pendente | Pendente | Só alterações válidas podem ser confirmadas; pendência explícita |
| Exclusão de serviço compartilhado | Pendente | Pendente | Pendente | Aviso inequívoco: todos os cenários; confirmar ou cancelar |
| Exclusão de peça com componentes | Pendente | Pendente | Pendente | Aviso da perda de serviços e componentes; cancelar não altera dados |
| Troca de cenário durante revisão | Pendente | Pendente | Pendente | Plano anterior descartado; botão não aplica em cenário novo |
| Alteração concorrente antes da confirmação | Pendente | Pendente | Pendente | HTTP 409 e nenhuma gravação parcial |
| Perda de resposta após commit e repetição | Pendente | Pendente | Pendente | Mesmo recibo, sem duplicação de linha ou quantidade |
| Acessibilidade com teclado e zoom 200% | Pendente | Pendente | Pendente | Foco alcança revisão, detalhes, confirmar e cancelar; sem texto inacessível |

## Evidências automatizadas

- `server/tests/voice-review.test.ts`: rotulagem compreensível, efeitos globais e escopo por cenário.
- `server/tests/voice-apply.test.ts`: SQLite real, rollback, idempotência, revisão obsoleta, isolamento de flags, PDF imutável.
- `server/tests/voice-input.test.ts`: sessão, origem, tentativa de adulterar plano e repetição no endpoint.
- A página recebe a lista de revisão do servidor; o payload de confirmação não contém alterações arbitrárias.
- O botão de confirmação tem alvo de 48 px e a mensagem de exclusão utiliza cor de alto contraste para fundo branco.

**Limitação:** testes automatizados e revisão de CSS não substituem capturas visuais e uso manual em Android/iOS/desktop. Preencher a matriz e registrar evidências antes de aprovar o PR.
