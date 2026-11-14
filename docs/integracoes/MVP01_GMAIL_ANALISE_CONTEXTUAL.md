# MVP01 — análise contextual e decisão assistida

## Entrega e limites

Jornada implementada: aviso Gmail existente → autorização humana persistida →
extração com evidências → consulta contextual somente leitura → proposta de
providências → complementação/aprovação/rejeição humana persistida.

A jornada sintética funciona integralmente no aplicativo local. Não houve merge,
deploy, alteração n8n, acesso a mensagens reais, escrita no Coda, envio de mensagens
ou ativação de executor. Integração com Gmail/Coda/IA reais **não homologada**.

Base inicial consultada: main `2692b0ee187ce35464ab7fbc55b865e0949308a3`.
Durante o trabalho, a main avançou para `9d22ebfff0b4879e706613a1af6baa4839adec6a`
com merge da PR #221. A branch foi atualizada para essa base sem conflitos; o
incremento preserva a OS incorporada pela main, sem novas integrações operacionais.
PRs #149 e #219 continuavam abertas, com partes históricas já presentes na main;
nenhum merge integral foi feito. A main já contém avisos Gmail, fila, pacotes,
complementação e contratos de preparação. PR #219 inclui preparação comercial e
migração V18 fora deste incremento. PR #220 permanecia aberta/draft, HEAD
`8ff1e3f955a76cfcdfdda13bc653a952aeefbcf6`; suas correções não foram reconstruídas.
Relatórios da recuperação devem ser consultados na branch daquela PR, pois não
constituem evidência de merge na main. O incremento não altera o contrato da OS.

Inspeção n8n somente leitura, separada do GitHub: alimentador `kOOWQripUr9BNy29`
publicado `8a791abf-faaf-4915-805f-c3d5448bdad2`; worker `KQ6qkUfdvz6PApmt`
publicado `2cc9fd9f-0637-4ff0-9b18-63e47f756c24`; monitor `vlwnt13SHEKwOS2S`
ativo `ab621c5b-d8c2-4bf2-8e00-5cc6fbaade1d`. Versões distintas dos snapshots originais
da PR #220; o estado publicado não implica merge Git. Nenhum workflow foi modificado.

## Reaproveitamento e incremento

- Autorização, negação, ator/data/requestId/revisão/hash: `GmailIntakeRepository`.
- Propostas, hash/revisão, decisões e complementações: `UpdatePackageRepository`.
- Área Atualizações: um card Gmail com painel contextual, sem segunda entrada da proposta.
- `EventInventory`, `EventPreparation`, evidências e `prepareGmailPackageForReview`
  continuam no caminho existente de preparação de alterações operacionais. Não foram
  importadas da PR #149/#219 nem alteradas suas exigências de atestado.
- O novo caminho interno prepara **recomendações para conferência humana** por template
  fixo. Não declara verificações comerciais como concluídas e não usa o tipo `other`
  para executar comandos. O modelo extrai fatos, não gera ações executáveis.
- Conversão de células ricas Coda reutiliza `cellText`. A consulta contextual requer
  configuração explícita de doc/tabela/colunas auditadas; não adivinha IDs pelo nome.
- Não há segunda fila de transporte. `gmail_analysis_jobs` é persistência da análise
  autorizada, independente da fila de entrega do aviso (esta não foi modificada).

Arquivos novos: `shared/gmail-analysis.ts`; backend `gmail-analysis.ts`,
`gmail-analysis-schema.ts`, `gmail-analysis-contract.ts`, `gmail-analysis-providers.ts`;
`src/GmailAnalysisPanel.tsx` e CSS; testes e scripts de demonstração/navegador.
Integrações pontuais em app/index, repositório/simulador de pacotes, componentes
Atualizações/aviso, `.env.example`, API e CI de navegador existente.

## Contrato e consistência

Autorização permanece independente da proposta. No piloto real, recuperação e claim
se limitam ao UUID/corte persistidos; o comportamento irrestrito de recuperação é
reservado à demonstração sintética em banco separado. Antes de cada etapa de IO e da
confirmação final, o serviço verifica status/revisão/hash persistidos. Negação é
terminal no repositório existente. A recuperação repara o intervalo decisão→job e
complementação→nova geração. Uma rejeição durante reconsulta prevalece.

Um job por aviso; um snapshot por aviso/geração. Lease de 120 segundos com token e
fencing, timeout total de 45 segundos, até três casos por ciclo de 15 segundos.
Até cinco tentativas automáticas por geração, backoff de 1/2/4/8 minutos. Após o
limite, recuperação exige comando autenticado idempotente. Não existe limite de
novas tentativas **explicitamente solicitadas** por humanos, que são registradas.

Fonte/modelo/contexto/persistência têm códigos técnicos separados. 401/403 aguardam
correção de credencial e retomada humana; 400/422, 404 de API e 409 aguardam conferência,
sem descarte do caso. 408/429/5xx/rede permitem retentativa limitada. Ausência de
candidatos na resposta válida Coda é pendência funcional, distinta de 404 da API.
Resposta inválida nunca cria proposta. Checkpoint da extração evita chamar novamente
Gmail/modelo quando apenas contexto ou persistência falharam. Falha na transação de
proposta não deixa pacote órfão. Interrupção retoma após lease; worker antigo não
pode confirmar o resultado de outro proprietário.

Extração contém campos conhecidos e desconhecidos, origem, evidência literal e
proveniência declarado/inferido/desconhecido. Contexto ERP é uma seção separada,
com digest/data, candidatos e divergências. Identificador forte (processo, XP ou
orçamento) é necessário para correspondência automática; placa isolada é insuficiente.
Múltiplos candidatos exigem seleção humana; conflitos não recebem vínculo automático.
Complementação não apaga o que o e-mail declarou e cria nova proposta imutável.

Pacotes `reviewOnly` são identificados por vínculo persistido. Aprovação continua
usando o status legado compatível, mas é mostrada como "Proposta aprovada · sem
execução" e sai das pendentes. O simulador recusa esses pacotes. Qualquer executor
futuro precisará respeitar essa barreira e de autorização/contrato separados.

## Segurança e documentos

Sessão e mesma origem nas escritas, JSON limitado, revisão/hash e recibos existentes.
Saída do modelo tem schema rígido e citações verificadas; inferências não formam
chaves de busca. Nenhuma ferramenta é concedida à IA. Prompt injection não pode
habilitar IO adicional ou criar decisões humanas; interpretação semântica ainda
exige revisão humana. Sem corpo completo ou erro bruto do provedor em logs/checkpoints.
Citações podem conter dados pessoais: banco/sessão continuam sujeitos à governança
existente; não foi inventada política de retenção ou exclusão documental.

Anexos preservam conta, mensagem, ID do anexo, nome/MIME/tamanho e digest quando
fornecido. Não baixa anexos binários ou interpreta seu conteúdo. Referências
permitirão futuramente deduplicação por origem/digest; **não há upload, pasta,
movimentação, permissões ou política documental Drive antecipada**.

## Demonstração reproduzível

Node 24/npm 11; `npm ci`. Em dois terminais, sem carregar `.env`:

```sh
node scripts/gmail-analysis-demo.ts
npm run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

Abra `http://127.0.0.1:5173/atualizacoes`, senha sintética
`synthetic-mvp01-password-0123`. O servidor usa somente
`.runtime/gmail-mvp01-demo/demo.sqlite` e providers sintéticos embutidos.
Não usa o banco normal nem credenciais reais. Reiniciar preserva a jornada; para
recomeçar, com a demo parada, remova exclusivamente esse diretório sintético.

1. Abra o aviso, autorize análise; confirme que não autoriza reparo ou envio.
2. Confira processo 12345, orçamento ORC-10, evidências e campos desconhecidos.
3. Confira contexto Coda sintético e referência do anexo; não existe arquivo no Drive.
4. Aprove ou rejeite as providências; consulte Todos e recarregue.
5. Confirme decisão preservada e ausência de qualquer alteração operacional.

O navegador automatizado acrescenta segundo caso com falha de consulta, recuperação,
dois candidatos, seleção humana, nova revisão e rejeição, nas três larguras.

```sh
npm run check
node --test server/tests/gmail-analysis*.test.ts
# Dependência transitória de QA, como no CI existente:
npm install --no-save --package-lock=false playwright@1.56.1
node scripts/gmail-analysis-browser.mjs
node scripts/updates-browser.mjs
node scripts/updates-handoff-loopback.mjs
```

CI executa o novo navegador no workflow existente de Atualizações. Artefatos sintéticos
são publicados pelo CI; localmente ficam em `.runtime/gmail-analysis-browser/`
(`results.json`, seis screenshots) e `artifacts/updates-browser/`. Asserções verificam
scroll horizontal, controles acessíveis e ausência de erro JS, além dos estados no banco.

## Matriz de aceitação e evidências

| Critério | Evidência automatizada |
|---|---|
| 1. Autorizado: uma análise/proposta | Serviço + API + navegador |
| 2. Negado não processa | Replay, retry e recuperação sem providers |
| 3. Reentrega/concorrência | Serviços concorrentes, duas conexões SQLite, unicidade |
| 4. Reinício/decisões | SQLite em arquivo reaberto; reload navegador |
| 5. Sem XP/placa | Processo 12345; ausentes continuam desconhecidos |
| 6. Múltiplos candidatos | Sem vínculo, aprovação bloqueada, seleção/complementação |
| 7. Divergência | Processo/orçamento/veículo explícitos; sem vínculo automático |
| 8. Falha Coda | Checkpoint/retry; navegador recuperação |
| 9. Ausência não inventada | Unknown explícito e recusa de valor sem citação |
| 10. IA malformada | Schema, JSON/refusal/incomplete rejeitados |
| 11. Instrução maliciosa | Dados separados, ausência de tools, comandos rejeitados |
| 12. Alteração material | Nova geração, snapshot anterior imutável, aprovação stale 409 |
| 13–14. Aprovação sem execução/ERP | Dados sintéticos intactos, zero executed, simulador bloqueado |
| 15. 320/390/1440 | Chromium, fluxo completo e capturas em cada largura |

Versões locais: Node 24.22.1, npm 11.9.0, Chromium 156.0.8078.79, Playwright 1.58.2.
Resultados finais de check/navegador e CI serão registrados na PR, distinguindo os
ensaios sintéticos da integração real ainda não realizada.

## Riscos residuais e ativação posterior (não executada)

- Bootstrap agora admite modo real-pilot explícito com configuração completa e scope
  persistido para um único aviso; demonstração sintética permanece separada. Os novos
  caminhos foram exercitados com fetch sintético, sem homologação de credenciais reais.
  Configuração, identidade/escopos, colunas Coda e provedor IA dependem de conferência
  e autorização para o piloto. Ver o roteiro específico abaixo.
- Aviso legado identifica mensagem, não múltiplas contas. MVP é de conta única;
  associação de novas contas exige contrato de identidade, sem inferência por ID.
- Leitor Gmail admite texto plain MIME; HTML-only, corpo grande, anexos com texto
  e MIME fora do limite permanecem falha/pendência recuperável, sem conteúdo inventado.
- Consulta Coda admite até 20 candidatos e falha fechada com paginação adicional.
  O snapshot pode ficar desatualizado após a consulta; nenhuma ação operacional é
  autorizada por ele. Não há sincronização/ERP local completo.
- Modelos podem interpretar mal fatos mesmo com citações; revisão humana é obrigatória.
  Não se comprovou precisão com dados reais nem interpretação binária de anexos.
- Evidências permanecem nas tabelas SQLite locais. Retenção, acesso ampliado e gestão
  documental requerem a política própria ainda em homologação.

Proposta de ativação: seguir o roteiro específico abaixo; revisar esta PR e o CI;
resolver a dependência de entrega da
PR #220 sem merge indiscriminado; configurar providers reais com escopos somente
leitura em ambiente explicitamente autorizado; verificar saúde/autorização/IDs com
novo caso permitido; homologar evidências, ambiguidade e decisão; só depois avaliar
ativação controlada para operadores. Não existe alteração n8n necessária nesta PR.

Antes de publicação autorizada: backup SQLite, registrar versão anterior, habilitar
storages aditivos e feature flag com providers revisados, validar saúde e caso novo.
Rollback: desligar análise/parar scheduler, manter tabelas/snapshots/decisões e restaurar
versão anterior conforme compatibilidade revisada; não apagar filas, avisos ou dados
para "reiniciar". Nenhuma etapa de publicação ou caso real foi executada aqui.


## Incremento da revisão técnica — preparação do piloto real

Revisão atendida: [bloqueios de bootstrap e recuperação histórica](https://github.com/Funix-CentroReparacaoAutomotiva/funixapp/pull/222#pullrequestreview-5907529044).
Não houve execução real do piloto nesta etapa.

### Configuração e barreiras

OFF por padrão. O modo real-pilot instancia os adapters existentes, sem fallback
para fixture, token de outro módulo ou modelo implícito. O modo sintético legado
continua funcionando em banco próprio e desenvolvimento. Configuração inválida aborta
o startup; desabilitar a flag permite voltar ao aplicativo sem análise, preservando registros.

| Variável (prefixo FUNIX_GMAIL_ANALYSIS_) | Valor exigido |
|---|---|
| ENABLED / MODE | true / real-pilot, somente após autorização de ativação |
| PILOT_NOTICE_ID | Um UUID de aviso novo já existente, inicialmente sem análise |
| PILOT_ACTIVATED_AT | Corte UTC anterior à chegada: YYYY-MM-DDTHH:mm:ss.sssZ |
| GMAIL_ACCOUNT / GMAIL_TOKEN | Conta exata e access token OAuth de curta duração, grant gmail.readonly |
| CODA_TOKEN / CODA_DOC_ID / CODA_TABLE_ID | Credencial com acesso restrito somente leitura e IDs auditados |
| CODA_COLUMNS_JSON | JSON exato das sete chaves documentadas na API, valores c-... distintos |
| CODA_READ_ONLY_CONFIRMED | true após conferência de privilégio no provedor |
| OPENAI_API_KEY / OPENAI_MODEL | Chave dedicada a este fluxo e modelo explicitamente homologável |

Requer os storages/decisões Gmail e Atualizações existentes e a flag de complementação
para casos ambíguos. Não misturar real-pilot com SYNTHETIC=true ou fixture configurada.
Não colocar valores de credenciais em comandos, PR, screenshots ou arquivos versionados.

O banco vincula de forma imutável UUID, corte, conta e hash da configuração não secreta
(doc/tabela/colunas/modelo). Tokens ficam fora do vínculo e podem ser renovados sem
ampliar elegibilidade. Mudar UUID/corte/contexto/modelo no mesmo banco falha fechado;
esta etapa **não implementa rotação de piloto nem reset**. Não apagar a tabela para
liberar outro caso: outro piloto exigirá escolha e procedimento explicitamente revisados.
Troca para modo sintético no banco vinculado também é recusada.

Gate em criação, recuperação, claim, retomada, complementação e em cada etapa externa.
Somente o aviso selecionado, criado e autorizado a partir do corte, pode ser processado.
Avisos negados não entram. Jobs/autorizações históricos ficam intactos. O novo caso
não pode já ter job prévio quando o vínculo é criado, evitando reutilizar análise sintética.
Todas as instâncias precisam executar a versão revisada; parar schedulers antigos antes
ativar. Não é possível impor o gate a um processo ainda executando código antigo.

Antes de ler a mensagem elegível, Google tokeninfo valida validade e grant gmail.readonly
(escopos amplos/de escrita são recusados); Gmail profile confirma a conta. Isso ocorre
somente depois de autorização persistida, não no bootstrap ou health. Coda só recebe
GET; seu privilégio real precisa ser conferido no provedor — a flag não comprova grant.
IA não recebe ferramentas. Falhas de credencial permanecem recuperáveis por intervenção.
Não registrar tráfego com URL/headers/body: tokeninfo usa access_token na query TLS;
a aplicação não loga essa URL, token ou resposta bruta. Proxies/traces precisam da mesma
restrição/redação. Nenhum refresh OAuth automático ou segredo persistido no SQLite.

Consulta autenticada `GET /api/atualizacoes/analises-gmail?ids=` retorna items vazio e
scope técnico: modo, UUID, corte, hash, valid e authorized. Não revela conta, mensagem,
prompt ou token. É verificação local de configuração, não prova de saúde remota.
Erros de acesso aparecerão no estado do caso após a etapa autorizada.

### Roteiro de homologação de um caso (para autorização posterior)

**Antes:**

1. Revisar PR/CI e autorizar separadamente publicação/ativação e o acesso real aos três
   serviços. Conferir HEAD instalado em todas as instâncias. Preservar backup SQLite e
   registrar versões/flags anteriores. Manter análise OFF e schedulers antigos parados.
2. Registrar o corte UTC. Usar uma mensagem nova e controlada após esse corte, com
   conteúdo e destinatário aprovados para o teste; a chegada/aviso usa a integração
   Gmail existente. Não reentregar nem reprocessar avisos históricos. Capturar o UUID
   do novo aviso na consulta autenticada; manter a autorização inicial pendente.
3. Confirmar a conta exata, grant Gmail somente leitura, acesso Coda limitado ao
   documento, tabela e sete colunas (conferidas pelo responsável), e política aplicável
   ao envio do conteúdo para IA. Configurar chave/projeto IA dedicado e limite de gasto;
   conferir modelo/preços atuais sem inventar custo. Credenciais ficam somente no
   mecanismo de segredos já utilizado pela instalação; sem alterar n8n.
4. Configurar o único UUID/corte e todos os campos obrigatórios. Ativar somente mediante
   autorização e reiniciar. Consultar scope com ids= vazio: UUID exato, corte correto,
   valid=true e authorized=false. Confirmar que nenhum histórico ganhou job ou teve
   tentativas/estado alterados. Nenhuma consulta remota deve ocorrer nessa fase.

**Durante:**

5. Autorizar a análise desse aviso na UI com sessão autenticada; registrar horário UTC
   e operador. Confirmar persistência da autorização antes da primeira chamada. A
   checagem automática Gmail deve bloquear conta/grant incorretos antes de ler o corpo.
6. Acompanhar estado/código técnico, evidências e consulta Coda. Conferir processo,
   orçamento, condições, dados desconhecidos, ambiguidades/divergências e horário do
   contexto. Placa isolada não basta. Não confirmar prazo, peças, capacidade ou agenda
   por inferência. Se faltar dado, complementar e revisar a nova geração antes de aprovar.
7. Aprovar/rejeitar somente as recomendações. Confirmar decisão persistida e snapshot
   preservado. Conferir ausência de e-mail/WhatsApp enviado, arquivo no Drive, compra,
   agendamento, OS, alteração comercial ou escrita Coda. Não executar as providências.

**Depois:**

8. Registrar resultado, duração observada (início/fim UTC), tentativas, gerações e erros
   sanitizados. Verificar uma proposta por geração e nenhuma duplicação por retry/reload.
   Conferir que nenhum aviso fora do UUID foi processado e decisões anteriores continuam iguais.
9. Conferir uso/custo no projeto dedicado do provedor IA, no intervalo do piloto,
   incluindo tentativas cobradas. O adapter não retorna faturamento; dashboards podem
   atrasar. Custo não disponível deve ser marcado desconhecido, nunca zero fictício.
10. Preservar evidências e decisões conforme governança de dados; avaliar utilidade
    das três providências de revisão fixas com o operador. Não ampliar conectores ou
    converter recomendações em execução. Decidir separadamente sobre outro piloto.

**Sucesso:** apenas o UUID autorizado foi analisado; identidade/grant corretos;
evidências e correspondência conferidas ou incerteza explicitada; decisão humana
persistida; sem duplicidade/escrita externa; duração/custo apurados ou pendência
explicitamente registrada. Sucesso do caso não equivale à aprovação de ações operacionais.

**Interromper:** scope/conta/grant divergente, qualquer job histórico alterado, evidência
sem suporte, associação incerta apresentada como certa, chamada inesperada, erro
recorrente, limite de gasto atingido ou proposta com aparência de ação executada.
Desabilitar a análise e registrar somente códigos/IDs técnicos; não insistir por retries
quando a causa for credencial/configuração. Corrigir primeiro e retomar explicitamente
apenas o mesmo caso, preservando checkpoint e autorização.

**Reversão:** colocar ENABLED=false em todas as instâncias e reiniciar de modo controlado;
encerramento aborta etapa em curso e não inicia o próximo job. Requisição já enviada
pode ter sido cobrada; não há cancelamento financeiro garantido. Preservar jobs, scope,
snapshots e decisões. Se necessário restaurar versão anterior do app, manter análise OFF
antes do rollback; não restaurar cópia antiga do banco sobre decisões mais recentes e
não remover triggers/tabelas para contornar o gate. Não reverter Gmail/Coda/Drive por
scripts: este MVP não deveria ter escrito nesses sistemas. Uma escrita inesperada é
incidente e interrompe o piloto.

### Evidências e pendências desta etapa

Regressões novas: bootstrap real completo com fetch sintético; configuração incompleta;
compatibilidade sintética; caso único autorizado; históricos/jobs preexistentes intactos;
negado selecionado após vínculo; restart/rotação de tokens sem ampliação; modo/contexto
alterado bloqueado; fonte de conta errada bloqueada antes de IA; serviço sem scope cercado
num await; API de scope e autorização de outro aviso sem agendamento; simulador persistente
recusando reviewOnly sem gravar recibo. Resultados finais e CI constam na PR.

Interface e contratos comerciais não foram alterados. O caminho persistente do simulador
já passa pela barreira reviewOnly; busca de referências ao status de aprovação não
identificou dispatcher operacional nesta base. Os módulos de handoff/ingestão existentes
não transformam aprovação em execução; atestados antigos não foram relaxados.

Pendentes: credenciais e grants reais, mapeamento Coda conferido, precisão do modelo,
custo/duração e utilidade num caso real, política de dados aplicável e autorização de
publicação/ativação/consultas. Riscos remanescentes incluem expiração de token (retomada
humana, sem refresh), texto HTML-only/anexos não interpretados, Coda com mais de 20
candidatos e recomendações fixas. Nenhuma dessas dependências foi declarada homologada.
