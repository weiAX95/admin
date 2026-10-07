import { Button, Form, Input, Select, Space, Typography, Upload } from 'antd';
import type { FormInstance } from 'antd';
import { getToken } from '../api/client';
import type { PromptPayload, PromptPart } from '../api/prompts';

export default function PromptBlocksEditor({form}:{form:FormInstance<PromptPayload>}) {
  return <Form.List name="blocks">{(blocks,{add: addBlock,remove: removeBlock})=><div>
    <Space style={{marginBottom:8}}><Typography.Title level={5} style={{margin:0}}>有序消息与媒体</Typography.Title><Button onClick={()=>addBlock({role:'user',parts:[{type:'text',text:''}]})}>添加消息</Button></Space>
    {blocks.map(block=><div key={block.key} style={{border:'1px solid var(--ant-color-border)',borderRadius:8,padding:12,marginBottom:12}}>
      <Space><Form.Item name={[block.name,'role']} label="角色" style={{marginBottom:8}}><Select style={{width:140}} options={['system','user','assistant'].map(value=>({value,label:value}))} /></Form.Item><Button danger onClick={()=>removeBlock(block.name)}>删除消息</Button></Space>
      <Form.List name={[block.name,'parts']}>{(parts,{add: addPart,remove: removePart})=><div>
        {parts.map(part=><Space key={part.key} align="start" wrap style={{display:'flex',marginBottom:8}}>
          <Form.Item name={[part.name,'type']} label="类型"><Select style={{width:120}} options={['text','image','audio','video'].map(value=>({value,label:value}))} /></Form.Item>
          <Form.Item noStyle shouldUpdate={(before,after)=>before.blocks?.[block.name]?.parts?.[part.name]?.type!==after.blocks?.[block.name]?.parts?.[part.name]?.type}>{()=>{
            const type=form.getFieldValue(['blocks',block.name,'parts',part.name,'type']) as PromptPart['type'];
            if(type==='text') return <Form.Item name={[part.name,'text']} label="正文" rules={[{required:true,message:'请输入文本'}]}><Input.TextArea rows={3} style={{width:360}} /></Form.Item>;
            return <><Form.Item name={[part.name,'assetId']} label="附件 ID" rules={[{required:true,message:'请上传附件'}]}><Input readOnly style={{width:295}} placeholder="上传后自动填写" /></Form.Item><Upload showUploadList={false} customRequest={async options=>{
              try {
                const response=await fetch('/api/prompt-media',{method:'POST',headers:{Authorization:`Bearer ${getToken()}`,'x-media-kind':type},body:options.file as File});
                const result=await response.json();
                if(!response.ok) throw new Error(result.error || '上传失败');
                form.setFieldValue(['blocks',block.name,'parts',part.name,'assetId'],result.id);
                options.onSuccess?.(result);
              } catch(error) {options.onError?.(error instanceof Error?error:new Error('上传失败'));}
            }}><Button>上传{type==='image'?'图片':type==='audio'?'音频':'视频'}</Button></Upload></>;
          }}</Form.Item>
          <Button onClick={()=>removePart(part.name)}>删除片段</Button>
        </Space>)}
        <Space><Button onClick={()=>addPart({type:'text',text:''})}>添加文本</Button>{(['image','audio','video'] as const).map(type=><Button key={type} onClick={()=>addPart({type})}>添加{type==='image'?'图片':type==='audio'?'音频':'视频'}</Button>)}</Space>
      </div>}</Form.List>
    </div>)}
  </div>}</Form.List>;
}
