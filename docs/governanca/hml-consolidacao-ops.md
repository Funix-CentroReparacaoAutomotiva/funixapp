# HML — consolidação da administração remota (proposta de implementação)

Estado: proposta em desenvolvimento, 19/11/2026. Não autoriza merge, instalação, deploy, migração, configuração real de acesso ou alteração produtiva. Relacionada a #271–#274. A HML existente deve continuar disponível.

## Evidência e restrições

O piloto preparou e instalou o candidato #257: preparação n8n #40621, despacho #41083, journal accepted #41089 e diagnóstico #41090. O ambiente instalado foi confirmado na revisão 54b60d98b6c39ff0dc8ada0f7daa60bcf6cf2325. O resultado informou backup/HTTPS verificados e externos preservados; a homologação funcional é independente. O procedimento atual tem candidato fixo no preparador, no solicitante de atualização e na seleção administrativa. Não generalizar apenas o workflow n8n: o servidor também precisa validar a seleção. Não transformar um piloto em API administrativa genérica.

## Incremento A — preparação reutilizável e atualização ligada à seleção

- Incorporar ao controle de versão as fontes revisadas do piloto (controlador de preparação, despacho/worker e transporte). Nunca incluir chaves, PAT, certificados, configuração de rede real, dados de HML ou produção. Manter documentação de instalação e atualização reversível dos controladores e configuração local root-owned separada.
- Aceitar apenas identidade tipada de candidato: PR, run_id, attempt, artifact_id, revision de 40 hex; requerer digest SHA-256 e tamanho confirmados independentemente pela API do repositório fixo. Nunca aceitar URL, caminho local, shell, parâmetros Docker, configuração ou código do candidato como autoridade.
- Habilitar preparação não mutável via transporte autenticado: validação estrita de limites, metadata GitHub, workflow confiável em main, tentativa concluída, PR/head, nome/run/size/digest do artefato, archive e manifesto; preservar verificação de procedência oficial. Suprimir tokens, URLs assinadas e detalhes internos nos retornos. Download sem transmitir bearer ao blob. Não carregar imagens, alterar gateway/DB ou afetar serviços externos nesta fase. Limitar espaço e quantidade de candidatos; limpeza seletiva fora de operação ativa, nunca prune global.
- Registro de preparação imutável por operação (root-owned), com identidade, hash do pacote/config, revisão instalada e vínculo com journal ativo. Revisão instalada obtida do ambiente, não confiada a entrada do cliente. Novas preparações não substituem registro aprovado, autorização ou operação em execução. Usar os locks existentes com ordem consistente; recusar pendência de recuperação. Verificação de estado e arquivos na mesma seção crítica antes da primeira mutação.
- Workflow n8n manual, OFF por padrão, parâmetros estruturados e escopo funix-hml; mesma autenticação mTLS, sem desativar verificação TLS, sem retry de POST. Consultar ticket real e solicitar somente operação explicitamente autorizada, com correspondência exata da seleção solicitada. Despacho não é aceite: consultar journal e diagnóstico até conclusão, não repetir após timeout.
- Preservar as invariantes do atualizador oficial: backup antes da atualização, isolamento, saúde/HTTPS/autenticação, gate, rollback automático quando aplicável, evidência e recuperação de interrupção. Não rodar código arbitrário do candidato como root. Consolidar revisão do adaptador REST e retry HTTPS em código/testes (#271/#272), não em patches manuais permanentes.

## Incremento B — aprovação móvel independente (alternativa preferencial a validar)

### Entrega DEV do Incremento A — limite verificável da branch #285

Inventário na base 9a0e0a94: deploy contém hml-update.py (prepare_operation,
installed_preflight, checked_update_package, execute_operation), transação,
safety, manutenção Docker/Nginx, isolamento, writer guard, identidade de imagens,
seleção de build e procedência REST; testes e hml-maintenance-rehearsal.yml já
exercitam a transação oficial. Não há transport.py, rootctl.py, preparador SSH,
emissor administrativo ou instalador do piloto nesta árvore. Fontes recuperados
em outra PR draft (#284) não comprovam identidade dos módulos instalados e não
são importados implicitamente para este contrato. Integração mTLS/worker pendente
da importação e revisão autorizada desses fontes.

hml-selection.py é biblioteca sem CLI, serviço, download, extração ou escrita.
parse aceita JSON de até 4096 bytes com somente pr/run_id/attempt/artifact_id,
revision SHA40, sha256 hex64 e size inteiro positivo limitado a 20 GiB. Não
aceita URL/caminho/shell/env/projeto. verify_package recebe um caminho canônico
controlado pelo host, rejeita links e confere ID/size/digest via API fixa; delega
run/tentativa/workflow/repo/PR/revisão/expiração e digest dos bytes ao verificador
oficial. Metadados mudando entre consultas são ambíguos e bloqueiam. Retorno
limitado inclui update_authorized=false: comprovação de procedência não autoriza
deploy. O manifesto e a extração permanecem exclusivamente em prepare_operation.

require_available é um contrato puro sobre fatos obtidos pelo futuro adaptador
sob o lock oficial: operação existente, recuperação pendente ou contenção bloqueiam.
Não é implementação de lock/registro root-owned e não deve receber esses fatos
do cliente. O adaptador futuro deve validar host_scope, obter locks existentes
na ordem aprovada, conferir predecessor/journal/arquivos na seção crítica, criar
registro root-owned imutável por operação e chamar prepare_operation. Deve
reconciliar timeout sem retry de POST; nunca apagar registro/lock para repetir.
Os testes de replay/concorrência aqui validam essa interface pura, não uma
garantia de concorrência de controlador ainda ausente.

Interface futura n8n: workflow manual OFF, mTLS validado com origem/fingerprint,
identidade estruturada e nenhuma opção de comando. Consulta de ticket real,
seleção idêntica à aprovação independente, POST único sem retry e observação do
journal até accepted/restored/pending; queued não significa aceite. Nenhum
workflow n8n, credencial ou autorização foi criado/modificado nesta entrega.
Implantação futura exige fontes revisados, migração administrativa reversível,
CI, decisão PO e autorização separadas. Incremento B não foi iniciado.

Usar GitHub Environment dedicado de **aprovação HML**, não runner com acesso VPS. Workflow em main confiável, apenas solicitação/revisão, sem deploy, segredos VPS ou acesso de rede privado. Conferir disponibilidade e interface móvel no GitHub antes de adotar. A direção revisa a solicitação exata e aprova ou rejeita. Referências: https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/review-deployments e https://docs.github.com/en/rest/actions/workflow-runs#get-the-review-history-for-a-workflow-run.

A identidade do conector possui administração do repositório: revisão usando a mesma conta não constitui segregação. Pré-requisito: identidade pessoal distinta, controlada pela direção, com MFA, não conectada ao ChatGPT/Codex/n8n; permissão mínima para revisar. Ambiente com required reviewers, prevent self-review, impedir bypass administrativo quando disponível e restrição à main. Fixar no host ID numérico do aprovador e ambiente e identidade/revisão do workflow confiável, não confiar em configuração GitHub alterável pelo solicitante. Se esta segregação não estiver disponível, manter autorização local existente, sem flexibilizar controles.

- Gerar no servidor desafio único com hash canônico que vincule operação, ação, PR, revisão candidata, pacote, configuração, predecessor, journal e expiração. Exibir identificação/hashes na solicitação revisada pela direção, sem dados privados. O servidor registra emissão, valida evidência autenticada via API GitHub (repositório, workflow confiável, run/attempt, ambiente, aprovador permitido e estado), aprovação explícita do desafio exato; não aceitar comentário livre, log/artefato do candidato, resposta do n8n ou mero sucesso de job como autorização. Preferir comentário de revisão com desafio/hash exato, com validação do registro returned by approvals API; testar que UI permite. Rejeitar divergência, rejeição posterior, tentativa reexecutada, ausência de vinculação/identidade, aprovação antiga; janela limitada pelo relógio do servidor e consumo atômico de uso único. Verificar novamente estado e expiração antes da mutação. Sem autorização emitida pela IA.
- A aprovação permite somente a operação determinada, não concede acesso VPS nem habilita deploy automático pelo GitHub. Manter n8n como transporte e atualizador oficial como executor. Não colocar credenciais de escrita do host no GitHub.
- Preservar aprovação administrativa local (fallback independente), revogação e trilha de auditoria, distinguir autorização, despacho, execução e aceite. Não expor serviço público adicional nem abrir portas para este incremento.

## Critérios de aceite

1. Dois candidatos sintéticos diferentes, mesmo controlador e workflow, sem reinstalação. Preparar ambos sem Docker load/DB/gateway; recusar identidade/arquivo/digest/PR/workflow inválidos, URL/caminho arbitrário, candidato grande demais, symlink e reuso indevido.
2. Preparação B não muda aprovação de A. Disputa simultânea, predecessor/journal/config/pacote alterado, aprovação expirada/revogação/replay, falha parcial e retry após timeout demonstrados com fixtures isoladas.
3. Testar aprovador incorreto (inclusive conta do conector), ambiente incorreto, tentativa/workflow não confiável, challenge divergente, bypass sem revisão, rejeição, reaprovação/replay. Evidência de aprovação independente em teste sem deploy. Não habilitar aprovação móvel até validar a identidade e API de fato.
4. Testes do atualizador existentes e regressões direcionadas, incluindo rollback e manutenção. Testar transporte mTLS com origem/certificado incorretos. Nenhum teste real em produção.
5. PR draft, CI, revisão de código, documentação e plano de migração sem downtime da aplicação. Somente depois de revisão e autorização separada, instalar atualização dos controladores e pilotar próximo candidato real. Sem repetir deploy #257 apenas para testar.

## Ordem de trabalho

A primeiro; B em seguida ou em paralelo sem ativação. Adotar B apenas após validação da identidade independente. Manter piloto atual como referência e fallback. Recuperação/rollback remoto explícito em incremento posterior, com consentimento específico sobre dados pós-deploy; preservar auto-restauração desde já. Não criar cadastro novo de pendências: atualizar #273 e #274.
