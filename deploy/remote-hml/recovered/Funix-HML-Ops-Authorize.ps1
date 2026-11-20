param(
    [Parameter(Mandatory=$true)][ValidatePattern('^[a-f0-9]{40}$')][string]$Revision,
    [Parameter(Mandatory=$true)][ValidatePattern('^[a-f0-9]{40}$')][string]$InstalledRevision,
    [string]$SshUser = 'root',
    [string]$KeyPath = (Join-Path $HOME '.ssh/funix_hostinger')
)
$ErrorActionPreference = 'Stop'
$OutputEncoding = [Text.Encoding]::ASCII
$report = Join-Path $PSScriptRoot 'funix_hml_ops_autorizacao.txt'
if (-not (Test-Path -LiteralPath $KeyPath)) { throw 'Chave SSH administrativa local nao encontrada.' }
$sshArgs = @('-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=15','-i',$KeyPath,"$SshUser@2.25.144.201")
$cmd = '/usr/bin/env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin HOME=/root /usr/bin/python3 -I /usr/local/lib/funix-hml-ops/rootctl.py'
$raw = @(& ssh.exe @sshArgs "$cmd preview")
if ($LASTEXITCODE -ne 0) { $raw | Tee-Object -FilePath $report; throw 'Previa de autorizacao bloqueada. Nenhuma autorizacao criada.' }
$p = ($raw -join "`n") | ConvertFrom-Json
if ($p.schema -ne 'funix-hml-ops/1' -or $p.scope -ne 'funix-hml' -or $p.status -ne 'approval_preview' -or $p.preview.action -ne 'update' -or $p.preview.revision -cne $Revision -or $p.preview.installed_revision -cne $InstalledRevision -or $p.preview_sha256 -cnotmatch '^[a-f0-9]{64}$') { throw 'Revisao, estado instalado ou contrato diferente do solicitado. Nenhuma autorizacao criada.' }
Write-Host 'AUTORIZACAO PARA ATUALIZACAO EXCLUSIVA DA HML (NAO PRODUCAO)'
Write-Host ('PR: ' + $p.preview.identity.pr)
Write-Host ('Revisao atual: ' + $p.preview.installed_revision)
Write-Host ('Revisao candidata: ' + $p.preview.revision)
Write-Host ('Operacao: ' + $p.preview.operation)
Write-Host ('SHA256: ' + $p.preview.sha256)
Write-Host 'A aprovacao permite iniciar uma unica atualizacao, dentro de 20 minutos.'
Write-Host 'O atualizador oficial fara backup, controle de manutencao e restauracao automatica se aplicavel.'
Write-Host 'Este script NAO executa deploy. O acionamento sera feito pelo ChatGPT separadamente.'
$confirmation = 'AUTORIZAR ' + $Revision.Substring(0,12)
$answer = Read-Host "Digite exatamente $confirmation para aprovar"
if ($answer -cne $confirmation) { Write-Host 'Cancelado. Nenhuma autorizacao criada.'; exit 0 }
& ssh.exe @sshArgs "$cmd approve $($p.preview_sha256)" 2>&1 | Tee-Object -FilePath $report
$code = $LASTEXITCODE
"SSH_EXIT=$code" | Tee-Object -FilePath $report -Append
Write-Host "Relatorio: $report"
if ($code -ne 0) { Write-Host 'Autorizacao bloqueada. Nao acione o deploy.'; exit $code }
Write-Host 'Autorizacao de uso unico registrada. O deploy ainda nao foi executado.'
