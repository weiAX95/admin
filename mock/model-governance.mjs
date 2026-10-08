const features=new Set(['vision','function_calling','json_mode','streaming','embedding','reasoning']);
export const supportedProvider=new Set(['legacy','openai','qwen','gemini']);
export const modelUsable=(model, user)=>Boolean(model?.active && model.status==='active' && (user.role==='admin' || model.allowed_roles?.includes(user.role)));
export function validateRegistry(body, current=null){
  const name=body.name===undefined?current?.name:body.name;
  if(typeof name!=='string'||!(/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,99}$/).test(name))throw new Error('唯一标识只能使用字母、数字、点、冒号、下划线和连字符');
  const status=body.status===undefined?current?.status||'active':body.status;
  if(!['active','deprecated','retired'].includes(status))throw new Error('模型状态无效');
  const roles=body.allowedRoles===undefined?current?.allowed_roles||['admin']:body.allowedRoles;
  if(!Array.isArray(roles)||!roles.includes('admin')||roles.some(role=>!['admin','member'].includes(role))||new Set(roles).size!==roles.length)throw new Error('角色白名单无效');
  const tags=body.featureTags===undefined?current?.feature_tags||[]:body.featureTags;
  if(!Array.isArray(tags)||tags.some(tag=>!features.has(tag))||new Set(tags).size!==tags.length)throw new Error('能力标签无效');
  const context=body.contextWindow===undefined?current?.context_window??null:body.contextWindow;
  const output=body.maxOutputTokens===undefined?current?.max_output_tokens??null:body.maxOutputTokens;
  if(context!==null&&(!Number.isInteger(context)||context<=0))throw new Error('上下文窗口必须为正整数');
  if(output!==null&&(!Number.isInteger(output)||output<=0))throw new Error('最大输出 token 必须为正整数');
  if(context!==null&&output!==null&&output>context)throw new Error('最大输出不能超过上下文窗口');
  const endpoint=body.endpointUrl===undefined?current?.endpoint_url??null:body.endpointUrl||null;
  if(endpoint!==null){
    if(typeof endpoint!=='string'||endpoint.length>300)throw new Error('Endpoint URL 无效');
    let url;try{url=new URL(endpoint);}catch{throw new Error('Endpoint URL 无效');}
    if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)throw new Error('Endpoint URL 必须是无凭据的 HTTPS 地址');
  }
  const apiVersion=body.apiVersion===undefined?current?.api_version??null:body.apiVersion;
  if(apiVersion!==null&&(typeof apiVersion!=='string'||apiVersion.length>80))throw new Error('API version 无效');
  return {name,status,allowedRoles:roles,featureTags:tags,contextWindow:context,maxOutputTokens:output,endpointUrl:endpoint,apiVersion};
}
