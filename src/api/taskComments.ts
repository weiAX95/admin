import { http } from './client';

export interface TaskComment {
  id:string; taskId:string; parentId:string | null; authorId:string | null; authorName:string;
  content:string | null; version:number; createdAt:string; updatedAt:string; deletedAt:string | null;
  replies?:TaskComment[];
}
export const listTaskComments = (taskId:string,order:'newest'|'oldest',offset:number) =>
  http.get<{items:TaskComment[];total:number}>(`/tasks/${encodeURIComponent(taskId)}/comments`,{order,offset:String(offset),limit:'20'});
export const createTaskComment = (taskId:string,content:string,parentId?:string) =>
  http.post<TaskComment>(`/tasks/${encodeURIComponent(taskId)}/comments`,{content,parentId:parentId || null});
export const updateTaskComment = (taskId:string,id:string,version:number,content:string) =>
  http.patch<TaskComment>(`/tasks/${encodeURIComponent(taskId)}/comments/${id}`,{version,content});
export const deleteTaskComment = (taskId:string,id:string,version:number) =>
  http.del<TaskComment>(`/tasks/${encodeURIComponent(taskId)}/comments/${id}`,{version});
