# FUNIX ERP — Painel de Orquestração (primeiro incremento)

**Estado: MVP em desenvolvimento; não implantado, homologado ou aprovado para produção.** Protótipo funcional **somente de leitura** para acompanhar as seis iniciativas existentes no GitHub, sem oferecer chat, criação de tarefas, aprovação, envio, credenciais ou execução de agentes.

## Execução local

No diretório que contém `index.html`, `styles.css` e `app.mjs`:

```sh
python3 -m http.server 8080 --bind 127.0.0.1
```

Abrir `http://127.0.0.1:8080`. O navegador consulta uma busca pública da API GitHub (`search/issues`) por títulos de iniciativas e épicos, sem autenticação nem acesso a dados privados. Atualizações de registros não comprovam entrega. 

Testes de modelo: `node --test tests/painel.test.mjs` (10 casos). O CI do repositório também deve executá-los por `npm run test:painel`. Validação visual em 320, 390 e 1440 px continua pendente: a política do navegador automatizado na sessão bloqueia navegação inclusive para `localhost`.

## Dados e honestidade de estados

- Fonte: repositório público `Funix-CentroReparacaoAutomotiva/funixapp`, 22 issues de iniciativas/épicos #291–#313 (com IDs fixos e verificados; #308 não faz parte desse conjunto).
- Seis iniciativas e IDs de épicos são um mapa conhecido. O navegador lê estados e datas reais, sem escrever no GitHub.
- Não expõe total de PRs ao proprietário. Mostra apenas os registros de iniciativas/épicos, sinalizações explícitas de bloqueio e últimas edições no GitHub.
- **"Em acompanhamento" significa apenas issue aberta**, nunca "trabalho ativo". "Encerrada no GitHub" não equivale a integrada, homologada, publicada ou aceita. Última edição não é progresso.
- Não apresenta percentual concluído, custo, pontos, agentes individuais ou bloqueios inferidos.
- Sem dados ou com rate limit/falha da API, deixa claro que os estados não foram verificados; **não exibe valores sintéticos como reais**.
- A consulta direcionada evita perder as iniciativas conforme novas PRs/itens sejam criados. Se uma issue esperada faltar, a busca estiver incompleta, tiver paginação pendente ou falhar, o painel indica que os dados não foram verificados. A API pública possui limites de uso; futuramente uma fonte de síntese controlada poderá substituir esta dependência, se houver benefício demonstrado.

## Segurança e limitações

- **Não publicar dados confidenciais no repositório ou no painel.** Toda informação exibida vem de itens já públicos na origem. Para status internos ou dados privados, será necessário planejar autenticação/hosting apropriado.
- Sem token no browser, sem conexões à VPS, n8n, Evolution, Coda ou ERP operacional. Nenhum merge ou deploy deve ser feito automaticamente a partir deste protótipo.
- A interface não mostra agentes por identidade porque GitHub author/assignee não comprova qual IA executou uma tarefa.
- O próximo incremento só se justifica se houver um registro confiável, mantido pelo CTO, de **entrega, próximo passo, bloqueio, responsável e homologação por frente**. Esse registro pode alimentar o painel; não deve obrigar o proprietário a preencher campos manuais.

## Aceite do primeiro incremento

- Abre em desktop e celular e permite identificar as seis frentes rapidamente.
- Seleção de uma frente revela linhas de trabalho e estados rastreáveis com links. As atualizações recentes não são tratadas como entregas realizadas.
- O resumo deixa de enfatizar PRs e não informa falsamente que uma frente está ativa somente porque sua issue está aberta.
- API falha/rate limit: mensagem explícita, sem progresso fictício.
- Código estático e testes sem dependências pagas.
- Repositório público / página online exigem revisão de confidencialidade antes de publicação.