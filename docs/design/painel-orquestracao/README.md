# FUNIX ERP — Painel de Orquestração (primeiro incremento)

**Estado: MVP em desenvolvimento; não implantado, homologado ou aprovado para produção.** Protótipo funcional **somente de leitura** para acompanhar as seis iniciativas existentes no GitHub, sem oferecer chat, criação de tarefas, aprovação, envio, credenciais ou execução de agentes.

## Execução local

No diretório que contém `index.html`, `styles.css` e `app.mjs`:

```sh
python3 -m http.server 8080 --bind 127.0.0.1
```

Abrir `http://127.0.0.1:8080`. O navegador consulta dois endpoints públicos da API GitHub, sem autenticação e sem dados pessoais. 

Testes de modelo: `node --test tests/painel.test.mjs`. Validação visual recomendada em 320, 390 e 1440 px.

## Dados e honestidade de estados

- Fonte: repositório público `Funix-CentroReparacaoAutomotiva/funixapp`, issues #291–#313 e PRs abertas.
- Seis iniciativas e IDs de épicos são um mapa conhecido. O navegador lê estados e datas reais, sem escrever no GitHub.
- Mostra o total de PRs abertas **do repositório**, sem atribuí-las automaticamente a frentes ou agentes.
- **"Em acompanhamento" significa apenas issue aberta**, nunca "trabalho ativo". "Encerrada no GitHub" não equivale a integrada, homologada, publicada ou aceita. Última edição não é progresso.
- Não apresenta percentual concluído, custo, pontos, agentes individuais ou bloqueios inferidos.
- Sem dados ou com rate limit/falha da API, deixa claro que os estados não foram verificados; **não exibe valores sintéticos como reais**.
- A consulta de issues usa as 100 issues/PRs mais recentes por criação para evitar muitas requisições. Se as seis iniciativas deixarem de caber nessa página, o protótipo indica indisponibilidade, não inventa estado. Uma fonte de síntese autenticada e controlada poderá substituir essa dependência se necessária.

## Segurança e limitações

- **Não publicar dados confidenciais no repositório ou no painel.** Toda informação exibida vem de itens já públicos na origem. Para status internos ou dados privados, será necessário planejar autenticação/hosting apropriado.
- Sem token no browser, sem conexões à VPS, n8n, Evolution, Coda ou ERP operacional. Nenhum merge ou deploy deve ser feito automaticamente a partir deste protótipo.
- A interface não mostra agentes por identidade porque GitHub author/assignee não comprova qual IA executou uma tarefa.
- O próximo incremento só se justifica se houver um registro confiável, mantido pelo CTO, de **entrega, próximo passo, bloqueio, responsável e homologação por frente**. Esse registro pode alimentar o painel; não deve obrigar o proprietário a preencher campos manuais.

## Aceite do primeiro incremento

- Abre em desktop e celular e permite identificar as seis frentes rapidamente.
- Seleção de uma frente revela linhas de trabalho e estados rastreáveis com links.
- API falha/rate limit: mensagem explícita, sem progresso fictício.
- Código estático e testes sem dependências pagas.
- Repositório público / página online exigem revisão de confidencialidade antes de publicação.