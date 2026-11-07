# FUNIX — Acesso ao Chat V20 com operador único

**Decisão de produto informada pela direção em 07/11/2026:** o FunixApp terá **um único operador humano, o proprietário**, neste estágio. Não projetar múltiplas contas, papéis, hierarquias, equipes ou telas de permissões. **Status:** simplificação de escopo aprovada pela direção; medidas técnicas descritas abaixo ainda são proposta de implementação, não funcionalidade implantada.

## 1. Modelo mínimo

- O único operador acessa o Chat por meio da **sessão autenticada já existente** no FunixApp. Login com senha existente continua obrigatório; a aplicação deve ser acessada de forma segura por HTTPS.
- O operador autenticado pode **ler o histórico integral** das conversas da **instância permitida, definida no backend** (`funix_comercial`); inclusive conversas relacionadas a múltiplos Atendimentos. Não existe filtro por cargos ou por vendedor.
- Não há acesso anônimo, público ou por links de JID escolhidos pelo navegador. Requisições somente com `conversationId` opaco; a resolução do JID e da instância fica no servidor, com escopo limitado.
- O mesmo operador pode vincular/desvincular conversas e Atendimentos mediante **ação explícita** e motivo, com revisão e idempotência para evitar conflitos. Selecionar o Atendimento ativo não cria vínculo.
- Conversa sem Atendimento pode existir; não cria Atendimento, lead, vínculo ou cliente automaticamente. Uma conversa pode vincular vários Atendimentos e vice-versa. Desvinculação não apaga conteúdo.
- O histórico da conversa é o mesmo enquanto se alterna contexto comercial. Atendimento selecionado determina apenas que orçamento/veículo está no painel.
- A credencial Evolution fica **somente no servidor**; erros, logs e navegador não recebem a credencial, URLs administrativas, payloads brutos ou dados além do necessário. Não incluir mensagem em auditoria técnica.
- Manter `Cache-Control: no-store`, controles de timeout e limites, verificação da sessão a cada pedido e `Origin` em operações de escrita. A origem e disponibilidade de históricos devem ser exibidas sem prometer completude.
- Proteger e conservar os dados da FUNIX conforme política de privacidade e obrigações legais; usuário único não elimina LGPD.

**Pressuposto operacional obrigatório:** a senha e a sessão são usadas **somente pelo proprietário**; nenhuma outra pessoa utiliza ou compartilha o mesmo login. Se isso mudar, o controle de acesso deve ser revisto **antes** de criar usuário, ampliar acessos ou permitir operação simultânea.

## 2. Contrato de autorização mínimo — apenas proposta

| Operação | Controle obrigatório |
|---|---|
| Lista de conversas | Sessão ativa; somente instância interna autorizada; metadados mínimos |
| Histórico por `conversationId` | Sessão ativa; resolver conversa no servidor; limitar instância; página/limite fixados pelo backend |
| Lista de Atendimentos vinculados | Sessão ativa; buscar apenas dados do aplicativo |
| Vincular/desvincular | Sessão ativa; Origin, confirmação humana, motivo, revisão, idempotência e registro da alteração |
| Selecionar contexto | Conversa/Atendimento vinculados; não altera mensagens nem concede acesso a instâncias externas |

A proposta **não cria** endpoints, contas, privilégios, migrações ou acesso real à Evolution. `capabilities.messages=false` e o receptor HMAC atual permanecem desativados até um piloto autorizado.

## 3. Testes sintéticos (roteiro de aceite; nem todos implementados)

| ID | Caso | Esperado |
|---|---|---|
| SINGLE-01 | Sem sessão | Nenhuma chamada ao fornecedor; negado |
| SINGLE-02 | Sessão expirada | Nenhuma chamada ao fornecedor; negado |
| SINGLE-03 | Sessão válida e conversa da instância interna | Leitura da conversa permitida |
| SINGLE-04 | Conversa de outra instância | Negado sem chamada à Evolution |
| SINGLE-05 | Navegador tenta informar `remoteJid` | Rejeitar; não usar JID fornecido pelo cliente |
| SINGLE-06 | Conversa vinculada a dois Atendimentos | Alternar contexto não altera linha do tempo |
| SINGLE-07 | Chat sem Atendimento | Histórico pode ser lido; contexto fica neutro |
| SINGLE-08 | Atendimento desconhecido/não vinculado | Não é selecionado automaticamente |
| SINGLE-09 | Associação N:N | Vínculos são explícitos, sem exclusividade indevida |
| SINGLE-10 | Desvincular | Mensagens permanecem intactas; preferência inválida é limpa |
| SINGLE-11 | Alteração concorrente de vínculo | Controle de revisão + idempotência, sem duplicação |
| SINGLE-12 | Queda/timeout da Evolution | Estado de indisponibilidade, não “histórico vazio” |
| SINGLE-13 | Mensagens de dois Atendimentos | Histórico integral da conversa para o único operador |
| SINGLE-14 | Segredos, logs e falhas | Sem apikey, URLs administrativas ou corpo de mensagens |
| SINGLE-15 | Rota antiga por Atendimento | Sem regressão nem mudança de semântica |
| SINGLE-16 | Estado antes da liberação | Chat não ativado; `capabilities.messages=false` |

Testes automatizados de política pura são apenas demonstração **offline/sintética**, não prova de segurança da rota ou da infraestrutura. Integração só após validação de autenticação, URLs, migração, backups e regressão.

## 4. Decisão de eficiência e governança

- **Não implementar agora** RBAC, gestão de usuários, papéis, concessões por operador, permissões por Atendimento, auditoria por funcionário, convites ou recuperação de contas múltiplas.
- **Manter** autenticação existente, escopo fixo de instância, vínculos explícitos, segurança de credenciais, trilha mínima de alterações e privacidade.
- **Revisitar somente se** um segundo operador ganhar acesso, houver terceirização de suporte com conteúdo, ou exigência legal/contratual que demande segmentação.

Fontes: diretriz da direção (07/11/2026), protótipo V20 seção V14, `server/app.ts` e `server/chat/schema.ts` atuais; princípios de minimização e controles digitais em `06_legal_and_policy.md`, `07_digital.md`, `09_decision_framework.md`. A release conceitual v0.3.1 não está registrada como aprovada em `FUNIX_REGISTROS_VIVOS.md`.
