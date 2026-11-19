import os,stat
from pathlib import Path
p=Path('/var/lib/funix-hml-ops/client-export')
try:
    s=p.lstat(); assert os.geteuid()==0 and p.resolve(strict=True)==p and s.st_uid==0 and stat.S_ISDIR(s.st_mode) and stat.S_IMODE(s.st_mode)==0o700
    fs=[p/x for x in ('ca.crt','client.crt','client.key')];assert set(p.iterdir())==set(fs)
    for f in fs:
        s=f.lstat();assert f.resolve(strict=True)==f and s.st_uid==0 and stat.S_ISREG(s.st_mode) and not s.st_mode&0o077 and s.st_nlink==1
    for f in fs:f.unlink()
    p.rmdir(); print('CLIENT_EXPORT_PURGED=true',flush=True)
except Exception: raise SystemExit('client credential purge blocked')
