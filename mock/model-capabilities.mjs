const defaults={input:['text'],output:['text'],tools:false};
const allowed={legacy:{input:['text'],output:['text'],tools:false},openai:{input:['text','image','audio'],output:['text'],tools:true},qwen:{input:['text','image','audio','video'],output:['text'],tools:true},gemini:{input:['text','image','audio','video'],output:['text','image','audio'],tools:true}};
const priceKeys=['imageInputUsdEach','audioInputUsdPerSecond','videoInputUsdPerSecond','imageOutputUsdEach','audioOutputUsdPerSecond'];

export function providerConfigured(provider) {
  if(provider==='legacy') return Boolean(process.env.MODEL_API_BASE_URL&&process.env.MODEL_API_KEY);
  if(provider==='openai') return Boolean(process.env.OPENAI_API_KEY);
  if(provider==='qwen') return Boolean(process.env.DASHSCOPE_API_KEY);
  if(provider==='gemini') return Boolean(process.env.GEMINI_API_KEY);
  return false;
}

export function validateModelCapabilities(provider,capabilities=defaults,pricing={}) {
  const support=allowed[provider];
  if(!support) throw new Error('供应商无效');
  if(!capabilities || !Array.isArray(capabilities.input) || !Array.isArray(capabilities.output) || !capabilities.input.includes('text') || !capabilities.output.length || capabilities.input.some(kind=>!support.input.includes(kind)) || capabilities.output.some(kind=>!support.output.includes(kind)) || typeof capabilities.tools!=='boolean' || capabilities.tools&&!support.tools) throw new Error('模型能力声明超出当前适配器范围');
  if(!pricing || typeof pricing!=='object' || Array.isArray(pricing) || Object.entries(pricing).some(([key,value])=>!priceKeys.includes(key) || typeof value!=='number' || !Number.isFinite(value) || value<0)) throw new Error('媒体价格配置无效');
  return {provider,capabilities:{input:[...new Set(capabilities.input)],output:[...new Set(capabilities.output)],tools:capabilities.tools},mediaPricing:pricing};
}

export function requiredMedia(messages) {
  return [...new Set(messages.flatMap(message=>(message.parts || []).filter(part=>part.type!=='text').map(part=>part.assetId)))];
}

export async function preflightMedia(client,messages,model,toolSchema=null) {
  const capabilities=model.capabilities || defaults;
  if(toolSchema && !capabilities.tools) throw new Error(`${model.display_name} 不支持工具 schema`);
  const parts=messages.flatMap(message=>message.parts || []);
  for(const part of parts) if(!capabilities.input.includes(part.type)) throw new Error(`${model.display_name} 不支持 ${part.type} 输入`);
  const ids=requiredMedia(messages);
  if(!ids.length) return {imageCount:0,audioSeconds:0,videoSeconds:0};
  const rows=(await client.query('SELECT id,kind,byte_size,duration_seconds FROM prompt_media_assets WHERE id=ANY($1)',[ids])).rows;
  if(rows.length!==ids.length) throw new Error('部分媒体附件已丢失');
  if(model.provider!=='gemini' && rows.some(row=>Number(row.byte_size)>20*1024*1024)) throw new Error('当前供应商内联媒体请求限制为每件 20 MB，请选择更小的附件');
  const usage={imageCount:0,audioSeconds:0,videoSeconds:0};
  for(const part of parts) if(part.type!=='text') {
    const record=rows.find(row=>row.id===part.assetId);
    if(record.kind!==part.type) throw new Error('媒体附件类型不匹配');
    if(part.type==='image') usage.imageCount++;
    if(part.type==='audio') usage.audioSeconds+=Number(record.duration_seconds);
    if(part.type==='video') usage.videoSeconds+=Number(record.duration_seconds);
  }
  const pricing=model.media_pricing || {};
  if((usage.imageCount && pricing.imageInputUsdEach===undefined) || (usage.audioSeconds && pricing.audioInputUsdPerSecond===undefined) || (usage.videoSeconds && pricing.videoInputUsdPerSecond===undefined)) throw new Error(`${model.display_name} 尚未配置本次媒体输入的单价`);
  return usage;
}

export function preflightOutput(model,kind='text') {
  if(!model.capabilities?.output?.includes(kind)) throw new Error(`${model.display_name} 不支持 ${kind} 输出`);
  if(kind==='image' && model.media_pricing?.imageOutputUsdEach===undefined) throw new Error(`${model.display_name} 尚未配置图片输出单价`);
  if(kind==='audio' && model.media_pricing?.audioOutputUsdPerSecond===undefined) throw new Error(`${model.display_name} 尚未配置音频输出单价`);
  return kind==='image' ? 4*Number(model.media_pricing.imageOutputUsdEach) : kind==='audio' ? 600*Number(model.media_pricing.audioOutputUsdPerSecond) : 0;
}

export function mediaCost(usage,pricing) {
  return usage.imageCount*Number(pricing.imageInputUsdEach || 0)+usage.audioSeconds*Number(pricing.audioInputUsdPerSecond || 0)+usage.videoSeconds*Number(pricing.videoInputUsdPerSecond || 0);
}
