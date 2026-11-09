import test from 'node:test'
import assert from 'node:assert/strict'
import {loginRateLimitIdentity,parseTrustedLoginProxies} from '../login-rate-limit.ts'

test('proxy addresses are exact and opt-in, with strict configuration',()=>{
 assert.equal(parseTrustedLoginProxies(undefined).size,0)
 assert.deepEqual([...parseTrustedLoginProxies('172.20.0.5,::ffff:192.0.2.8')],['172.20.0.5','192.0.2.8'])
 for(const invalid of ['172.20.0.0/16','*','localhost','172.20.0.5,','172.20.0.5,172.20.0.5']) {
  assert.throws(()=>parseTrustedLoginProxies(invalid),/FUNIX_LOGIN_TRUSTED_PROXY_IPS/)
 }
})

test('untrusted TCP peers cannot bypass throttling via spoofed headers',()=>{
 const trusted=parseTrustedLoginProxies('172.20.0.5')
 assert.equal(loginRateLimitIdentity('198.51.100.1',{'x-forwarded-for':'203.0.113.10'},trusted),'peer:198.51.100.1')
 assert.equal(loginRateLimitIdentity('::ffff:198.51.100.1',{'x-forwarded-for':'203.0.113.11'},trusted),'peer:198.51.100.1')
 assert.equal(loginRateLimitIdentity('198.51.100.1',{},trusted),'peer:198.51.100.1')
})

test('trusted proxy uses only the closest valid forwarded address',()=>{
 const trusted=parseTrustedLoginProxies('172.20.0.5')
 assert.equal(loginRateLimitIdentity('172.20.0.5',{'x-forwarded-for':'203.0.113.1'},trusted),'client:203.0.113.1')
 assert.equal(loginRateLimitIdentity('172.20.0.5',{'x-forwarded-for':'192.0.2.88, 203.0.113.2'},trusted),'client:203.0.113.2')
 for(const forwarded of ['',', 203.0.113.2','garbage','203.0.113.1, invalid','203.0.113.1:8080']) {
  assert.equal(loginRateLimitIdentity('172.20.0.5',{'x-forwarded-for':forwarded},trusted),'peer:172.20.0.5')
 }
 assert.equal(loginRateLimitIdentity('172.20.0.5',{'x-forwarded-for':['203.0.113.1','203.0.113.2']},trusted),'peer:172.20.0.5')
})
