import { http } from './client';

export type ContentKind = 'tasks'|'notes'|'experiments'|'prompts'|'cases';
export interface ContentComment {
  id:string; entityId:string; parentId:string | null; authorId:string | null; authorName:string;
  content:string | null; version:number; createdAt:string; updatedAt:string; deletedAt:string | null;
  replies?:ContentComment[];
}
const base = (kind:ContentKind,entityId:string) => kind==='cases'
  ? `/evaluation/cases/${encodeURIComponent(entityId)}/comments`
  : `/${kind}/${encodeURIComponent(entityId)}/comments`;
export const listContentComments = (kind:ContentKind,entityId:string,order:'newest'|'oldest',offset:number) =>
  http.get<{items:ContentComment[];total:number}>(base(kind,entityId),{order,offset:String(offset),limit:'20'});
export const createContentComment = (kind:ContentKind,entityId:string,content:string,parentId?:string) =>
  http.post<ContentComment>(base(kind,entityId),{content,parentId:parentId || null});
export const updateContentComment = (kind:ContentKind,entityId:string,id:string,version:number,content:string) =>
  http.patch<ContentComment>(`${base(kind,entityId)}/${id}`,{version,content});
export const deleteContentComment = (kind:ContentKind,entityId:string,id:string,version:number) =>
  http.del<ContentComment>(`${base(kind,entityId)}/${id}`,{version});
