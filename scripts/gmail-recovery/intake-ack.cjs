const r = $input.first()?.json ?? {}, body = readBody(r);
const claim = $('Validar concessao e excluir homologacoes').first().json;
const status = Number(r.statusCode ?? 0);
let result = 'retry', noticeId = null, errorCode = 'INTAKE_UNCONFIRMED';
if (status === 202 && body && typeof body === 'object') {
  if (body.status === 'ignored') { result = 'ignored'; errorCode = null; }
  else if (['awaiting_authorization', 'authorized', 'denied'].includes(body.status) &&
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(String(body.noticeId ?? ''))) {
    result = 'notified'; noticeId = body.noticeId; errorCode = null;
  }
} else if (status >= 400 && status < 500 && ![408, 429].includes(status)) {
  result = 'blocked'; errorCode = 'INTAKE_HTTP_' + status;
} else if (status >= 400 && status <= 599) errorCode = 'INTAKE_HTTP_' + status;
const timestamp = String(Date.now());
const rawBody = JSON.stringify({messageId: claim.messageId, leaseToken: claim.leaseToken, result, noticeId, errorCode});
return [{json: {timestamp, rawBody, toSign: timestamp + '.' + rawBody, result, messageId: claim.messageId}}];
