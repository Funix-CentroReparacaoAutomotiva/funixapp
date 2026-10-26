from pathlib import Path
import json, os, secrets, subprocess, tempfile, uuid

docker = ['docker', '--host=unix:///var/run/docker.sock']
env = os.environ.copy()
for key in ('DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH'):
    env.pop(key, None)
env['FUNIX_OPERATOR_PASSWORD'] = secrets.token_hex(24)
containers = []

def run(*args):
    return subprocess.check_output(docker + list(args), env=env, text=True).strip()

js = '''
import assert from 'node:assert/strict';
const base='http://127.0.0.1:8787',origin='https://app.funix.com.br';
for(let i=0;i<40;i++){
 try{if((await fetch(base+'/api/ready')).ok)break}catch{}
 await new Promise(resolve=>setTimeout(resolve,250));
}
assert.equal((await fetch(base+'/api/ready')).status,200);
assert.equal(process.getuid(),1000);
assert.equal(process.env.FUNIX_DATABASE_PATH,'/data/funix.sqlite');
const login=await fetch(base+'/api/session',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({password:process.env.FUNIX_OPERATOR_PASSWORD})});
assert.equal(login.status,200);
const cookie=login.headers.get('set-cookie').split(';')[0];
const headers={Cookie:cookie,Origin:origin,'Content-Type':'application/json'};
if(process.env.QA_CREATE==='1'){
 const result=await fetch(base+'/api/atendimentos',{method:'POST',headers,body:JSON.stringify({phone:'+5511999990000',name:'QA SINTÉTICO persistência PR10'})});
 assert.equal(result.status,201);
 const record=await result.json();console.log(JSON.stringify({id:record.id,phone:record.phone}));
}else{
 const result=await fetch(base+'/api/atendimentos/'+process.env.QA_EXPECTED,{headers});
 assert.equal(result.status,200);const record=await result.json();
 assert.equal(record.id,process.env.QA_EXPECTED);assert.equal(record.phone,'+5511999990000');
 const scenarios=await fetch(base+'/api/atendimentos/'+record.id+'/cenarios',{headers});
 assert.equal(scenarios.status,200);assert.equal((await scenarios.json()).scenarios.length,1);
 console.log('PASS: same Atendimento and initial scenario after container removal/recreation; UID 1000; database /data/funix.sqlite');
}
'''

try:
    with tempfile.TemporaryDirectory(prefix='funix-pr10-synthetic-') as temp:
        data=Path(temp)/'data';data.mkdir(mode=0o700);os.chown(data,1000,1000)
        def start():
            name='funix-pr10-qa-'+uuid.uuid4().hex[:10];containers.append(name)
            run('run','-d','--name',name,'--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges:true',
                '--mount',f'type=bind,source={data},target=/data',
                '--mount','type=tmpfs,target=/tmp,tmpfs-size=16777216',
                '-e','FUNIX_OPERATOR_PASSWORD','-e','FUNIX_APP_ORIGIN=https://app.funix.com.br','-e','FUNIX_DATABASE_PATH=/data/funix.sqlite','funix-api:pr10')
            return name
        first=start()
        created=json.loads(run('exec','-e','QA_CREATE=1',first,'node','--input-type=module','-e',js))
        run('stop',first);run('rm',first);containers.remove(first)
        assert (data/'funix.sqlite').is_file()
        assert ((data/'funix.sqlite').stat().st_mode & 0o777)==0o600
        second=start()
        print(run('exec','-e','QA_EXPECTED='+created['id'],second,'node','--input-type=module','-e',js))
        run('stop',second);run('rm',second);containers.remove(second)
        print('PASS: bind file retained outside both container layers, mode 0600; temporary synthetic data only; no host ports, no external network, no VPS')
finally:
    for name in containers:
        subprocess.run(docker+['rm','-f',name],env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
