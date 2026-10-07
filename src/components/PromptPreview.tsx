import { useState } from 'react';
import { Input, Space, Typography } from 'antd';
import type { PromptVariable } from '../api/prompts';

export default function PromptPreview({ content, variables }: { content: string; variables: PromptVariable[] }) {
  const [values,setValues] = useState<Record<string,string>>({});
  const definitions = new Map((variables || []).filter(item=>item?.name).map(item=>[item.name,item]));
  const rendered = content.split(/(\{\{[A-Za-z_][A-Za-z0-9_]*\}\})/g).map((part,index) => {
    if (!part.startsWith('{{')) return part;
    const name = part.slice(2,-2), variable=definitions.get(name);
    const value = values[name] || (variable?.defaultValue === undefined ? '' : String(variable.defaultValue));
    return value ? <span key={index}>{value}</span> : <span key={index} style={{color:'#ec929f'}} title="变量未填写">{part}</span>;
  });
  return <div><Typography.Text type="secondary">变量填充预览</Typography.Text><Space wrap style={{display:'flex',margin:'10px 0'}}>{[...definitions.values()].map(variable=><Input key={variable.name} style={{width:190}} aria-label={`预览变量 ${variable.name}`} placeholder={`${variable.name} (${variable.type})`} value={values[variable.name] || ''} onChange={event=>setValues(current=>({...current,[variable.name]:event.target.value}))} />)}</Space><pre style={{whiteSpace:'pre-wrap',padding:12,border:'1px solid #30364c',borderRadius:8,minHeight:55}}>{rendered}</pre></div>;
}
