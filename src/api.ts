export type Session = { authenticated: boolean; configured: boolean }
export type RequestFailure = Error & { status?: number; code?: string; kind?: 'network' | 'http' | 'response'; method?: string; endpoint?: string; requestId?: string; elapsedMs?: number }
export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const method = (init?.method ?? 'GET').toUpperCase()
  const started = performance.now()
  // Diagnostic route only: never expose record IDs or query/contact data.
  const endpoint = url.split('?')[0].replace(/(\/(?:atendimentos|catalogos|cenarios|diagnosticos|componentes|orcamentos))\/[^/]+/g, '$1/:id')
  const failure = (message: string, kind: RequestFailure['kind'], status?: number, code?: string, requestId?: string): RequestFailure => Object.assign(new Error(message), {kind,method,endpoint,status,code,requestId,elapsedMs:Math.round(performance.now()-started)})
  let response: Response
  try { response = await fetch(url, { credentials: 'same-origin', ...init, cache: 'no-store' }) }
  catch (cause) {
    if ((cause as Error).name === 'AbortError') throw cause
    throw failure('Não foi possível comunicar com o FUNIX. Tente atualizar os dados.', 'network')
  }
  let body
  try { body = await response.json() }
  catch(cause) { if ((cause as Error).name === 'AbortError') throw cause }
  const requestId = body?.error?.requestId ?? response.headers.get('X-Request-Id') ?? undefined
  if (!response.ok) {
    throw failure(body?.error?.message || 'O FUNIX não concluiu a solicitação.', 'http', response.status, body?.error?.code, requestId)
  }
  if (!body) throw failure('O FUNIX respondeu, mas não foi possível ler uma resposta válida. Atualize os dados para conferir o resultado.', 'response', response.status, undefined, requestId)
  return body as T
}
