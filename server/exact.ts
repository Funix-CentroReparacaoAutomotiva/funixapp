// Exact decimal/rational arithmetic. No financial operation passes through Number.
const gcd = (a: bigint,b: bigint): bigint => { a=a<0n?-a:a; while(b){const r=a%b;a=b;b=r} return a || 1n }
export class Q {
  readonly n: bigint; readonly d: bigint
  constructor(n: bigint,d=1n) { if(d<=0n)throw new Error('Invalid denominator');const g=gcd(n,d);this.n=n/g;this.d=d/g }
  static from(value: string): Q {
    if(!/^\d{1,12}(?:\.\d{1,6})?$/.test(value))throw new Error('Decimal inválido: use ponto e até seis casas decimais.')
    const [whole,fraction='']=value.split('.')
    return new Q(BigInt(whole+fraction),10n**BigInt(fraction.length))
  }
  add(b: Q){return new Q(this.n*b.d+b.n*this.d,this.d*b.d)}
  sub(b: Q){return new Q(this.n*b.d-b.n*this.d,this.d*b.d)}
  mul(b: Q){return new Q(this.n*b.n,this.d*b.d)}
  div(b: Q){if(b.n<=0n)throw new Error('Divisor deve ser positivo.');return new Q(this.n*b.d,this.d*b.n)}
  cmp(b: Q){const x=this.n*b.d-b.n*this.d;return x<0n?-1:x>0n?1:0}
  abs(){return new Q(this.n<0n?-this.n:this.n,this.d)}
  floor(){return this.n>=0n?this.n/this.d:-((-this.n+this.d-1n)/this.d)}
  ceil(){return -new Q(-this.n,this.d).floor()}
  ceilUnit(){return new Q(this.mul(new Q(20n)).ceil(),20n)}
  toString(){
    let d=this.d,two=0,five=0
    while(d%2n===0n){d/=2n;two++}while(d%5n===0n){d/=5n;five++}
    if(d!==1n)throw new Error('Decimal periódico não pode ser emitido sem regra de arredondamento.')
    const places=Math.max(two,five),negative=this.n<0n
    const integer=(negative?-this.n:this.n)*(10n**BigInt(places)/this.d)
    const digits=integer.toString().padStart(places+1,'0')
    const text=places?digits.slice(0,-places)+'.'+digits.slice(-places):digits
    return (negative?'-':'')+(text.includes('.')?text.replace(/0+$/,'').replace(/\.$/,''):text)
  }
}
export const ZERO=new Q(0n)
export function sum(values: Q[]){return values.reduce((a,b)=>a.add(b),ZERO)}
