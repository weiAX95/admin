import { http, getToken, ApiError } from './client';

export type PromptType = 'system' | 'user' | 'assistant' | 'tool_description';
export type PromptFormat = 'text' | 'chat' | 'tool';
export interface PromptVariable { name: string; type: 'string' | 'number' | 'boolean' | 'select'; required: boolean; defaultValue?: string | number | boolean; options?: string[] | string }
export interface PromptMessage { role: 'system' | 'user' | 'assistant'; content: string }
export interface PromptPart { type:'text'|'image'|'audio'|'video'; text?:string; assetId?:string }
export interface PromptBlock { role:'system'|'user'|'assistant'; parts:PromptPart[] }
export interface PromptVersion { id: string; prompt_id: string; version: number; semver: string; content: string; prompt_type: PromptType; format: PromptFormat; variables: PromptVariable[]; messages: PromptMessage[]; blocks:PromptBlock[]; tool_schema: Record<string, unknown> | null; author_id: string | null; author_name?: string | null; change_summary: string; created_at: string }
export interface PromptItem { id: string; name: string; owner_id: string | null; folder_id: string | null; tags: string[]; updated_at: string; version_id: string; semver: string; content: string; prompt_type: PromptType; format: PromptFormat; average_auto_score?:number|null; average_human_rating?:number|null; calls?:number }
export interface PromptFolder { id: string; name: string; parent_id: string | null }
export interface PromptPayload { name?: string; folderId?: string | null; tags?: string[]; content: string; type: PromptType; format?: PromptFormat; variables: PromptVariable[]; messages?: PromptMessage[]; blocks?:PromptBlock[]; toolSchema?: Record<string, unknown> | null; confirmFindings?: boolean; expectedVersionId?: string; bump?: 'patch' | 'minor' | 'major' }

export const listPrompts = (folderId?: string) => http.get<{ items: PromptItem[] }>('/prompts', folderId ? { folderId } : undefined);
function normalized(value: PromptPayload): PromptPayload {
  return { ...value, variables: (value.variables || []).map(variable => {
    const raw = variable.defaultValue;
    let defaultValue = raw;
    if (raw === '') defaultValue = undefined;
    else if (variable.type === 'number' && typeof raw === 'string') defaultValue = Number(raw);
    else if (variable.type === 'boolean' && typeof raw === 'string') defaultValue = raw === 'true';
    const options = typeof variable.options === 'string' ? variable.options.split(',').map(item => item.trim()).filter(Boolean) : variable.options;
    return { ...variable, defaultValue, options };
  }) };
}
export const createPrompt = (value: PromptPayload) => http.post<{ id: string; versionId: string; semver: string; warnings: string[] }>('/prompts', normalized(value));
export const getPrompt = (id: string) => http.get<PromptItem & { latest: PromptVersion }>(`/prompts/${id}`);
export const updatePromptMeta = (id: string, value: { name?: string; folderId?: string | null; tags?: string[] }) => http.patch<{ id: string }>(`/prompts/${id}`, value);
export const deletePrompt = (id: string) => http.del<{ deleted: boolean }>(`/prompts/${id}`);
export const listPromptVersions = (id: string) => http.get<{ items: PromptVersion[] }>(`/prompts/${id}/versions`);
export const savePromptVersion = (id: string, value: PromptPayload) => http.post<{ id: string; semver: string; warnings: string[] }>(`/prompts/${id}/versions`, normalized(value));
export const restorePromptVersion = (id: string, versionId: string, expectedVersionId: string, confirmFindings = false) => http.post<{ id: string; semver: string }>(`/prompts/${id}/versions/${versionId}/restore`, { expectedVersionId, confirmFindings });
export const listPromptFolders = () => http.get<{ items: PromptFolder[] }>('/prompt-folders');
export const createPromptFolder = (name: string, parentId?: string | null) => http.post<{ id: string }>('/prompt-folders', { name, parentId });
export const renamePromptFolder = (id: string, name: string) => http.patch<{ id: string }>(`/prompt-folders/${id}`, { name });
export const deletePromptFolder = (id: string) => http.del<{ deleted: boolean }>(`/prompt-folders/${id}`);
export const listPromptComplianceRules = () => http.get<{ items: { id:string; name:string; pattern:string; active:boolean }[] }>('/prompt-compliance-rules');
export const createPromptComplianceRule = (name:string,pattern:string) => http.post<{id:string}>('/prompt-compliance-rules',{name,pattern});
export const deletePromptComplianceRule = (id:string) => http.del<{deleted:boolean}>(`/prompt-compliance-rules/${id}`);
export interface PromptSearchHit extends PromptItem {}
export const searchPrompts = (keyword:string, history=false, regex=false) => http.get<{items:PromptSearchHit[]}>('/prompts/search',{keyword,history:String(history),regex:String(regex)});
export const suggestPrompts = (q:string) => http.get<{items:{value:string;kind:'name'|'tag'}[]}>('/prompts/suggestions',{q});
export interface PromptReferences { outgoing:{id:string;name:string;version_id:string;semver:string}[]; incoming:{id:string;name:string;version_id:string;semver:string}[]; experiments:{id:string;title:string}[] }
export const getPromptReferences = (id:string) => http.get<PromptReferences>(`/prompts/${id}/references`);
export interface PromptVersionStats { id:string;semver:string;calls:number;completed:number;average_auto_score:number|null;average_human_rating:number|null;human_count:number;average_prompt_tokens:number|null }
export interface PromptAnalytics { versions:PromptVersionStats[];trend:{day:string;calls:number;average_auto_score:number|null;average_human_rating:number|null}[];models:string[] }
export const getPromptAnalytics = (id:string) => http.get<PromptAnalytics>(`/prompts/${id}/analytics`);
export const getPromptLeaderboard = (order:'calls'|'score') => http.get<{items:{id:string;name:string;calls:number;average_auto_score:number|null}[]}>('/prompts/leaderboard',{order});
export type PromptTransferFormat='json'|'yaml';
export interface PromptImportItem {name:string;versionId:string;status:'valid'|'skipped';reason:string;findings:string[]}
export interface PromptImportPreview {items:PromptImportItem[];validCount:number;skippedCount:number}
export const exportPromptFile=(format:PromptTransferFormat,ids:string[])=>http.get<{format:PromptTransferFormat;filename:string;content:string}>(`/prompts/export?format=${format}${ids.map(id=>`&id=${encodeURIComponent(id)}`).join('')}`);
export const previewPromptImport=(format:PromptTransferFormat,text:string)=>http.post<PromptImportPreview>('/prompts/import/preview',{format,text});
export const confirmPromptImport=(format:PromptTransferFormat,text:string,confirmFindings=false)=>http.post<{imported:number;skipped:number;items:PromptImportItem[]}>('/prompts/import/confirm',{format,text,confirmFindings});

export async function exportPromptArchive(ids:string[]):Promise<Blob> {
  const response=await fetch(`/api/prompts/archive?${ids.map(id=>`id=${encodeURIComponent(id)}`).join('&')}`,{headers:{Authorization:`Bearer ${getToken() || ''}`}});
  if(!response.ok) throw new ApiError(response.status,(await response.json()).error || 'ZIP 导出失败');
  return response.blob();
}

export async function importPromptArchive(file:File,confirm=false,confirmFindings=false):Promise<PromptImportPreview | {imported:number;skipped:number;items:PromptImportItem[]}> {
  const endpoint=confirm?'confirm':'preview';
  const response=await fetch(`/api/prompts/archive/${endpoint}?confirmFindings=${confirmFindings}`,{method:'POST',headers:{Authorization:`Bearer ${getToken() || ''}`,'Content-Type':'application/zip'},body:file});
  const data=await response.json();
  if(!response.ok) throw new ApiError(response.status,data.error || 'ZIP 导入失败');
  return data;
}
