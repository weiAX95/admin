import { http } from './client';

export interface ModelCapabilities {input:('text'|'image'|'audio'|'video')[];output:('text'|'image'|'audio'|'video')[];tools:boolean}
export interface MediaPricing {imageInputUsdEach?:number;audioInputUsdPerSecond?:number;videoInputUsdPerSecond?:number;imageOutputUsdEach?:number}
export interface ModelConfig { id: string; displayName: string; apiModel: string; provider:'legacy'|'openai'|'qwen'|'gemini';capabilities:ModelCapabilities;mediaPricing:MediaPricing;configured:boolean;inputUsdPerMillion: number; outputUsdPerMillion: number; active: boolean }
export interface PlatformConfig { configured: boolean; dailyBudgetUsd: number; concurrencyLimit: number; judgeModelId: string | null; models: ModelConfig[] }
export interface ExperimentVariant { id?: string; modelId: string; label: string; parameters: { temperature?: number; top_p?: number; max_tokens?: number; stop_sequences?: string[]; frequency_penalty?: number; presence_penalty?: number;output_kind?:'text'|'image' }; position?: number }
export interface ExperimentTemplate { id: string; name: string; systemPrompt: string; userPrompt: string; variants: Omit<ExperimentVariant, 'modelId'>[] }
export interface DefinitionPayload { title: string; taskId: string | null; systemPrompt: string; userPrompt: string; promptVersionId: string | null; variables: Record<string, string>; variants: ExperimentVariant[]; execute?: boolean }
export interface ExperimentRun { id: string; batchId: string; experimentId: string; variantId: string; inputIndex: number; status: 'queued' | 'running' | 'completed' | 'failed'; modelId: string; apiModel: string; provider:string; parameters: ExperimentVariant['parameters']; output: string | null;outputParts:{type:string;assetId?:string;mimeType?:string;text?:string}[];toolCalls:unknown[];mediaUsage:Record<string,number>;mediaPriceSnapshot:MediaPricing; promptTokens: number | null; completionTokens: number | null; latencyMs: number | null; costUsd: number | null; autoScore: number | null; error: string | null; createdAt: string }
export interface ExperimentBatch { id: string; kind: string; status: string; inputs: Record<string,string>[]; createdAt: string; runs: ExperimentRun[]; winRates: { included: number; excluded: number; variants: { variantId: string; wins: number; rate: number }[] } }
export interface ExperimentDefinition extends Omit<DefinitionPayload, 'execute'> { id: string; ownerId: string; chainId: string | null; cumulativeCostUsd: number; variants: ExperimentVariant[]; batches: ExperimentBatch[]; createdAt: string; updatedAt: string }

export const getPlatformConfig = () => http.get<PlatformConfig>('/experiment-platform/config');
export const savePlatformConfig = (settings: { dailyBudgetUsd: number; concurrencyLimit: number; judgeModelId?: string | null }) => http.put('/experiment-platform/config', settings);
export const addPlatformModel = (model: { displayName: string; apiModel: string; provider:ModelConfig['provider'];capabilities:ModelCapabilities;mediaPricing:MediaPricing;inputUsdPerMillion: number; outputUsdPerMillion: number }) => http.post<{ id: string }>('/experiment-platform/models', model);
export const updatePlatformModel = (id: string, model: { displayName: string;provider:ModelConfig['provider'];capabilities:ModelCapabilities;mediaPricing:MediaPricing;inputUsdPerMillion: number; outputUsdPerMillion: number; active: boolean }) => http.patch<{ id: string }>(`/experiment-platform/models/${id}`, model);
export const getExperimentTemplates = () => http.get<{ items: ExperimentTemplate[] }>('/experiment-templates');
export const getPromptLibrary = () => http.get<{ items: { id: string; name: string; version_id: string; version: number; content: string }[] }>('/experiment-platform/prompts');
export const createPromptLibrary = (name: string, content: string) => http.post<{ id: string; versionId: string }>('/experiment-platform/prompts', { name, content });
export const addPromptVersion = (id: string, content: string) => http.post<{ id: string; version: number }>(`/experiment-platform/prompts/${id}/versions`, { content });
export const createDefinition = (payload: DefinitionPayload) => http.post<ExperimentDefinition>('/experiment-definitions', payload);
export const updateDefinition = (id: string, payload: DefinitionPayload) => http.put<ExperimentDefinition>(`/experiment-definitions/${id}`, payload);
export const getDefinition = (id: string) => http.get<ExperimentDefinition>(`/experiment-definitions/${id}`);
export const runDefinition = (id: string, variables: Record<string,string>) => http.post<{ batchId: string; runCount: number; estimatedMaxCostUsd: number }>(`/experiment-definitions/${id}/run`, { variables });
export const runBatch = (id: string, inputs: Record<string,string>[]) => http.post<{ batchId: string; runCount: number; estimatedMaxCostUsd: number }>(`/experiment-definitions/${id}/batches`, { inputs });
export const getBatch = (id: string) => http.get<ExperimentBatch>(`/experiment-batches/${id}`);
export const retryBatch = (id: string) => http.post<{ queued: number }>(`/experiment-batches/${id}/retry`, {});
export const estimateDefinition = (id: string, payload: Record<string,unknown>) => http.post<{ runCount: number; estimatedMaxCostUsd: number; remainingBudgetUsd: number }>(`/experiment-definitions/${id}/estimate`, payload);
