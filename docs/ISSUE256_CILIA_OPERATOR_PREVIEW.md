# Issue #256 — Consulta nativa Cilia (primeira interface)

Flag FUNIX_CILIA_PREVIEW_ENABLED=false por padrão. Sessão de operador, Origin exata, POST JSON com base64 canônico dos bytes originais (máximo 512 KiB); GET autenticado informa disponibilidade. Nenhum token de integração, rede externa ou persistência. O Atendimento é obtido pelo servidor. A comparação de placa apenas indica coincidência, divergência ou pendência; não prova identidade/autorização.

Entrada na lista de orçamentos emitidos: Importar orçamento · Cilia. Consulta apresenta identidade de origem, totais, linhas, sugestões dimensionais, pendências e componentes de terceiros. Não seleciona dimensão ou agrupamento, não emite, não grava. Não é a interface de revisão financeira completa. Testes adicionados de limites, autenticação, flag e origem; execução a confirmar via CI. Próximos passos obrigatórios: editor de escopo, comparação autenticada, persistência e homologação. Sem deploy.
