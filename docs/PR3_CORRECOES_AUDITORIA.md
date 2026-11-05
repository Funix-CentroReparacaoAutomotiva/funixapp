# PR3 — correções da auditoria independente

Base: `origin/main`, commit `1d98aa5de4cd1aab545fc3c79838299e5407ffdf`. Branch: `fix/voice-pr3-audit`. Sem migração, mudança de motor comercial, merge, deploy ou acesso ao banco publicado.

## Causas e correções

1. **Negociação perdida (P1).** O sucesso da aplicação incrementava a chave React do CommercialPanel e reinicializava seu estado de negociação. Agora um contador específico solicita a leitura dos dados comerciais no componente existente. O rascunho, inclusive mudanças feitas depois do planejamento, permanece; a atualização bloqueia cálculos obsoletos e usa a invalidação existente da prévia ao receber novas revisões. Nenhuma regra financeira foi alterada.
2. **Revisão incompleta (P2).** O texto de add_piece ignorava os valores consolidados e afirmava habilitação fixa. A revisão agora mostra diagnóstico, intensidade, texto das observações e flags finais. Serviços novos mostram dimensão, quantidade, diagnóstico, observações e origem de recomendação. Alterações mostram observações novas ou limpeza explícita; exclusões de serviços repetidos identificam linha, dimensão e quantidade. Dados compartilhados, flags locais e invalidação de confirmações são explícitos. A confirmação adicional das exclusões globais permanece obrigatória.
3. **Recomendações parciais (P2).** O limite era detectado durante a inclusão de linhas no plano. Agora a capacidade é verificada sobre todas as inclusões elegíveis da operação antes de qualquer inclusão. Uma operação pendente por capacidade não produz serviços, mas comandos independentes continuam aplicáveis. Curadoria, referências cadastradas e applySuggestedServices permanecem inalterados.

## Regressões e validação

- Antes das correções, os novos testes SQLite falharam por inclusão parcial (1 linha em vez de 0) e valores ausentes na revisão. Depois, passaram.
- Chromium antes da correção falhou em `voice refresh must preserve CommercialPanel`, após confirmar a voz com negociação de R$ 123,45. A regressão exige preservar o mesmo componente e o valor após atualização; também muda o modo da negociação depois do planejamento e verifica uma nova prévia com `adjust`/`123.45` e revisão atualizada.
- `node --test --test-isolation=none server/tests/voice-review.test.ts server/tests/voice-apply.test.ts`: 15 testes aprovados.
- `npm run check`: build, tipos e 424 testes aprovados; zero falhas/ignorados. Lint aprovado com avisos, incluindo o efeito de invalidação da atualização comercial.
- `node scripts/voice-browser-review.mjs`: Chromium em 1440, 320 e 390 px; revisão, negociação, aplicação, cancelamento e confirmação de exclusão global. Use `FUNIX_VOICE_ARTIFACTS` para salvar capturas fora do checkout. O workflow de navegador existente já executa esse script.
- O teste SQLite compara o caso de 49 serviços + duas recomendações com a rejeição integral do repositório comercial, confirma a preservação das 49 linhas/IDs e observações independentes, o replay do recibo e a inclusão válida até o limite exato de 50.
- A suíte existente cobre cenários/composição, diagnóstico/intensidade, curadoria, rollback, autenticação/origem, idempotência, motor, negociação, emissão e snapshots/PDFs imutáveis. Somente bancos sintéticos e provedores simulados.

## Limites e recomendação

As validações automatizadas não substituem gravação real em Android/iOS, permissões de microfone ou avaliação de transcrição/interpretação reais. Nenhum serviço externo de IA/PDF foi utilizado pelos novos testes. A regressão de negociação valida a requisição da prévia comercial; a emissão e imutabilidade permanecem cobertas pela suíte existente com mocks.

Recomendação: após revisão e aprovação da direção, retomar a homologação operacional controlada com áudio real. Não executar merge/deploy automaticamente.
