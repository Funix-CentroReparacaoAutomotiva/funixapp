# FUNIX — MVP WhatsApp bidirecional: texto e mídias

## Escopo operacional

**Objetivo:** usar a aba Chat do Atendimento como interface CRM para texto, fotos, vídeos e áudios do WhatsApp. Não integra IA, não transcreve nem interpreta arquivos automaticamente, não altera Coda/n8n.

Esta entrega reúne em uma única versão:
- envio de texto pela funcionalidade da PR #130;
- envio de foto (JPEG, PNG, WebP), vídeo (MP4/WebM) e áudio (MP3, MP4/M4A, OGG, WebM) até **12 MiB por arquivo**;
- abertura sob demanda de fotos (com ampliação), reprodução de vídeo e áudio recebidos;
- manutenção do botão **Atualizar mensagens**; atualização automática será implementada depois.

## Fluxo e limitações

O navegador envia somente conteúdo, tipo MIME e os IDs de Atendimento e conversa. O servidor verifica o vínculo Coda ativo e busca o JID real na Evolution, sem aceitar um número fornecido pelo navegador. A recuperação de mídia valida a página e o identificador da mensagem no contexto canônico antes de solicitar o conteúdo à Evolution.

Os arquivos não são armazenados no banco do FunixApp nem no Coda. Mídias antigas podem expirar no WhatsApp; tipos não compatíveis com a instalação atual da Evolution serão reportados como indisponíveis.

**Operações de envio não fazem retry automático**. Em erro ou timeout, confira o WhatsApp antes de enviar novamente.

A resposta HTTP 200 representa aceitação pela Evolution, não entrega nem leitura pelo destinatário.

## Configuração após CI e deploy

As funções continuam **OFF por padrão** até ativação explícita no runtime:

- `FUNIX_EVOLUTION_READ_ENABLED=true` e configuração Evolution existente: leitura;
- `FUNIX_CODA_SYNC_ENABLED=true`: associação canônica;
- `FUNIX_EVOLUTION_SEND_ENABLED=true`: envio de texto;
- `FUNIX_EVOLUTION_MEDIA_ENABLED=true`: envio e abertura de mídias.

Como o upload é transmitido em JSON base64, configure no proxy HTTPS `client_max_body_size` de **ao menos 18m** e timeout de upload compatível com arquivos de 12 MiB. A API pode exigir aumento de `requestTimeout` para arquivos maiores; testar antes de considerar vídeos grandes suportados. Não copiar segredos para a interface.

Para desligar envios imediatamente: desabilitar as flags de envio/mídia no runtime e reiniciar a API pelo procedimento operacional existente. A leitura de texto permanece separada.

## Teste controlado único de aceitação

Utilizar **somente número sob controle do operador**, Atendimento com vínculo confirmado e arquivos de teste sem dados pessoais:

1. Abrir o Atendimento pelo Funil e por Conversas; ambos devem chegar ao mesmo Chat.
2. Enviar texto e confirmar recepção no WhatsApp do aparelho de teste.
3. Enviar uma foto pequena JPEG e abrir a mesma foto recebida na direção oposta; verificar ampliação.
4. Enviar um vídeo MP4 curto e reproduzir o vídeo recebido no próprio Chat.
5. Enviar um áudio OGG/MP3 curto e reproduzir o áudio recebido.
6. Validar que Chat sem vínculo canônico **não envia** e que conteúdo expirado exibe uma mensagem de indisponibilidade.
7. Usar “Atualizar mensagens” para atualizar o histórico.

**Critério de aprovação do MVP:** ações 2–5 comprovadas no WhatsApp real, sem duplicidade e na ficha correta. CI sintético comprova interface/contratos, mas não substitui compatibilidade com a versão real da Evolution.
