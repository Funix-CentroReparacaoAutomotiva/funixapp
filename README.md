# FUNIX — aplicativo operacional

Primeiro incremento em desenvolvimento: interface fiel à V20 e backend Node somente leitura. React + TypeScript + Vite existentes foram preservados. O Coda continua sendo a fonte de verdade; nenhum sistema produtivo foi alterado.

A direção confirmou a evolução para um ERP próprio em três blocos: **Comercial → Produção → Financeiro**. A etapa atual é revisar os fluxos comerciais e redesenhar os processos antes de fechar o banco e implementar a persistência própria. O mapa inicial fica em `docs/analise-funcional-comercial/MAPA_GERAL_COMERCIAL.md`. O aplicativo ainda é somente leitura; escopo, decisões e critérios estão em `docs/DECISAO_COMERCIAL_PRIMEIRO.md`.

**Estado real:** base executável de desenvolvimento; consultas da investigação confirmadas via Superhuman Docs; conexão REST contínua do aplicativo ainda não provisionada neste ambiente. Sem credencial, o app informa indisponibilidade e não exibe clientes fictícios. Versionar no GitHub não publica o aplicativo para acesso pelo navegador. Não é uma versão homologada ou liberada para operação.

## Executar

Requisitos: Node **24.19.x**, npm **11.9.x**.

```bash
npm ci
cp .env.example .env
```

Edite `.env` localmente: configure `FUNIX_OPERATOR_PASSWORD` com pelo menos 12 caracteres. Os campos de credencial devem ser preenchidos por meio seguro, fora do chat e do controle de versão. Sem senha configurada, o acesso fica fechado. O frontend não usa variáveis `VITE_` para secrets.

Em dois terminais, dentro da pasta do projeto:

```bash
npm run dev:api
```

```bash
npm run dev -- --port 5173 --strictPort
```

Abra `http://127.0.0.1:5173`. O Vite encaminha `/api` para `127.0.0.1:8787`. A origem deve ser idêntica a `FUNIX_APP_ORIGIN`; mudar host/porta exige ajustar essa configuração. O backend usa loopback e respeita o proxy do ambiente com `--use-env-proxy`. Esse setup é local, sem publicação externa.

## Conectar leitura real

1. Provisionar `CODA_API_TOKEN` no cofre/ambiente do backend com o menor privilégio disponível e acesso ao documento `2zsjI-nqWr`.
2. Autorizar o destino oficial `https://coda.io` pela configuração de rede do ambiente; preservar proxy e TLS. A rede atual não estabelece acesso a esse destino.
3. Confirmar por leitura os IDs REST das views. O conector observou Funil `table-cJ75t2m_-9` e Acompanhamento `table-wqS5r8cTUX`, mas a equivalência REST precisa de prova. Preencher `FUNIX_CODA_FUNIL_VIEW_ID` e `FUNIX_CODA_ACOMPANHAMENTO_VIEW_ID`. O adaptador valida os metadados antes de usar a consulta.
4. Entrar e verificar registros reais, buscas, paginação e correspondência de IDs com o ERP. Essa validação ponta a ponta ainda não ocorreu no processo Node.

Não colocar o token no navegador, não copiar chaves do n8n nem executar webhooks produtivos como teste. O conector disponível ao agente não transfere suas credenciais ao código.

## Comportamento deste incremento

- Entrada Conversas / Funil / Veículos; moldura e identidade V20; Quadro/Lista; Kanban horizontal e recolhível.
- Atendimento e Experiência têm rotas e contexto próprios. O cabeçalho usa o registro aberto. Retorno preserva o estado da área de origem.
- Listagens consomem DTOs reais da API e carregam páginas. A busca atual é progressiva sobre as páginas consultadas; usar “Carregar mais” quando houver continuação. Contagens não representam total do ERP.
- Conversas e Chat não usam a lista de leads como se fossem mensagens. Estão indisponíveis até auditar vínculos e a integração de comunicação.
- Histórico depende da decisão sobre a divergência documentada em `docs/DECISOES_PENDENTES.md`; a API devolve `409 HISTORY_POLICY_PENDING`.
- Copiloto começa por consulta e navegação explícitas. Não há IA, voz ou execução comercial simuladas.
- Diagnósticos, envio, agendamento, emissão de PDF/OS, entrada/saída e alterações de fase não estão habilitados. As fórmulas operacionais não recebem gravação.

## Verificar

```bash
npm run check
```

O comando executa build e tipagem frontend, tipagem backend, testes Node isolados e lint. Os testes usam dados sintéticos e transporte controlado, sem chamar produção. Validam sessão, origem, métodos de escrita recusados, erros de configuração, mapeamento e paginação. Não comprovam autenticação remota, entrega WhatsApp, geração PDF ou homologação operacional.

A revisão de navegador usou Chromium em desktop 1440×960 e celular 390×844; a evidência e suas limitações ficam em `docs/VALIDACAO.md`. Mocks de QA não estão presentes na execução normal.

## Documentos

- `docs/ARQUITETURA_ATUAL.md`: arquitetura, ambiente, escopo e marcos verificáveis.
- `docs/MAPA_DADOS_CODA.md`: tabelas, relações, fórmulas, views e riscos auditados.
- `docs/INTEGRACOES.md`: workflows publicados, contratos e histórico observado.
- `docs/DECISOES_PENDENTES.md`: conflitos e decisões materiais.
- `docs/API.md`: contrato do backend e erros.
- `docs/design/`: referência V20 e inspeção; protótipo não é aplicação integrada.
- `docs/referencias/`: contexto institucional original, sem promoção automática a políticas vigentes.

## Próximo incremento e implantação

Revisar com a direção o mapa comercial e os subprocessos, começando pelo diagnóstico; derivar os contratos e o banco dos comportamentos suficientemente compreendidos. A implementação seguirá esses fluxos, preservando a V20. Provisionar leitura contínua, resolver Histórico e auditar comandos em ambiente seguro continuam sendo dependências para ampliar a integração; alterações de integrações produtivas não fazem parte da publicação inicial do código.

A sessão atual é de desenvolvimento para um operador e fica em memória: reiniciar o backend encerra acessos. Antes de hospedagem externa, aprovar identidade/papéis e HTTPS, persistência/topologia de sessão, monitoramento, retenção de dados, teste seguro de integração e rollback. Não há comando de publicação produtiva neste pacote.
