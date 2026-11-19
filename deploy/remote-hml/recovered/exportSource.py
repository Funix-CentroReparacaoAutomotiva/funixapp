import base64,json,os,stat
from pathlib import Path
p=Path('/var/lib/funix-hml-ops/client-export')
try:
    s=p.lstat(); assert os.geteuid()==0 and p.resolve(strict=True)==p and s.st_uid==0 and stat.S_ISDIR(s.st_mode) and stat.S_IMODE(s.st_mode)==0o700
    r={}
    for name in ('ca.crt','client.crt','client.key'):
        f=p/name;s=f.lstat();assert f.resolve(strict=True)==f and s.st_uid==0 and stat.S_ISREG(s.st_mode) and not s.st_mode&0o077 and s.st_nlink==1 and 0<s.st_size<=65536
        r[name]=base64.b64encode(f.read_bytes()).decode('ascii')
    print(json.dumps(r),flush=True)
except Exception: raise SystemExit('client credential export blocked')
