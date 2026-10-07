import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import ffprobe from 'ffprobe-static';

const execFileAsync=promisify(execFile);
const directory=process.env.PROMPT_MEDIA_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)),'prompt-media');
const route=/^\/api\/prompt-media\/([0-9a-f-]{36})$/;
const limits={image:10*1024*1024,audio:50*1024*1024,video:500*1024*1024};
const maximum=kind=>{
  const lowered=Number(process.env[`PROMPT_${kind.toUpperCase()}_MAX_BYTES`]);
  return Number.isInteger(lowered)&&lowered>0 ? Math.min(limits[kind],lowered) : limits[kind];
};
export const isPromptMediaPath=pathname=>pathname==='/api/prompt-media'||route.test(pathname);
export const promptMediaPath=id=>path.join(directory,id);
const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));};

function imageMime(data) {
  if (data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'image/png';
  if (data[0]===255&&data[1]===216&&data[2]===255) return 'image/jpeg';
  if (['GIF87a','GIF89a'].includes(data.toString('ascii',0,6))) return 'image/gif';
  if (data.toString('ascii',0,4)==='RIFF'&&data.toString('ascii',8,12)==='WEBP') return 'image/webp';
  return null;
}

async function inspect(file,kind) {
  const handle=await fsp.open(file,'r');
  const head=Buffer.alloc(32);
  try {await handle.read(head,0,32,0);} finally {await handle.close();}
  if (kind==='image') {
    const mime=imageMime(head);
    if (!mime) throw Object.assign(new Error('图片格式只支持 PNG、JPEG、GIF、WebP'),{status:415});
    return {mime,duration:null};
  }
  let stdout;
  try {({stdout}=await execFileAsync(ffprobe.path,['-v','error','-show_entries','format=format_name,duration:stream=codec_type','-of','json',file],{timeout:10000,maxBuffer:128000}));}
  catch {throw Object.assign(new Error('媒体文件无法识别'),{status:415});}
  const metadata=JSON.parse(stdout),formats=(metadata.format?.format_name || '').split(',');
  const duration=Number(metadata.format?.duration);
  if (!Number.isFinite(duration)||duration<=0||duration>600) throw Object.assign(new Error('音视频时长必须在 10 分钟以内'),{status:422});
  if (kind==='audio' && metadata.streams?.some(stream=>stream.codec_type==='video')) throw Object.assign(new Error('音频文件不能包含视频轨道'),{status:415});
  if (kind==='video' && !metadata.streams?.some(stream=>stream.codec_type==='video')) throw Object.assign(new Error('视频文件缺少视频轨道'),{status:415});
  let mime;
  if (kind==='audio') mime=formats.some(value=>['mp3'].includes(value))?'audio/mpeg':formats.includes('wav')?'audio/wav':formats.includes('flac')?'audio/flac':formats.includes('ogg')?'audio/ogg':formats.includes('mov')||formats.includes('mp4')?'audio/mp4':formats.includes('matroska')||formats.includes('webm')?'audio/webm':null;
  else mime=formats.includes('mov')||formats.includes('mp4')?'video/mp4':formats.includes('matroska')||formats.includes('webm')?'video/webm':null;
  if (!mime) throw Object.assign(new Error('不支持的音视频容器格式'),{status:415});
  return {mime,duration};
}

export async function handlePromptMedia(req,res,pool,lookupSession) {
  const pathname=new URL(req.url,'http://localhost').pathname;
  const token=/^Bearer (.+)$/.exec(req.headers.authorization || '')?.[1];
  const account=await lookupSession(token);
  if (!account) return json(res,401,{error:'请先登录'});
  if (pathname==='/api/prompt-media' && req.method==='POST') {
    const kind=req.headers['x-media-kind'];
    if (!Object.hasOwn(limits,kind)) return json(res,400,{error:'媒体类型无效'});
    const max=maximum(kind);
    if (Number(req.headers['content-length'] || 0)>max) return json(res,413,{error:'文件超过允许大小'});
    const id=crypto.randomUUID();
    await fsp.mkdir(directory,{recursive:true});
    const temp=path.join(directory,`${id}.upload`);
    const hash=crypto.createHash('sha256');
    let bytes=0;
    try {
      await pipeline(req,new Transform({transform(chunk,_encoding,callback){bytes+=chunk.length;if(bytes>max) callback(Object.assign(new Error('文件超过允许大小'),{status:413}));else {hash.update(chunk);callback(null,chunk);}}}),fs.createWriteStream(temp,{flags:'wx'}));
      if (!bytes) throw Object.assign(new Error('文件不能为空'),{status:400});
      const {mime,duration}=await inspect(temp,kind);
      await fsp.rename(temp,promptMediaPath(id));
      try {await pool.query('INSERT INTO prompt_media_assets(id,kind,mime_type,byte_size,duration_seconds,sha256,uploaded_by) VALUES($1,$2,$3,$4,$5,$6,$7)',[id,kind,mime,bytes,duration,hash.digest('hex'),account.id]);}
      catch(error){await fsp.unlink(promptMediaPath(id)).catch(()=>{});throw error;}
      return json(res,201,{id,url:`/api/prompt-media/${id}`,kind,mimeType:mime,byteSize:bytes,durationSeconds:duration});
    } catch(error){await fsp.unlink(temp).catch(()=>{});return json(res,error.status || 500,{error:error.status?error.message:'媒体保存失败'});}
  }
  const match=pathname.match(route);
  if (match && req.method==='GET') {
    const record=(await pool.query('SELECT mime_type,byte_size FROM prompt_media_assets WHERE id=$1',[match[1]])).rows[0];
    if (!record) return json(res,404,{error:'媒体不存在'});
    try {await fsp.access(promptMediaPath(match[1]));} catch{return json(res,404,{error:'媒体文件不存在'});}
    res.writeHead(200,{'Content-Type':record.mime_type,'Content-Length':Number(record.byte_size),'Cache-Control':'private, no-store','Content-Security-Policy':"default-src 'none'; sandbox",'X-Content-Type-Options':'nosniff'});
    return fs.createReadStream(promptMediaPath(match[1])).pipe(res);
  }
  return json(res,405,{error:'method not allowed'});
}
