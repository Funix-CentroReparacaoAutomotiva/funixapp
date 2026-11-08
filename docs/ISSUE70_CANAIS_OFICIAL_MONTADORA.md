# Issue #70 — quatro canais de pesquisa, com Montadora condicional

Decisão funcional de 08/11/2026: exibir **Geral | Original | Oficial | Montadora**. Os três primeiros permanecem na interface; **Montadora** aparece apenas para marcas com e-commerce direto de peças verificado. A mesma regra vale para Diagnóstico (somente componente selecionado) e Copiloto (opções visíveis com o componente em revisão).

- **Geral:** Google Shopping com marca, modelo, ano inequívoco e descrição técnica.
- **Original:** mesma pesquisa no Google Shopping acrescida do termo `original` (não certifica autenticidade).
- **Oficial:** loja oficial da marca dentro do Mercado Livre, quando conhecida e cadastrada; caso contrário, opção indisponível. Não usar lojas genéricas, concessionárias independentes ou vendedores não certificados.
- **Montadora:** e-commerce próprio de peças da marca, quando comprovado. Não exibir para marcas sem canal de venda direta verificado.
- **Volkswagen:** Oficial = busca por componente em `https://lista.mercadolivre.com.br/loja/volkswagen/<componente-em-slug>?sb=storefront_url`; Montadora = pesquisa direta em `https://pecas.vw.com.br/todas-categorias?q=...`, com nome da peça, modelo e ano; rota observada em navegação real com uma peça sintética no Chromium em 08/11/2026. Ambos os canais são divulgados pela própria Volkswagen: `https://www.vw.com.br/pt/servicos-e-acessorios/reparadoresvw.html`.
- Buscas de loja no Mercado Livre: Volkswagen, Chevrolet, Fiat, Jeep e Hyundai Mobis seguem o padrão de URLs fornecidas manualmente pela direção (`lista.mercadolivre.com.br/loja/<loja>/<peca>?sb=storefront_url`). Ford e Renault não têm rota de pesquisa de loja validada: a opção Oficial fica indisponível para essas marcas até confirmação. A inclusão do quarto botão para outras marcas dependerá de verificação da venda direta; não presumir que página de serviços ou catálogo seja e-commerce.
- Sem mudança de dados, preço, MR, aplicação de orçamento, consultas pagas, backend de cotação, ledger ou flags.

Limitação: **Montadora** (VW) abre pesquisa filtrada pelo termo no próprio Peças.VW, mas isso não comprova compatibilidade ou equivalência de preços. **Oficial** (Mercado Livre) usa a rota de pesquisa **específica de loja** demonstrada nos links reais fornecidos pela direção em 08/11/2026. A verificação automatizada do Mercado Livre retornou HTTP 403, portanto o comportamento final no navegador comum deve ser homologado pela FUNIX. O termo da peça é normalizado para o caminho; não acrescentamos modelo/ano nesse caminho sem teste real adicional. O fragmento `#D[...]` não é necessário para identificar a busca. Para Ford/Renault, sem evidência dessa rota, a pesquisa Oficial permanece indisponível, sem redirecionamento enganoso à página inicial.

Validar testes unitários e Chromium em 320/390/1440, três versus quatro botões, sem buscas automáticas, sem PII nas URLs. Entrega em PR, sem merge/deploy automáticos nesta etapa.
