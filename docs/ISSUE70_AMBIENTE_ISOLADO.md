# Preparar o executor isolado do piloto real — PR #72

Este guia não ativa cotação no app. A [autorização da direção](https://github.com/Funix-CentroReparacaoAutomotiva/funixapp/pull/72#issuecomment-6700492835) permite até dez reservas reais na mesma rodada, começando somente por P01. Não permite produção, merge/deploy, contratação, busca/cópia de segredos ou contorno de rede. Usar o commit revisado da PR, Node 24 e dados sintéticos.

## 1. Credencial e isolamento

O administrador autorizado deve disponibilizar uma credencial **já aprovada para este piloto**, pelo secret manager do executor, vinculada a `OPENAI_API_KEY` como variável protegida do processo. Não copiar de produção, colocar em `.env`, arquivo de script, argumentos de linha de comando, Git, chat, relatório ou logs. Não imprimir valor/headers, fazer dump do ambiente, usar `set -x` ou gravar sessão de terminal com entrada de segredo. A presença de uma variável não comprova que a credencial foi aprovada: verificar a origem/binding e seu estado pronto, sem revelar conteúdo. Não iniciar login nem criar outra chave para contornar ausência.

Usar um executor não-production, sem acesso a SQLite/áudio/Atendimentos de produção. O harness usa exclusivamente os casos públicos/sintéticos de `scripts/quote-pilot-cases.ts`; não ligar o servidor de aplicação nem modificar `server/index.ts` ou configuração produtiva. A cotação permanece desabilitada no startup normal e bloqueada em production.

## 2. Rede permitida

Pelo fluxo de configuração **aprovado** do ambiente, permitir como destino do piloto somente `api.openai.com` em HTTPS/443. Preservar proxy e CA herdados, verificação TLS e demais políticas existentes. A pesquisa dos sites é executada pela ferramenta hospedada: o executor não precisa de acesso direto às seis lojas, scraper ou proxy alternativo. Não editar `/etc/codex/network-policy.json`, remover proxy, usar `--insecure` ou solicitar rede irrestrita para vencer bloqueio.

Conferir estado atual do runtime: observações atuais, segredo pronto e política aplicada com o host permitido. Só depois verificar conectividade por mecanismo de diagnóstico/leitura autorizado, registrando no máximo status HTTP e resultado TLS, sem credencial ou corpo privado. Um host ausente na política já é impedimento; não enviar teste de conexão a destino explicitamente bloqueado. Não usar `/v1/responses` como simples teste de rede: ele é a tentativa P01 e pode cobrar.

## 3. Um único ledger persistente

O administrador deve definir **um caminho absoluto estável** em volume persistente para `FUNIX_QUOTE_LEDGER`, fora do Git e de áreas públicas. Registrar esse caminho no controle privado da rodada e reutilizá-lo entre processos, reinícios e tentativas. Não usar diretório temporário que desapareça ao recriar o executor. Recomenda-se diretório exclusivo do operador com modo `0700`, ledger `0600`, mesmo proprietário e `umask 077`. Não compartilhar com outra rodada ou processo de produção; evitar symlinks e escrita por outros usuários.

**Somente numa rodada inédita confirmada pelo responsável**, sem reservas anteriores, inicializar o arquivo de forma exclusiva com este conteúdo não secreto:

```json
{"reserved":0,"maxInitialSearches":10,"reservedUsd":0}
```

A criação deve falhar se o arquivo já existir (por exemplo, criação exclusiva `O_EXCL`), sem sobrescrevê-lo. Numa retomada, ler apenas o ledger não secreto original e conferir proprietário/permissões, JSON íntegro, inteiro `reserved` entre 0 e 10 e ausência de outro processo ativo. Nunca recriar com zero se ele sumiu, foi corrompido ou perdeu o volume: interromper e reconciliar reservas/faturamento. O provider reserva e faz fsync **antes** da chamada; erros e timeout não devolvem reserva. Lock existente causa falha fechada; não remover lock cegamente nem trocar caminho para continuar. Ledger e eventual cópia de recuperação pertencem ao mesmo histórico, não a orçamentos separados.

O teto é dez reservas, uma ferramenta por resposta, sem retry automático; o envelope documental de US$3,30 não é garantia de cobrança. Reconfirmar modelo/tarifas antes da execução, sem aumentar teto ou mudar modelo por conta própria.

## 4. Preflight sem revelar segredo

Após o secret binding, rede e ledger serem disponibilizados pelo administrador, verificar somente booleanos e o registro não secreto. Não consultar `.env` ou diretórios de produção. Esta verificação de presença, sozinha, não valida autorização ou conectividade:

```sh
node --input-type=module <<'NODE'
console.log({
  nonProduction: process.env.NODE_ENV !== 'production',
  keyPresent: Boolean(process.env.OPENAI_API_KEY),
  ledgerConfigured: Boolean(process.env.FUNIX_QUOTE_LEDGER),
  liveAuthorized: process.env.FUNIX_QUOTE_PILOT_LIVE === 'authorized'
});
NODE
```

`FUNIX_QUOTE_PILOT_LIVE=authorized` é uma flag local não secreta que o executor aprovado pode definir para o comando, depois dos gates. Ela não substitui credencial aprovada, política de rede ou ledger. Se qualquer pré-condição faltar, parar e registrar o impedimento; não preencher com mock nem pedir chave no chat.

## 5. Somente P01 e auditoria antes de continuar

Com todas as condições confirmadas e o ledger original configurado, executar **uma vez**:

```sh
mkdir -p work
FUNIX_QUOTE_PILOT_LIVE=authorized node --use-env-proxy scripts/quote-pilot.ts --live --case P01 --out work/p01-tentativa-01.json
```

O comando herda a credencial protegida e o caminho já configurado; não os copia ou imprime. `--use-env-proxy` preserva o transporte pelo proxy do executor em Node 24. Não reutilizar o comando como tentativa automática em loop nem sobrescrever evidência anterior. Uma invocação seleciona só um caso e reserva no máximo uma tentativa. P09, sem ano, e P10, sem lado, devem permanecer `needs_details`, sem chamada e sem reserva.

Conferir o arquivo saneado, o ledger e, quando disponível, a cobrança do fornecedor:

- Distinguir requisição/tentativa reservada, número efetivo de `web_search_call` e oferta aceita. Uma reserva sem usage pode ter cobrança desconhecida.
- Verificar resposta concluída e JSON válido; o parser só aceita uma busca concluída e URL simultaneamente em `action.sources` e `output_text.annotations`. Não tratar zero ofertas como prova de que não há peça no mercado.
- Conferir fonte direta HTTPS de cada preço, trecho que sustenta o valor total em BRL, unidade, peça/lado/ano/geração/condição e evidência de canal oficial para Original nova. Uma citação não garante estoque ou preço atual.
- Registrar latência ponta a ponta, `inputTokens`, `outputTokens`, `webSearchCalls`, custo estimado e contagem antes/depois do ledger. A fórmula/tarifas estão no relatório; confrontar usage com fatura quando disponível. Não transformar duração de mock em latência da OpenAI.
- Em erro, esquema/modelo incompatível, sources/citations ausentes ou oferta sem sustentação, **parar** e preparar diagnóstico/correção com metadados públicos mínimos. Não registrar resposta bruta, headers, segredo ou URL suspeita para “debugar”. Não repetir cegamente nem trocar modelo/ledger. Se forem necessários metadados adicionais para esclarecer rejeição, revisar a instrumentação antes de gastar outra tentativa.

Somente se P01 for tecnicamente válido, com oferta sustentada e custo esperado, decidir explicitamente pelo próximo caso (`--case P02`, um por invocação), mantendo o ledger. Esta entrega pede P01 primeiro; não inicia os demais. Não calcular confiabilidade estatística ou economia humana com dez exemplos. Publicar somente evidência saneada; conservar a PR em draft e produção inalterada.

## Estado desta sessão

O runtime consultado continua sem segredo OpenAI, host permitido e ledger configurado. P01 **não foi executado**. O estado atual e a validação da continuidade estão em `docs/evidencias/issue70/continuidade/validation.json`; o preflight anterior permanece histórico. Nenhuma preparação de segredo, mudança de rede ou criação/reset de ledger foi executada nesta sessão.
