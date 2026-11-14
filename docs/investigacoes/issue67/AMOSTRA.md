# Registro das consultas sintéticas

Amostra exploratória: resultado indexado é candidato, nunca oferta confirmada. Cada linha tem os três primeiros links em `consultas.json`; nenhuma página de terceiros foi copiada integralmente. Tempos medem a ferramenta de pesquisa, incluindo possível cache, não APIs das lojas.

| ID | Fonte / veículo | Componente | ms | Avaliação |
|---|---|---|---:|---|
| Q01 | Volkswagen / Gol 1.0 2019 | farol dianteiro esquerdo | 414 | Vitrine; anúncio de Gol G5 2009–2011 entre os resultados não atende Gol 2019. |
| Q02 | Volkswagen / Polo 1.0 TSI 2020 | para-choque dianteiro | 990 | Primeiro resultado é travessa, não cobertura do para-choque. |
| Q03 | Volkswagen / Fox 1.6 2015 | maçaneta externa porta dianteira direita | 544 | Primeiro anúncio é maçaneta traseira; consulta pede dianteira. |
| Q04 | Volkswagen / Saveiro 1.6 2021 | guia para-choque dianteiro esquerdo | 646 | Primeiro resultado é para-choque inteiro; guia apareceu sem preço validado. |
| Q05 | Chevrolet / Onix LT 1.0 2020 | farol dianteiro direito | 450 | Vitrine mistura LED/sem LED, gerações, cupom e preço sem cupom; link individual da montadora não confirmado. |
| Q06 | Chevrolet / Prisma LT 1.4 2018 | para-choque traseiro | 488 | Vitrine retorna guia em vez da cobertura; listagens incluem cobertura 2018–2019 sem oferta individual validada. |
| Q07 | Chevrolet / Cobalt LT 1.8 2016 | vidro porta dianteira esquerda | 458 | Listagem mistura vidros dianteiros/traseiros e novos/usados; falta fornecedor autorizado confirmado. |
| Q08 | Chevrolet / S10 LT 2.8 2021 | suporte para-choque dianteiro direito | 1194 | Listagem mistura guia plástica e braço metálico, lado e anos; especificar subcomponente/OEM. |
| Q09 | Fiat / Argo Drive 1.0 2021 | farol dianteiro esquerdo | 585 | Vitrine e anúncios misturam LED e halógeno; versão/tecnologia ainda não comprovadas. |
| Q10 | Fiat / Strada Endurance 1.4 2021 | para-choque dianteiro | 570 | Vitrine mistura para-choque completo e inferior; confirmar acabamento/furos e geração. |
| Q11 | Fiat / Uno Vivace 1.0 2014 | maçaneta externa porta dianteira direita | 578 | Primeiro anúncio é lado esquerdo; solicitado direito. |
| Q12 | Fiat / Mobi Like 1.0 2020 | presilha fixação para-barro | 548 | Primeiro anúncio é presilha de quebra-sol, não de para-barro; descrição contradiz alegação de genuína. |
| Q13 | Hyundai Mobis / HB20 Comfort 1.0 2019 | farol dianteiro direito | 584 | Primeira listagem é de farol Mobi, não HB20; resultados seguintes misturam gerações HB20. |
| Q14 | Hyundai Mobis / HB20S Vision 1.0 2021 | para-choque traseiro | 604 | Listagem contém candidato HB20S 2020–2021, mas sem URL individual validada e compatibilidade de versão. |
| Q15 | Hyundai Mobis / Creta Action 1.6 2021 | vidro porta dianteira esquerda | 1071 | Listagens misturam elevadores e vidros fixos/traseiros; não validado vidro dianteiro solicitado. |
| Q16 | Hyundai Mobis / HB20 Comfort 1.0 2017 | guia para-choque dianteiro direito | 439 | Vitrine contém guia direita e par; falta prova de unidade, ano e anúncio individual. |
| Q17 | Ford / Ka SE 1.0 2018 | farol dianteiro esquerdo | 726 | Vitrine Ford alternativa /loja/ford descoberta; vínculo técnico com URL fornecida não comprovado por API. |
| Q18 | Ford / Fiesta SE 1.6 2015 | para-choque dianteiro | 476 | Listagem mistura hatch/sedan e gerações; carroceria não informada, requer pergunta. |
| Q19 | Ford / EcoSport SE 1.5 2019 | maçaneta externa porta dianteira direita | 898 | Primeiro candidato declara peça nova com detalhes de armazenamento, de outra loja oficial; não comprova canal Ford. |
| Q20 | Ford / Ranger XLS 2.2 2020 | suporte para-choque dianteiro esquerdo | 1211 | Primeiro resultado é para-choque usado completo, não suporte esquerdo. |
| Q21 | Jeep / Renegade Sport 1.8 2019 | farol dianteiro direito | 449 | Vitrine retorna full LED; tecnologia da versão Sport não confirmada. |
| Q22 | Jeep / Compass Longitude 2.0 2020 | para-choque dianteiro | 825 | Listagem mistura flex/diesel e coberturas superior/inferior; motor 2.0 sem combustível é insuficiente. |
| Q23 | Jeep / Renegade Sport 1.8 2021 | moldura para-lama dianteiro esquerdo | 588 | Candidato novo em loja Jeep, mas divergência entre códigos OEM/MPN e URL bloqueada na abertura. |
| Q24 | Jeep / Compass Longitude 2.0 2018 | presilha fixação para-barro | 720 | Candidato Jeep novo com código 51877375 e preço total; aplicação Compass 2018 e URL atual não confirmadas. |
| Q25 | VW portal / Gol 1.0 2019 | farol dianteiro esquerdo | 438 | Candidato oficial 5U7941007D; faixa por vendedores e aplicação genérica Gol 2017–2023, sem oferta unitária final. |
| Q26 | VW portal / Polo 1.0 TSI 2020 | para-choque dianteiro | 879 | Candidato oficial 6EA807217FGRU; faixa por vendedores, máximo mudou entre índice e abertura. |
| Q27 | VW portal / Fox 1.6 2015 | maçaneta externa porta dianteira direita | 868 | Primeiro resultado é adesivo de porta, não maçaneta; demais portas/revestimentos também não equivalem. |
| Q28 | VW portal / Saveiro 1.6 2021 | guia para-choque dianteiro esquerdo | 437 | Guia 5U0807183B encontrada; índice indicava zero/sem estoque, abertura mostrou faixa positiva; lado não explicitado na página aberta. |
| Q29 | VW portal / Gol 1.0 2019 | vidro porta dianteira direita | 954 | Listagem de vidros não prova geração/lado; candidato 5W4845202 precisa verificação de aplicação. |
| Q30 | VW portal / Polo 1.0 TSI 2020 | presilha fixação para-barro | 889 | Categoria presilhas; candidatos de teto e mangueira não equivalem ao fixador de para-barro. |
| Q31 | Renault portal / Sandero Expression 1.0 2018 | farol dianteiro esquerdo | 1071 | Catálogos e páginas gerais Renault/Motrio; nenhum farol solicitado com preço e link individual comprovados. |
| Q32 | Renault portal / Logan Authentique 1.0 2017 | para-choque traseiro | 477 | Páginas gerais e ofertas Renault; nenhum para-choque solicitado confirmado. |
| Q33 | Renault portal / Kwid Zen 1.0 2020 | maçaneta externa porta dianteira direita | 917 | Primeiro resultado é catálogo de lubrificantes; nenhum anúncio da maçaneta solicitado confirmado. |
| Q34 | Renault portal / Duster Dynamique 1.6 2016 | guia para-choque dianteiro esquerdo | 656 | Catálogos e ofertas gerais Renault; nenhum guia solicitado confirmado. |
