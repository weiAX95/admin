import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pipeline} from 'node:stream/promises';
import {Transform} from 'node:stream';
import yazl from 'yazl';
import yauzl from 'yauzl';
import {buildPromptTransfer,importPrompts} from './prompts.mjs';
import {inspectPromptMedia,maximumPromptMediaSize,promptMediaPath} from './prompt-media.mjs';

const archiveLimit=1024*1024*1024;
const uuid=/^[0-9a-f-]{36}$/;
const json=(res,status,value)=>{
  res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
  res.end(JSON.stringify(value));
};
const error=(message,status=400)=>Object.assign(new Error(message),{status});
export const isPromptArchivePath=pathname=>pathname==='/api/prompts/archive'||pathname==='/api/prompts/archive/preview'||pathname==='/api/prompts/archive/confirm';

async function exportArchive(res,pool,url) {
  const client=await pool.connect();
  let document,assets;
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    document=await buildPromptTransfer(client,url.searchParams.getAll('id'));
    const ids=[...new Set(document.prompts.flatMap(prompt=>prompt.versions.flatMap(version=>(version.blocks||[]).flatMap(block=>block.parts.filter(part=>part.type!=='text').map(part=>part.assetId)))))];
    assets=ids.length?(await client.query('SELECT id,kind,mime_type,byte_size,duration_seconds,sha256 FROM prompt_media_assets WHERE id=ANY($1)',[ids])).rows:[];
    if(assets.length!==ids.length) throw error('提示词引用的媒体记录不存在',409);
    for(const asset of assets) await fsp.access(promptMediaPath(asset.id));
    await client.query('COMMIT');
  } catch(cause) {await client.query('ROLLBACK').catch(()=>{});throw cause;} finally {client.release();}
  const manifest={archiveVersion:1,document,assets:assets.map(asset=>({sourceId:asset.id,kind:asset.kind,mimeType:asset.mime_type,byteSize:Number(asset.byte_size),durationSeconds:asset.duration_seconds,sha256:asset.sha256}))};
  const zip=new yazl.ZipFile();
  zip.addBuffer(Buffer.from(JSON.stringify(manifest)), 'manifest.json', {compress:true});
  for(const asset of assets) zip.addFile(promptMediaPath(asset.id),`media/${asset.id}`,{compress:false});
  zip.end();
  res.writeHead(200,{'Content-Type':'application/zip','Content-Disposition':'attachment; filename="prompts.zip"','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
  zip.outputStream.on('error',cause=>res.destroy(cause)).pipe(res);
}

async function receiveArchive(req,folder) {
  const zipPath=path.join(folder,'upload.zip');
  let bytes=0;
  await pipeline(req,new Transform({transform(chunk,_encoding,callback){bytes+=chunk.length;callback(bytes>archiveLimit?error('归档文件过大',413):null,chunk);}}),fs.createWriteStream(zipPath));
  const entries=new Map();
  await new Promise((resolve,reject)=>{
    yauzl.open(zipPath,{lazyEntries:true,validateEntrySizes:true},(openError,zip)=>{
      if(openError) return reject(openError);
      let count=0,uncompressed=0,settled=false;
      const fail=cause=>{if(!settled){settled=true;zip.close();reject(cause);}};
      zip.on('error',fail);
      zip.on('end',()=>{if(!settled){settled=true;resolve();}});
      zip.on('entry',entry=>{
        if(settled) return;
        count++;uncompressed+=entry.uncompressedSize;
        if(count>1002 || uncompressed>archiveLimit || !/^(manifest\.json|media\/[0-9a-f-]{36})$/.test(entry.fileName) || entries.has(entry.fileName)) return fail(error('ZIP 条目无效、重复或体积超限'));
        zip.openReadStream(entry,(streamError,stream)=>{
          if(streamError) return fail(streamError);
          const target=path.join(folder,entry.fileName.replace('/','-'));
          pipeline(stream,fs.createWriteStream(target,{flags:'wx'})).then(()=>{entries.set(entry.fileName,target);zip.readEntry();}).catch(fail);
        });
      });
      zip.readEntry();
    });
  });
  const manifestPath=entries.get('manifest.json');
  if(!manifestPath) throw error('ZIP 缺少 manifest.json');
  const stat=await fsp.stat(manifestPath);
  if(stat.size>10_000_000) throw error('清单超过 10 MB');
  let manifest;
  try {manifest=JSON.parse(await fsp.readFile(manifestPath,'utf8'));} catch {throw error('清单 JSON 无效');}
  if(manifest?.archiveVersion!==1 || !manifest.document || !Array.isArray(manifest.assets) || manifest.assets.length>1000) throw error('清单结构无效');
  const seen=new Set();
  for(const asset of manifest.assets) {
    if(!uuid.test(asset.sourceId) || seen.has(asset.sourceId) || !['image','audio','video'].includes(asset.kind) || !/^[0-9a-f]{64}$/.test(asset.sha256)) throw error('媒体清单无效');
    seen.add(asset.sourceId);
    const file=entries.get(`media/${asset.sourceId}`);
    if(!file) throw error(`缺少媒体文件 ${asset.sourceId}`);
    const stat=await fsp.stat(file);
    if(stat.size!==asset.byteSize || stat.size>maximumPromptMediaSize(asset.kind)) throw error(`媒体大小不符 ${asset.sourceId}`);
    const digest=crypto.createHash('sha256');
    for await (const chunk of fs.createReadStream(file)) digest.update(chunk);
    if(digest.digest('hex')!==asset.sha256) throw error(`媒体哈希不符 ${asset.sourceId}`);
    const inspected=await inspectPromptMedia(file,asset.kind);
    if(inspected.mime!==asset.mimeType) throw error(`媒体格式不符 ${asset.sourceId}`);
  }
  if(entries.size!==seen.size+1) throw error('ZIP 包含清单外的文件');
  const referenced=new Set(manifest.document.prompts?.flatMap(prompt=>prompt.versions?.flatMap(version=>version.blocks?.flatMap(block=>block.parts?.filter(part=>part.type!=='text').map(part=>part.assetId) || []) || []) || []) || []);
  if([...referenced].some(id=>!seen.has(id))) throw error('提示词引用了未打包的媒体');
  return {manifest,entries};
}

async function importArchive(req,res,pool,account,confirm) {
  const folder=await fsp.mkdtemp(path.join(os.tmpdir(),'prompt-archive-'));
  const created=[];
  let client;
  try {
    const {manifest,entries}=await receiveArchive(req,folder);
    client=await pool.connect();
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(748201)');
    const assetMap={};
    if(confirm) for(const asset of manifest.assets) {
      const previous=(await client.query('SELECT asset_id,sha256 FROM prompt_import_assets WHERE source_key=$1 AND source_asset_id=$2',[manifest.document.sourceKey,asset.sourceId])).rows[0];
      if(previous && previous.sha256!==asset.sha256) throw error(`来源媒体 ${asset.sourceId} 的内容已改变`,409);
      if(previous) {assetMap[asset.sourceId]=previous.asset_id;continue;}
      const local=(await client.query('SELECT id FROM prompt_media_assets WHERE id=$1 AND sha256=$2',[asset.sourceId,asset.sha256])).rows[0];
      if(local) {
        await client.query('INSERT INTO prompt_import_assets(source_key,source_asset_id,asset_id,sha256) VALUES($1,$2,$3,$4)',[manifest.document.sourceKey,asset.sourceId,local.id,asset.sha256]);
        assetMap[asset.sourceId]=local.id;
        continue;
      }
      const newId=crypto.randomUUID(),final=promptMediaPath(newId);
      await fsp.mkdir(path.dirname(final),{recursive:true});
      await fsp.copyFile(entries.get(`media/${asset.sourceId}`),final,fs.constants.COPYFILE_EXCL);
      created.push(final);
      await client.query('INSERT INTO prompt_media_assets(id,kind,mime_type,byte_size,duration_seconds,sha256,uploaded_by) VALUES($1,$2,$3,$4,$5,$6,$7)',[newId,asset.kind,asset.mimeType,asset.byteSize,asset.durationSeconds,asset.sha256,account.id]);
      await client.query('INSERT INTO prompt_import_assets(source_key,source_asset_id,asset_id,sha256) VALUES($1,$2,$3,$4)',[manifest.document.sourceKey,asset.sourceId,newId,asset.sha256]);
      assetMap[asset.sourceId]=newId;
    }
    const result=await importPrompts(client,account,{document:manifest.document,assetMap,confirmFindings:new URL(req.url,'http://localhost').searchParams.get('confirmFindings')==='true'},confirm);
    if(result.status>=400 || !confirm) {
      await client.query('ROLLBACK');
      for(const file of created) await fsp.unlink(file).catch(()=>{});
      created.length=0;
    }
    else await client.query('COMMIT');
    json(res,result.status,result.data);
  } catch(cause) {
    if(client) await client.query('ROLLBACK').catch(()=>{});
    for(const file of created) await fsp.unlink(file).catch(()=>{});
    json(res,cause.status || 400,{error:cause.message || '归档导入失败'});
  } finally {
    client?.release();
    await fsp.rm(folder,{recursive:true,force:true});
  }
}

export async function handlePromptArchive(req,res,pool,lookupSession) {
  const url=new URL(req.url,'http://localhost');
  const token=/^Bearer (.+)$/.exec(req.headers.authorization || '')?.[1];
  const account=await lookupSession(token);
  if(!account) return json(res,401,{error:'请先登录'});
  if(url.pathname==='/api/prompts/archive' && req.method==='GET') return exportArchive(res,pool,url);
  if(url.pathname==='/api/prompts/archive/preview' && req.method==='POST') return importArchive(req,res,pool,account,false);
  if(url.pathname==='/api/prompts/archive/confirm' && req.method==='POST') return importArchive(req,res,pool,account,true);
  return json(res,405,{error:'method not allowed'});
}
