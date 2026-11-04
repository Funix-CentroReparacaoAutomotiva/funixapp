# PR39 — homologação direta do backend com jsreport

**Estado: preparação concluída; teste real bloqueado por acesso/configuração.** Base funcional conferida: `85d8659e0b6bcadb2a18c220e374c63a431334d7`, branch `feat/orcamento-identificacao-pdf-download`.

Não houve chamada ao jsreport instalado, SSH/VPS, importação, alteração de workflows, merge ou deploy. Nenhum PDF local/mock é apresentado como PDF real desta homologação.

## Contexto informado pela direção

Os testes sintéticos anteriores via workflows n8n retornaram PDFs válidos: execução **28597** (duas categorias), **28602** (serviços/componentes/desconto) e **28603** (21 peças). São evidências informadas pela direção, não reexecutadas nem novamente inspecionadas nesta tarefa. Elas não foram usadas como substitutas da chamada direta do backend.

## O que foi executado

1. Confirmado no GitHub que o HEAD do PR39 permanecia exatamente em `85d8659e0b6bcadb2a18c220e374c63a431334d7`.
2. Sincronizado o checkout local com esse commit, incluindo o adendo final do importador; o índice restante da sessão anterior foi conferido pela árvore Git, sem reset ou descarte de alterações.
3. Gerados três corpos JSON completos `{template:{name:'FUNIX - Orcamento'},data:...}` pelo **adaptador do próprio commit**, utilizando as fixtures sintéticas existentes.
4. Conferidos `canEmit=true`, as duas categorias, a igualdade entre o JSON do adaptador e o JSON congelado e a quantidade de 21 peças no caso longo. O caso de desconto preserva o valor oficial, componentes e uma única dedução.
5. Executado `npm run check:server`, aprovado. Não foram repetidos testes de conectividade n8n ou testes reais do renderer.

Arquivos: [evidencias/pr39-homologacao-direta/](evidencias/pr39-homologacao-direta/). O `manifest.json` contém revisão, SHA-256, tamanho, quantidade de diagnósticos e estado **prepared-not-sent** de cada arquivo. Não contém autenticação. Os nomes/contatos são sintéticos ou vazios; os valores são de QA, não preços recuperados do Coda.

| Arquivo | Caso | Diagnósticos/peças |
| --- | --- | --- |
| `01-duas-categorias.json` | Etapas de preparação/pintura, duas categorias; campos opcionais vazios | 1 |
| `02-servicos-componentes-desconto.json` | Serviços brutos, componentes com MR, desconto destacado e Serviços líquido no resumo | 1 |
| `03-extenso-21-pecas.json` | Categorias e etapas em orçamento extenso | 21 |

A preparação usa fixtures com SQLite **em memória** e renderer mock exclusivamente para reservar/congelar os dados do adaptador. Nenhum BLOB/PDF mock foi exportado como documento de homologação. Essa preparação não comprova os itens de armazenamento/download com um PDF real.

### Reprodução da preparação

```bash
node scripts/prepare-jsreport-homologation.ts .runtime/pr39-direto-nova-execucao
```

A pasta deve ser nova. O script verifica que `server/` e `shared/` continuam equivalentes à base aprovada, não lê credenciais, não faz rede e não abre o SQLite instalado. Cada execução produz seu próprio manifesto; datas/ordem de dados sintéticos podem mudar os hashes, sem alterar o contrato. Os hashes do manifesto entregue referem-se aos arquivos entregues.

## Bloqueios encontrados — sem tentativa de contorno

A consulta de readiness do ambiente retornou observações atuais e política de rede aplicada. Foram verificados somente nomes/presença das configurações, sem abrir arquivos de segredos.

| Dependência | Situação observada | Efeito |
| --- | --- | --- |
| `FUNIX_JSREPORT_ENDPOINT` | Não configurada no processo; endpoint direto não fornecido por configuração protegida | Não há destino configurado para o cliente do backend |
| `FUNIX_JSREPORT_USERNAME` | Não configurada; nenhum secret binding disponível no ambiente | Sem identidade de autenticação Basic para o cliente |
| `FUNIX_JSREPORT_PASSWORD` | Não configurada; nenhum secret binding disponível no ambiente | Sem autenticação protegida para chamada real |
| Acesso de rede ao destino | Política HTTP restrita sem domínio FUNIX liberado; sem regra TCP/VPN para a VPS | Conectores existentes não equivalem à autorização de rede do processo Node |
| Canal administrativo direto | Nenhum acesso administrativo configurado/disponível foi identificado neste ambiente | Não foi presumido SSH nem utilizado acesso indireto pelo n8n |

Não foi feita chamada sem autenticação, extração de credencial do n8n, uso do n8n como proxy, alteração da política de rede ou desativação de TLS. Não se afirma ter recebido erro HTTP do jsreport: a chamada real **não foi tentada** porque os pré-requisitos faltam.

## Matriz desta homologação

| Verificação solicitada | Resultado nesta tarefa |
| --- | --- |
| JSONs sintéticos gerados pelo adaptador | **Concluída**; três arquivos com manifesto e hashes |
| Backend → jsreport autenticado, sem n8n | **Bloqueada por configuração/acesso** |
| PDFs reais e inspeção visual de categorias/etapas/rateios/desconto/componentes/prazo/parcelamento/logo/páginas | **Não executada**; nenhum PDF real obtido |
| Snapshot + PDF real imutáveis no SQLite isolado | **Não executada nesta homologação real** |
| Download posterior do PDF real, com os mesmos bytes e sem nova renderização | **Não executada nesta homologação real** |
| Publicação dos PDFs reais para revisão visual | **Bloqueada**; não se substitui por PDFs locais/mock |

Os testes com mocks e renderização local das entregas anteriores continuam válidos para seus respectivos escopos; não são evidência de integração direta com o serviço instalado.

## Dependência exata para continuar

Disponibilizar ao processo de teste, por canal protegido, `FUNIX_JSREPORT_ENDPOINT`, `FUNIX_JSREPORT_USERNAME` e `FUNIX_JSREPORT_PASSWORD`, e autorizar o **host exato** do endpoint na política de rede deste ambiente. O cliente atual exige endpoint HTTPS terminado em `/api/report`; o template permanece `FUNIX - Orcamento`. Não é necessário colocar segredos no Git, no relatório ou no chat, nem exportá-los do n8n.

Alternativamente, a direção pode disponibilizar um canal administrativo já autorizado que tenha esse acesso, para um ensaio isolado; isso não autoriza alterar a aplicação instalada ou seus contêineres. Nenhum novo ambiente/subdomínio/serviço é necessário.

Depois que o acesso estiver disponível:

1. Executar o fluxo oficial de prévia/confirmar emissão contra SQLite **novo e exclusivo de QA**, usando o backend real sem `options.render`/mock. A reserva/JSON efetivos dessa execução devem ser preservados; não se injeta um JSON preparado no lugar do snapshot oficial.
2. Contabilizar as chamadas diretas ao cliente jsreport, sem n8n. Guardar somente PDFs reais obtidos, revisão, request IDs e hashes sanitizados; nunca headers de autenticação.
3. Conferir visualmente o documento real e a logo, agrupamentos, rateios, desconto global, componentes/MR, prazo e parcelas; verificar o documento extenso página a página. Não modificar o template para mascarar incompatibilidades.
4. Conferir os bytes do PDF persistido, reiniciar apenas o processo de QA/reabrir o SQLite isolado e solicitar o download pela API autenticada. Comparar SHA-256 e tamanho. O download deve funcionar sem renderização e sem acesso ao jsreport.
5. Alterar somente dados sintéticos no banco de QA e confirmar que o snapshot/PDF emitido permanece igual; repetir a emissão com a chave original deve devolver o mesmo documento, sem chamada adicional ao renderer.
6. Disponibilizar os PDFs reais sintéticos e atualizar o parecer, distinguindo preparação, execução real e inspeção visual.

**Conclusão:** a homologação direta ainda não foi concluída. A continuação depende de endpoint, credenciais protegidas e acesso de rede, não de repetir os testes anteriores de n8n. Sem merge/deploy ou alteração produtiva.
