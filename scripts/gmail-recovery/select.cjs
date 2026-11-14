// Runs in the existing feeder Code node. Ledger metadata only; no Gmail reads.
const CUTOVER_UTC = '2026-11-14T05:48:43.000Z';
const excluded = new Set(['1a1d2efa0bf0b85d', 'd3c15a7e2026111301', '1a1d87af83b6c00a']);
const wanted = $('Trava de publicacao (OFF)').first().json.eventMessageId;
const pending = new Set(['received', 'queued', 'leased', 'retry']);
const timestampOf = value => Number.isFinite(Date.parse(value)) ? Date.parse(value) : 0;
const candidates = $input.all().map((item, index) => ({row: item.json, index})).filter(({row}) =>
  /^[a-f0-9]{15,25}$/i.test(String(row.message_id ?? '')) &&
  row.source === 'gmail' && pending.has(row.state) &&
  timestampOf(row.first_seen_at) >= Date.parse(CUTOVER_UTC) &&
  !excluded.has(String(row.message_id).toLowerCase()) &&
  (!wanted || String(row.message_id).toLowerCase() === wanted)
);
// Check least recently inspected first: leased/retrying messages cannot starve new work.
candidates.sort((a, b) => timestampOf(a.row.last_checked_at) - timestampOf(b.row.last_checked_at) ||
  timestampOf(a.row.first_seen_at) - timestampOf(b.row.first_seen_at) || Number(a.row.id) - Number(b.row.id));
const seen = new Set(), out = [];
for (const {row, index} of candidates) {
  const messageId = String(row.message_id).toLowerCase();
  if (seen.has(messageId)) continue;
  seen.add(messageId);
  out.push({json: {messageId, expectedState: row.state, action: row.state === 'received' ? 'enqueue' : 'status'}, pairedItem: {item: index}});
  if (out.length === 25) break;
}
return out;
