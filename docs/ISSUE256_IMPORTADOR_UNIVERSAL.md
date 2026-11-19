# Issue #256 — importador universal: mudança de direção (17/11/2026)

Decisão da direção: o destino primário é uma composição nativa, editável, com valores comerciais conciliados; Coda é temporário, Cilia é recorrente. Não criar telas antes de validar o canal ChatGPT/n8n e o fluxo nativo. Preservar rastreabilidade da origem, sem nova emissão ou OS automática. Esta fase reutiliza PR #257, ainda draft; código de histórico separado existente permanece provisório/desligado e não deve ser habilitado como resultado final.

O [contrato da API nativa e os artefatos ChatGPT/n8n](ISSUE256_API_NATIVA.md) descrevem a etapa mais recente. A aplicação transacional e a API de máquina para Coda já estão implementadas. A homologação com ERP real e a validação de formato do Cilia seguem pendentes.

## Implementação desta revisão
- `server/external-budget.ts`: contrato neutro V1, validação estrita e aritmética exata, identidades por origem/documento/revisão, digest canônico e adaptador Coda a partir do pacote já validado. Campos do Cilia são **contrato proposto**, não formato de exportação verificado. SHA-256 de evidência não autentica documento. Preservar documento original no futuro fluxo autorizado.
- Valores de serviço bruto/desconto/peças/total obrigatórios e conciliados; quantidade de origem e unidade (operação/hora/etc.) independentes da quantidade nativa. Distinguir faturamento e fornecimento; itens faturados por terceiros, origem incerta e franquias/impostos/complementos ficam bloqueados até definir representação correta. Não inferir receita, pagamento, autorização ou custo.
- `server/external-budget-plan.ts`: planejador puro; mapeamento explícito de cada linha para IDs ativos e alternativas técnicas (quantidade nativa explícita). Avalia preços com o próprio motor, seleciona combinação suficiente de menor bruto entre opções fornecidas e elegíveis e recalcula integralmente com desconto. Deriva preço manual para reproduzir venda por item e sinaliza que não é custo comprovado. Sem alternativas automáticas por nome, sem modificar fatores globais ou inserir linhas artificiais. Pendências, duplicação de peça/serviço, limite de busca e divergência exata bloqueiam. Fornecimento desconhecido/por parceiro fica destacado em avisos para revisão, não é autorização de compra. Apenas prévia, não gravação.
- Dois testes sintéticos de adaptação e planejamento; Cilia simulado, sem dados reais, não prova compatibilidade de arquivos reais.

## Pendências antes de homologação
1. Amostra real autorizada de Cilia (preferir XML/estrutura disponível, PDF se necessário). Verificar como separar taxas, franquias, complementos, peças fornecidas, modalidade de autorização; ajustar contrato com evidência, não inventar parser.
2. Serviço de aplicação nativa transacional/idempotente com proteção da composição mestre compartilhada, escopo e revisão atuais; mapear origem à identidade estável do Atendimento, bloquear conflito, manter histórico/PDF existentes. Validar novamente o motor na confirmação. Capturar original/hash, revisão e recibo ligado ao cenário. Preservar números e datas, não emitir automaticamente.
3. API de máquina autenticada independente, mínimo escopo, prévia sem efeitos, confirmação explícita e revisão do canal n8n; sem senha de operador em workflow, ambiente real ou bypass de autenticação. A aplicação não pode inserir diretamente no SQLite por fora de seus repositórios.
4. Testes integrados de rollback, concorrência, replay, catálogo/preço revisto, compartilhamento das máscaras, casos reais em homologação autorizada, sem merge/deploy.

CI da revisão fee43049: 10/10 workflows sucesso; nova revisão depende do CI. main avançou em 1 commit de OS, sem arquivos em conflito nesta etapa.
