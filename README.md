# FUNIX — MVP Comercial integrado / Issue #7

Aplicativo interno React/TypeScript/Vite + API Node 24 e SQLite próprio. A branch comercial preserva a M1.2 auditada e implementa a cadeia integrada: Atendimentos, composição mestre, cenários/matriz, configuração comercial, componentes com MR global por Atendimento, motor exato V0.9, negociação, N emissões imutáveis e PDF real.

Sem Coda, WhatsApp ou IA ativos; sem operação de agenda/OS/produção/financeiro. Não há preços fictícios ou clientes de demonstração carregados na aplicação. Dados e catálogos da direção são mantidos pelo operador; configurações ausentes ficam pendentes e bloqueiam emissão.

A Issue #7 autoriza desenvolvimento/commits/PRs, sem merge ou deploy. [Relatório e operação curta](docs/ISSUE_7_MVP_COMERCIAL.md), [API](docs/API.md), [evidências](docs/evidencias/issue7/COMANDOS.md). O proprietário homologa uma única experiência integrada ao final; esta entrega não afirma aprovação funcional ou prontidão produtiva.

A atualização atual está descrita em [Editor e painel financeiro aprovados](docs/EDITOR_FINANCEIRO_APROVADO.md): autosave, componentes dentro do diagnóstico, MR único e emissão direta com conferência. O menu superior de cenários dá acesso ao histórico/PDF do Atendimento. Catálogos e Precificação ficam na área global **Configurações** (`/configuracoes`), ao lado de Conversas e Funil. [Ajustes pós-auditoria](docs/PR17_AJUSTES_AUDITORIA.md) e [migração V7](docs/MIGRACAO_V7_MR.md).

## Executar localmente

Requisitos: Node 24 e npm 11, conforme `.nvmrc` e `package.json`.

```bash
npm ci
cp .env.example .env
```

No arquivo `.env`, configure `FUNIX_OPERATOR_PASSWORD` (12–256 caracteres). A senha é somente do backend; não a envie pelo chat ou Git. Configure os caminhos/origem se necessário:

```dotenv
FUNIX_APP_ORIGIN=http://127.0.0.1:5173
FUNIX_API_PORT=8787
FUNIX_API_HOST=127.0.0.1
FUNIX_DATABASE_PATH=.runtime/funix.sqlite
```

Em dois terminais:

```bash
npm run dev:api
```

```bash
npm run dev -- --port 5173 --strictPort
```

Abra http://127.0.0.1:5173, entre, use **Novo Atendimento**, informe telefone e confirme. Nome, veículo informado, marca, modelo, placa, motivo e observações são opcionais. Use **Editar Atendimento** para completar os dados e **Salvar alterações** para confirmar. Busca, Quadro/Lista, colapso e retorno contextual usam registros próprios.

A migração cria o banco na primeira execução e atualiza incrementalmente o M1.1 existente, sem recriar Atendimentos; não há clientes de demonstração ou fallback remoto. Atendimentos salvos permanecem após fechar/reabrir o navegador ou reiniciar a API. A sessão fica em memória: após reiniciar a API, é necessário entrar novamente. Campos ainda não confirmados no formulário não são banco persistido; a interface avisa sobre alterações não salvas.

## Limite funcional

- Conversas e Funil, com Configurações globais para administração; Veículos e Experiências foram retirados do produto ativo.
- Seis fases V1.0 persistidas, com mudanças manuais. Os prazos dos rótulos não movimentam contatos automaticamente.
- Rejeitados exige recusa explícita e motivo; silêncio do cliente não vira perda.
- Telefone repetido é permitido. O original é preservado; E.164 só é obtido quando há indicação internacional inequívoca, sem inventar DDI.
- Mapa selecionável V20 e árvore V2, catálogo único sem aprovação manual; a busca de peças inclui cadastros do operador. Peças sem código permanecem indisponíveis. A manutenção de catálogos fica em Configurações → Catálogos. Diagnósticos, serviços e dimensões começam vazios e precisam dos dados da direção para compor orçamentos completos; não há carga fictícia.
- Cabeçalho com edição compacta; cenários em miniabas numéricas, variação por cópia das inclusões e comparação. Letras são exclusivas das versões emitidas de orçamento. [Entrega de interface do PR #11](docs/PR11_INTERFACE.md).
- Cenários contêm somente máscaras por IDs; atributos mestre são globais. Serviços repetidos são linhas independentes. Emissão manual gera versões A…Z,AA… sem limite artificial, com snapshot e PDF congelados.
- Chat, IA global/contextual e envio ao ERP permanecem indisponíveis.
- Chave técnica UUID não depende de placa/telefone. Nome legível com prefixo de origem definitivo ainda depende da escolha da direção.
- Adaptador e testes Coda antigos estão isolados, sem uso no processo atual.

## Verificar

```bash
npm run check
python3 -m unittest discover -s deploy/tests -v
python3 tests/browser/pr17_auditoria_regressions.py
```

Os scripts históricos `m1_2_catalogos.py`, `pr11_interface.py`, `issue7_integrated.py` e `issue15_diagnosticos.py` ainda descrevem os formulários/rodapés substituídos e não são o roteiro de QA da UI atual. O runner acima cobre o editor/painel atual e as regressões de Atendimento, cenários e inclusão; as regras comerciais continuam cobertas pela suíte Node/SQLite.

O teste integrado histórico também requer `pdftotext` para validação independente do PDF, somente no ambiente de QA. A aplicação não depende desse comando. Os testes devem ser executados sequencialmente. O teste de navegador usa Playwright/Chromium, processos próprios em loopback e banco temporário com dados sintéticos; falha se as portas de teste já estiverem ocupadas. Não depende de credenciais de produção. Evidências M1.1 em `docs/M1_ATENDIMENTOS.md`; entrega M1.2, comandos e limitações em [docs/M1_2_CATALOGOS_DIAGNOSTICOS.md](docs/M1_2_CATALOGOS_DIAGNOSTICOS.md).

## Backup e restauração

```bash
npm run db:backup -- .runtime/backups/funix-revisao.sqlite
```

O comando lê a origem definida em `FUNIX_DATABASE_PATH`/`.env`, usa o backup consistente do SQLite e recusa destino existente. Arquivos reais e backups não entram no Git. Guarde cópia em local seguro além do disco de trabalho.

Para restaurar: parar a API; preservar uma cópia do arquivo atual; substituir o arquivo definido em `FUNIX_DATABASE_PATH` por um backup compatível; restringir acesso ao proprietário; reiniciar e conferir os registros. Nunca restaurar copiando sobre banco aberto. Não remover arquivos/journals enquanto houver processo usando o banco.

## Implantação futura

O Compose atual não contém volume de banco e não foi modificado nesta tarefa. **Não implantar esta versão com o Compose antigo sem autorizar e configurar armazenamento durável.** Em produção, a API exige `FUNIX_DATABASE_PATH` explícito apontando para armazenamento persistente; isso impede iniciar silenciosamente com banco em memória. A configuração de um caminho não comprova, por si só, que exista volume/backups.

A preparação anterior de Hostinger/GHCR permanece disponível como histórico técnico em `docs/IMPLANTACAO_HOSTINGER.md`; não constitui autorização para ativar esta versão. Secrets, VPS, DNS, Traefik e workflows produtivos ficaram inalterados.

## Fontes e continuidade

Importação pontual de cadastros comerciais Coda para V7: [procedimento, resultados e pendências da Issue #18](docs/ISSUE18_IMPORTACAO_CODA.md). Ferramenta offline com dry-run, sem token em produção, sem execução automática e sem alterar o motor. Esta documentação não autoriza carga produtiva.

- `AGENTS.md`: autorização e precedência atuais.
- `docs/especificacao-v1.0/FONTES.json`: SHA-256 dos originais V1.0, V0.9, V20, árvore V2 e referências institucionais.
- `docs/M1_ATENDIMENTOS.md`: entrega auditada M1.1.
- `docs/M1_2_CATALOGOS_DIAGNOSTICOS.md`: entrega atual e evidências M1.2.
- `docs/API.md`: API atual.
- `docs/historico/`: orientações anteriores preservadas; não prevalecem sobre V1.0.

Ordem oficial: **M1 Atendimento + orçamento → M2 Coda unidirecional → M3 WhatsApp real → M4 IA assistiva**. A entrega atual segue a Issue #7 até a homologação integrada; Coda, WhatsApp, IA e implantação permanecem sob autorizações separadas.
