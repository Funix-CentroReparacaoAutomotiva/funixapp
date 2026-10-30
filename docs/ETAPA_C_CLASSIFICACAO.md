# Etapa C — classificação funcional do catálogo

Projeção de navegação de `src/piece-navigation.ts`, derivada dos códigos reais de `server/data/hierarquia-v2.json`. A hierarquia original, os IDs `v2:<código>`, os vínculos e os códigos não foram alterados. Não há novo catálogo ou migração. Cada código aparece uma vez na projeção funcional; repetições geográficas permanecem na V2.

A regra usa a família estruturada do código (antes de `__`), sem decidir lados por nomes. Os lados usam `CatalogItem.side` e `HierarchyNode.lado`. Cadastros posteriores também vêm da mesma consulta de catálogo; famílias não reconhecidas ficam em Outros, sem diferenciação de origem/status. Inativos ou sem identificação utilizável não participam da contagem/seleção.

## Cobertura

| Grupo | Códigos únicos |
| --- | ---: |
| Lataria | 20 |
| Estrutura | 29 |
| Vidros | 10 |
| Acessórios | 81 |
| Interior | 9 |
| Outros | 14 |
| **Total** | **163** |

## Grupo residual e decisões abertas

São 14 códigos: rodas (4) e pinças de freio (4), para as quais os grupos solicitados não definem uma categoria mecânica; alojamentos da portinhola (2) e soleiras (2), sem distinção segura entre estrutura e acabamento; teto solar e teto panorâmico (2), que representam conjuntos e não necessariamente somente vidro. Não presumimos material ou tipo construtivo. Isso não bloqueia sua utilização: continuam localizáveis por busca, pelo grupo Outros e nas regiões originais do mapa.

Painéis internos e revestimentos ficam em Interior; molduras externas, iluminação e seus alojamentos ficam em Acessórios. O vidro do teto fica em Vidros, a chapa do teto em Lataria. Essas são classificações de navegação, sem efeito sobre elegibilidade, preço ou regras comerciais.

## Correspondência integral

| Código original | Nome da V2 | Grupo |
| --- | --- | --- |
| `acabamentos_plasticos_dianteiros` | Acabamentos plásticos dianteiros | Acessórios |
| `acabamentos_plasticos_laterais__motorista` | Acabamentos plásticos laterais · Motorista | Acessórios |
| `acabamentos_plasticos_laterais__passageiro` | Acabamentos plásticos laterais · Passageiro | Acessórios |
| `acabamentos_plasticos_teto` | Acabamentos plásticos do teto | Acessórios |
| `acabamentos_plasticos_traseiros` | Acabamentos plásticos traseiros | Acessórios |
| `adesivos_dianteiros` | Adesivos dianteiros | Acessórios |
| `adesivos_laterais__motorista` | Adesivos laterais · Motorista | Acessórios |
| `adesivos_laterais__passageiro` | Adesivos laterais · Passageiro | Acessórios |
| `adesivos_porta_malas` | Adesivos do porta-malas | Acessórios |
| `adesivos_teto` | Adesivos do teto | Acessórios |
| `adesivos_traseiros` | Adesivos traseiros | Acessórios |
| `aerofolio` | Aerofólio | Acessórios |
| `alojamento_farol__motorista` | Alojamento do farol · Motorista | Acessórios |
| `alojamento_farol__passageiro` | Alojamento do farol · Passageiro | Acessórios |
| `alojamento_lanterna_traseira__motorista` | Alojamento da lanterna · Motorista | Acessórios |
| `alojamento_lanterna_traseira__passageiro` | Alojamento da lanterna · Passageiro | Acessórios |
| `antena` | Antena | Acessórios |
| `bagageiro` | Bagageiro | Acessórios |
| `churrasqueira` | Churrasqueira (base do para-brisa) | Acessórios |
| `defletor_inferior_dianteiro` | Defletor inferior dianteiro | Acessórios |
| `defletor_inferior_traseiro` | Defletor inferior traseiro | Acessórios |
| `difusor_dianteiro` | Difusor dianteiro | Acessórios |
| `difusor_traseiro` | Difusor traseiro | Acessórios |
| `farol__motorista` | Farol · Motorista | Acessórios |
| `farol__passageiro` | Farol · Passageiro | Acessórios |
| `farol_milha__motorista` | Farol de milha · Motorista | Acessórios |
| `farol_milha__passageiro` | Farol de milha · Passageiro | Acessórios |
| `friso_porta_dianteira__motorista` | Friso dianteiro · Motorista | Acessórios |
| `friso_porta_dianteira__passageiro` | Friso dianteiro · Passageiro | Acessórios |
| `friso_porta_traseira__motorista` | Friso traseiro · Motorista | Acessórios |
| `friso_porta_traseira__passageiro` | Friso traseiro · Passageiro | Acessórios |
| `frisos_dianteiros` | Frisos dianteiros | Acessórios |
| `frisos_laterais__motorista` | Frisos laterais (geral) · Motorista | Acessórios |
| `frisos_laterais__passageiro` | Frisos laterais (geral) · Passageiro | Acessórios |
| `frisos_traseiros` | Frisos traseiros | Acessórios |
| `grade_dianteira` | Grade dianteira | Acessórios |
| `grade_inferior__motorista` | Grade inferior · Motorista | Acessórios |
| `grade_inferior__passageiro` | Grade inferior · Passageiro | Acessórios |
| `grade_inferior_central` | Grade inferior central / inteiriça | Acessórios |
| `grade_lateral__motorista` | Grade lateral · Motorista | Acessórios |
| `grade_lateral__passageiro` | Grade lateral · Passageiro | Acessórios |
| `grade_traseira` | Grade traseira | Acessórios |
| `lampada_luz_placa` | Lâmpada da luz de placa | Acessórios |
| `lanterna_central` | Lanterna central | Acessórios |
| `lanterna_re__motorista` | Lanterna de ré · Motorista | Acessórios |
| `lanterna_re__passageiro` | Lanterna de ré · Passageiro | Acessórios |
| `lanterna_traseira__motorista` | Lanterna traseira · Motorista | Acessórios |
| `lanterna_traseira__passageiro` | Lanterna traseira · Passageiro | Acessórios |
| `luz_placa` | Luz de placa | Acessórios |
| `macaneta_dianteira__motorista` | Maçaneta dianteira · Motorista | Acessórios |
| `macaneta_dianteira__passageiro` | Maçaneta dianteira · Passageiro | Acessórios |
| `macaneta_traseira__motorista` | Maçaneta traseira · Motorista | Acessórios |
| `macaneta_traseira__passageiro` | Maçaneta traseira · Passageiro | Acessórios |
| `moldura_dianteira_generica` | Moldura dianteira (genérica) | Acessórios |
| `moldura_farol_milha__motorista` | Moldura do farol de milha · Motorista | Acessórios |
| `moldura_farol_milha__passageiro` | Moldura do farol de milha · Passageiro | Acessórios |
| `moldura_lateral__motorista` | Moldura lateral (geral) · Motorista | Acessórios |
| `moldura_lateral__passageiro` | Moldura lateral (geral) · Passageiro | Acessórios |
| `moldura_porta_dianteira__motorista` | Moldura dianteira · Motorista | Acessórios |
| `moldura_porta_dianteira__passageiro` | Moldura dianteira · Passageiro | Acessórios |
| `moldura_porta_traseira__motorista` | Moldura traseira · Motorista | Acessórios |
| `moldura_porta_traseira__passageiro` | Moldura traseira · Passageiro | Acessórios |
| `moldura_traseira_generica` | Moldura traseira (genérica) | Acessórios |
| `para_barro_dianteiro__motorista` | Para-barro dianteiro · Motorista | Acessórios |
| `para_barro_dianteiro__passageiro` | Para-barro dianteiro · Passageiro | Acessórios |
| `para_barro_traseiro__motorista` | Para-barro traseiro · Motorista | Acessórios |
| `para_barro_traseiro__passageiro` | Para-barro traseiro · Passageiro | Acessórios |
| `rack_lateral__motorista` | Rack lateral · Motorista | Acessórios |
| `rack_lateral__passageiro` | Rack lateral · Passageiro | Acessórios |
| `rack_teto__motorista` | Rack de teto · Motorista | Acessórios |
| `rack_teto__passageiro` | Rack de teto · Passageiro | Acessórios |
| `retrovisor__motorista` | Retrovisor · Motorista | Acessórios |
| `retrovisor__passageiro` | Retrovisor · Passageiro | Acessórios |
| `sensor_estacionamento_dianteiro__motorista` | Sensor de estacionamento dianteiro · Motorista | Acessórios |
| `sensor_estacionamento_dianteiro__passageiro` | Sensor de estacionamento dianteiro · Passageiro | Acessórios |
| `sensor_estacionamento_traseiro__motorista` | Sensor de estacionamento traseiro · Motorista | Acessórios |
| `sensor_estacionamento_traseiro__passageiro` | Sensor de estacionamento traseiro · Passageiro | Acessórios |
| `spoiler_dianteiro` | Spoiler dianteiro | Acessórios |
| `spoiler_lateral__motorista` | Spoiler lateral · Motorista | Acessórios |
| `spoiler_lateral__passageiro` | Spoiler lateral · Passageiro | Acessórios |
| `spoiler_traseiro` | Spoiler traseiro | Acessórios |
| `alma_para_choque_dianteiro` | Alma do para-choque dianteiro | Estrutura |
| `alma_para_choque_traseiro` | Alma do para-choque traseiro | Estrutura |
| `assoalho_porta_malas` | Assoalho do porta-malas | Estrutura |
| `bojo_estepe` | Bojo / caixa do estepe | Estrutura |
| `caixa_de_ar__motorista` | Caixa de ar · Motorista | Estrutura |
| `caixa_de_ar__passageiro` | Caixa de ar · Passageiro | Estrutura |
| `caixa_roda_dianteira__motorista` | Caixa de roda dianteira · Motorista | Estrutura |
| `caixa_roda_dianteira__passageiro` | Caixa de roda dianteira · Passageiro | Estrutura |
| `caixa_roda_generica__motorista` | Caixa de roda (sem eixo) · Motorista | Estrutura |
| `caixa_roda_generica__passageiro` | Caixa de roda (sem eixo) · Passageiro | Estrutura |
| `caixa_roda_traseira__motorista` | Caixa de roda traseira · Motorista | Estrutura |
| `caixa_roda_traseira__passageiro` | Caixa de roda traseira · Passageiro | Estrutura |
| `cofre_motor_dianteiro` | Cofre do motor dianteiro | Estrutura |
| `cofre_motor_traseiro` | Cofre do motor traseiro | Estrutura |
| `coluna_a__motorista` | Coluna A — dianteira · Motorista | Estrutura |
| `coluna_a__passageiro` | Coluna A — dianteira · Passageiro | Estrutura |
| `coluna_b__motorista` | Coluna B — central · Motorista | Estrutura |
| `coluna_b__passageiro` | Coluna B — central · Passageiro | Estrutura |
| `coluna_c__motorista` | Coluna C — traseira · Motorista | Estrutura |
| `coluna_c__passageiro` | Coluna C — traseira · Passageiro | Estrutura |
| `coluna_generica__motorista` | Coluna (genérica) · Motorista | Estrutura |
| `coluna_generica__passageiro` | Coluna (genérica) · Passageiro | Estrutura |
| `longarina_dianteira__motorista` | Longarina dianteira · Motorista | Estrutura |
| `longarina_dianteira__passageiro` | Longarina dianteira · Passageiro | Estrutura |
| `longarina_traseira__motorista` | Longarina traseira · Motorista | Estrutura |
| `longarina_traseira__passageiro` | Longarina traseira · Passageiro | Estrutura |
| `painel_dianteiro` | Painel dianteiro | Estrutura |
| `painel_traseiro` | Painel traseiro | Estrutura |
| `travessa_do_radiador` | Travessa do radiador | Estrutura |
| `acabamentos_porta_malas` | Acabamentos plásticos do porta-malas | Interior |
| `interno_porta_dianteira__motorista` | Parte interna da porta dianteira · Motorista | Interior |
| `interno_porta_dianteira__passageiro` | Parte interna da porta dianteira · Passageiro | Interior |
| `interno_porta_malas` | Interno do porta-malas | Interior |
| `interno_porta_traseira__motorista` | Parte interna da porta traseira · Motorista | Interior |
| `interno_porta_traseira__passageiro` | Parte interna da porta traseira · Passageiro | Interior |
| `moldura_porta_malas` | Molduras do porta-malas | Interior |
| `painel_lateral_interno__motorista` | Painel lateral interno · Motorista | Interior |
| `painel_lateral_interno__passageiro` | Painel lateral interno · Passageiro | Interior |
| `capo` | Capô | Lataria |
| `lateral_traseira__motorista` | Lateral traseira · Motorista | Lataria |
| `lateral_traseira__passageiro` | Lateral traseira · Passageiro | Lataria |
| `para_choque_dianteiro` | Para-choque dianteiro | Lataria |
| `para_choque_traseiro` | Para-choque traseiro | Lataria |
| `para_lama_dianteiro__motorista` | Para-lama · Motorista | Lataria |
| `para_lama_dianteiro__passageiro` | Para-lama · Passageiro | Lataria |
| `ponteira_para_choque_traseiro__motorista` | Ponteira do para-choque traseiro · Motorista | Lataria |
| `ponteira_para_choque_traseiro__passageiro` | Ponteira do para-choque traseiro · Passageiro | Lataria |
| `porta_carga_lateral__motorista` | Porta de carga lateral · Motorista | Lataria |
| `porta_carga_lateral__passageiro` | Porta de carga lateral · Passageiro | Lataria |
| `porta_carga_traseira` | Porta de carga traseira | Lataria |
| `porta_dianteira__motorista` | Porta dianteira · Motorista | Lataria |
| `porta_dianteira__passageiro` | Porta dianteira · Passageiro | Lataria |
| `porta_traseira__motorista` | Porta traseira · Motorista | Lataria |
| `porta_traseira__passageiro` | Porta traseira · Passageiro | Lataria |
| `portinhola_combustivel__motorista` | Portinhola de combustível · Motorista | Lataria |
| `portinhola_combustivel__passageiro` | Portinhola de combustível · Passageiro | Lataria |
| `tampa_porta_malas` | Tampa do porta-malas | Lataria |
| `teto_chapa` | Teto | Lataria |
| `alojamento_portinhola_combustivel__motorista` | Alojamento da portinhola · Motorista | Outros |
| `alojamento_portinhola_combustivel__passageiro` | Alojamento da portinhola · Passageiro | Outros |
| `pinca_freio_dianteira__motorista` | Pinça de freio dianteira · Motorista | Outros |
| `pinca_freio_dianteira__passageiro` | Pinça de freio dianteira · Passageiro | Outros |
| `pinca_freio_traseira__motorista` | Pinça de freio traseira · Motorista | Outros |
| `pinca_freio_traseira__passageiro` | Pinça de freio traseira · Passageiro | Outros |
| `roda_dianteira__motorista` | Roda dianteira · Motorista | Outros |
| `roda_dianteira__passageiro` | Roda dianteira · Passageiro | Outros |
| `roda_traseira__motorista` | Roda traseira · Motorista | Outros |
| `roda_traseira__passageiro` | Roda traseira · Passageiro | Outros |
| `soleira__motorista` | Soleira · Motorista | Outros |
| `soleira__passageiro` | Soleira · Passageiro | Outros |
| `teto_panoramico` | Teto panorâmico | Outros |
| `teto_solar` | Teto solar | Outros |
| `para_brisa` | Para-brisa | Vidros |
| `vidro_dianteiro_outro` | Vidro dianteiro (outro) | Vidros |
| `vidro_panoramico` | Vidro panorâmico | Vidros |
| `vidro_porta_dianteira__motorista` | Vidro da porta dianteira · Motorista | Vidros |
| `vidro_porta_dianteira__passageiro` | Vidro da porta dianteira · Passageiro | Vidros |
| `vidro_porta_traseira__motorista` | Vidro da porta traseira · Motorista | Vidros |
| `vidro_porta_traseira__passageiro` | Vidro da porta traseira · Passageiro | Vidros |
| `vidro_teto` | Vidro do teto (não especificado) | Vidros |
| `vidro_teto_solar` | Vidro do teto solar | Vidros |
| `vidro_traseiro` | Vidro traseiro | Vidros |

Para conferir a projeção automaticamente: `node --test server/tests/piece-navigation.test.ts`. A classificação é calculada sobre os itens do catálogo em execução; esta tabela registra a cobertura da V2 na base aprovada, não alimenta o aplicativo.
