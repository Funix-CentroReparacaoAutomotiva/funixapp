// eslint-disable-next-line no-unused-vars -- Concatenated with the receipt/ACK Code-node sources by build-plan.mjs.
function readBody(response) {
  const body = response.body;
  if (body && typeof body === 'object' && !body._readableState) return body;
  // Preserve the bounded response representation already handled by the published nodes.
  const chunks = body?._readableState?.buffer;
  const chunk = Array.isArray(chunks) ? chunks.find(x => x?.type === 'Buffer' && Array.isArray(x.data)) : null;
  if (chunk && chunk.data.length <= 8192) {
    try { return JSON.parse(String.fromCharCode(...chunk.data)); } catch { return null; }
  }
  return null;
}
