# Vendas — Atendimento (layout aprovado)
- Quatro abas de primeiro nível: Dados, WhatsApp, Diagnóstico, Confirmação. Barra inferior escura, painel comercial compartilhado e copiloto acessível no registro. Emissão no diagnóstico; Confirmação reúne documentos emitidos e entrada/agendamento pelos fluxos já existentes.
- Identificador humano AT + sequência decimal de no mínimo seis dígitos. V32 adiciona tabela e trigger, preservando UUIDs e snapshots; registros antigos numerados por criação e ID.
- Pagante opcional, classificação por vínculo do Atendimento (JSON da referência); vínculos legados sem classificação preservados. Misto derivado pelos pagantes identificados; nenhuma alocação de orçamento a pagante.
- Mapa descontinuado na interface. A implementação permanece no código, mas não há aba nem gesto para ela; URL antiga é normalizada para Diagnóstico. Candidato à remoção completa em limpeza técnica futura, após validar dependências.
- Não alteradas fórmulas, contratos de aprovação, geração de PDF ou snapshots. Homologação somente; dados de teste sintéticos e sem integrações externas reais.
