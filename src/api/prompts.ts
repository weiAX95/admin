import { http } from './client';

export type PromptType = 'system' | 'user' | 'assistant' | 'tool_description';
export type PromptFormat = 'text' | 'chat' | 'tool';
export interface PromptVariable { name: string; type: 'string' | 'number' | 'boolean' | 'select'; required: boolean; defaultValue?: string | number | boolean; options?: string[] | string }
export interface PromptMessage { role: 'system' | 'user' | 'assistant'; content: string }
export interface PromptVersion { id: string; prompt_id: string; version: number; semver: string; content: string; prompt_type: PromptType; format: PromptFormat; variables: PromptVariable[]; messages: PromptMessage[]; tool_schema: Record<string, unknown> | null; author_id: string | null; author_name?: string | null; change_summary: string; created_at: string }
export interface PromptItem { id: string; name: string; owner_id: string | null; folder_id: string | null; tags: string[]; updated_at: string; version_id: string; semver: string; content: string; prompt_type: PromptType; format: PromptFormat }
export interface PromptFolder { id: string; name: string; parent_id: string | null }
export interface PromptPayload { name?: string; folderId?: string | null; tags?: string[]; content: string; type: PromptType; format?: PromptFormat; variables: PromptVariable[]; messages?: PromptMessage[]; toolSchema?: Record<string, unknown> | null; confirmFindings?: boolean; expectedVersionId?: string; bump?: 'patch' | 'minor' | 'major' }

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
