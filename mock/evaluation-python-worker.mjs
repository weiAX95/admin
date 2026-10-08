import crypto from 'node:crypto';
import { spawn } from 'node:child_process';

const pythonImage = () => process.env.EVALUATION_PYTHON_IMAGE || 'agent-eval-python:local';
const bertImage = () => process.env.EVALUATION_BERTSCORE_IMAGE || '';
const CUSTOM_PROGRAM = `import contextlib,io,json,math,sys
request=json.load(sys.stdin)
scope={}
with contextlib.redirect_stdout(io.StringIO()):
    exec(compile(request['source'],'<metric>','exec'),scope)
    function=scope.get('score')
    if not callable(function): raise ValueError('script must define score(payload)')
    result=function(request['payload'])
if result is not None and (isinstance(result,bool) or not isinstance(result,(int,float)) or not math.isfinite(result) or result<0 or result>1): raise ValueError('score must return 0..1 or None')
print(json.dumps({'score':result}))`;
const BERT_PROGRAM = `import json,sys
from bert_score import score
request=json.load(sys.stdin)
_,_,f1=score([request['output']],[request['reference']],model_type='/models/bert-base-multilingual-cased',device='cpu',verbose=False)
print(json.dumps({'score':max(0,min(1,float(f1[0])))}))`;

function execute(command,args,input,timeoutMs=30000) {
  return new Promise((resolve,reject)=>{
    const child=spawn(command,args,{stdio:['pipe','pipe','pipe']});
    let stdout='',stderr='',settled=false;
    const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);if(error)reject(error);else resolve(value);};
    const timer=setTimeout(()=>{child.kill('SIGKILL');finish(new Error(`指标沙箱超过 ${Math.round(timeoutMs/1000)} 秒时限`));},timeoutMs);
    child.on('error',error=>finish(new Error(`指标沙箱不可用：${error.message}`)));
    child.stdout.on('data',chunk=>{stdout+=chunk;if(stdout.length>1024*1024){child.kill('SIGKILL');finish(new Error('指标沙箱输出过大'));}});
    child.stderr.on('data',chunk=>{stderr+=chunk;if(stderr.length>4096)stderr=stderr.slice(-4096);});
    child.on('close',code=>{if(code!==0)return finish(new Error(`指标沙箱失败：${stderr.trim().slice(-300)||`退出码 ${code}`}`));try{finish(null,JSON.parse(stdout));}catch{finish(new Error('指标沙箱返回无效 JSON'));}});
    child.stdin.end(JSON.stringify(input));
  });
}

export async function pythonMetricAvailable(kind='custom') {
  const image=kind==='bertscore'?bertImage():pythonImage();
  if(!image)return false;
  try {await execute('docker',['image','inspect',image],null,5000);return true;} catch{return false;}
}

async function runContainer(image,program,input,timeoutMs=30000,memory='256m') {
  if(!(await pythonMetricAvailable(image===bertImage()?'bertscore':'custom')))throw new Error('指标容器镜像未就绪，请管理员安装后重试');
  const name=`admin-eval-${crypto.randomUUID()}`;
  const args=['run','--rm','--name',name,'--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--pids-limit','32','--memory',memory,'--memory-swap',memory,'--cpus','1','--user','65534:65534','--tmpfs','/tmp:rw,nosuid,noexec,size=16m','-i',image,'python','-I','-B','-c',program];
  try {return await execute('docker',args,input,timeoutMs);} finally {await execute('docker',['rm','-f',name],null,5000).catch(()=>{});}
}

export async function runPythonMetric(source,payload,timeoutMs=30000) {
  if(typeof source!=='string'||!source.trim()||source.length>20000)throw new Error('Python 指标源码须为 1–20000 字');
  const result=await runContainer(pythonImage(),CUSTOM_PROGRAM,{source,payload},timeoutMs);
  if(result.score!==null && (typeof result.score!=='number'||!Number.isFinite(result.score)||result.score<0||result.score>1))throw new Error('Python 指标结果超出 0–1');
  return result.score;
}

export async function runBertScore(output,reference,timeoutMs=120000) {
  if(typeof output!=='string'||typeof reference!=='string')return null;
  const result=await runContainer(bertImage(),BERT_PROGRAM,{output,reference},timeoutMs,'4g');
  if(typeof result.score!=='number'||!Number.isFinite(result.score)||result.score<0||result.score>1)throw new Error('BERTScore 结果超出 0–1');
  return result.score;
}
