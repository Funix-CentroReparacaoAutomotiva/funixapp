const expected = $('Preparar uma entrega ou conciliacao').item.json;
const response = $input.first()?.json ?? {};
const status = Number(response.statusCode ?? 0);
const body = readBody(response);
// Invalid/uncertain responses never advance delivery state. Preserve only a fixed error code.
const valid = status === 200 && body && typeof body === 'object' &&
  body.messageId === expected.messageId &&
  ['queued', 'leased', 'retry', 'notified', 'ignored', 'blocked'].includes(body.state);
return [{json: {
  messageId: expected.messageId,
  expectedState: expected.expectedState,
  queueState: valid ? body.state : expected.expectedState,
  lastError: valid ? (body.state === 'blocked' ? 'QUEUE_BLOCKED' : body.state === 'retry' ? 'QUEUE_RETRY' : '') :
    status >= 400 && status <= 599 ? 'QUEUE_HTTP_' + status : 'QUEUE_RESPONSE_UNCONFIRMED',
  wakeWorker: Boolean(valid && ['queued', 'leased', 'retry'].includes(body.state))
}, pairedItem: {item: 0}}];
