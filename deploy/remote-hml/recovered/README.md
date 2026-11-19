# FUNIX — #274 | Recuperação dos fontes do piloto mTLS

**Material de referência para revisão e integração no Codex. NÃO EXECUTAR os instaladores, emissores ou módulos deste pacote.** Nenhuma alteração na VPS foi efetuada na extração.

## Origem e conteúdo

Três PowerShell fornecidos pela direção: Ops-Setup, Prepare-Setup e Ops-Authorize. Os dois instaladores contêm os módulos Python originais, codificados em Base64. Os arquivos `ops/rootctl.py` (inclui worker e emissor de autorização), `ops/transport.py` e `prepare/control.py` são decodificados byte a byte. O manifesto contém SHA-256 e tamanho de cada fonte. O hash do control.py coincide com PREP_SHA exigido por rootctl.py. Os tamanhos dos três módulos, unidades, wrappers e sudoers coincidem com o inventário administrativo da VPS; isso não comprova igualdade byte a byte no servidor.

- `originais/`: cópias dos PowerShell. O Prepare-Setup teve somente a constante A (aprovação fixa histórica do candidato piloto) substituída por None para impedir reutilização; normalização UTF-8/LF nessa cópia. Os outros dois são cópias byte a byte.
- `bootstrap/`: blocos Python dos instaladores e rotinas de exportação/purga de credencial, extraídos de literais. São código, não credenciais. O prepare-install mantém a remoção de A e o placeholder __INPUT__.
- `estrutura/`: unidades systemd, sudoers e wrappers extraídos da lógica original; não são cópias lidas da VPS.
- `manifest.json`: hashes, tamanhos, origens e comparação de tamanho com inventário.

## Sanitização

Nenhum relatório bruto, ticket emitido, token, certificado, chave, arquivo de autorização vivo, estado operacional, banco ou conteúdo de diretórios privados foi incluído. O código contém referências a caminhos de credenciais, procedimentos de emissão e constantes de identidade/hash dos módulos oficiais, necessárias para revisão; não contém os valores das credenciais. Configuração transport.json real não incluída: o instalador documenta seus campos. A inspeção estática e busca por formatos conhecidos de segredos não substituem revisão humana antes de commit. Os identificadores e endereços de infraestrutura presentes nos fontes são contexto operacional, não segredos de autenticação; avaliar sua externalização.

## Lacunas e validação

Os arquivos de testes automatizados originais (12 testes relatados na issue #274) não foram encontrados nos anexos; não foram recriados como se fossem originais. Os instaladores preservam seus próprios checks negativos e de instalação. Todos os 7 blocos/módulos Python extraídos foram compilados estaticamente sem execução. PowerShell não foi executado nem validado em host Windows. Não houve requisição de rede ou deploy. O código oficial antigo não foi exportado da VPS; os hashes fixados estão no control.py. A versão instalada não foi conferida por hash, apenas por tamanho do inventário.

## Orientação para integração (proposta, não decisão de execução)

Partir da main atual que contém #280; PR draft referenciando #273/#274. Aproveitar o transporte mTLS e as fronteiras de privilégio originais. O worker atual chama execute_operation diretamente em candidato previamente preparado; o novo coordenador pressupõe diretório sem config.json. Resolver essa incompatibilidade explicitamente sem apagar config/journal, sem perder aprovação de uso único vinculada ao predecessor sob lock e sem duplicar a transação. control.py carrega módulos pinados e injeta uma política antiga de retry por monkey patch; consolidar com #279, não manter a política antiga em paralelo. Preservar autenticação/isolamento, backup, auditoria, revogação e rotação. Não permitir entrada arbitrária, não acionar workflow POST, não ampliar credenciais e não tocar produção/VPS. Corrigir instalação para fontes versionados e parametrização administrativa segura, com testes sintéticos novos claramente identificados e ensaio integrado. Revisão, CI e autorização separados de merge e implantação.
