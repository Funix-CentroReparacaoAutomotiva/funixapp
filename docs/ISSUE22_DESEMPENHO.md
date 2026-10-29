# Issue #22 — Autosave, recargas e consultas

Base auditável: `main` / `d829b948f6a0198d805aca47e3760304a9223f62`, com PRs #19 e #21 integrados. Branch: `fix/issue22-autosave-desempenho`. Implementação limitada ao desempenho; sem mudanças de fórmulas, migrações, índices, dependências, CSS, desenho/navegação do mapa, workflows ou infraestrutura.

## Diagnóstico e alterações

- **Autosave:** GET preventivo de workspace, GETs por componente e comparação de objetos com `revision`/`updatedAt` provocavam leituras e regravações desnecessárias. `src/calculation-state.ts` compara somente entradas persistidas, normalizando decimais textuais sem calcular dinheiro. Ignora metadados e ordem visual; preserva multiplicidade de serviços, identidade e associação de atributos às flags.
- **`src/DiagnosisEditor.tsx`:** usa revisões já confirmadas. Flags isoladas usam PATCH de cenário; atributos realmente alterados usam PATCH de diagnóstico/componente. Componentes são gravados sequencialmente com revisão confirmada e um GET final, sem GET individual. Rascunhos incompletos, quantidades fracionárias e digitação durante requisição continuam preservados.
- **Contrato mínimo:** header opcional `X-Funix-Include-Revision: 1` retorna `{item,scenarioRevision}` nos PATCHs de diagnóstico e POST/PATCH de componente. A revisão é lida **dentro da transação**, inclusive no retorno idempotente. Sem header, respostas anteriores permanecem iguais. Arquivos: `server/app.ts`, `server/commercial.ts`, `server/components.ts`, `shared/commercial.ts`, `docs/API.md`.
- **Recuperação:** GET de reconciliação fica no caminho de erro, antes de uma tentativa explícita. Compara versão confirmada, intenção atual e última tentativa sem confirmação. Recupera IDs de serviços e componentes cuja escrita ocorreu mas cuja resposta se perdeu; não repete POST cegamente. Mudança real de conteúdo ou inclusão remota bloqueia sobrescrita e mantém campos locais. Falha somente no GET final não reenvia escrita já confirmada. Resposta JSON sem confirmação válida também é tratada como incerta.
- **Catálogo:** `src/CommercialPanel.tsx` reutiliza o catálogo da instância aberta, eliminando seu GET após cada mutação. Atualização explícita e remontagem/recarga revalidam. API continua validando atividade/identidade.
- **SQL:** `server/scenarios.ts` carrega as três famílias de flags em lote; `server/commercial.ts` usa JOINs e agrupamento de serviços/flags. Mantém forma dos DTOs, ordenação, isolamento por Atendimento e resultados calculados. Testes com leitores SQL anteriores independentes comparam todos os cenários e cálculos no mesmo banco.

## Medição reproduzível

Node 24.19.0, mesmo ambiente local Linux, SQLite temporário em arquivo (`synchronous=FULL`), dados sintéticos. Sem acesso à VPS, Coda, banco existente ou credenciais reais. Fixture única: `server/tests/fixtures/performance.ts`.

| Conjunto | Peças | Serviços por peça | Componentes totais | Cenários |
|---|---:|---:|---:|---:|
| Pequeno | 1 | 2 | 3 | 1 |
| Médio | 20 | 3 | 20 | 3 |
| Estresse | 80 | 4 | 80 | 10 |

Baseline foi executado antes das otimizações. A medição DOM mais precisa foi repetida sobre um checkout isolado da mesma main, sem alterações funcionais; os três arquivos de medição/fixture são byte a byte iguais nos dois checkouts. UUIDs e horários são regenerados; quantidades, configurações e sequência de operações são iguais. Não se trata de dois snapshots idênticos de banco.

Frontend compilado (`vite preview` somente para QA), API local real, Chromium desktop 1440×960 e viewport móvel 390×844 com toque. Atraso artificial **por resposta** de 0 e 150 ms, sem limitação de CPU/banda. Não são medições de RTT real, Hostinger ou aparelho físico. Login, carga inicial e abertura do editor ficam fora da janela.

Cada variante tem cinco amostras: p50 é mediana; p95 é o maior valor dessas cinco, descritivo, sem promessa de SLA. Timer no evento DOM até status `Salvo` via MutationObserver, sem polling na cronometragem. Edição conjunta dos três componentes inclui o debounce existente de 450 ms. Foram 36 variantes/180 operações por versão. Evidências contêm todas as amostras, bytes de resposta e cadeia de requisições. Ensaios preliminares com polling não foram usados na comparação final.

## Antes/depois observado

As contagens abaixo ocorreram em todas as cinco amostras de cada variante, nos dois viewports e nos três conjuntos. A carga inicial de catálogo não está incluída.

| Operação no editor | Requisições antes → depois | Caminho normal depois |
|---|---:|---|
| Toggle serviço | 4 → 2 | PATCH cenário + GET workspace |
| Toggle componente | 8 → 2 | PATCH cenário + GET workspace |
| Editar 3 componentes juntos | 13 → 4 | 3 PATCH componentes + GET workspace |

Tempos com atraso artificial de **150 ms por resposta**. Cada célula mostra **p50 / p95**, em ms; p95 é o máximo de cinco amostras.

| Conjunto | Viewport | Operação | Antes | Depois | Redução p50 |
|---|---|---|---:|---:|---:|
| Pequeno | desktop | Toggle serviço | 506.6 / 513.8 | 336.8 / 339 | 33.5% |
| Pequeno | desktop | Toggle componente | 1150.8 / 1170.9 | 335.9 / 339.5 | 70.8% |
| Pequeno | desktop | Editar 3 componentes | 2418 / 2437.7 | 1118.4 / 1124.1 | 53.7% |
| Pequeno | mobile | Toggle serviço | 509.1 / 531.1 | 335 / 337 | 34.2% |
| Pequeno | mobile | Toggle componente | 1142.1 / 1148.8 | 336.6 / 336.8 | 70.5% |
| Pequeno | mobile | Editar 3 componentes | 2412.8 / 2423.9 | 1116.6 / 1145.4 | 53.7% |
| Médio | desktop | Toggle serviço | 526.5 / 527.7 | 345.1 / 350.4 | 34.5% |
| Médio | desktop | Toggle componente | 1190.3 / 1263.2 | 348.7 / 354.4 | 70.7% |
| Médio | desktop | Editar 3 componentes | 2517.1 / 2519.3 | 1132.7 / 1137.2 | 55.0% |
| Médio | mobile | Toggle serviço | 522.9 / 555.9 | 346.9 / 374 | 33.7% |
| Médio | mobile | Toggle componente | 1188 / 1195.6 | 344.7 / 389.7 | 71.0% |
| Médio | mobile | Editar 3 componentes | 2492.7 / 2502.6 | 1127.6 / 1142.5 | 54.8% |
| Estresse | desktop | Toggle serviço | 833.2 / 850.2 | 526.5 / 540.7 | 36.8% |
| Estresse | desktop | Toggle componente | 1867.3 / 1883.7 | 514.3 / 540 | 72.5% |
| Estresse | desktop | Editar 3 componentes | 3888.2 / 3939.9 | 1341.2 / 1412.1 | 65.5% |
| Estresse | mobile | Toggle serviço | 865.4 / 903.2 | 543.7 / 561.5 | 37.2% |
| Estresse | mobile | Toggle componente | 1800.9 / 1863.5 | 530.3 / 545.7 | 70.6% |
| Estresse | mobile | Editar 3 componentes | 3692.7 / 3804 | 1346.1 / 1369.6 | 63.5% |

[Comparação completa CSV](evidencias/issue22/comparacao.csv) / [JSON](evidencias/issue22/comparacao.json), incluindo atraso zero, bytes e todas as variantes. Amostras e cadeias: [antes](evidencias/issue22/navegador-antes.json) / [depois](evidencias/issue22/navegador-depois.json).

### Servidor isolado

Handler HTTP em processo, sem rede/TLS e com autenticação fora da cronometragem; dez aquecimentos e 50 amostras. Contagem separada instrumenta execuções SELECT reais, não só criação de statements. Cálculo puro corresponde a **um** cenário; GET mantém todos.

| Conjunto | SELECTs GET antes → depois | GET p50/p95 antes (ms) | GET p50/p95 depois (ms) | Cálculo puro p50 antes → depois (ms) |
|---|---:|---:|---:|---:|
| Pequeno | 17 → 14 | 0.839 / 1.835 | 0.964 / 1.483 | 0.083 → 0.086 |
| Médio | 119 → 14 | 5.403 / 7.622 | 4.905 / 7.083 | 0.769 → 0.76 |
| Estresse | 520 → 14 | 62.014 / 67.871 | 56.649 / 62.55 | 3.713 → 3.579 |

[Servidor antes](evidencias/issue22/servidor-antes.json) / [depois](evidencias/issue22/servidor-depois.json). SELECTs do GET completo caem de 520 para 14 no estresse; os dois repositórios isolados executam nove consultas constantes. Isso não elimina o custo de cálculo/serialização de todos os cenários. Pequenos tempos oscilam e algumas medidas (por exemplo, PATCH isolado de flags) não melhoram; o ganho principal comprovado é o menor número de viagens e de gravações/leitura por interação, não uma aceleração geral das fórmulas.


## Testes e evidências

- `npm run check`: build frontend, TypeScript backend, **103 testes Node aprovados** e lint sem erros. Quatro avisos React preexistentes em `src/App.tsx` foram mantidos. Log: [npm-check.txt](evidencias/issue22/npm-check.txt).
- `python3 -m unittest discover -s deploy/tests -v`: **23 testes aprovados**, com simulação local dos comandos; nenhum instalador/deploy real executado. [Log](evidencias/issue22/deploy-tests.txt).
- `python tests/browser/issue22_regressions.py`: **14 grupos aprovados**, sete em cada viewport. Cobertura: contagem de requisições/revisões; perda de confirmação de flags/componente/serviço; digitação enquanto salva; serviços repetidos/fracionários; linha incompleta completada fora da ordem; conflito real de atributos/máscaras; falha no GET pós-escrita; alterações de parâmetros seguidas de edição; reload e hashes imutáveis de snapshot/PDF. [Resultados](evidencias/issue22/regressoes.json).
- Regressões existentes executadas com artefatos redirecionados para `.runtime/issue22/regressions`, em bancos sintéticos: PR17 **8**, editor financeiro **17**, M1 Atendimentos **19**, cenários Issue7 **3**, inclusão/recuperação Issue12 **11**; **58 grupos aprovados**. [Asserções consolidadas](evidencias/issue22/regressoes-existentes.json). `tests/browser/issue22_all_regressions.py` oferece o mesmo agrupamento reproduzível sem sobrescrever evidências históricas.
- Dois testes antigos tiveram expectativas atualizadas: conflito passa a ser detectado atomicamente no PATCH (mantidas asserções de rascunho e dados remotos); falha de catálogo não afeta mutação ordinária porque não há GET, mas sua falha na atualização explícita continua coberta, junto à falha do workspace após POST real. Nenhuma verificação de integridade foi retirada.
- Testes Node novos comparam DTOs/cálculos com SQL anterior, contam consultas constantes, verificam assinaturas e contrato opt-in, rejeição atômica de revisão obsoleta e captura da revisão antes de um segundo escritor pós-commit.
- Screenshots sintéticos: [desktop](evidencias/issue22/desktop-autosave.png) e [mobile](evidencias/issue22/mobile-autosave.png). São evidências funcionais do ambiente local, sem redesenho visual ou homologação produtiva.

### Reexecutar

Pré-requisitos já usados: Node 24, dependências npm do projeto, Python/Playwright e Chromium em `/usr/bin/chromium`. Scripts de navegador usam portas locais 5173/8787; o Harness verifica disponibilidade e cria/remove SQLite próprio temporário, sem carregar `.env` nem importar dados comerciais reais. Não executar testes de navegador em paralelo nas mesmas portas.

```bash
npm ci --no-audit --no-fund
npm run check
node scripts/measure-commercial.mjs /tmp/funix-server-NOVO.json
python tests/browser/issue22_performance.py /tmp/funix-browser-NOVO.json
python tests/browser/issue22_regressions.py
python tests/browser/issue22_all_regressions.py
```

Os arquivos de saída de medição devem ser novos (criação exclusiva). Para reproduzir o antes, usar checkout separado da base indicada, copiar somente `scripts/measure-commercial.mjs`, `server/tests/fixtures/performance.ts` e `tests/browser/issue22_performance.py` desta branch, instalar as mesmas dependências e executar build/medições nesse checkout. Não levar código funcional otimizado à base.

## Riscos e limites

- **Todos os cenários continuam calculados no workspace.** A carga de estresse permanece próxima de 2,47 MB e dezenas de ms de CPU/serialização. Não foi demonstrada necessidade de mudar contratos de comparação/invalidação para obter os ganhos de round-trips desta entrega. Não há cache de cálculos nem promessa de latência constante com crescimento ilimitado.
- Catálogo alterado em outra aba/contexto exige atualizar/reabrir a visão. Isso não contorna validação no backend. Não foi adicionado estado global ou cache distribuído.
- Gravações de atributos e flags continuam condicionadas às revisões reais; outro escritor ainda pode causar 409 legítimo. Recuperação é explícita e prioriza não perder/sobrescrever rascunho. Não há retentativa automática ilimitada.
- Mudanças de autosave requerem frontend/API da mesma revisão para o opt-in; clientes anteriores sem header mantêm o contrato anterior. Nenhum deploy foi executado.
- Motores comercial/técnico, FC/FR/MR/desconto, preço especial, energia, emissão/token/idempotência e arquivos imutáveis não foram alterados. A independência preço–energia permanece fora desta issue.
- Sem merge, importação, alteração de banco existente ou acesso à VPS/Coda. Próxima ação: auditoria deste PR; nenhuma funcionalidade adicional iniciada.
