import fs from 'node:fs/promises';
import {promptMediaPath} from './prompt-media.mjs';

const trim=url=>url.replace(/\/$/,'');
const base={
  legacy:()=>trim(process.env.MODEL_API_BASE_URL || ''),
  openai:()=>trim(process.env.OPENAI_API_BASE_URL || 'https://api.openai.com/v1'),
  qwen:()=>trim(process.env.QWEN_API_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1'),
  gemini:()=>trim(process.env.GEMINI_API_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta'),
};
const secret={legacy:()=>process.env.MODEL_API_KEY,openai:()=>process.env.OPENAI_API_KEY,qwen:()=>process.env.DASHSCOPE_API_KEY,gemini:()=>process.env.GEMINI_API_KEY};

async function resolved(messages,client) {
  const ids=[...new Set(messages.flatMap(message=>(message.parts || []).filter(part=>part.type!=='text').map(part=>part.assetId)))];
  const rows=ids.length?(await client.query('SELECT id,mime_type,kind FROM prompt_media_assets WHERE id=ANY($1)',[ids])).rows:[];
  if(rows.length!==ids.length) throw new Error('运行媒体附件不存在');
  const media=new Map();
  for(const row of rows) {
    const bytes=await fs.readFile(promptMediaPath(row.id));
    if(bytes.length>20*1024*1024) throw new Error('媒体超过供应商内联请求上限');
    media.set(row.id,{mime:row.mime_type,kind:row.kind,base64:bytes.toString('base64')});
  }
  return messages.map(message=>({role:message.role,parts:(message.parts || [{type:'text',text:message.content || ''}]).map(part=>part.type==='text'?part:{...part,media:media.get(part.assetId)})}));
}

function functionSchema(schema) {
  if(!schema) return null;
  if(typeof schema.name!=='string' || !/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(schema.name) || !schema.parameters || typeof schema.parameters!=='object') throw new Error('工具 schema 需要 name 和 parameters');
  return {name:schema.name,description:String(schema.description || ''),parameters:schema.parameters};
}

function build(provider,model,messages,parameters,tool,outputKind='text') {
  if(provider==='legacy') {
    if(messages.some(message=>message.parts.some(part=>part.type!=='text'))) throw new Error('兼容模式只支持文本');
    return {url:`${base.legacy()}/chat/completions`,body:{model,messages:messages.map(message=>({role:message.role,content:message.parts.map(part=>part.text).join('')})),...parameters}};
  }
  if(provider==='qwen') {
    const content=messages.map(message=>({role:message.role,content:message.parts.map(part=>{
      if(part.type==='text') return {type:'text',text:part.text};
      const data=`data:${part.media.mime};base64,${part.media.base64}`;
      if(part.type==='image') return {type:'image_url',image_url:{url:data}};
      if(part.type==='audio') return {type:'input_audio',input_audio:{data,format:part.media.mime.split('/')[1]}};
      return {type:'video_url',video_url:{url:data,fps:2}};
    })}));
    return {url:`${base.qwen()}/chat/completions`,body:{model,messages:content,...parameters,...(tool?{tools:[{type:'function',function:tool}]}:{})}};
  }
  if(provider==='openai') {
    if(messages.some(message=>message.parts.some(part=>part.type==='video'))) throw new Error('OpenAI 当前适配器不支持视频输入');
    const input=messages.map(message=>({role:message.role,content:message.parts.map(part=>{
      if(part.type==='text') return {type:'input_text',text:part.text};
      if(part.type==='image') return {type:'input_image',image_url:`data:${part.media.mime};base64,${part.media.base64}`};
      if(!['audio/wav','audio/mpeg'].includes(part.media.mime)) throw new Error('OpenAI 音频输入仅支持 WAV 或 MP3');
      return {type:'input_audio',input_audio:{data:part.media.base64,format:part.media.mime==='audio/wav'?'wav':'mp3'}};
    })}));
    return {url:`${base.openai()}/responses`,body:{model,input,...(parameters.max_tokens?{max_output_tokens:parameters.max_tokens}:{}),...(tool?{tools:[{type:'function',...tool}]}:{})}};
  }
  if(provider==='gemini') {
    const system=messages.filter(message=>message.role==='system').flatMap(message=>message.parts.map(part=>part.type==='text'?{text:part.text}:{inlineData:{mimeType:part.media.mime,data:part.media.base64}}));
    const contents=messages.filter(message=>message.role!=='system').map(message=>({role:message.role==='assistant'?'model':'user',parts:message.parts.map(part=>part.type==='text'?{text:part.text}:{inlineData:{mimeType:part.media.mime,data:part.media.base64}})}));
    return {url:`${base.gemini()}/models/${encodeURIComponent(model)}:generateContent`,body:{contents,systemInstruction:system.length?{parts:system}:undefined,generationConfig:{temperature:parameters.temperature,topP:parameters.top_p,maxOutputTokens:parameters.max_tokens,stopSequences:parameters.stop,...(outputKind==='image'?{responseModalities:['IMAGE']}:{})},...(tool?{tools:[{functionDeclarations:[tool]}]}:{})}};
  }
  throw new Error('未知模型供应商');
}

function parsed(provider,result,outputKind='text') {
  if(provider==='legacy'||provider==='qwen') {
    const message=result.choices?.[0]?.message;
    const output=typeof message?.content==='string'?message.content:Array.isArray(message?.content)?message.content.filter(part=>part.type==='text').map(part=>part.text).join('\n'):'';
    const toolCalls=message?.tool_calls || [];
    if(!output && !toolCalls.length) throw new Error('模型响应缺少输出');
    return {output,toolCalls,promptTokens:result.usage?.prompt_tokens,completionTokens:result.usage?.completion_tokens,outputParts:[]};
  }
  if(provider==='openai') {
    const outputParts=(result.output || []).flatMap(item=>item.content || []).filter(part=>part.type==='output_text');
    const output=result.output_text || outputParts.filter(part=>part.type==='output_text').map(part=>part.text).join('\n');
    const toolCalls=(result.output || []).filter(item=>item.type==='function_call');
    if(!output && !toolCalls.length && !outputParts.length) throw new Error('模型响应缺少输出');
    return {output:output || '',toolCalls,promptTokens:result.usage?.input_tokens,completionTokens:result.usage?.output_tokens,outputParts};
  }
  const parts=result.candidates?.[0]?.content?.parts || [];
  const output=parts.filter(part=>typeof part.text==='string').map(part=>part.text).join('\n');
  const toolCalls=parts.filter(part=>part.functionCall).map(part=>part.functionCall);
  const outputParts=parts.filter(part=>part.inlineData).map(part=>({type:'image',mimeType:part.inlineData.mimeType || part.inlineData.mime_type,data:part.inlineData.data}));
  if(outputKind==='image' && (!outputParts.length || outputParts.length>4 || outputParts.some(part=>!part.mimeType?.startsWith('image/')))) throw new Error('图片输出缺失、格式无效或超过 4 张');
  if(outputKind==='text'&&outputParts.length) throw new Error('文本模型意外返回媒体输出，请检查能力声明');
  if(!output && !toolCalls.length && !outputParts.length) throw new Error('模型响应缺少输出');
  return {output,toolCalls,outputParts,promptTokens:result.usageMetadata?.promptTokenCount,completionTokens:result.usageMetadata?.candidatesTokenCount};
}

export async function completeWithProvider(client,{provider='legacy',model,messages,parameters={},toolSchema=null,outputKind='text'}) {
  const key=secret[provider]?.();
  if(!key) throw new Error(`${provider} 凭据未配置`);
  const media=await resolved(messages,client);
  if(outputKind!=='text' && !(provider==='gemini'&&outputKind==='image')) throw new Error('当前供应商适配器不支持所选输出类型');
  const request=build(provider,model,media,parameters,functionSchema(toolSchema),outputKind);
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),120000);
  try {
    const headers={'Content-Type':'application/json',...(provider==='gemini'?{'x-goog-api-key':key}:{Authorization:`Bearer ${key}`})};
    const response=await fetch(request.url,{method:'POST',headers,body:JSON.stringify(request.body),signal:controller.signal});
    if(!response.ok) throw new Error(`${provider} HTTP ${response.status}: ${(await response.text()).slice(0,300)}`);
    const value=parsed(provider,await response.json(),outputKind);
    if(!Number.isInteger(value.promptTokens)||!Number.isInteger(value.completionTokens)) throw new Error('模型响应缺少 token 用量');
    return value;
  } finally {clearTimeout(timeout);}
}
