# Validação — Copiloto de Voz PR 1

Base `main`: `9a0ffb370cf00611c913ee09f07c3142b867c9f1`.

- `npm run check`: **362 testes Node aprovados**, incluindo **47 novos** do planejador; zero falhas. Build/Vite e TypeScript frontend/backend aprovados. Sete avisos de lint preexistentes, nenhum aviso novo.
- `git diff --check`: aprovado.
- [Log completo](npm-check.txt).
- [Matriz dos 17 critérios e auditoria dos contratos](../../COPILOTO_VOZ_PR1.md).
- [Exemplos sintéticos com inputs/planos](../../exemplos/voice-planner/).

Os testes específicos estão em `server/tests/voice-planner.test.ts`. Validam criação, referências existentes/ambíguas, correções, incrementos/absolutos, replays, curadoria, regras opcionais/pendentes, flags por cenário, revisões, conflitos e preservação de conteúdo manual. Entradas congeladas não são alteradas; referências temporárias não colidem por separadores dos IDs de comando.

A comprovação de ausência de escrita usa DTOs obtidos dos repositórios e `total_changes()` de SQLite sintético: a chamada do planejador não altera banco, snapshot ou bytes de PDF anteriormente emitido. A comparação com a Fase 4 executa o applier existente **separadamente, após o planejador**, apenas no banco sintético, para comprovar equivalência dos serviços/quantidades/flags/origens previstos.

Todos os exemplos/regras de teste são explicitamente sintéticos. Não houve inspeção da VPS, coleta Coda, importação, migração instalada, acesso ao jsreport instalado ou alteração de dados reais. As contagens históricas das 77 relações não foram tratadas como diagnóstico da instalação atual.

Reprodução:

```bash
npm run check
# Opcional: somente os casos novos, sem depender de navegador ou serviço externo:
node --test --test-isolation=none server/tests/voice-planner.test.ts
git diff --check
```

Não há testes visuais novos: nenhuma tela/gesto/botão/estilo ou endpoint foi alterado. O Copiloto existente não ganhou gravação ou aplicação nesta entrega. A CI normal do PR verifica também os scripts e imagens Docker; nenhum deploy é autorizado por esta entrega.
