export type Session = { authenticated: boolean; configured: boolean }
export type RequestFailure = Error & { status?: number; code?: string }
export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response
  try { response = await fetch(url, { credentials: 'same-origin', ...init }) }
  catch (cause) {
    if ((cause as Error).name === 'AbortError') throw cause
    throw new Error('Não foi possível conectar. Verifique a conexão e tente novamente.')
  }
  const body = await response.json().catch(() => null)
  if (!response.ok) {
    const failure: RequestFailure = new Error(body?.error?.message || 'Não foi possível concluir a consulta.')
    failure.status = response.status; failure.code = body?.error?.code
    throw failure
  }
  if (!body) throw new Error('O serviço não retornou uma resposta válida.')
  return body as T
}
