import { http } from './client';

export type SpaceRole = 'owner' | 'editor' | 'viewer';
export interface Space { id:string; name:string; description:string; icon:string; ownerId:string; status:'active'|'archived'; role:SpaceRole; version:number; createdAt:string; updatedAt:string }
export interface SpaceMember { id:string; username:string; name:string | null; role:'editor'|'viewer'; addedAt:string }
export interface SpaceCandidate { id:string; username:string; name:string | null }
export interface SpaceActivityItem { id:string; space_id:string; actor_id:string | null; actor_name:string; action:string; resource_type:'space'|'member'; resource_id:string | null; detail:string; occurred_at:string }
export interface SpaceActivityQuery { action?:string; actorId?:string; resourceType?:'space'|'member'; offset?:number; limit?:number }
export const listSpaceActivity = (id:string,query:SpaceActivityQuery={}) => http.get<{items:SpaceActivityItem[];total:number;actors:{actor_id:string;actor_name:string}[]}>(`/spaces/${id}/activity`,{
  action:query.action,actorId:query.actorId,resourceType:query.resourceType,offset:String(query.offset||0),limit:String(query.limit||20),
});
export const listSpaces = () => http.get<{ items:Space[] }>('/spaces');
export const listDeletedSpaces = () => http.get<{ items:(Space & {deletedAt:string})[] }>('/spaces/deleted');
export const restoreSpace = (id:string,version:number) => http.post<Space>(`/spaces/${id}/restore`,{version});
export const createSpace = (value:{name:string;description:string;icon:string}) => http.post<Space>('/spaces',value);
export const updateSpace = (id:string,version:number,value:Partial<Pick<Space,'name'|'description'|'icon'|'status'>>) => http.patch<Space>(`/spaces/${id}`,{version,...value});
export const deleteSpace = (id:string,version:number) => http.del<{deleted:boolean}>(`/spaces/${id}`,{version});
export const listSpaceMembers = (id:string) => http.get<{ownerId:string;items:SpaceMember[]}>(`/spaces/${id}/members`);
export const findSpaceCandidates = (id:string,query:string) => http.get<{items:SpaceCandidate[]}>(`/spaces/${id}/candidates`,{query});
export const addSpaceMembers = (id:string,members:{userId:string;role:'editor'|'viewer'}[]) => http.post<{saved:number}>(`/spaces/${id}/members`,{members});
export const changeSpaceMemberRole = (id:string,userId:string,role:'editor'|'viewer') => http.patch<{saved:boolean}>(`/spaces/${id}/members/${userId}`,{role});
export const removeSpaceMember = (id:string,userId:string) => http.del<{deleted:boolean}>(`/spaces/${id}/members/${userId}`);
export const transferSpaceOwner = (id:string,version:number,userId:string) => http.post<{ownerId:string}>(`/spaces/${id}/transfer`,{version,userId});
