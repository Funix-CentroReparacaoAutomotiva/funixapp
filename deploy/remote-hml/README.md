# #274 — fontes recuperados e integração proposta

Somente revisão/CI. Não executar instaladores ou emitir aprovação nesta etapa.
O README e manifesto recuperados estão em recovered/. Preservamos os módulos
originais ali; rootctl.py, transport.py e control.py no diretório principal são
as variantes propostas. O worker permanece dentro de rootctl.py. Nenhum teste
novo é apresentado como um dos 12 testes históricos não recuperados.

Alterações: os pins de control.py correspondem aos módulos oficiais desta
revisão, incluindo hml-official-update.py. Removido somente o retry paralelo
antigo que repetia violações de autenticação. O worker mantém consumo único,
prazo de 20 minutos e vínculo de arquivo/config/journal/predecessor, conferido
novamente no callback sob lock oficial. Chama execute_prepared do coordenador,
que valida identidade/escopo e delega a execute_operation existente. Não apaga
config nem recria operação preparada, nem cria backup/rollback paralelos.

install.py deriva do instalador original, substituindo cópias Base64 pelos
módulos versionados adjacentes e root-owned. Mantém first-install-only,
privilégios, exclusividade da bridge, TLS e checks negativos originais.
Não é um migrador da instalação existente: exige control.py e official/
reconciliados por procedimento administrativo revisado. Os PowerShell e
prepare-install.py em recovered/ são referência histórica, não instaladores
autorizados para esta revisão. A aprovação fixa histórica foi removida no
pacote fornecido. A instalação real/PowerShell e migração do piloto não foram
executadas ou validadas na VPS; precisam de revisão e autorização separadas.

Fronteira preservada: transporte sem privilégio, certificado cliente validado
por CA e fingerprint, origem exata, apenas GET status e POST update, sudoers
com dois wrappers sem argumentos. Emissão/cancelamento da autorização ocorre
separadamente pelo administrador; remoto não emite aprovação, recovery ou
rollback explícito. Interrupção exige inspeção, nunca rearme/retry automático.
Revogação deve parar somente o transporte dedicado e revogar sua identidade;
rotação requer nova CA/certificados e fingerprint por procedimento aprovado.
Não reutilizar a credencial SSH de leitura para escrita.

Não há certificados, chaves, tokens, tickets ou autorizações vivas neste pacote.
Caminhos de credenciais, geração de certificados e hashes são código/contrato.
Não exportar transport.json nem diretórios privados para o Git. Os utilitários
exportSource/purgeSource são apenas referência de origem, nunca execução CI.

Limitações: testes sintéticos novos verificam tickets, parsing, fronteira mTLS,
ausência de aprovação, pins e delegação oficial. Ainda faltam ensaio de
instalação e mTLS de ponta a ponta com worker/systemd, expiração/reutilização e
revogação/rotação completas. Esta PR não declara o piloto pronto para deploy.

Incremento de revisão: migrate.py e MIGRATION.md propõem migração administrativa
de código com inventário old/new aprovado, locks existentes, backup/staging
privados, interrupção recuperável e parada exclusiva do transporte. Testes
locais simulam systemctl, mas trocam/restauram arquivos reais sintéticos.
Teste TLS real com certificados sintéticos cobre CA/cliente/origem/fingerprint
e rejeição sem aprovação, com backend privilegiado isolado. Isso ainda não
constitui cadeia transporte → wrappers sudo → worker → transação em systemd
real. O ensaio oficial de Docker continua separado. O CI Windows apenas analisa
PowerShell, sem SSH ou emissão de aprovação. O relatório administrativo não
persiste resposta/ticket; o procedimento para candidatos novos e retenção
está em MIGRATION.md. O preparador agora aceita restored usando previous.
