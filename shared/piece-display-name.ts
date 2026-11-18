/** #165 — presentation aliases for four EXISTING V2 piece identities.
 * The underlying catalog name, code, ID, history, hierarchy and map geometry
 * remain unchanged. Only the exact original V2 labels are normalized.
 * Operator-renamed pieces are never silently relabelled.
 */
const legacyMolduras:Readonly<Record<string,readonly [string,string]>>={
  moldura_porta_dianteira__motorista:['Moldura dianteira · Motorista','Moldura da porta dianteira · Motorista'],
  moldura_porta_dianteira__passageiro:['Moldura dianteira · Passageiro','Moldura da porta dianteira · Passageiro'],
  moldura_porta_traseira__motorista:['Moldura traseira · Motorista','Moldura da porta traseira · Motorista'],
  moldura_porta_traseira__passageiro:['Moldura traseira · Passageiro','Moldura da porta traseira · Passageiro']
}

export function pieceDisplayName(item:{code:string|null;name:string}):string{
  const known=item.code===null?undefined:legacyMolduras[item.code]
  return known&&item.name===known[0]?known[1]:item.name
}
