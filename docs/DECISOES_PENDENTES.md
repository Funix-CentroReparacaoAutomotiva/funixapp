# Decisões e riscos — 21/10/2026

## Decisões concretas para a direção

1. **Histórico:** V20/guia especificam Experiências com saída; a view atual do ERP retorna todas as Experiências, sem sharedFilter. Recomenda-se consultar flag_Saiu=true somente no aplicativo, sem modificar a view. Consulta à direção aberta; não foi assumida aprovação. O endpoint permanece explícito sobre a pendência.
2. **Acesso contínuo:** provisionar credencial de leitura Coda no runtime e permitir seu destino pela configuração do ambiente. Não enviar tokens no chat nem colocar chave Vite. Alternativa: gateway de leitura autenticado reaproveitando infraestrutura existente; ainda não existe contrato verificado. A leitura desta sessão não autentica o aplicativo.
3. **Hospedagem e identidade:** validar destino de implantação, usuários e papéis antes de expor dados reais. A sessão local de operador único serve a desenvolvimento, sem representar decisão corporativa definitiva.
4. **Comandos:** reservar cópia/ambiente de teste para auditar agendamento, orçamento/PDF/OS, envio e falhas parciais. Essa autorização não foi inferida do acesso de leitura.

Não se pede nova aprovação de detalhes cosméticos, stack local ou refatorações reversíveis. Decisões relevantes não serão tomadas por existência de diretriz institucional genérica.

## Matriz curta de risco

| Risco observado | Impacto | Tratamento neste incremento | Antes de habilitar |
|---|---|---|---|
| fase_Operacional/situação financeira calculadas | Inconsistência operacional/financeira | Nenhum endpoint de escrita | Mapear eventos legítimos e permissões |
| Agendamento executa cadeia Coda | Duplicidade/estado parcial | Não reproduzir botão | Auditoria em cópia; 1:1, idempotência e recuperação |
| Draft n8n difere da versão publicada | Alteração involuntária de produção | Inventário pela versão publicada; zero publicações | Diff e teste da versão exata |
| Envio simples sem idempotência durável verificada | WhatsApp duplicado após timeout | Envio desabilitado | Chave de comando e estado incerto/reconciliação |
| PDF e entrada sem auth no nó webhook | Exposição/entrada indevida | Não chamar nem expor rotas | Auditar controles externos e autenticação |
| Histórico atual não filtra saída | Decisão sobre visualização | Pendência explícita | Aprovar regra do app ou manter view atual |
| Chat↔Atendimento N:N não comprovado | Mistura de mensagens/demandas | Conversas não é inventada a partir de leads | Modelo explícito e escopo por mensagem |
| Secrets/rede de runtime ausentes | App sem leitura contínua | 503 claro, sem mocks | Provisionar e provar integração real |
| Testes isolados versus produção | Falsa expectativa de prontidão | Evidências rotuladas | Teste ponta a ponta autorizado e homologação |

## Divergências registradas

- V20 usa etapas fictícias; o Funil real tem vocabulário próprio. Preservar o desenho e usar os estados reais é exigência do guia, sem transpor os rótulos do mock.
- Header do protótipo não muda ao abrir outro card; no app deve refletir a entidade selecionada.
- A view pessoal Finalizado da base de Experiências não constitui filtro compartilhado de acompanhamento.
- Imagine.io foi mencionado no guia, mas sua identidade/função não foi verificada. Não instalar nem contratar serviço por semelhança de nome.
