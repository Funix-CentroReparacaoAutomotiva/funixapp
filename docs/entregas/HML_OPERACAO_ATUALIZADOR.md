# FUNIX — operação do atualizador HML (proposta pré-deploy)

**Estado:** incremento em draft; não usar na VPS antes de CI, revisão e
aceite do primeiro pacote real. Nenhum merge/comando remoto foi executado.
O ensaio no HEAD 593c885 (run 44311960313/job 134828086264) concluiu 86 testes,
HML_ARTIFACT_MAINTENANCE_ENTRYPOINT_OK, update, rollback e recuperação pré/pós
aceite. API GitHub simulada; Docker/SQLite/Nginx/TLS sintéticos reais.

## Escopo e ordem

Issues #271/#272: a consulta de procedência usa urllib da biblioteca padrão,
HTTPS verificado para api.github.com, sem gh obrigatório e sem seguir redirects.
Para repositório privado, disponibilizar FUNIX_HML_GITHUB_TOKEN apenas no
ambiente do processo autorizado, com token de curta duração e leitura mínima
de Actions/Pull requests/metadata no repositório FUNIX. Não colocar token na
linha de comando, config, logs ou pacote. Sem token, acesso público só funciona
se os metadados estiverem públicos; 401/403/404 ou resposta inválida bloqueiam.
A sessão do gh não é reutilizada implicitamente. Download do artefato continua
sendo uma etapa separada do transporte autorizado.

O validador HTTPS repete a suíte completa até três vezes, espera um segundo
entre tentativas e limita a janela a 60s, com timeout de operação de até 5s.
Somente erros de transporte e 502/503/504 de endpoints esperados como 200 são
transitórios. Certificado/TLS, autenticação, revisão, prontidão, limites de corpo
e bloqueio de escrita falham imediatamente. Diagnóstico em stderr contém
somente tentativa/categoria/retry, nunca URL arbitrária, corpo ou credenciais.
A causa da instabilidade histórica permanece não demonstrada.

Distribuição do código: gerar o pacote **da revisão aprovada** com
`git archive --format=tar REVISAO_APROVADA deploy/` e transportar o arquivo
íntegro pelo canal já autorizado. Instalar o diretório `deploy` completo em um
diretório versionado de código confiável; não copiar apenas hml-update.py.
Isso inclui hml-image-identity.py e todos os módulos carregados dinamicamente.
Antes de prepare/preflight, conferir o SHA aprovado e a presença de
`deploy/hml-image-identity.py` no pacote e na instalação. Não misturar módulos
de revisões diferentes nem sobrescrever código de uma operação em andamento.

1. Integrar #230 e #262 somente após revisão, CI da revisão exata e autorização
   separada de merge. A ação produtiva permanece manual e inalterada.
2. Despachar **FUNIX - Homologacao (candidato)** na main, para PR interna
   revisada e SHA exato, com checks verdes. Nunca selecionar código não
   confiável. O artefato é privado, retido por 3 dias.
3. Usar administrador local da VPS e somente os utilitários de atualização
   de uma revisão confiável/registrada. Transportar candidate.zip sem
   descompactar, via SSH com host verificado. Não copiar chave root,
   credenciais da produção ou token GitHub para o chat. A consulta de
   proveniência usa `gh api` com sessão autenticada **somente leitura** do
   repositório (Actions, Pull requests); disponibilidade/credencial ainda
   não verificadas na VPS. Não instalar gh nem autenticar como root sem
   revisão/autorização separada; credencial de curta duração quando aplicável.
4. Preparar diretórios privados root 0700 /var/lib/funix-hml/updater e
   subdiretório novo op-IDENTIFICADOR. Artefato root 0600
   op-IDENTIFICADOR/candidate.zip. O comando prepare verifica metadados
   autenticados, ZIP, SHA e IDs, sem docker load, troca de serviços ou
   gravação no banco. Registra somente hash do Compose normalizado
   (não duplica senha) e config privada. Primeira operação exige revisão
   auditada 8e801e9b e gateway estável, hash de gateway.compose.yaml.
   O contrato é reutilizado e mudanças exigem revisão independente.
5. Preflight confirma o release atual, saúde, rede/mounts e HTTPS. Conferir
   disponibilidade de janela HML, espaço e ausência de operação pendente.
   Somente após aceite do operador, update com --authorize. Sob lock
   global, repete validação do ambiente e do pacote antes de parar
   serviços. Preserva configurações originais, gateway fixo e SQLite
   via backup durável. A HML poderá ficar indisponível brevemente.
6. Em interrupção verificar journal privado. Recover exige autorização e
   usa o mesmo diretório; não depende de pacote ainda disponível. Rollback
   de atualização aceita exige também confirmação explícita de descarte
   dos dados pós-update, com backup separado. Não repetir update com
   journal existente, não remover lock/journal manualmente. Não tocar
   produção, rede compartilhada ou Traefik.

Exemplo de contrato da CLI (placeholders, **não executar agora**):
```bash
python3 /CAMINHO-CONFIAVEL/hml-update.py prepare --operation /var/lib/funix-hml/updater/op-IDENTIFICADOR --config /var/lib/funix-hml/updater/op-IDENTIFICADOR/config.json --artifact-id ID --run-id RUN --attempt TENTATIVA --revision SHA40 --pr NUMERO
```
Os verbos preflight, update, recover e rollback usam o mesmo par operation/config.
Update/recover/rollback exigem --authorize; rollback também
--discard-post-update-data. O código proposto restringe caminhos e contexto
Docker local, exige arquivos privados, hash do contrato, autenticação do
artefato e journal. **Não constitui liberação antes dos testes e revisão.**

## Limitações / aceite restante

- O teste anterior não verificou a semântica da API GitHub real nem a
  disponibilidade de gh na VPS. Validar o primeiro pacote autêntico.
- A auditoria aprovada da VPS não executou o atualizador nem migrações.
- O comando prepare grava metadados privados locais e extrai ZIP apenas
  temporariamente. Não faz deploy. O teste da CLI é unitário; o ciclo
  Docker usa o entrypoint compartilhado, sem VPS.
- A base de Compose permanece instalada; não executar compose up normal
  sem o override images.json depois de atualização, pois apontaria a release
  inicial. Não substituir os arquivos instalados com o Compose produtivo.
- A direção precisa aprovar a revisão funcional na HML; produção é outro
  fluxo. Não remover as travas para obter sucesso artificial.

## Correção do primeiro CI da interface operacional

Run 44314802858, job 134837973022: regressões Python aprovadas;
ensaio integrado falhou antes de carregar o pacote, por importação local
de shutil em prepare_candidate, causando UnboundLocalError no cálculo
do espaço livre. Removidas as importações locais redundantes de shutil
e subprocess. Acrescentado teste de prepare_candidate com ZIP temporário
real, espaço simulado e validação de ausência de docker load no modo
preparação. Aguardar nova execução completa; nenhuma VPS foi acessada.
