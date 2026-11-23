# Issue #256 — Cilia: primeira etapa, leitura XML isolada

Direção revisada: o importador pertence ao FunixApp; não depende de n8n, ChatGPT ou IA para o fluxo padrão. Este incremento implementa somente a leitura de origem. Não expõe rota, botão, persistência ou conversão automática para o contrato neutro. Nenhuma alteração do cálculo, composição, aprovação, emissão ou OS.

## Perfil observado e limites

Amostra autorizada analisada privadamente: exportação XML UTF-8 de orçamento Cilia, 32 itens, peças e serviço manual, três grupos de cobertura, tarifas separadas por tipo, identidade/revisão e totais. Nenhum XML real, identificador de cliente, placa ou preço de parceiro real é publicado. Fixtures são sintéticas. A amostra não comprova toda a variedade de exportações.

- Leitor restrito a XML de dados (até 512 KiB, profundidade 24, 20.000 elementos, 1.000 itens); rejeita DTD, entidades externas, atributos, comentários, CDATA e instruções de processamento. UTF-8 inválido e sintaxe não reconhecida falham. Não é parser XML genérico. Campos desconhecidos relevantes são sinalizados; metadados pessoais do cliente e anexos não são extraídos.
- Registra hash SHA-256 dos bytes, número, revisão, evento, emissor e identificação de veículo como evidência não autenticada. Não seleciona Atendimento nem autoriza escopo.
- T/RI compartilham uma única hora; conserva as duas flags, campos originais normalizados, ordem, código, comentário, quantidade e fornecimento. R e P independentes. Nenhuma hora externa vira quantidade nativa. Zero não equivale a ausência.
- Usa tarifas declaradas no documento e aritmética racional do motor. Preserva valores bruto/líquido da peça, desconto e totais declarados. Verifica reconciliação do perfil observado (quantidade unitária, sem ajustes, somente impacto), incluindo peças da associação fora da receita da oficina e serviços manuais. Quantidade não unitária, arredondamento não exato, fornecimento impreciso, divergências e coberturas alternativas ficam pendentes. Não infere regras de majoração/desconto/franquia/dedução. R$/hora não é custo nem energia FUNIX.
- Retorno sempre canWrite=false; financialIntegrity apenas indica ausência de pendências na comparação suportada, não autorização nem qualidade técnica. Dados retornados podem conter identificação do veículo; não registrar em logs ou publicar.
- Resumo por categoria é preservado. Não é ainda uma conferência integral por centro de receita nem por todos os tipos de descontos. Não cria ou confirma serviços de execução externa.
- Etapa seguinte: dicionário versionado de candidatos a códigos nativos, agrupamento explícito por operação, revisão de métodos/dimensões, compatibilidade com catálogo ativo, modelo para peças de terceiros, conciliação e complemento. Só depois contrato de prévia e interface autenticada. Reaproveitar PR #257 sem override de preço. Não guardar dados reais em Git.

Validação prevista: testes sintéticos em server/tests/cilia-xml.test.ts e CI normal da branch. A prova de execução e o ensaio privado com a amostra real devem ser registrados separadamente; não presumir homologação. Sem merge ou deploy.
