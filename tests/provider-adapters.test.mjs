import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {completeWithProvider} from '../mock/provider-adapters.mjs';
import {validateModelCapabilities} from '../mock/model-capabilities.mjs';

test('provider adapters use native request formats and retain tool calls without executing them',async t=>{
  const requests=[];
  const server=http.createServer(async(req,res)=>{
    let text='';for await(const chunk of req) text+=chunk;
    requests.push({url:req.url,headers:req.headers,body:JSON.parse(text)});
    res.writeHead(200,{'Content-Type':'application/json'});
    if(req.url==='/responses') res.end(JSON.stringify({output_text:'OpenAI 文本',output:[{type:'function_call',name:'lookup',arguments:'{}'}],usage:{input_tokens:7,output_tokens:3}}));
    else if(req.url==='/chat/completions') res.end(JSON.stringify({choices:[{message:{content:'Qwen 文本',tool_calls:[{function:{name:'lookup',arguments:'{}'}}]}}],usage:{prompt_tokens:8,completion_tokens:4}}));
    else res.end(JSON.stringify({candidates:[{content:{parts:[{text:'Gemini 文本'},{functionCall:{name:'lookup',args:{}}}]}}],usageMetadata:{promptTokenCount:9,candidatesTokenCount:5}}));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const url=`http://127.0.0.1:${server.address().port}`;
  Object.assign(process.env,{OPENAI_API_BASE_URL:url,OPENAI_API_KEY:'test',QWEN_API_BASE_URL:url,DASHSCOPE_API_KEY:'test',GEMINI_API_BASE_URL:url,GEMINI_API_KEY:'test'});
  const messages=[{role:'system',content:'规则'},{role:'user',content:'提问'}];
  const toolSchema={name:'lookup',description:'只生成调用',parameters:{type:'object',properties:{}}};
  const client={query:sql=>{if(sql.includes('FROM model_connections'))return {rows:[]};throw new Error('文本无需查询媒体')}};
  const openai=await completeWithProvider(client,{provider:'openai',model:'openai-test',messages,toolSchema});
  const qwen=await completeWithProvider(client,{provider:'qwen',model:'qwen-test',messages,toolSchema});
  const gemini=await completeWithProvider(client,{provider:'gemini',model:'gemini-test',messages,toolSchema});
  assert.equal(openai.output,'OpenAI 文本');assert.equal(openai.toolCalls[0].name,'lookup');
  assert.equal(qwen.output,'Qwen 文本');assert.equal(qwen.toolCalls[0].function.name,'lookup');
  assert.equal(gemini.output,'Gemini 文本');assert.equal(gemini.toolCalls[0].name,'lookup');
  assert.equal(requests[0].body.input[1].content[0].type,'input_text');
  assert.equal(requests[1].body.messages[1].content[0].type,'text');
  assert.equal(requests[2].body.contents[0].parts[0].text,'提问');
  assert.ok(requests.every(item=>item.body.tools));
  assert.equal(requests[2].headers['x-goog-api-key'],'test');
  assert.throws(()=>validateModelCapabilities('openai',{input:['text','video'],output:['text'],tools:false}),/范围/);
});

test('provider adapter honors an already canceled request signal',async()=>{
  const controller=new AbortController();
  controller.abort();
  process.env.OPENAI_API_BASE_URL='http://127.0.0.1:9';
  process.env.OPENAI_API_KEY='test';
  const client={query:async()=>({rows:[]})};
  await assert.rejects(completeWithProvider(client,{provider:'openai',model:'test',messages:[{role:'user',content:'test'}],signal:controller.signal}),error=>error.name==='AbortError');
});
