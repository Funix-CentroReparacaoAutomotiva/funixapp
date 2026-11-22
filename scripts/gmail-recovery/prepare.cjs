const row = $input.first().json;
const timestamp = String(Date.now()), rawBody = JSON.stringify({messageId: row.messageId});
return [{json: {...row, timestamp, rawBody, toSign: timestamp + '.' + rawBody}, pairedItem: {item: 0}}];
