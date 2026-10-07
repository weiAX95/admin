import crypto from 'node:crypto';
import {importPrompts} from './prompts.mjs';

const json=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
const invalid=(message,status=400)=>Object.assign(new Error(message),{status});
const maximumVersions=1000;
export const isPromptSyncPath=pathname=>pathname==='/api/prompts/sync/config'||pathname==='/api/prompts/sync/preview'||pathname==='/api/prompts/sync/confirm';

function connection(provider) {
  if(provider==='langfuse') {
    const key=process.env.PROMPT_SYNC_LANGFUSE_PUBLIC_KEY,secret=process.env.PROMPT_SYNC_LANGFUSE_SECRET_KEY;
    if(!key||!secret) return null;
    return {base:process.env.PROMPT_SYNC_LANGFUSE_BASE_URL || 'https://cloud.langfuse.com',headers:{Authorization:`Basic ${Buffer.from(`${key}:${secret}`).toString('base64')}`},identity:key};
  }
  if(provider==='langsmith') {
    const key=process.env.PROMPT_SYNC_LANGSMITH_API_KEY;
    if(!key) return null;
    return {base:process.env.PROMPT_SYNC_LANGSMITH_BASE_URL || 'https://api.smith.langchain.com',headers:{'X-API-Key':key},identity:crypto.createHash('sha256').update(key).digest('hex')};
  }
  throw invalid('不支持的同步来源');
}

function baseUrl(raw) {
  const url=new URL(raw);
  if(!['https:','http:'].includes(url.protocol)||url.username||url.password||url.search||url.hash||url.pathname!=='/'&&url.pathname!=='') throw invalid('外部 API 地址无效');
  const allowed=new Set(['cloud.langfuse.com','us.cloud.langfuse.com','jp.cloud.langfuse.com','hipaa.cloud.langfuse.com','api.smith.langchain.com','eu.api.smith.langchain.com',...(process.env.PROMPT_SYNC_ALLOWED_HOSTS || '').split(',').map(value=>value.trim()).filter(Boolean)]);
  if(!allowed.has(url.hostname) || (url.protocol!=='https:'&&!['localhost','127.0.0.1'].includes(url.hostname))) throw invalid('外部 API 主机未列入允许列表');
  return url.origin;
}

async function remote(connection,path) {
  const response=await fetch(`${baseUrl(connection.base)}${path}`,{headers:connection.headers,redirect:'error',signal:AbortSignal.timeout(15000)});
  if(!response.ok) throw invalid(`外部 API 返回 ${response.status}`,502);
  if(Number(response.headers.get('content-length')||0)>10_000_000) throw invalid('外部响应超过 10 MB',502);
  const raw=await response.text();
  if(raw.length>10_000_000) throw invalid('外部响应超过 10 MB',502);
  try{return JSON.parse(raw);}catch{throw invalid('外部 API 响应不是 JSON',502);}
}

const vars=text=>[...new Set([...text.matchAll(/\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}/g)].map(match=>match[1]))].map(name=>({name,type:'string',required:true}));
const unsupported=(name,version,reason)=>({name,versionId:String(version),status:'skipped',reason,findings:[]});

async function langfuse(connection) {
  const prompts=[],skipped=[];
  let count=0,page=1;
  while(true) {
    const listing=await remote(connection,`/api/public/v2/prompts?page=${page}&limit=100`);
    if(!Array.isArray(listing.data)||!listing.meta||!Number.isInteger(listing.meta.totalPages)) throw invalid('LangFuse 列表结构无效',502);
    for(const meta of listing.data) {
      if(!meta.name||!Array.isArray(meta.versions)) {skipped.push(unsupported(meta.name||'未知',page,'缺少名称或版本列表'));continue;}
      const versions=[];
      for(const number of [...meta.versions].sort((a,b)=>a-b)) {
        if(++count>maximumVersions) throw invalid('外部版本超过单次 1000 个上限',413);
        try {
          const value=await remote(connection,`/api/public/v2/prompts/${encodeURIComponent(meta.name)}?version=${number}&resolve=false`);
          if(value.config && Object.keys(value.config).length) {skipped.push(unsupported(meta.name,number,'版本含无法无损映射的配置'));continue;}
          let content='',messages=[],format='text';
          if(value.type==='text'&&typeof value.prompt==='string') content=value.prompt;
          else if(value.type==='chat'&&Array.isArray(value.prompt)&&value.prompt.every(item=>['system','user','assistant'].includes(item.role)&&typeof item.content==='string')) {
            format='chat';messages=value.prompt.map(item=>({role:item.role,content:item.content}));content=messages.map(item=>`${item.role}: ${item.content}`).join('\n');
          } else {skipped.push(unsupported(meta.name,number,'含无法无损映射的消息或媒体'));continue;}
          versions.push({id:`${meta.name}:${number}`,semver:`0.0.${number}`,type:'system',format,content,messages,variables:vars(content)});
        } catch(cause) {skipped.push(unsupported(meta.name,number,cause.message));}
      }
      if(versions.length) prompts.push({sourceId:meta.name,name:meta.name,tags:Array.isArray(meta.tags)?meta.tags:[],versions});
    }
    if(page>=listing.meta.totalPages) break;
    if(page>=100) throw invalid('外部分页超过单次 100 页上限',413);
    page++;
  }
  return {prompts,skipped};
}

function langsmithText(manifest) {
  if(typeof manifest?.kwargs?.template==='string' && !Object.keys(manifest.kwargs.partial_variables||{}).length) {
    const template=manifest.kwargs.template;
    if(manifest.kwargs.template_format==='mustache'||!/[{}]/.test(template)) return template;
  }
  if(typeof manifest?.template==='string'&&!/[{}]/.test(manifest.template)) return manifest.template;
  return null;
}

async function langsmith(connection) {
  const prompts=[],skipped=[];
  let offset=0,count=0,total=Infinity;
  while(offset<total) {
    const listing=await remote(connection,`/api/v1/repos?repo_type=prompt&limit=100&offset=${offset}`);
    if(!Array.isArray(listing.repos)||!Number.isInteger(listing.total)) throw invalid('LangSmith 仓库列表结构无效',502);
    total=listing.total;
    for(const repo of listing.repos) {
      if(!repo.full_name || !repo.id) {skipped.push(unsupported(repo.repo_handle||'未知',offset,'仓库缺少稳定 ID 或全名'));continue;}
      const parts=repo.full_name.split('/');
      if(parts.length!==2||parts.some(value=>!value)) {skipped.push(unsupported(repo.full_name,offset,'仓库名称无法映射'));continue;}
      const route=`/api/v1/commits/${parts.map(encodeURIComponent).join('/')}`;
      const commits=[];let next=0,commitTotal=Infinity;
      while(next<commitTotal) {
        const listing=await remote(connection,`${route}?limit=100&offset=${next}&include_stats=false`);
        if(!Array.isArray(listing.commits)||!Number.isInteger(listing.total)) throw invalid('LangSmith 提交列表结构无效',502);
        commitTotal=listing.total;commits.push(...listing.commits);next+=listing.commits.length;
        if(!listing.commits.length && next<commitTotal) throw invalid('LangSmith 分页未前进',502);
        if(next>maximumVersions) throw invalid('外部提交超过单次 1000 个上限',413);
      }
      commits.reverse();
      const versions=[];
      for(const [index,commit] of commits.entries()) {
        if(++count>maximumVersions) throw invalid('外部版本超过单次 1000 个上限',413);
        try {
          const result=await remote(connection,`${route}/${encodeURIComponent(commit.commit_hash)}`);
          const content=langsmithText(result.manifest);
          if(content===null) {skipped.push(unsupported(repo.full_name,commit.commit_hash,'提交结构无法无损映射，可能包含消息或媒体'));continue;}
          versions.push({id:commit.commit_hash,semver:`0.0.${index+1}`,type:'system',format:'text',content,variables:vars(content),createdAt:commit.created_at});
        } catch(cause) {skipped.push(unsupported(repo.full_name,commit.commit_hash,cause.message));}
      }
      if(versions.length) prompts.push({sourceId:repo.id,name:repo.full_name,tags:Array.isArray(repo.tags)?repo.tags:[],versions});
    }
    offset+=listing.repos.length;
    if(!listing.repos.length && offset<total) throw invalid('LangSmith 分页未前进',502);
    if(offset>=1000) throw invalid('外部仓库超过单次 1000 个上限',413);
  }
  return {prompts,skipped};
}

async function requestBody(req) {
  let raw='';
  for await(const chunk of req) {raw+=chunk;if(raw.length>10000) throw invalid('请求过大',413);}
  try{return JSON.parse(raw);}catch{throw invalid('请求 JSON 无效');}
}

export async function handlePromptSync(req,res,pool,lookupSession) {
  const url=new URL(req.url,'http://localhost');
  const token=/^Bearer (.+)$/.exec(req.headers.authorization || '')?.[1];
  const account=await lookupSession(token);
  if(!account) return json(res,401,{error:'请先登录'});
  if(account.role!=='admin') return json(res,403,{error:'仅管理员可同步外部提示词'});
  if(url.pathname==='/api/prompts/sync/config'&&req.method==='GET') return json(res,200,{langfuse:Boolean(connection('langfuse')),langsmith:Boolean(connection('langsmith'))});
  if(!['/api/prompts/sync/preview','/api/prompts/sync/confirm'].includes(url.pathname)||req.method!=='POST') return json(res,405,{error:'method not allowed'});
  try {
    const body=await requestBody(req),provider=body.provider;
    if(!['langfuse','langsmith'].includes(provider)) throw invalid('同步来源无效');
    const config=connection(provider);
    if(!config) throw invalid('服务端尚未配置只读凭据',409);
    const fetched=provider==='langfuse'?await langfuse(config):await langsmith(config);
    const document={schemaVersion:1,sourceKey:`${provider}:${baseUrl(config.base)}:${crypto.createHash('sha256').update(config.identity).digest('hex')}`,prompts:fetched.prompts};
    const digest=crypto.createHash('sha256').update(JSON.stringify(document)).digest('hex');
    const confirm=url.pathname.endsWith('/confirm');
    if(confirm && body.expectedDigest!==digest) throw invalid('外部提示词在预览后发生变化，请重新预览',409);
    const client=await pool.connect();
    try {
      await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(748201)');
      const result=await importPrompts(client,account,{document,confirmFindings:body.confirmFindings===true},confirm);
      if(result.status>=400||!confirm) await client.query('ROLLBACK');else await client.query('COMMIT');
      json(res,result.status,{...result.data,digest,externalSkipped:fetched.skipped});
    } catch(cause) {await client.query('ROLLBACK').catch(()=>{});throw cause;} finally {client.release();}
  } catch(cause) {json(res,cause.status||502,{error:cause.message||'外部同步失败'});}
}
