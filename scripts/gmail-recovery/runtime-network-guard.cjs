// Applied only to the disposable lab processes through NODE_OPTIONS.
// Deny all TCP destinations except literal loopback; do not load any credentials.
const net = require('node:net');
const dns = require('node:dns');
const connect = net.Socket.prototype.connect;
const loopback = host => ['127.0.0.1', '::1', 'localhost'].includes(host);
net.Socket.prototype.connect = function (...args) {
  let options = args[0];
  if (Array.isArray(options)) options = options[0];
  const host = options && typeof options === 'object' ? options.host ?? options.hostname ?? 'localhost' :
    typeof args[1] === 'string' ? args[1] : 'localhost';
  if (!loopback(host)) throw Error('GMAIL_LAB_EGRESS_DENIED');
  return connect.apply(this, args);
};
const lookup = dns.lookup;
dns.lookup = function (host, ...args) {
  if (!loopback(host)) throw Error('GMAIL_LAB_DNS_DENIED');
  return lookup.call(this, host, ...args);
};
