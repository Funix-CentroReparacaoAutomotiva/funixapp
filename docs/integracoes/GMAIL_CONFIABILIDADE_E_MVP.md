# Gmail: confiabilidade mínima e primeira jornada assistida

Data: 14/11/2026. Base auditada: `main@2692b0ee187ce35464ab7fbc55b865e0949308a3`.
Estado: correções preparadas e verificadas em desenvolvimento isolado; **não publicadas no n8n**.
Contrato e escopo do MVP abaixo são propostas, não autorização de ativação.

## 1. Avaliação e defeitos prioritários

Os três workflows estão ativos e com draft igual à versão publicada observada:

| Componente | ID | Versão observada |
|---|---|---|
| Monitor | `vlwnt13SHEKwOS2S` | `ab621c5b-d8c2-4bf2-8e00-5cc6fbaade1d` |
| Alimentador | `kOOWQripUr9BNy29` | `e9d72d6c-1188-42d0-bff4-423aa758150f` |
| Worker | `KQ6qkUfdvz6PApmt` | `284851a9-4a1d-4c19-a5c6-95258a663376` |

O caminho continua: captura → ledger → chamada assíncrona → enqueue HMAC → chamada
assíncrona → claim → leitura mínima → classificação → ACK → conciliação do ledger.
SQLite já oferece deduplicação, claim transacional, lease de 120 segundos,
idempotência de claim/ACK, backoff e bloqueio na quinta tentativa. Não recriar isso.

| Prioridade | Evidência reproduzida | Correção local preparada |
|---|---|---|
| Alta | Busca do evento ocorria após limitar aos 100 `received`; um ID fora da janela não era encontrado | Busca por ID no próprio DataTable quando acionado por evento; recuperação consulta o ledger com paginação nativa `returnAll` |
| Alta | Recuperação selecionava uma mensagem por hora | Até 25 IDs distintos por ciclo, processamento individual e chamada do worker para cada entrega pendente |
| Alta | ACK confirmado seguido de resposta perdida/erro do ledger deixava `queued` sem conciliação; alimentador só consultava `received` | `status` para `queued/leased/retry`, avanço somente após recibo do mesmo ID; estados finais não iniciam nova leitura Gmail |
| Média | Falha em um HTTP/acionamento podia interromper o lote | Continuação por item, estado conservador e código fixo de erro; recuperação posterior |
| Média | Todo erro HTTP do classificador virava retry, inclusive conflito 409 | 4xx permanentes bloqueiam; 408/429/5xx permanecem recuperáveis; payload inválido nunca confirma entrega |
| Média | ID de evento inválido virava acionamento genérico de recuperação | Evento malformado falha fechado, sem selecionar outra mensagem |
| Média | Worker salvava dados integrais de execução em falhas, potencialmente incluindo conteúdo Gmail | Plano local desativa retenção integral de erros; ledger/fila conservam estados/códigos técnicos |

Não foi demonstrada perda definitiva ou vazamento em produção. Foram demonstrados
defeitos de seleção/recuperação e estados que não convergem pelo caminho anterior.
`rowNotExists` + insert do monitor não prova exclusão mútua no ledger; a fila SQLite
continua sendo a autoridade de deduplicação. Duplicatas do ledger são tratadas sem
duplicar avisos; esta entrega não apaga registros existentes.

## 2. Desenvolvimento e validação

- `scripts/gmail-recovery/*.cjs`: código dos nós corrigidos, sem credenciais.
- `scripts/gmail-recovery/build-plan.mjs`: gera plano local reprodutível; sem rede.
- `gmail-recovery/local-review-plan.json`: alterações para revisão, condicionadas
  às versões auditadas; **não é um workflow importável nem um publicador**.
- `server/tests/fixtures/gmail-recovery/published-sanitized.json`: grafos observados,
  sem credenciais, pin data ou conteúdo de mensagens.
- `server/tests/gmail-event-recovery.test.ts`: executa o código e o encadeamento com
  DataTable/Gmail/acionamentos sintéticos, HTTP HMAC em loopback e SQLite real.
- `shared/gmail-intake-queue.ts`: tipo de claim alinhado ao endpoint existente,
  incluindo `requestId` obrigatório. Nenhuma mudança de protocolo ou migração.

Ensaios: mais de 100 registros, lotes sucessivos, IDs excluídos/corte histórico,
ID inválido, duplicidade/concorrência, respostas perdidas de enqueue/claim/intake/ACK,
falha após ACK, indisponibilidade parcial, recibo divergente, backoff, bloqueio,
preservação de decisão negada e ausência de decisões humanas inventadas.
As configurações dos 13 nós alterados/adicionados passaram na validação de schema n8n.
Resultado local desta entrega: 14 testes novos aprovados; `npm run check` aprovado
(build, tipos, 974 testes de servidor, lint e 8 testes de custos/voz). Sem QA visual,
pois esta entrega não altera UI. A suíte mantém os testes existentes de persistência
da fila em arquivo, reinício e handles SQLite independentes.
O check conserva avisos de lint/bundle já existentes fora dos arquivos desta entrega.

Comandos (sem `.env`, sem credenciais externas):

```bash
node scripts/gmail-recovery/build-plan.mjs
node --test --test-isolation=none server/tests/gmail-event-recovery.test.ts
npm run check
```

Limites: o simulador não substitui o runtime n8n. Paginação nativa, item linking
do loop, comportamento de erro dos nós e agendamentos precisam ser confirmados
em cópia isolada antes de qualquer publicação autorizada. A leitura de todos os
metadados do ledger é uma escolha simples para o volume atual, não garantia de
escala ilimitada; o processamento fica limitado a 25 IDs por ciclo. A recuperação
permanece horária, portanto não promete retentativa imediata nem SLA de um minuto
em falhas. O timeout do workflow pode interromper um lote; os itens incompletos
permanecem recuperáveis. Estado `blocked` exige revisão, nunca reset automático.
Gmail indisponível antes do intake continua protegido por expiração de lease e
limite de cinco tentativas; não se habilitou reenvio externo ou recuperação ilimitada.

Aplicação futura: reconferir versões publicadas e schema do DataTable; testar o
plano em cópia isolada com serviços simulados; preservar credenciais/configurações
privadas existentes; aprovar mudança e publicar somente os dois workflows afetados.
Monitor, corte `2026-11-14T05:48:43.000Z` e três exclusões ficam preservados.
Reversão: restaurar versões preservadas dos dois workflows, sem apagar/recriar
ledger, fila ou decisões. Esta branch não altera nenhum ambiente instalado.

## 3. Contrato comum mínimo proposto

Manter os domínios abaixo separados. A tabela define o contrato lógico para a
primeira jornada; não cria um barramento genérico, novas tabelas ou executor.

| Domínio | Dados mínimos | Reuso e regra |
|---|---|---|
| Evento | versão, `source`, `sourceReference`, `eventKey`, horário da origem quando conhecido e horário observado | `EventInventory` e `UpdatePackageIngest`; convenção existente `gmail:<messageId>:v1`. Explicitar a conta de origem antes de suportar múltiplas caixas, sem mudar IDs históricos |
| Evidência | referência original, digest, anexos inventariados, cobertura/truncamento, origem de cada informação | `GmailTextEvidence`, `GmailAttachmentEvidence`, `EventPreparation` e attestation existentes. Informação do e-mail é evidência declarada, não fato confirmado no ERP |
| Contexto | ID real Coda, vínculo local explícito quando houver, entidades candidatas, momento da consulta, revisão ou digest dos campos observados, conflitos | Adaptadores/contextos existentes. Placa, nome e telefone apenas ajudam a buscar; múltiplos candidatos bloqueiam seleção automática |
| Proposta | ID, revisão, hash, fonte, contexto, ações com IDs estáveis, diferenças propostas e pendências | `UpdatePackage`, fragmentos identity/documents/commercial e `missingFields`. Mudança material invalida aprovação e exige nova revisão |
| Autorização | ator autenticado, data, decisão, `requestId`, revisão/hash e escopo | Aviso `authorized` libera análise daquele e-mail; aprovação do pacote libera somente o escopo exibido. Nenhuma decisão é produzida pelo classificador |
| Resultado | proposta/revisão e ação correspondente, estado por ação, tentativa/operação estável, recibo externo quando existir, código de erro e horário | Reutilizar estados/recibos existentes. Extensão futura por ação precisa distinguir preparado, confirmado, falha e resultado incerto; não declarar `executed` por timeout ou aprovação |

Ações de execução futura exigem tipos/parâmetros em allowlist; o tipo descritivo
`other` existente não concede execução arbitrária. O texto da proposta não é comando.

O contexto observado e o plano precisam ser persistidos/congelados para revisão,
não recalculados silenciosamente entre a leitura e o clique. Antes de eventual
execução externa, revalidar apenas as pré-condições relevantes no sistema responsável.
Texto de e-mail, anexos e saída de IA são entradas não confiáveis: não podem alterar
ferramentas, permissões, instruções de execução ou destinos de comunicação.

`prepareGmailPackageForReview` já exige evidência completa e attestation confiável;
a triagem comercial marca autorizações como pendentes de revisão. O MVP ainda
precisa implementar a interpretação/revisão contextual real. Não basta preencher
booleans de revisão ou contornar os guardas existentes para liberar uma proposta.

## 4. Primeiro MVP verificável: autorização recebida por e-mail

Objetivo: reduzir procura e redigitação para transformar um e-mail autorizado para
análise em um encaminhamento operacional revisável. Termina em proposta e decisão
humana persistidas; não inclui executor de escrita no ERP/Drive nesta primeira entrega.

1. Reusar aviso e decisão de triagem existentes. Antes da autorização, somente
   classificação mínima; depois dela, ler o conteúdo necessário e inventariar anexos.
2. Extrair com evidência: processo, veículo, parceiro, orçamento/versão, valores
   declarados, escopo, ressalvas e datas. Campos ausentes permanecem desconhecidos.
3. Consultar Coda por adaptador de leitura com escopo explícito. Apresentar registro
   encontrado e divergências; zero resultados ou múltiplos candidatos exigem escolha
   humana. Não criar Atendimento, Experiência ou agendamento por aproximação.
4. Preparar resumo, diferenças e próximos passos. Distinguir autorização de reparo,
   liberação de vistoria, retirada, peças e data agendada. IA propõe; backend valida.
5. Revisar em Atualizações, solicitar esclarecimento quando necessário e registrar
   aprovação/rejeição da versão exata. Entregar lista concreta de ações para execução
   humana no sistema competente, sem rotular ações apenas preparadas como executadas.

Critérios: cada conclusão remete à evidência; nenhum contexto ambíguo é aprovado
automaticamente; reentrega não duplica proposta/decisão; recusa impede análise posterior;
mudança de contexto/proposta exige nova revisão; falha de Coda preserva o caso pendente;
nenhuma escrita externa, envio ou alteração financeira ocorre durante testes.
Medir tempo até proposta revisável, correções exigidas pelo operador, acerto de
identificação, pendências e duplicidades. Comparar com casos de controle equivalentes;
não inventar meta de economia nem promover energia técnica a custo/margem real.

Excluídos: agendamento automático, compra de peças, cobranças/notas, alterações de
orçamento, envio Gmail/WhatsApp, push para novos perfis e ampliação para várias fontes.
O alerta inicial é a pendência na interface existente; notificações para coordenador
dependem de público/identidade e regras ainda não definidos no escopo de operador único.

Dependências: PR #149 tem conteúdo parcialmente incorporado e descrição defasada;
não fazer merge integral. PR #219 propõe autonomia comercial e V18; manter os limites
atuais de consulta Coda nesta entrega e reavaliar autoridade/vínculos antes da integração
do MVP, sem incorporar seus 79 arquivos ou assumir que foi aprovada/instalada.

## 5. Drive: incorporar identidade documental sem antecipar política

No primeiro MVP, apenas inventariar/referenciar anexos e propor classificação;
sem criar pastas, carregar arquivos, mover documentos ou alterar compartilhamento.
Uma referência documental deve conservar conta/origem, `messageId`, `attachmentId`,
nome/MIME/tamanho observados, digest quando calculado e eventual `driveFileId` existente.

Após homologação documental específica: usar identidade do anexo e recibo de upload
para reconhecer repetição; conferir conteúdo e contexto antes de reutilizar arquivo;
ligar vários registros ao mesmo original ou usar atalho aprovado, preservando permissões.
Hash isolado não autoriza deduplicação global entre casos, contas ou permissões distintas.
Uma falha após upload deve ser conciliada pelo recibo/ID, sem repetir upload cegamente.
Versão comercial é distinta de arquivo com mesmo nome. Não inferir revisão pelo nome.

A política de pasta de pré-atendimento/atalho na Experiência continua em homologação.
Não criar pastas vazias ou definir destinos por intuição. Os documentos 11–13 foram
localizados como minutas na auditoria anterior; registro vivo e texto aprovado 13 v1.0
não foram localizados. Não declarar essas versões vigentes. Permanece a proibição
expressa de IA enviar, responder, encaminhar ou agendar e-mails.

## 6. Autorizações e próximo gate

Autorizados nesta tarefa: leitura, branch, correções locais, testes sintéticos e PR
de desenvolvimento. Nenhuma mudança produtiva foi executada. Publicação de workflows,
deploy/flags, acesso contextual a dados reais, reprocessamento real e homologação com
mensagem nova dependem de autorização específica. Merge desta PR, sozinho, não aplica
o plano n8n; o gerador não está no startup ou no workflow de implantação.

Próximo gate técnico: validar os dois grafos corrigidos no runtime n8n isolado.
Depois, mediante autorização operacional, comprovar uma mensagem nova percorrendo
monitor → ledger → fila → aviso → ACK → conciliação. Só então implementar a jornada
assistida do MVP sobre os contratos aprovados, sem expandir antecipadamente a plataforma.
