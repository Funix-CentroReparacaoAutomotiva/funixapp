# Copiloto de Orçamento por Voz — PR 2/3

Base conferida: `main` `cf9859abf394ebd455f609afe4e19031a5410185`, merge do PR #42. Branch: `feat/voice-capture-interpretation`.

Entrega: captura no botão existente → upload autenticado → transcrição → interpretação estruturada → validação PR1 → planejamento puro. **Nenhum comando é aplicado, nenhum diagnóstico é salvo e nenhum orçamento é emitido por voz.**

## Auditoria inicial e reaproveitamento

| Área | Estado real inspecionado | Alteração mínima |
| --- | --- | --- |
| PR #42 | Contrato v1, correções de exclusão e proteção de referência não resolvida, planejador sem SQLite | Reutilizados sem modificar seus três módulos |
| Autenticação | Cookie HttpOnly/SameSite, sessões e origem exata em `server/app.ts` | Nova rota atrás das mesmas proteções; revalida sessão no final |
| Contexto de cenário | `CommercialPanel` mantém seleção confirmada; `App` tem Map sem notificação reativa | Callback explícito de contexto confirmado, incluindo revisões; não consultar Map antigo para gravar |
| Composição | Peças e atributos compartilhados, masks por cenário | Somente SELECTs pelos repositórios atuais |
| Recomendações | Consultas por diagnóstico/intensidade, relações pendentes excluídas da derivação | Carregadas para o planejador; não presume instalação das 77 relações históricas |
| Copiloto | Launcher e painel existentes, sem integração de IA | Mesmo posicionamento/classes, toque curto preservado, pressão/teclado e estados adicionados |
| Tempo HTTP | Node requestTimeout=15 s e headersTimeout=10 s | Preservados; upload limitado a 15 s e processamento a 110 s só nesta rota |
| Configuração | Runtime Compose já injeta env backend | Somente nomes sem valores em .env.example; sem mudança de infraestrutura |
| Catálogos/legado | Validação/curadoria por IDs e ambiguidades já tratadas no PR1 | Sem catálogo, fórmula, importação ou migração nova |

Não foi acessada a VPS, Coda ou base instalada. Catálogos/regras reais, suporte efetivo dos modelos na conta e smartphone físico não foram certificados por fixtures sintéticas. O planejador permanece a autoridade determinística de negócio; a IA não pode gravar ou escolher destino.

## Arquivos e contratos

- `shared/voice-input.ts`: contexto de captura, limites e resposta `applied:false`.
- `src/voice-capture.ts`: ciclo de vida nativo e cancelamento, dependências injetáveis.
- `src/VoiceCopilot.tsx`, `src/voice-copilot.css`: adapta o botão/painel existentes; transcrição e plano apenas em memória.
- `src/App.tsx`, `src/CommercialPanel.tsx`: passagem do contexto confirmado; troca de cenário/Atendimento, aba, saída e sessão invalidam a captura/resultado.
- `server/voice-context.ts`: construção read-only do contexto completo para o planejador e projeção mínima para o modelo.
- `server/voice-provider.ts`: chamadas HTTP separadas para transcrição e Responses; sem SDK/dependência adicional.
- `server/voice-model-contract.ts`: JSON Schema estrito, conferência do transporte e conversão explícita para contrato PR1.
- `server/voice-endpoint.ts`, `server/app.ts`: upload binário, limites, autenticação, cancelamento e resposta sem mutação.
- `server/tests/voice-*.test.ts`, fixtures e `tests/browser/voice_input.py`: testes sintéticos.
- `.env.example` e `docs/API.md`: configuração e contrato HTTP.

### Captura

Pressão de 350 ms inicia preparação; toque curto continua abrindo/recolhendo. Enter/Espaço têm comportamento equivalente; Escape cancela. O botão não exige gesto touch. Pointer capture, pointercancel, perda de foco/visibilidade, navegação, cenário, logout/contexto ausente e unmount interrompem e liberam tracks. A autorização tardia nunca inicia captura após soltar. “Gravando” só é publicado no evento `MediaRecorder.start`.

Escolha por `MediaRecorder.isTypeSupported`: WebM/Opus, WebM, Ogg/Opus, Ogg, MP4. Bitrate solicitado 64 kbps; limite de 180 s e 12 MiB. Ao atingir duração/limiar de tamanho, encerra e processa o áudio capturado. Um chunk excepcionalmente grande que ultrapasse o limite não é enviado: mostra erro e oferece download voluntário da tentativa em memória; o app não salva o áudio. URL temporária é revogada na limpeza. Não há streaming para IA.

Transcrição e plano ficam no painel atual (details opcionais), sem modal de aprovação nem tela intermediária. O estado de processamento agrupa transcrição/interpretação: o endpoint retorna uma resposta final, sem polling/streaming ou alegar progresso de uma fase que ainda não foi confirmada.

### Backend e OpenAI

- Transcrição: POST multipart nativo para `https://api.openai.com/v1/audio/transcriptions`; modelo `gpt-transcribe`, hint português, prompt apenas para transcrição fiel.
- Interpretação: Responses API, modelo `gpt-6.1-terra`, configurável; `store:false`, sem ferramentas/funções, saída JSON Schema strict e limite de saída.
- Variáveis exclusivamente backend: `OPENAI_API_KEY`, `FUNIX_VOICE_TRANSCRIPTION_MODEL`, `FUNIX_VOICE_INTERPRETATION_MODEL`. Ausência de chave retorna 503 antes de qualquer chamada externa. Não há fallback silencioso de modelo. GPT-6 Luna poderá ser escolhido futuramente pela variável, após autorização/homologação.
- Chave real não foi solicitada, fornecida ou usada. Testes injetam providers/fetch determinísticos.
- O contrato intermediário torna explícitas as omissões: setDiagnosis/setIntensity distinguem ausência de null; preserveDimension vale apenas para correção de serviço anterior; quantidade opcional usa null. O conversor remove somente esses campos de transporte; PR1 continua validando os comandos.
- O modelo fornece somente comandos. IDs do Atendimento/cenário, revisões, chave e requestId são construídos pelo servidor.
- Catálogo técnico e composição ativa mínima seguem para interpretação; não seguem contatos, placa, nomes de cliente, notas existentes, preços ou outros Atendimentos. As masks/identidades dos demais cenários ficam apenas no planejador do backend.
- Saída recusada, incompleta, inválida, falha de transcrição/interpretação, timeout e contexto desatualizado têm códigos diferentes e mensagens sanitizadas. Conteúdo bruto do provedor não é logado nem devolvido como diagnóstico de erro.
- Áudio/transcrição permanecem só na memória necessária ao request/visualização. O app não cria arquivos, logs de conteúdo, recibos duráveis ou tabelas de IA. A retenção do provedor continua dependente da política da conta; `store:false` não é uma promessa de retenção zero da organização.

Referências técnicas consultadas: [transcrição de arquivos](https://developers.openai.com/api/docs/guides/speech-to-text) e [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs).

### Limites e consistência

Um request em processamento por instância e 12 tentativas/minuto. Upload também limitado por bytes acumulados quando não existe Content-Length; assinatura de contêiner deve corresponder ao MIME. Tamanho máximo de resposta do provedor: 512 KiB. Não há retries automáticos de chamadas pagas.

A duração é imposta no gravador e validada como metadado no backend; este PR não acrescenta decoder de áudio para conferir duração real independentemente. O limite de bytes é verificado independentemente do cliente.

O backend confere o cenário pelo pertencimento exato, compara as revisões da captura e verifica novamente o digest do contexto completo após processamento. Alterações concorrentes e saída de sessão descartam o resultado. No navegador, mudança de contexto invalida a geração e aborta o request; respostas antigas não entram no contexto atual. Não há transação SQLite aberta aguardando IA.

## Validação

As evidências em [voice-input](evidencias/voice-input/) distinguem captura nativa Chromium com dispositivo sintético, provider mock e dados sintéticos de homologação real no S21 Ultra.

| Requisitos solicitados | Cobertura |
| --- | --- |
| 1–3 Toque, pressão e soltar | Navegador nativo e teste de captura; teclado também verificado |
| 4–6 Permissão e liberação tardia | Navegador com permissão fake/delay/denial + unitários; tracks encerrados |
| 7–9 Cancelamento, página e cenário | Pointercancel, navegação/abas e cenário no navegador; visibilidade/logout/unmount na classe e sessão no backend |
| 10–13 Vazio, formatos, limites, recursos | Unitários: vazio, MIME alternativo/indisponível, erro, duração, tamanho, URL/tracks e resposta tardia |
| 14 Responsividade | 1440/390/320 px, três abas, footer e launcher sem colisão/overflow; screenshots de gravação e resultado |
| 15–20 Segurança e escopo | HTTP real local: autenticação, origem, método, MIME/assinatura, tamanho inclusive chunked, contexto ausente/estrangeiro |
| 21–24 Transcrição, estrutura, rejeição e parcial | Provider e adaptador mock, schema/conversor e plano PR1; pendências e operações independentes preservadas |
| 25–28 Referências, correções, peças e quantidades | 30 fixtures portuguesas + regressões completas do planejador; nenhuma inferência por parser local |
| 29–31 Recusa, incompleto, timeout, contexto | Mock do protocolo OpenAI, concorrência/rate limit, sessão encerrada e revisão alterada durante provider |
| 32–33 Sem escrita e histórico | `total_changes()` inalterado na interpretação, snapshot/PDF iguais e composição não salva; integridade do SQLite sintético no browser |

As 30 falas de oficina estão em `server/tests/fixtures/voice-dictations.ts`: são oráculos de saída estruturada para conversor/planejador, **não** teste de qualidade linguística de gpt-6.1-terra. Incluem duas peças, intensidade versus dimensão, correção de pintura, quantidade incremental/absoluta, remoção/restauração, ambiguidade e pedido malicioso sem comandos autorizados.

### Resultados executados

- `npm run check`: build frontend/backend, **407 testes Node aprovados** (34 novos) e lint concluído; sete avisos preexistentes, nenhum novo.
- `node --test --test-isolation=none server/tests/voice-input.test.ts server/tests/voice-capture.test.ts`: **34/34** após reforçar os oráculos semânticos.
- `python3 tests/browser/voice_input.py`: **30 grupos aprovados**, em 1440/390/320 px, captura MediaRecorder nativa com dispositivo sintético; três abas e painel financeiro expandido/recolhido; 24 screenshots.
- Regressões existentes: `fase5_gestures` **30**, `fase4_recommendations` **33**, `pdf_emission` **66** grupos aprovados, total **129**.
- `git diff --check`: aprovado.

O roteiro histórico `etapa5_rodape.py` também foi tentado, mas interrompeu antes das verificações porque espera “Emitir orçamento”, enquanto a base atual já usa “Emitir”. Não é declarado como aprovado e não foi alterado para ampliar o escopo. A geometria corrente, inclusive painel expandido/recolhido, foi validada pelo roteiro deste PR. Nenhuma correção de interface ou emissão foi introduzida para acomodar esse harness antigo.

## Continuidade no PR 3

O PR 3 deverá integrar a aplicação no backend depois deste mesmo pipeline e antes da resposta, sob transação/revisões, confirmação de remoções conforme contrato existente e recibo idempotente confiável. Não aceitar um plano devolvido pelo browser como autoridade. Revalidar contexto e mapear identidades planejadas aos UUIDs reais sem duplicar serviços. Reutilizar conversor, validador e planejador; não reimplementar interpretação em um parser. A tela de Diagnósticos poderá receber a composição confirmada diretamente, sem nova aprovação obrigatória.

Pendências reais para homologação: chave/modelos configurados pelo proprietário em implantação autorizada; chamadas reais ao provedor e microfone/permissão/gesto no Samsung S21 Ultra físico. Nenhuma dessas verificações está declarada como realizada neste PR.

Sem merge, deploy, PR 3, migração, acesso produtivo ou alterações de fórmulas/catálogos/PDFs.
