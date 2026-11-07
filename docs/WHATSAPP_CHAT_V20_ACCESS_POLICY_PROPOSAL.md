# FUNIX — Proposta de política de acesso e cenários de teste do Chat V20

**Data:** 07/11/2026. **Estado: PROPOSTA / NÃO APROVADA; NÃO IMPLEMENTADA.** Anexo à PR #83 e à Issue #71. Nenhuma mudança de produção ou acesso a dados reais foi autorizada por este documento.

## 1. Fundamento e problema concreto

- `00_master_index.md` exige distinguir proposta de política aprovada; `FUNIX_REGISTROS_VIVOS.md` não registra a release conceitual v0.3.1 como aprovada nem identifica uma matriz de alçadas de Chat.
- `06_legal_and_policy.md` §7 recomenda acesso proporcional por função, finalidade, proteção de mensagens e logs, retenção definida e validação LGPD. Não presume consentimento/autorizações inexistentes.
- `07_digital.md` §11 requer gestão de credenciais, permissões, recuperação e responsável técnico; `09_decision_framework.md` §7 reserva privacidade e mudanças de impacto à decisão autorizada; `10_strategy.md` recomenda soluções proporcionais ao esforço de gestão.
- `server/app.ts` implementa hoje sessão de senha, não identidade individual/roles documentadas. `server/chat/schema.ts` mantém associação temporal de vínculo único ativo, diferente do N:N V20.
- O protótipo V20 `demoLinks` e `demoActiveByChat` é desenho de UX: **não é prova de autorização**.
- Uma conversa WhatsApp pode conter históricos de vários veículos, familiares, representantes e Atendimentos. Acesso a Atendimento A, por si, não justifica revelar toda a conversa incluindo Atendimento B.

**Decisão provisória de projeto recomendada:** leitura integral por conversa requer permissão própria concedida explicitamente a uma identidade individual. Vínculo comercial e contexto visual **não concedem** essa permissão. Nenhum endpoint real deve expor histórico integral enquanto o aplicativo usar somente uma senha comum sem identidade/política individual auditável.

## 2. Modelo mínimo de autorização (proposta para decisão)

Um `principal` é o usuário individual autenticado e identificado, **não** nome digitado no frontend, telefone WhatsApp, sessão genérica nem conta técnica compartilhada. As permissões são verificadas **no servidor, em cada requisição**, a partir de dados confiáveis e revogáveis.

| Permissão proposta | O que permite | O que NÃO permite |
|---|---|---|
| `chat.inbox.read` | Ver metadados técnicos mínimos de conversas disponíveis no escopo designado | Ler textos, mídia ou abrir conversa fora do escopo |
| `chat.history.read_full` | Ler linha do tempo integral de conversas autorizadas no escopo da caixa de entrada | Acessar todas as caixas/instâncias, exportar tudo, enviar mensagens |
| `chat.links.manage` | Criar e desfazer vínculos N:N com revisão, motivo e auditoria | Alterar história, vincular por inferência automática, conceder `read_full` |
| `chat.audit.read` | Ver trilha mínima de operações autorizadas | Consultar corpos de mensagens ou segredos |
| `chat.support.temporarily_access` | Permissão excepcional, **somente se aprovada**, temporária e auditada | Acesso permanente por ser técnico de TI |

As permissões poderão ser associadas a papéis e escopos de instância/caixa; **nenhuma concessão é automática só por possuir nome de função**.

### Matriz sugerida à direção (não delegação vigente)

| Função típica | Inbox | Histórico integral | Gerenciar vínculos | Auditoria |
|---|---|---|---|---|
| Direção/gestão designada | Sim, se concedido | Sim, se concedido | Sim, se concedido | Sim, se concedido |
| Atendimento/comercial designado | Sim, se concedido | Sim, se concedido para a caixa operacional | Somente se delegado | Não por padrão |
| Produção/pátio | Não por padrão | Não | Não | Não |
| Suporte de TI | Metadados técnicos sem conteúdo, conforme necessidade | Não por padrão; exceção temporária aprovada | Não | Logs técnicos sem conteúdo, quando autorizado |
| Integrações n8n/ERP | Contas de serviço com mínimo privilégio, sem login humano | Não por padrão | Não | Não |

**Alternativa mais restritiva** (se a direção decidir segmentar por equipe/cliente): conceder `read_full` apenas por conversa/instância, com gestão explícita de escopos. Isso aumenta custo administrativo. **Alternativa não recomendada:** liberar histórico integral para qualquer login por senha comum ou inferir direito a partir de vinculação de Atendimento.

**Escolha pendente da direção:** (a) Comercial autorizado enxerga histórico de todas as conversas da caixa única `funix_comercial`, ou (b) permissões por subconjunto/atribuídas. Recomenda-se (a) para equipe comercial pequena e caixa coletiva **somente após identificar individualmente os operadores, aprovar a delegação, incluir auditoria e validar necessidade/privacidade**. A seleção de Atendimento não muda o escopo do Chat.

## 3. Regras obrigatórias propostas

1. **Negação por padrão:** ausência de identidade individual, escopo, permissão ou estado conhecido = negar. Sessão expirada/inválida = `401`; recurso fora de escopo = resposta neutra sem permitir enumerar conversas (por exemplo `404`).
2. O navegador envia apenas `conversationId` opaco. O backend resolve `instance` e `remoteJid` autorizados; nunca permite consultar JIDs arbitrários com uma chave do fornecedor.
3. O frontend nunca recebe `AUTHENTICATION_API_KEY`, endereço administrativo, SQL, `mediaKey`, URLs brutas ou campos de payload fora da projeção mínima contratada.
4. **Permissão de contexto ≠ permissão de histórico**: usuário com direito ao Atendimento A mas sem `chat.history.read_full` não recebe o conteúdo integral. Se autorizado ao Chat, mudar contexto de A para B não filtra/re-escreve o histórico — apenas muda o painel comercial.
5. Vincular conversa X ao Atendimento A exige `chat.links.manage`, permissão de consulta ao Atendimento, confirmação humana de mesma demanda, `expectedRevision`, `requestId` idempotente e motivo. Desvincular não apaga mensagens nem relações legadas; tentativa concorrente gera `409`.
6. Selecionar contexto B exige vínculo X↔B existente **e** permissão para ver B; mudança de preferência nunca cria vínculo.
7. Chat sem Atendimento é permitido no domínio; a visibilidade depende de escopo de inbox, não gera lead nem vínculo automático. Mensagens de `@lid`, números ambíguos, familiares e representantes não são convertidos em titularidade do veículo.
8. Auditoria mínima: identidade individual, timestamp, ação, `conversationId` opaco e resultado, alteração de vínculo com revisão/motivo; não salvar corpo de mensagem, nomes, números, URL de mídia, credenciais ou resposta Evolution em logs.
9. Revogação precisa surtir efeito nas próximas requisições; respostas `Cache-Control: no-store`; não continuar entregando mensagens por cache de privilégios após logout/revogação.
10. Histórico incompleto ou Evolution indisponível deve ser comunicado explicitamente, não tratado como “conversa vazia”. Falha do Chat não bloqueia vendas, pátio, orçamentos, n8n nem ERP.

A política de retenção de logs/histórico, direitos dos titulares, formalização de usuário individual, vínculo de funcionários e acesso por terceiros ainda requer validação jurídica/administrativa. Este texto não substitui avaliação LGPD.

## 4. Plano de testes sintéticos (ESPECIFICADO, AINDA NÃO IMPLEMENTADO)

Todos os IDs abaixo são inteiramente fictícios. Os testes devem usar transporte e banco em memória/mockados, sem Evolution produtiva, WhatsApp, contatos ou credenciais reais.

Dados: `conv-1` tem vínculos `att-A` e `att-B`; `conv-2` tem vínculo `att-A`; `conv-3` não tem Atendimento. `op-comercial` possui `chat.inbox.read` e `chat.history.read_full` para a instância fictícia; `op-restrito` possui apenas acesso a `att-A`; `op-gestor` possui gestão de vínculos explicitamente delegada; `op-ti` não tem permissão de conteúdo.

| ID | Cenário | Resultado esperado |
|---|---|---|
| AUTH-01 | Sem sessão ou sessão expirada lê `conv-1` | 401; nenhum acesso ao fornecedor |
| AUTH-02 | Login compartilhado, sem principal individual, pede histórico | Negado; nenhum acesso ao fornecedor |
| AUTH-03 | Operador com `att-A`, mas sem `read_full`, pede `conv-1` | Negado, sem informar existência de conversa/Atendimento B |
| AUTH-04 | Operador autorizado em `conv-1` alterna contexto A→B | Mesma conversa, mesmas mensagens; muda somente seleção comercial |
| AUTH-05 | Operador autorizado vê `conv-3` sem Atendimento | Histórico permitido pelo escopo; contexto neutro e nenhum lead criado |
| AUTH-06 | TI sem permissão de conteúdo tenta abrir `conv-1` | Negado; logs não revelam corpo/segredo |
| AUTH-07 | Usuário autorizado a uma caixa pede `conversationId` de outra | Negado antes de chamar Evolution |
| AUTH-08 | Frontend envia JID arbitrário em vez de `conversationId` | Rejeitado, sem consultas externas |
| AUTH-09 | Gerente autorizado vincula `conv-1`→`att-B` com revisão correta | Vínculo único idempotente, sem duplicar mensagens |
| AUTH-10 | Duas escritas concorrentes usam a mesma revisão esperada | Uma confirma; outra retorna 409; sem estado parcial |
| AUTH-11 | Usuário apenas `read_full` tenta gerenciar vínculo | Negado; sem alteração |
| AUTH-12 | Usuário seleciona contexto `att-X` não vinculado a `conv-1` | Rejeita; não cria vínculo automático |
| AUTH-13 | Desvincular `att-B` de `conv-1` | Mensagens intocadas; contexto ativo B é invalidado |
| AUTH-14 | Revoga `read_full` entre páginas de histórico | Próxima página negada sem acesso à Evolution |
| AUTH-15 | Evolution falha/timeout após autorização | Estado “indisponível”, não array vazio com histórico completo |
| AUTH-16 | Histórico com A e B e operador só pode ver A | Sem `read_full`, não entregar nenhuma página, inclusive mensagens de A |
| AUTH-17 | `@lid` desconhecido e telefone parecido com nome existente | Nenhum vínculo/grant criado por heurística |
| AUTH-18 | Logs HTTP, erro de fornecedor e auditoria | Não contêm texto, número, `apikey`, URL bruta ou payload |
| AUTH-19 | `GET /api/atendimentos/:id/messages` legado | Comportamento existente preservado durante fase experimental |
| AUTH-20 | `capabilities.messages=false`, ingress HMAC desativado | Continuam desativados em todos os testes do experimento |

**Critério de aceite para automação futura:** executar testes negativos da permissão *antes* de qualquer chamada ao transporte; incluir teste de revogação, cross-Atendimento, contexto neutro, operações N:N e regressão de rotas antigas. CI não pode ser usado como prova de autorização aprovada. Não ligar este contrato proposto a routes/UI/SQLite real antes de uma decisão formal.

## 5. Caminho proporcional de implantação (proposto)

- **Agora, ChatGPT:** direção escolhe escopo do comercial e alçadas de vínculo; definir responsável e registrar a decisão com data, escopo e limitações em `FUNIX_REGISTROS_VIVOS.md`, seção C, se aprovada. Sem decisão, não liberar histórico real.
- **Próximo trabalho de código:** construir motor **puro e isolado** de política + testes AUTH-01…AUTH-18 com dados sintéticos, sem transporte real, banco ou runtime. Cabe no ChatGPT se testes puderem ser verificados; caso contrário Codex por execução integrada.
- **Em seguida, quando aprovado:** identidade individual mínima, grants e checagem por rota/conversa; implementação exige avaliação de migrações/testes integrados. Codex pode trazer vantagem concreta nesse ponto.
- **Somente depois:** piloto reversível de leitura interna em ambiente autorizado. Envio, consumo de eventos em produção e espelho durável são tarefas separadas.

## 6. Decisões abertas — sem presumir aprovação

**D1.** A caixa `funix_comercial` é compartilhada entre todos os atendentes comerciais habilitados, com acesso ao histórico integral? Ou haverá subdivisão por operador/cliente?

**D2.** Quem poderá criar e remover associações N:N: gestores somente, ou atendentes comerciais designados?

**D3.** Quem responderá pela administração de contas, concessão/revogação, auditoria e privacidade? Ainda não há pessoa formalmente designada neste registro.

**D4.** Retenção dos registros de auditoria e tratamento de conversas pessoais/fora do escopo comercial dependem de decisão de privacidade e revisão profissional proporcional.

Nenhuma resposta “vamos adiante” equivale a conceder permissões, aprovar esta política, implantar autenticação nova ou acessar históricos reais.
