# FUNIX — Especificação Unificada do Aplicativo V1.0

**Status: CONSOLIDADA PARA CONFERÊNCIA DA DIREÇÃO E INÍCIO DE DESENVOLVIMENTO INCREMENTAL.** A aprovação das 38 respostas e das 144 avaliações da V0.9 é verificada nos artefatos fornecidos; **o presente documento de integração V1.0 é uma nova síntese e ainda não foi homologado como um todo**. Não representa código, integração ou ambiente de produção implementados.

**Data-base:** 24/10/2026. **Produto:** aplicativo Comercial FUNIX com atendimento, orçamento, comunicação WhatsApp e IA assistiva. **Operação alvo:** uso interno inicial pelo proprietário. **Repositório existente:** `Funix-CentroReparacaoAutomotiva/funixapp`.

## 1. Objetivo e limite do produto

A V20 determina a linguagem visual, navegação e experiência do operador; a V0.9 aprovada determina o motor comercial e a transferência ao ERP; as **38 respostas de 24/10/2026** decidem o escopo de Chat, IA, interface e a sequência de entrega. A **hierarquia de peças proposta V2** fornece uma estrutura navegável candidata, mas não é uma tabela validada de preços ou comprovação de aplicabilidade de peças por veículo.

**Ciclo:** mensagem/entrada → Atendimento persistente → triagem, mapa e diagnóstico → serviços e componentes → preços, energia e prazo → orçamento A/B/C emitido por comando → prévia/PDF/negociação/aceite comercial → envio técnico de versão selecionada ao Coda. Chat e Copiloto trabalham sobre o mesmo Atendimento. A origem pode ser também manual, sem Chat.

**Fronteira do Coda:** o App NÃO cadastra ou consulta as entidades formais de Cliente/Veículo/Pagador do Coda; NÃO agenda, cria OS, controla produção, histórico operacional, entrega ou financeiro; NÃO traz Atendimentos legados do Coda. Envia dados comerciais disponíveis + snapshot da versão emitida por via de mão única; retorno de confirmação técnica não constitui sincronização de dados operacionais. A equipe completa os cadastros e continua o serviço dentro do Coda.

**Fronteira do WhatsApp:** distinta do Coda. A troca de mensagens precisa ser bidirecional com o provedor; o Chat não pode ser apenas um espelho fictício. A conexão deverá preservar o uso atual do número principal e WhatsApp/WhatsApp Web em paralelo, **condicionado à viabilidade comprovada** pelo provedor e a teste sem interrupção.

## 2. Precedência e natureza das fontes

1. Lei, segurança, integridade técnica, privacidade, direitos do cliente e compromissos já autorizados.
2. **Decisões de produto mais recentes e explícitas** nas 38 respostas (incluídas literalmente no Apêndice A), para Chat, IA, navegação, implantação e pontos onde alteram uma UI antiga. Não converter um comentário em algoritmo implícito.
3. **V0.9 aprovada** (`FUNIX_mapa_mestre_V09_APROVADO.json`): regras de cálculo, processo comercial e envio ao ERP; os 144 itens avaliáveis foram aprovados. `reviews` históricos e notas anteriores não têm a mesma precedência da versão validada.
4. **V20 HTML:** contrato visual e de usabilidade, com adaptação pontual aos estados reais. Texto/números/mensagens do protótipo são demonstração, não registros nem motores financeiros.
5. **Hierarquia de peças V2:** PROPOSTA de organização, não catálogo de peças aprovado nem motor de precificação. Usar para prototipação funcional e testes, validar itens faltantes e versões antes de habilitar orçamentos definitivos.
6. Referências FUNIX 00–10 conforme `00_master_index.md`, consideradas com seu status real de aprovação e limites normativos.
7. Guias antigos, `AGENTS` e documentos do repositório: evidências históricas e estado técnico; instruções que exigem Produção/Experiências/Veículos no MVP ou leitura operacional contínua do Coda são superadas neste recorte. **Atualizar orientações locais no repositório, sem substituição silenciosa antes de verificar regras que permaneceram úteis.**

## 3. Produto e navegação final

- **Entrada:** apenas **Conversas** e **Funil**; **remover completamente a aba Veículos** da navegação do MVP. Não mostrar Acompanhamento e Histórico operacional disfarçados como funções comerciais.
- **Conversas:** inbox real com nome/telefone, prévia, horário, não lidas e estado de conexão. Ao abrir, entrar no Atendimento correto com Chat ativo; não existe Chat exposto ao operador sem Atendimento.
- **Funil:** Kanban horizontal/recolhível + Quadro/Lista, busca e retorno contextual V20. Colunas determinadas: **Novo lead; Aguardando dados; Em negociação (24h); Morno (3 dias); Frio (5 dias); Rejeitados**. Os prazos constam dos nomes, mas **não há definição aprovada de gatilho para contagem nem de transição automática**. Implementar primeiro como fases visíveis e movimentação controlada; decidir automação temporal por teste/critério posterior, sem inferir que a passagem acontece sozinha.
- **Após envio ao Coda:** Atendimento sai do Kanban ativo mas permanece pesquisável no histórico comercial local. Não interpretar Rejeitados como destino automático de falta de resposta; na V0.9, perda demanda recusa explícita.
- **Atendimento:** um registro único oferece Chat, Mapa e Diagnósticos, com contexto consistente entre cabeçalho, placa, telefone e proposta. Manter identificação e retorno visual V20, corrigindo as amostras que mostram um contato diferente do cartão aberto.
- **IA visual:** manter tanto Copiloto global quanto barra/atalhos IA contextual no Chat; estados reais, não saídas fingidas.

## 4. Atendimentos: criação, identidade e vínculo com Chat

- Um Atendimento é criado manualmente com **telefone obrigatório** e outros campos informativos opcionais em texto (nome, placa, modelo/marca, motivo, etc.). Não usar esses textos como relacionamento formal com Cliente ou Veículo do ERP.
- A **primeira mensagem recebida** pelo WhatsApp deve pertencer a um Atendimento: procurar Atendimento **em aberto** do contato; se nenhum existir, criar automaticamente. Pode existir Atendimento sem Chat, mas **nunca mostrar Chat sem Atendimento**.
- Novas mensagens do mesmo contato pertencem ao seu Atendimento em aberto, conforme decisão CH06. **Exceção ainda não definida:** quando houver **dois ou mais Atendimentos simultaneamente em aberto** para o mesmo contato, não selecionar silenciosamente o mais recente; apresentar situação resolúvel pelo operador (ou restringir a abertura concorrente após aprovação de regra). Assim preservamos o intento da decisão sem inventar vínculo.
- O contato telefônico é chave técnica **de busca de contexto**, não identidade civil única. Normalizar E.164 no backend quando possível; manter dado original e preservar vínculo de conversa/provedor. Retries da mesma mensagem não criam novos Atendimentos nem duplicam mensagens.
- Outras contas/canais não foram aprovados no escopo inicial. A integração ao número atual não autoriza desligar o WhatsApp existente.
- Identificadores internos do App são próprios, persistentes e independentes do número legível apresentado. A direção solicitou **marcador de origem no começo do ID do Atendimento**, mas não escolheu a string específica; exemplo meramente ilustrativo `APP-AT0001` requer aprovação posterior. Não reconstruir IDs a partir de placa, telefone ou sequência de linhas do Coda.

## 5. Chat de WhatsApp funcional — contrato mínimo

- **Entrada e saída:** texto, foto, áudio, vídeo e documento **desde a fase de Chat**. Exibir/anexar arquivo, carregar quando disponível, indicar falha de mídia sem perder conversa; dimensionar armazenamento, limites e custo conforme provedor testado. Não prometer reprodução de todo recurso do WhatsApp.
- **Histórico inicial:** armazenar e mostrar mensagens a partir da ativação; não importar o histórico anterior como requisito do MVP. O histórico anterior permanece acessível pelo canal antigo.
- **Envio:** mostrar estados `enviando` / `aceita pelo provedor` / `falhou`; `entregue`/`lida` apenas quando eventos reais chegarem. Não chamar `aceita pelo provedor` de lida. Permitir reenvio manual de falha evidente, sem reemitir silenciosamente.
- **Iniciar conversa:** permitir por telefone **somente se o canal e as regras aplicáveis permitirem**, com aviso de janela/restrições da plataforma. Não forjar sucesso de abertura.
- **Respostas rápidas:** textos editáveis que preenchem o campo; **nunca enviam automaticamente**.
- **Concorrência com WhatsApp externo:** verificar recepção e envio quando mensagens também são tratadas pelo celular/Web; distinguir mensagens originadas de fora do App se API fornecer eventos; não criar mensagens duplicadas nem exibir falsa exclusividade do canal.
- **Teste de ativação:** número principal em piloto controlado, mantendo a rotina antiga como contingência. A autorização de testes com o número principal **não libera mutações em produção sem confirmação pontual do operador**.

## 6. IA — primeiro pacote funcional, estritamente assistivo

- Funções iniciais: **resumir a conversa atual, sugerir uma resposta, propor preenchimento dos campos do Atendimento**. Contexto por padrão = Chat atual + Atendimento selecionado; Copiloto global só consulta outros registros quando operador pedir explicitamente.
- IA **não envia mensagens, não emite/edita valores aprovados nem grava dados sem confirmação humana**. Sugestões de resposta são editáveis; proposta de alteração é apresentada como diferenças antes da gravação.
- Sugestões são pedidas sob demanda; opcionalmente mostrar discreto indicador de proposta já preparada, sem automação de envio.
- **Transcrição automática de áudios recebidos**, com indicação de falha ou baixa confiança quando detectável; manter áudio original acessível. Isso é recurso IA **da etapa 4**, não condição para a primeira entrega de Chat se o sequenciamento não mudou.
- **Áudio do Copiloto:** ditado voz→texto; resposta textual. **Sem análise visual/diagnóstico por IA de fotos no MVP**.
- IA pode usar referências institucionais 00–10 como diretrizes conceituais, preservando a distinção entre política aprovada, hipótese e dados do caso; não atribuir à FUNIX capacidades não implantadas.
- A navegação/pesquisa pelo Copiloto deve usar dados reais do App. Toda ação modificadora depende de confirmação humana. Se a integração IA não estiver disponível, mostrar indisponibilidade em vez de respostas fictícias.

## 7. Mapa do veículo e hierarquia de peças

- Mapa V20 é **atalho para selecionar regiões/peças**; a lista de Diagnósticos é o local para editar e concluir os itens. Seleção pelo desenho e pela busca/lista deve levar ao mesmo código físico e ao mesmo item de diagnóstico, evitando duplicação por vista.
- Hierarquia fornecida na V2: regiões `frente`, `traseira`, `motorista`, `passageiro`, `teto`, mais **acesso geral** (Interior, Inferior, Genéricos), que NÃO é sexta vista. No máximo **oito filhos imediatos por grupo**; peças prioritárias diretamente no primeiro nível. A variante lateral aparece em um único grupo com **Motorista / Passageiro / Ambos**. `Ambos` adiciona as duas peças reais; não é terceira peça nem cobrança.
- O mesmo `codigo_peca` usado em vistas diferentes referencia a **mesma identidade de componente físico**. A região onde foi clicado não é uma identidade diferente.
- **Análise estrutural deste arquivo V2:** foram encontrados **322 nós `peca`, 164 códigos únicos não vazios**, 123 seleções `Ambos` e máximo oito filhos. **23 folhas de `acesso_geral` não trazem `codigo_peca`**; essas entradas não podem ser gravadas como peças distintas sem atribuir IDs e validar a semântica. A hierarquia também tem itens marcados `sugestao_nova` e variantes não universais por modelo. Não promover esses itens a catálogo homologado por suposição.
- Esta árvore organiza **identificação e navegação das peças**, mas não determina automaticamente disponibilidade por modelo, dimensão, preço de serviço, componente nem relação com etapas. Essas configurações pertencem aos **catálogos comerciais/técnicos próprios** a serem elaborados pela direção (OR06).

## 8. Diagnóstico e catálogos comerciais próprios

- Diretor/proprietário preparará **novas tabelas iniciais**, pois o Coda está em revisão e não é garantido que seus catálogos sejam apropriados. Não importar automaticamente o esquema/preços atuais do Coda como política. Permitir carga inicial controlada (JSON/CSV conforme contrato a definir) e **tela simples de manutenção no App** para operador, com data/versão de mudanças relevantes.
- Contratos de catálogo necessários ao motor: peça/código; Serviço comercial; dimensão; tabela de preço (`Padrão`, `Parceria`, `Nosso Time`, `Retrabalho`); preço base único por serviço; fatores FD/FV/FC/FR; preço especial por tabela+serviço+dimensão; componentes com FCT; serviço→etapas; energia base/dimensional de cada etapa; capacidade global diária. Exigir validação de relações e chaves antes de permitir emissão real.
- Mudanças do catálogo afetam **rascunhos recalculáveis**, não versões emitidas; versões preservam os números, fatores e etapas exatos usados à época.
- Um diagnóstico pode selecionar peça, dano/dimensão, um ou mais serviços e componentes; deve ser possível alterar/remover itens sem deixar cobrança órfã em rascunho.

## 9. Motor matemático de orçamento — incorporar V0.9 integralmente

Não reprogramar as regras a partir de valores fictícios da V20. V0.9 é a referência normativa funcional. Resumo operativo:

1. **Serviço normal:** unitário = `preço_base_não_dimensionado × FD_dimensão × FV_tabela × FC_cor × FR_risco`; aplicar teto no unitário ao próximo múltiplo de **R$0,05**; depois multiplicar pela quantidade. Sem escala por quantidade.
2. **Preço especial:** chave exata `(tabela_comercial, serviço, dimensão)` substitui integralmente o caminho base/fatores; unitário especial ainda recebe o mesmo teto de **R$0,05**, antes da quantidade. Evitar exceções duplicadas; regra de seguradora não passa automaticamente para `Padrão`.
3. **Componente:** preço manual presente, incluindo `R$0,00` explícito, vezes **FCT individual**, teto unitário R$0,05 e depois quantidade. Preço vazio não significa zero. Peças/componentes não participam de desconto/ajuste comercial de serviços.
4. **Negociação:** modos exclusivos nenhum/desconto em serviços/ajuste do subtotal de serviços. Se ajuste for menor que subtotal, expor desconto preservando preços originais; se maior, distribuir aumento proporcional aos serviços, **armazenando os unitários finais**. Tentar compensação no último serviço, mantendo quantidade e múltiplos de R$0,05. **Resíduo até R$0,50** entre alvo comercial e total efetivo pode ser aceito com ciência explícita; maior exige revisão manual sem perder rascunho. Total efetivamente emitido = soma exata das linhas, descontos aplicáveis e componentes; nunca esconder centavos nem alterar componentes para compensar.
5. **Energia:** `E_etapa = E_base_etapa + E_dimensão_etapa`; energia total considerando serviços/quantidades e etapas; dias técnicos = `ceil(E_total / capacidade_diária_global_positiva)`. Energia independe de fatores comerciais. Ausência de configuração essencial impede **emissão**, não edição de rascunho.
6. **Snapshot:** emissão manual gera versões A, B, C... **imutáveis**, com composição/etapas, dimensões, quantidades, fator aplicado, valores, energia, parâmetros e prazo congelados. Emitir B não altera A. Cliques repetidos não criam duas letras iguais.
7. **Prévia e PDF:** apresentar versão emitida na UI, permitir abrir/comparar/selecionar e gerar PDF comercial apresentável, que pode ser enviado pelo Chat real quando habilitado. Conteúdo final do documento deve ser validado (escopo, preço, condições, prazo/hipóteses e identificação), inclusive com obrigações legais pertinentes.
8. **Aceite comercial:** operador pode marcar versão `Aprovada` **sem anexo de evidência obrigatória**, conforme OR05. **Isso não é prova automática de aceite jurídico ou autorização para executar reparo**; o ERP continua responsável pelos controles de execução, e o App não deve declarar o cliente legalmente vinculado sem suporte.
9. **Nomenclatura:** separar chave técnica imutável do nome de apresentação. Padrão Coda observado `PLACA-OR<número><letra>` ou variantes sem placa, mas seu algoritmo exato não foi comprovado; a direção quer **marcador de origem apenas no identificador do Atendimento**. Não impor um prefixo específico antes da confirmação, nem simular a sequência do Coda.

Para testes de preço e snapshot, executar os exemplos específicos da V0.9 e conjuntos adicionais com quantidade grande, preços zero, exceção especial e diferença positiva de negociação superior ao limite. Empregar cálculo monetário exato (inteiro de centavos/Decimal) e critérios de teto reproduzíveis.

## 10. Envio unidirecional para Coda

- Botão **Enviar ao ERP** em versão **emitida selecionada**, com confirmação explícita do operador. Não chamar Agendar. Encaminhar os campos do Atendimento que existirem e **snapshot completo da versão selecionada**, incluindo preços e etapas, sem reconstruí-los por catálogo do Coda.
- Se houver envio anterior, mostrar histórico/aviso; permitir **outro envio manual de outra versão** com identificador de transferência próprio. Envio aceito/falhou/incerto; falhas recuperáveis manualmente e dados preservados. Não exigir cliente, veículo ou pagador formal.
- Sem importação de Atendimentos antigos do Coda. Sem consultas de volta para acompanhar agenda ou OS. A equipe corrige incoerências operacionais no ERP, conforme a filosofia proporcional do MVP.
- A estrutura técnica de recepção no Coda, incluindo tabelas/colunas, formato do payload, tratamento do snapshot e autorização do webhook, **não foi homologada por estes documentos**. Fazer teste primeiro em simulação/cópia segura; habilitar produção apenas com autorização expressa.

## 11. Sequência de entrega aprovada — quatro marcos dentro do mesmo MVP

A pergunta LAN01 determinou explicitamente a ordem. Não adiantar Chat ou IA só porque parecem atraentes ou porque a V20 já os ilustra.

| Marco | Trabalho | Critério mínimo de homologação | Fora do marco |
|---|---|---|---|
| **M1** | Criar/salvar/abrir/editar Atendimento; Funil e Diagnósticos; mapa e peças com fonte validada; motor de preço/energia/prazo; rascunho, versões e PDF de orçamento | Caso realista da FUNIX pode ser registrado, reaberto após reinício, precificado e emitir PDF coerente, sem escrever no Coda | Chat e IA reais, ERP produtivo |
| **M2** | Envio ao Coda, mapeamento técnico receptor e estado aceito/falhou/incerto | Uma versão congelada e seus dados são recebidos no ERP em ensaio controlado, depois em envio autorizado, sem criar agenda/OS no App | Migração Coda→App, sincronização operacional |
| **M3** | WhatsApp real bidirecional; anexo/mídias; conversas vinculadas a Atendimento automático; inbox e Kanban | Receber/enviar texto, foto, áudio, vídeo e documento, com estados visíveis, mantendo uso do número principal pelo processo anterior | IA autônoma ou texto de IA fingido |
| **M4** | IA assistiva: resumos, respostas sugeridas, preenchimento confirmado, transcrição automática e ditado; Copiloto contextual/global | Operador consegue usar todas as funções em Atendimentos reais; nada é enviado/gravado sem confirmação | Diagnóstico automático por foto, CRM completo, operação Coda no App |

**Sequenciamento dentro de M1:** começar em subincremento com Atendimento persistente, não exigir catálogo pronto como condição de escrever a fundação; seguir catálogo/esquema, diagnóstico, motor e emissão. M1 só é homologado após a cadeia completa estar operável. Cada subincremento é testado e revisado antes de avançar; nenhum marco libera produção automaticamente.

## 12. Matriz UI V20 → regras → backend/teste

| UI / ação | Comportamento V1.0 | Contrato/validação técnica |
|---|---|---|
| Entrada V20 três abas | Exibir somente **Conversas** e **Funil** | Remover a aba Veículos, rotas operacionais sem UI ativa |
| Funil Kanban | Seis etapas nomeadas em UX03; buscas/lista/retorno | Estados reais persistidos; prazos não automatizados sem contrato adicional |
| Abrir cartão | Cabecalho/Chat/Mapa/Diagnósticos de **um mesmo Atendimento** | Teste alternando dois contatos/placas sem vazamento de contexto |
| Nova conversa WhatsApp | Localizar Atendimento aberto, senão criar | Unicidade por evento do provedor; resolver duplicidade de abertos por operador |
| Chat V20 e compositor | Enviar/receber texto e 4 famílias de mídia | Somente eventos reais; sucesso somente confirmado pelo provedor |
| Favoritos / respostas prontas | Preencher compositor para revisão | Nunca autoenviar |
| Copiloto laranja | Contextual/global, sem escrita não confirmada | Respostas e sugestões reais; estado desabilitado fora de M4 |
| Mapa SVG / região | Navegar árvore V2 e selecionar peça física | `codigo_peca`, lado, deduplicação, busca geral, `Ambos` = duas peças |
| Diagnósticos | Criar/editar peças, serviços, dimensões, componentes | Catálogo próprio; rascunho recalculável, exclusão sem órfãos |
| Painel de tabelas/cor/risco | Entradas vinculadas ao motor V0.9 | Precificação normal/especial e FCT testados |
| Negociação | Alterar só subtotal de serviços | Valores unitários ajustados, resíduo visível, total fechado |
| Criar orçamento | Emitir versão após validações V0.9 | Falhas úteis; não perder rascunho; A/B/C imutáveis |
| 3 Propostas / painel versões | Abrir/comparar/selecionar A/B/C | Seleção explícita; PDF compatível com snapshot |
| Botão Enviar ao ERP | Transferir versão emitida + Atendimento | Aceito/falhou/incerto; não agenda; não consulta cadastros |

## 13. Condições objetivas para o Codex e para testes

**Obrigatório:** reutilizar o repositório React/TypeScript/Vite + backend Node existente quando apropriado; banco comercial próprio e migrações proporcionais; operador autenticado; segredos fora do navegador e do Git; logs mínimos de erro; nenhuma gravação no Coda sem autorização; testes com dados sintéticos/cópia segura. Não inventar requisitos SaaS, painéis operacionais completos, camadas de escalabilidade ou recuperação sofisticada; falhas visíveis e recuperáveis manualmente são aceitáveis.

**Checklist funcional de aceite:**

- [ ] Telefone basta para abertura manual; campos de cliente/veículo informativos e opcionais.
- [ ] Atendimento permanece editável/relocalizável depois de reiniciar API/navegador.
- [ ] Seleção de peça pelas cinco vistas ou busca mantém a mesma identidade física, inclusive ação `Ambos`.
- [ ] Catálogos configuráveis; preço especial exato não duplica multiplicadores; unitários sobem para R$0,05 antes de quantidade.
- [ ] Componentes não sofrem negociação; zero explícito aceito; sem dados de energia/capacidade, emissão bloqueada com aviso.
- [ ] Negociação positiva com resíduo de até R$0,50 mostra diferença real; totais emitidos conciliam exatamente.
- [ ] Versões A/B/C mantêm snapshot imutável e prévias/PDF coerentes; operador escolhe versão.
- [ ] Envio ao Coda apenas após autorização técnica e confirmação; falha/incerteza recuperáveis.
- [ ] Mensagem inbound cria ou encontra Atendimento aberto; nunca há Chat órfão; duas contas não são falsamente fundidas por nome.
- [ ] Texto/foto/áudio/vídeo/documento trafegam em testes reais controlados; uso do número antigo preservado.
- [ ] IA não envia nem grava sem confirmação; transcrição preserva áudio e sinaliza falhas; sem interpretação visual de avarias.
- [ ] Nenhuma seção Veículos/Experiência/OS/Produção/Financeiro fica ativa como obrigação do MVP.

## 14. Pontos que ainda precisam de validação, sem bloquear desenvolvimento do código inicial

Estes não são novos 38 itens para o proprietário revisar. São **dependências reais com fase apropriada**:

| Dependência | Quando torna-se bloqueadora | Tratamento proposto |
|---|---|---|
| **Regras temporais do Funil:** “24h/3 dias/5 dias” após qual evento? passagem automática ou manual? | Antes de automatizar mudança de estágio e lembretes | Fases manuais inicialmente; breve validação de gatilho antes da automação |
| **Atendimentos múltiplos abertos para mesmo telefone** | Antes de vincular mensagens reais do WhatsApp | Não escolher automaticamente o mais recente; pedir escolha/revisão se ocorrer |
| **Catálogos comerciais/técnicos próprios** e 23 códigos genéricos da árvore de peças | Antes da **primeira emissão real** / persistência dessas peças | Direção fornece tabelas; Codex valida chaves, migração e versão; árvore proposta exige saneamento |
| **Formato do ID com marcador de origem** e exceções de nome de orçamento | Antes de expor nomenclatura definitiva/documentos | Propor 2 opções simples, sem alterar IDs técnicos; homologar no contexto do M1 |
| **PDF comercial e condições/validades aplicáveis** | Antes de enviar documentos definitivos a clientes | Prévia, campos de escopo, valor, prazo e termos revisados; conformidade pertinente |
| **Contrato receptor Coda** | Antes de executar envio real do M2 | Descoberta leitura, simulação e teste isolado; direção autoriza escrita |
| **Compatibilidade do número principal WhatsApp e provedor** | Antes de ativar o M3 | Testes controlados; preservar celular/Web e canal antigo |
| **Serviço de IA, custo e privacidade** | Antes do M4 real | Escolher integração real, limites de contexto e tratamento de dados conforme necessidade |

**Conflito aceitação/execução:** OR05 permite marcar `Aprovada` sem documento anexo; isso é **status comercial inserido pelo operador**, não substitui documentação/autorização legal da execução no ERP. Diferenciar interfaces e textos exibidos.

**Conflito de UI legado:** a navegação V20 original e os guias antigos incluíam Veículos/Histórico/Experiências. **Remover Veículos do MVP**, conforme UX01. Preservar código reaproveitável isoladamente não significa manter rota visível.

## 15. Parecer de prontidão

**GO para iniciar desenvolvimento incremental M1** após o Codex revisar a base existente. **NO-GO** para entrega indistinta do V20 + V0.9 + guias antigos sem esta precedência, para orçamentos reais sem catálogos próprios validados, para escrita real no Coda sem receptor testado e autorização, ou para Chat/IA apenas simulados apresentados como funcionalidades.

A especificação V1.0 aqui entregue precisa da **conferência sintética da direção**, principalmente nos poucos trechos de interpretação acima. Uma vez confirmada, usar como contrato de produto do MVP. Não iniciar nova rodada grande de perguntas; resolver detalhes de interface e técnica durante entregas testáveis.

## Apêndice A — Rastreabilidade literal das 38 respostas (24/10/2026)

As respostas abaixo foram copiadas, sem reinterpretação, do JSON enviado. As seções 1–15 operacionalizam seus efeitos e identificam inferências pontuais.

### 01 · Escopo e navegação

**UX01 — Qual é o destino da aba Veículos na primeira versão?**  
Resposta: Outro caminho — descrever nas observações  
Observação do proprietário: Remover completamente a aba veículos  

**UX02 — O que ocorre ao abrir uma conversa sem Atendimento vinculado?**  
Resposta: Criar automaticamente Atendimento ao receber a primeira mensagem  
Observação do proprietário: É obrigatório existir um atendimento. Ele nasce desde a primeira interação com o cliente. Pode haver atendimento sem chat. Mas nunca chat sem atendimento.  

**UX03 — Quais colunas devem aparecer no Kanban comercial?**  
Resposta: Definirei minha sequência nas observações  
Observação do proprietário: Novo lead, aguardando dados, Em negociação (24h), Morno (3 dias), Frio (5 dias), Rejeitados   

**UX04 — Depois de transferido ao ERP, o Atendimento permanece no Funil?**  
Resposta: Fica pesquisável no histórico comercial local; sai do Kanban ativo  

**UX05 — Como conciliar o Copiloto global com a barra IA dentro do Chat?**  
Resposta: Manter ambos: botão global para consulta/navegação e barra interna para ações no Chat atual  

### 02 · Conversas e WhatsApp

**CH01 — Qual número/canal será conectado primeiro?**  
Resposta: Número atual de atendimento da FUNIX, após teste técnico seguro  

**CH02 — Você precisa continuar usando WhatsApp no celular/WhatsApp Web em paralelo?**  
Resposta: Sim, o aplicativo novo não pode interromper o WhatsApp atual  

**CH03 — Qual histórico de mensagens o Chat deve mostrar quando entrar em operação?**  
Resposta: Começar com mensagens recebidas a partir da ativação; histórico anterior fica no canal antigo  

**CH04 — Quais formatos RECEBIDOS devem ser utilizáveis na primeira fase do Chat?**  
Resposta: Texto, fotografias, áudios, vídeos e documentos já na primeira fase  

**CH05 — Quais formatos você quer ENVIAR pelo aplicativo no MVP?**  
Resposta: Texto, fotos, vídeos, áudios e documentos desde o início  

**CH06 — Como relacionar conversas a Atendimentos?**  
Resposta: Outra regra  
Observação do proprietário: Eu não entendi o que quis dizer com mais recente nesta msg: "Vincular automaticamente ao Atendimento mais recente e permitir corrigir". Mas o que deve acontecer é, recebeu um chat, pesquisa se a pessoa já tem um atendimento em aberto. Não tem? Cria um novo atendimento. Já tem? Ok, esta interação pertence a este atendimento em aberto.  

**CH07 — É importante iniciar uma nova conversa com alguém que ainda não escreveu?**  
Resposta: Sim, por telefone, quando o canal permitir; informar claramente qualquer restrição  

**CH08 — O que deve existir em mensagens rápidas/modelos prontos?**  
Resposta: Manter respostas prontas editáveis; tocar preenche a caixa e exige envio humano  

**CH09 — Que confirmação de mensagem é indispensável para considerar o Chat utilizável?**  
Resposta: Enviando, enviada/aceita pelo provedor, falhou; recebida/lida quando o provedor fornecer esses eventos  

### 03 · Copiloto e inteligência artificial

**IA01 — Quais são as três funções de IA mais importantes na primeira entrega assistiva?**  
Resposta: Resumir conversas, sugerir respostas e propor preenchimento do Atendimento  

**IA02 — A quais informações a IA terá acesso em cada interação?**  
Resposta: Por padrão, Chat atual + Atendimento selecionado; Copiloto global consulta outros registros somente quando solicitado  

**IA03 — A IA pode escrever diretamente nos campos do Atendimento?**  
Resposta: A IA propõe valores; o operador confirma antes de gravar  

**IA10 — A IA poderá enviar mensagens ao cliente sem aprovação humana?**  
Resposta: Não: a IA apenas escreve sugestões; o operador revisa e clica Enviar  

**IA04 — Quando a IA deve oferecer sugestões durante o Chat?**  
Resposta: Somente quando acionada; exibir pequeno indicador quando houver proposta preparada  

**IA05 — Você quer transcrição de áudios recebidos?**  
Resposta: Sim: transcrever automaticamente áudios recebidos  

**IA06 — A IA deve analisar fotos do veículo para auxiliar no diagnóstico?**  
Resposta: Não no MVP: usar IA apenas textual e áudio  

**IA07 — Até onde vai a atuação do Copiloto global?**  
Resposta: Pesquisar, resumir e navegar; pode sugerir alterações, mas executa só após confirmação  

**IA08 — O botão Áudio da IA representa qual experiência?**  
Resposta: Ditar instruções/perguntas para o Copiloto (voz → texto); resposta em texto  

**IA09 — A IA deve usar os documentos internos FUNIX como conhecimento para responder?**  
Resposta: Sim, como orientação conceitual, separando regras aprovadas de fatos de cada Atendimento  

### 04 · Diagnósticos, preços e propostas na V20

**OR01 — O Mapa do veículo deve funcionar como entrada para selecionar peças/diagnósticos?**  
Resposta: Sim; clicar no mapa facilita selecionar, e a lista de Diagnósticos permite editar tudo  

**OR02 — Como adicionar itens que não aparecem no desenho do carro?**  
Resposta: Outro caminho  
Observação do proprietário: Existiriam itens de sub-grupos. Aí ao clicar neles devem abrir os componentes daquele grupo.  
Seria fundamental eu criar um documento que apresenta toda esta hierarquia.   

**OR03 — Como o operador acessará e comparará versões emitidas do orçamento?**  
Resposta: Painel/lista de versões no Atendimento; abrir, comparar e escolher a versão para enviar  

**OR04 — Qual formato de orçamento o cliente precisa receber?**  
Resposta: PDF padrão, visualizável e enviável pelo Chat; manter prévia no aplicativo  

**OR05 — Como reconhecer e registrar que o cliente aprovou uma versão?**  
Resposta: Basta marcar Aprovado, sem evidência vinculada  

**OR06 — De onde virá o catálogo inicial (serviços, dimensões, fatores e etapas)?**  
Resposta: Outro caminho  
Observação do proprietário: Eu irei desenvolver as tabelas iniciais, uma vez que o sistema esta passando por melhorias, não sei se as tabelas do CODA serão adequadas.  

**OR07 — Como pretende atualizar tabelas de preços e catálogos após a implantação?**  
Resposta: Tela simples de manutenção no próprio App, restrita ao operador; registrar data/versão de alterações relevantes  

**OR08 — A nomenclatura comercial deve reproduzir exatamente o Coda antes do MVP?**  
Resposta: Outra regra  
Observação do proprietário: A nomenclatura deve ter apenas uma diferênça. O id do atendimento deve ter algum modificador no começo para deixar claro q ele foi gerado no app.  

### 05 · Integração e transição com ERP

**ERP01 — Em que momento o botão Enviar ao ERP deve ser usado?**  
Resposta: Disponível para a versão emitida selecionada, com confirmação explícita do operador  

**ERP02 — Se o pacote já foi enviado, como lidar com nova versão ou novo envio?**  
Resposta: Permitir envio manual de outra versão, com aviso de envio anterior e identificador próprio  

**ERP03 — Você precisa trazer Atendimentos antigos do Coda para o novo App?**  
Resposta: Outro recorte  
Observação do proprietário: Não precisa trazer nenhum Atendimento do Coda.   

### 06 · Fases e entrada em operação

**LAN01 — Qual é o primeiro resultado de negócio que você quer homologar?**  
Resposta: Outra prioridade  
Observação do proprietário: 1 - Criação de atendimento e motor de orçamento  
2 - Integração com o Coda  
3 - Receber/responder chat do whatsapp  
4 - Implementação de IA  

**LAN02 — Como prefere fazer o primeiro teste com mensagens reais?**  
Resposta: Primeiro no número principal, mantendo processo antigo como contingência  

**LAN03 — Qual fidelidade visual deve ser exigida no primeiro MVP?**  
Resposta: Manter estrutura, identidade e navegação V20; ajustar componentes pontualmente para comportamentos reais  


## Apêndice B — Integridade dos arquivos base

- Questionário: `38/38` respondidos; essenciais `28/28`.
- V0.9: itens avaliáveis derivados `144`; aprovações `144`; demais `0`. Os dados informativos de histórico têm outros IDs e não substituem essa apuração.
- Árvore V2: `322` nós de peças; `163` códigos físicos únicos não vazios; `23` peças sem código; `123` ações de seleção conjunta; máximo `8` filhos. Não demonstra validação técnica por modelo.

**Arquivos anexos essenciais no pacote:** JSON V0.9 aprovado, HTML V20, respostas V1.0, hierarquia V2 JSON+MD, e referências institucionais 00–10.
