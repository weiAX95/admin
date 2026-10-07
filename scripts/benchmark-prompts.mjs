import { performance } from 'node:perf_hooks';
import { createPgTestServer } from '../tests/pg-helper.mjs';

const cleanups=[];
const api=await createPgTestServer({after:fn=>cleanups.push(fn)});
try {
  await api.client.query(`INSERT INTO prompt_library(id,name,tags,owner_id)
    SELECT 'bench-p-'||n,CASE WHEN n%100=0 THEN 'Agent 检索 '||n ELSE '学习提示 '||n END,
    ARRAY['学习','实验','提示'], 'admin' FROM generate_series(1,10000) n`);
  await api.client.query(`INSERT INTO prompt_library_versions(id,prompt_id,version,semver,content)
    SELECT 'bench-v-'||n||'-'||v,'bench-p-'||n,v,'0.0.'||v,
      CASE WHEN n%100=0 THEN 'Agent 检索正文 '||n ELSE '一般正文 '||n END
    FROM generate_series(1,10000) n CROSS JOIN generate_series(1,3) v`);
  const login=await fetch(`${api.base}/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'admin',password:'admin123'})});
  const token=(await login.json()).token;
  const timings=[];
  for(let index=0;index<35;index++) {
    const started=performance.now();
    const result=await fetch(`${api.base}/prompts/search?keyword=Agent`,{headers:{Authorization:`Bearer ${token}`}});
    if (!result.ok) throw new Error(`search HTTP ${result.status}`);
    await result.json();
    if(index>=5) timings.push(performance.now()-started);
  }
  timings.sort((a,b)=>a-b);
  console.log(JSON.stringify({prompts:10000,versions:30000,tagsPerPrompt:3,queries:30,p50Ms:timings[14],p95Ms:timings[28],maxMs:timings[29],query:'latest name/content/tags Agent',host:'local PostgreSQL + HTTP'}));
  const regexTimings=[];
  for(let index=0;index<30;index++) {
    const started=performance.now();
    const result=await fetch(`${api.base}/prompts/search?keyword=Agent&regex=true`,{headers:{Authorization:`Bearer ${token}`}});
    if (!result.ok) throw new Error(`regex HTTP ${result.status}`);
    await result.json();regexTimings.push(performance.now()-started);
  }
  regexTimings.sort((a,b)=>a-b);
  const invalid=await fetch(`${api.base}/prompts/search?keyword=${encodeURIComponent('(a+)+$')}&regex=true`,{headers:{Authorization:`Bearer ${token}`}});
  console.log(JSON.stringify({regexP95Ms:regexTimings[28],regexMaxMs:regexTimings[29],invalidRegexStatus:invalid.status,regexTimeoutMs:150}));
} finally {for (const cleanup of cleanups.reverse()) await cleanup();}
