# Núcleo de análise: portas e referências de contexto — incremento 1

**Estado:** desenvolvimento; não equivale a habilitação de um piloto ou homologação aprovada.

## Decisão de escopo
- Preservar o fluxo Gmail da PR #222, gate de autorização, vínculo persistente do piloto, snapshots, propostas reviewOnly, regras de identidade e comportamento padrão OFF.
- Separar os contratos de leitor de mensagem, interpretador e leitor de contexto. São portas TypeScript no monólito atual, não três serviços ou APIs novos.
- Referência opaca de candidato: manter o identificador legado Coda i-...; permitir novos identificadores ctx:<origem>:<chave> com máximo de 100 caracteres para caber nas opções de esclarecimento existentes. Namespace identifica origem do candidato, não é credencial nem autorização. Adaptadores resolvem seleção exata em seu próprio escopo. O adapter Coda continua aceitando e retornando exclusivamente IDs Coda.
- Não modificar o contrato persistido/publicado, formato da Experiência XP, código de erro legado, parser de Gmail, hash e forma de configuração real, ou schema SQLite. Nenhum novo modo real, roteador genérico, ingestão, webhook ou integração.
- O teste de substituição usa um leitor alternativo sintético, não o repositório real de Experiências do FunixApp. Identidade nativa de Experiência e revisões de orçamento precisam de um mapeamento verificado em etapa seguinte. Não inferir processo de associação a partir de ID de atendimento ou placa.
- A PR #225 continua em rascunho e não é pré-requisito.

## Aceite
1. Testes de regressão existentes para autorização negada, histórico, persistência, retry, conflitos e modo real restrito permanecem aprovados.
2. Testes novos: IDs opacos legados/nativos, rejeição de caminhos, duplicatas, comprimento e caracteres indevidos; leitor alternativo com ambiguidade e seleção humana exata, revisão e ausência de execução; isolamento do adapter Coda.
3. Executar npm run check e checks GitHub da revisão exata. Não declarar aprovação de testes não executados.
4. Homologação: candidato privado mediante workflow manual FUNIX - Homologacao (candidato), a partir da main e do SHA exato da PR revisada com CI aprovado, conforme docs/entregas/HML_OPERACAO_ATUALIZADOR.md. A instalação HML exige o procedimento separado de prepare/preflight e autorização de aplicação. Para simular análise use banco temporário isolado de desenvolvimento, fixtures sintéticas e sem rede real; não habilitar synthetic no contêiner configurado com NODE_ENV=production. Não conectar Gmail/Coda/OpenAI reais, importar dados, executar envio externo ou reaproveitar aviso histórico.
5. Próxima entrega: adapter de contexto nativo, usando contratos da Produção V1 (#267) e orçamentos, com identidade e versões verificáveis. Ausência de fonte/identidade deve permanecer explícita. Validar antes de propor mudança da configuração do piloto real.

Base incorporada: main f99f84a815e16af4b8c7270c63461eff173d9b38, sem alteração de infraestrutura ou módulos de negócio.
