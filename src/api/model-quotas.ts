import { http } from './client';

export interface ModelQuota { modelId:string;modelName:string;scope:'model'|'role'|'user';subjectId:string;dailyTokens:number }
export const listModelQuotas=()=>http.get<{items:ModelQuota[]}>('/model-quotas');
export const saveModelQuota=(value:Omit<ModelQuota,'modelName'>)=>http.put('/model-quotas',value);
export const deleteModelQuota=(value:Pick<ModelQuota,'modelId'|'scope'|'subjectId'>)=>http.del('/model-quotas',value);
