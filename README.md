# FUNIX — MVP Comercial, V1.0 / M1.1

Primeiro subincremento M1: criar, salvar, pesquisar, abrir, editar e reabrir **Atendimentos no banco próprio**. React/TypeScript/Vite e API Node existentes foram reaproveitados, com a identidade V20. A origem dos dados agora é SQLite local; o MVP não consulta ou modifica Coda.

A direção autorizou apenas desenvolvimento local e testes. Não houve push, deploy ou alteração de infraestrutura nesta entrega. O M1 completo ainda inclui composição, catálogos, motor, versões e PDF, que não foram implementados neste subincremento.

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

A migração cria o banco na primeira execução; não há clientes de demonstração ou fallback remoto. Atendimentos salvos permanecem após fechar/reabrir o navegador ou reiniciar a API. A sessão fica em memória: após reiniciar a API, é necessário entrar novamente. Campos ainda não confirmados no formulário não são banco persistido; a interface avisa sobre alterações não salvas.

## Limite funcional

- Somente Conversas e Funil; Veículos e Experiências foram retirados do produto ativo.
- Seis fases V1.0 persistidas, com mudanças manuais. Os prazos dos rótulos não movimentam contatos automaticamente.
- Rejeitados exige recusa explícita e motivo; silêncio do cliente não vira perda.
- Telefone repetido é permitido. O original é preservado; E.164 só é obtido quando há indicação internacional inequívoca, sem inventar DDI.
- Chat, IA global/contextual, diagnóstico, mapa selecionável, motor de orçamento e envio ao ERP permanecem indisponíveis.
- Chave técnica UUID não depende de placa/telefone. Nome legível com prefixo de origem definitivo ainda depende da escolha da direção.
- Adaptador e testes Coda antigos estão isolados, sem uso no processo atual.

## Verificar

```bash
npm run check
python3 -m unittest discover -s deploy/tests -v
python tests/browser/m1_atendimentos.py
```

O teste de navegador usa Playwright/Chromium, processos próprios em loopback e banco temporário com dados sintéticos; falha se as portas de teste já estiverem ocupadas. Não depende de credenciais de produção. Evidências e resultados em `docs/M1_ATENDIMENTOS.md`.

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
- `docs/M1_ATENDIMENTOS.md`: contrato técnico, execução, testes e pendências deste subincremento.
- `docs/API.md`: API atual.
- `docs/historico/`: orientações anteriores preservadas; não prevalecem sobre V1.0.

Ordem oficial: **M1 Atendimento + orçamento → M2 Coda unidirecional → M3 WhatsApp real → M4 IA assistiva**. A entrega termina na revisão deste primeiro subincremento; não avançar automaticamente.
