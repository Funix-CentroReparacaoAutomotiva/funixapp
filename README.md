# FUNIX — MVP Comercial, V1.0 / M1.2

Primeiro subincremento M1: criar, salvar, pesquisar, abrir, editar e reabrir **Atendimentos no banco próprio**. React/TypeScript/Vite e API Node existentes foram reaproveitados, com a identidade V20. A origem dos dados agora é SQLite local; o MVP não consulta ou modifica Coda.

O M1.1 foi auditado e aprovado no commit `3bf660eb5eb0500957a3f99552708d091a73b98b`. O M1.2 acrescenta catálogos e estrutura de diagnósticos, preservando os Atendimentos. A direção autorizou desenvolvimento, testes e publicação do M1.2 exclusivamente na branch `codex/m1-2-catalogos-diagnosticos` para auditoria. Não há autorização de merge ou deploy. Motor de preços, versões e PDF permanecem para revisão e incrementos posteriores.

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

- Somente Conversas e Funil; Veículos e Experiências foram retirados do produto ativo.
- Seis fases V1.0 persistidas, com mudanças manuais. Os prazos dos rótulos não movimentam contatos automaticamente.
- Rejeitados exige recusa explícita e motivo; silêncio do cliente não vira perda.
- Telefone repetido é permitido. O original é preservado; E.164 só é obtido quando há indicação internacional inequívoca, sem inventar DDI.
- Mapa selecionável V20 e árvore V2, catálogo próprio e composição manual de diagnósticos/serviços/dimensões disponíveis. Abra um Atendimento → Diagnósticos ou Mapa → Catálogos para manter os dados. Valide a identificação das peças antes de selecioná-las.
- Chat, IA global/contextual, motor de orçamento e envio ao ERP permanecem indisponíveis.
- Chave técnica UUID não depende de placa/telefone. Nome legível com prefixo de origem definitivo ainda depende da escolha da direção.
- Adaptador e testes Coda antigos estão isolados, sem uso no processo atual.

## Verificar

```bash
npm run check
python3 -m unittest discover -s deploy/tests -v
python3 tests/browser/m1_atendimentos.py
python3 tests/browser/m1_2_catalogos.py
```

O teste de navegador usa Playwright/Chromium, processos próprios em loopback e banco temporário com dados sintéticos; falha se as portas de teste já estiverem ocupadas. Não depende de credenciais de produção. Evidências M1.1 em `docs/M1_ATENDIMENTOS.md`; entrega M1.2, comandos e limitações em [docs/M1_2_CATALOGOS_DIAGNOSTICOS.md](docs/M1_2_CATALOGOS_DIAGNOSTICOS.md).

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

- `AGENTS.md`: autorização e precedência atuais.
- `docs/especificacao-v1.0/FONTES.json`: SHA-256 dos originais V1.0, V0.9, V20, árvore V2 e referências institucionais.
- `docs/M1_ATENDIMENTOS.md`: entrega auditada M1.1.
- `docs/M1_2_CATALOGOS_DIAGNOSTICOS.md`: entrega atual e evidências M1.2.
- `docs/API.md`: API atual.
- `docs/historico/`: orientações anteriores preservadas; não prevalecem sobre V1.0.

Ordem oficial: **M1 Atendimento + orçamento → M2 Coda unidirecional → M3 WhatsApp real → M4 IA assistiva**. A entrega termina na revisão deste subincremento M1.2; não avançar automaticamente.
