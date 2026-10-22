# Inventário ERP FUNIX — investigação em leitura

Data: 21/10/2026. Nenhuma tabela, linha, fórmula, página, automação ou botão produtivo foi alterado ou executado.

Este inventário do Coda é complementado por `INTEGRACOES.md`: ali o conector n8n comprovou workflows ativos e histórico de execução. Isso não estabelece credenciais para o processo Node. Os arquivos intermediários mencionados abaixo ficam no diretório de trabalho e não integram o aplicativo ou o pacote de código.

## Escopo e evidência

Conector Superhuman Docs acessível em leitura. Documento principal `2zsjI-nqWr`, título **Funix**, 202 páginas, URL https://docs.superhuman.com/d/Funix_d2zsjI-nqWr. A direção/guia identificou este documento como principal. A busca também retornou cópia **Funix (10/10/26)** `CzfQZRqqmz`; os IDs do inventário pertencem exclusivamente ao documento principal.

Foram lidos metadados, schemas, fórmulas, configurações de views e vocabulários não pessoais. Foram projetadas três linhas de Atendimentos apenas com ID/status/vínculo e três de Experiências apenas com ID/vínculo. Não foram copiados nomes, telefones, placas, valores individuais ou registros completos de clientes.

**Níveis de comprovação:** schema e leituras comprovados; fórmulas existentes e ações codificadas observadas; execução de processos mutantes e disponibilidade de n8n/Evolution não comprovadas. Contagens mostram registros existentes, não uma auditoria histórica de sucesso.

Arquivos intermediários locais:
- `coda-schema.json`: 48 tabelas/views, colunas, fórmulas, IDs, contagens e filtros sem PII.
- `coda-safe-projections.json`: leitura mínima e agregados.
- `coda-processes.json`: dependências e ações codificadas; URLs/literais de ações externas omitidos.

## Modelo de dados observado

| Entidade | ID da tabela | Linhas | Papel observado |
| --- | --- | ---: | --- |
| db_Atendimentos | grid-eGvJhrlDTH | 936 | Funil/escopo comercial, status, canal, retomada, desconto e vínculos |
| db_Atendimentos_Diagnosticos | grid-voKGJyLSB- | 2107 | Dano/parte/peça, dimensão/intensidade, aprovação e valor comercial |
| db_Atendimentos_Servicos | grid-aHz1ZDVlfK | 6996 | Serviço/dimensão, regra e valor calculado, energia, rateio |
| db_Atendimentos_Itens | grid-N4cjfFoShQ | 499 | Peças/itens orçados |
| db_Experiencias | grid-oejkc9WuBX | 107 | Unidade operacional da jornada, cliente/veículo/pagador, datas, fases e situações |
| db_Orcamentos | grid-LgsVNgYj3J | 704 | Versões/snapshots de orçamentos, valores persistidos, status e autorização técnica |
| db_OSs | grid-Umj75GSlHH | 72 | OS derivada do orçamento, valores persistidos e situação |
| db_OSs_Diagnosticos | grid-uNWEddS1ev | 348 | Snapshot dos diagnósticos da OS |
| db_OSs_Servicos | grid-WAiIptU9et | 858 | Serviços da OS |
| db_OSs_Etapas | grid-khi866xSGv | 881 | Etapas/energia e vínculo com experiência |
| db_OSs_Itens | grid-RT6jXtpzaH | 51 | Itens da OS |
| db_Processos | grid-ddGJJK3zs5 | 480 | Fase por experiência, energia, ordem, datas |
| db_Veiculos | grid-pDT-_PlSIJ | 1407 | Cadastro veicular e campos calculados |
| db_Entidades | grid-l9d-WgpqtC | não obtida | Cliente/pagador/contraparte; schema completo falhou no conector |
| db_relacaoEntidadeVeiculo | grid-7xYNejL-Jc | 1309 | Vínculo temporal entidade↔veículo, tipo de relação e ativo calculado |
| db_Faturas | grid-s_7DnEu_DC | 38 | Fatura por experiência/pagador; cobranças derivadas |
| db_TitulosFinanceiros | grid-CbOIUtgqrc | 126 | Contas/recebíveis, vencimento, contraparte e liquidação |
| db_Transacoes | grid-Cc5y5rur-5 | 105 | Lançamentos e impactos caixa/resultado/liquidação/impostos |
| eng_Financeira | grid--O2UZEZMWS | 114 | Comando financeiro com regra, datas e status de execução |
| cnf_RegrasLancamentos | grid-dbQ6cdu-HI | 20 | Fatores de impacto e classificação |

Relacionamentos principais verificados:
- Atendimento possui escopo de diagnósticos, serviços e itens; orçamento aponta para Atendimento.
- Experiência possui Atendimento, cliente Entidade, Veículo e Pagador; lookup reverso em Atendimento calcula Experiências.
- Orçamento deriva Experiência por Atendimento; OS aponta para Orçamento.
- Processos e Etapas de OS se vinculam à Experiência.
- Experiência agrega OSs, orçamentos, faturas, títulos e transações.
- Título pode apontar para Fatura; transação aponta para Títulos e Experiência.
- Não transformar Cliente, Pagador e Veículo em campos textuais únicos: são relações distintas.

Cardinalidade comprovada por expressões somente leitura: 107 Atendimentos possuem Experiência, nenhum Atendimento possui mais de uma, nenhuma Experiência está sem Atendimento e nenhuma aponta para mais de um Atendimento. Isso descreve o snapshot, sem estabelecer restrição estrutural 1:1 futura. O lookup reverso deve ser tratado como coleção.

## Views e filtros reais

**Funil:** `table-cJ75t2m_-9` / `v-AO7dEEII9r`, nome **Viz. Atendimentos (PC)**, 370 linhas.
- Status contém Novo lead, Aguardando dados, Em negociação, Morno, Frio ou Orçamento rejeitados.
- Tipo de atendimento contém Lead ou vazio. Excluir esta segunda condição incluiria atendimentos de outros tipos, como emprego.
- Layout card, grupos por status, ordem `ux_OrdemContato` crescente.

**Produção/Acompanhamento:** `table-wqS5r8cTUX` / `v-ebOX0melJU`, nome **ViewExperiencia_Comercial**, 25 linhas.
- Fase comercial contém Agendado, Inspeção, Produção, Acabamento ou Finalizado.
- Agrupada por fase comercial; exclui Entregue pelo filtro observado.

**Histórico:** `table-3FgOyPVySM` / `v-ycKPvjMuPa`, nome **ViewExperiencia_ComercialFinalizadas**, 107 linhas.
- `sharedFilter: null`; nome “Finalizadas” não comprova filtro de finalização.
- A view base de db_Experiencias possui filtro **pessoal** de fase Finalizado. Não é regra compartilhada.
- Filtrar no aplicativo por flag_Saiu seria decisão nova, pendente de direção. Não alterar o Coda para resolver silenciosamente a divergência.

**Planejamento:** `table-cxMBA72bak` em página Planejamento, 88 linhas visíveis, sobre db_Processos de 480 linhas.

IDs `table-*` do conector representam containers de views. Não presumir equivalência com identificadores públicos da API REST oficial sem probe autenticado de leitura.

## Vocabulários verificados

Status comerciais, em ordem:
1. Novo lead (30min)
2. Aguardando dados (24h)
3. Em negociação (48h)
4. Morno (3 dias)
5. Frio (5 dias)
6. Orçamento rejeitados
7. Agendado
8. Entrou
9. Fim negativo
10. Fim positivo

Fases comerciais: ⚪ Agendado, 🔵 Inspeção, 🟡 Produção, 🟠 Acabamento, 🟢 Finalizado, ✅ Entregue.

Fases operacionais: Agendado, Inspeção entrada, Desmontagem, Funilaria, Preparação, Pintura, Serviços Tecnicos, Estética, Limpeza, Inspeção saída, Finalizado, Saiu.

As grafias são do ERP. Preservar IDs e separar texto de apresentação, sem renomear valores produtivos.

## Fórmulas e processos já codificados

**Precificação:** serviço resolve regra pela base de precificação, produto e dimensão com fallbacks. Distingue tabelado, calculado e percentual, considera fator de quantidade/escala e fatores de cor e risco quando aplicáveis, arredonda em incrementos de R$ 0,05. Atendimento agrega valores comerciais por diagnóstico, serviços aprovados, itens, descontos/desvios e energia/prazo. Não recalcular no frontend.

**Orçamento:** `gerarOrcamento_Completo` chama criação do orçamento, diagnósticos, serviços, etapas e itens. A criação persiste snapshot dos valores, prazo, fatores, parcelas e informações comerciais. Cada versão não deve ser tratada como mero espelho mutável do Atendimento.

**Agendamento:** `at_Agendar` procura Entidade por telefone E164 e Veículo por placa; cria linha intermediária em `ux_Agendamento` e abre painel. Existe tratamento de cliente/veículo ausente e Pagador distinto. Não equivale a escrever apenas status “Agendado”.

**OS:** `gerarOS_Orquestrador` executa criação da OS, diagnósticos, serviços, etapas, processos, itens e cálculo das datas. `ConcluirOS` modifica situação para Finalizada e grava data; `CancelarOS` modifica situação para Cancelada e grava data. Essas ações não foram disparadas.

**Planejamento:** processos agregam energia das etapas por experiência/fase e dividem pela capacidade diária para sugerir duração. Fase operacional deriva saída, finalização, entrada, presença de OS e processos com data de início <= Now(), ordenados por fase. Fase comercial vem do mapeamento da fase operacional. Logo arrastar um card para outra fase não deve escrever em coluna calculada.

**Financeiro:** engine exige regra e datas válidas para executar; ação cria transação confirmada com fatores e impactos, usuário e dados de origem, depois marca comando executado. Experiência calcula quitado a partir de transações Confirmada, remanescente por valor investimento das OSs, e situação por cancelamento/não faturável/liquidação/vencidos/parcial/faturamento. Não criar baixa financeira por alteração direta de status visual.

**Integração n8n codificada:** Pack ID 71828, nome **Funix - n8n**.
- `add_Followup`: `SolicitarEnvio` com E164 e Copy_1..3 selecionadas por status.
- `pdf_gerarOrcamento`: monta JSON e chama `PrepararPDF`, depois abre host `n8n-eez8.srv2060217.hstgr.cloud`.
- Código Make.com POST antigo está dentro de comentário e não conta como integração ativa.
- Nenhuma dessas ações ou URL de webhook foi executada; saúde, credenciais, retries, contratos e Evolution continuam por verificar.

## Divergências e riscos a revisar antes de escrita

1. **Histórico sem filtro compartilhado:** confirmar política do aplicativo; decisão não implica alteração do ERP.
2. **Fase operacional é calculada:** ação codificada `LiberarParaInsepcao` tenta ModifyRows nessa coluna. O schema marca `isWritable:false`. Precisa reproduzir/validar em cópia de homologação, não “corrigir” em produção durante investigação.
3. **Saída do veículo:** regra disableIf de `xp_DarSaidaNoVeiculo` usa filtro com Status != Executado **OR** Status != Cancelado e IsBlank(); texto `ux_InfosSobreSaida` usa **AND** e IsNotBlank(). Há divergência lógica aparente; não foi corrigida nem testada acionando botões.
4. **SLA:** coluna “Tempo em min” traz durations estruturadas em vários status, mas Morno devolve número 3. Não inferir que o número seja minutos; ler SLA calculado existente e revisar unidades antes de portar regras.
5. **Snapshots:** valores persistidos em Orçamento/OS e fórmulas vivas em Atendimento têm responsabilidades diferentes. Recalcular snapshots pode alterar valores históricos/financeiros.
6. **Conector ≠ credencial de aplicativo:** acesso MCP provado não estabelece token REST no BFF nem autenticação do usuário final.
7. **Dados pessoais e financeiro:** nenhuma resposta de API do app deve retornar schema bruto, ações, tokens, payloads completos ou logs com PII. Permissões ainda precisam implementação/validação.
8. **Paginação/consistência:** 936 Atendimentos e centenas de detalhes exigem paginação, cache e rastreio de atualização; nunca renderizar primeira página como total.
9. **Erro do conector:** leituras com formats/controls falharam em algumas entidades; chamadas slim e include views resolveram núcleo. Não interpretar erro de introspecção como indisponibilidade de todas as tabelas.

Recomendação para a primeira etapa: BFF somente GET com credencial de servidor, DTOs projetados por IDs, estado explícito de integração pendente quando sem credencial, interface V20 preservada e dados locais de demonstração claramente identificados. Priorizar leituras de Funil e Acompanhamento. Em seguida validar comandos completos em cópia de homologação antes de habilitar gravações, mensagens ou financeiro.

