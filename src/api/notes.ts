import type { KnowledgeGraphData, Note, NoteCategory, NoteDetailData, NoteGraphData, NoteListResponse, NotePayload, NoteQuery, NoteTagDefinition, NoteVersion } from "../types";
import { http } from "./client";

export const listNotes = (query: NoteQuery | string = {}) => {
  const values = typeof query === "string" ? { taskId: query } : query;
  const search = new URLSearchParams();
  if (values.taskId) search.set("taskId", values.taskId);
  if (values.keyword) search.set("keyword", values.keyword);
  if (values.categoryId) search.set("categoryId", values.categoryId);
  values.tags?.forEach(tag => search.append("tag", tag));
  return http.get<NoteListResponse>(`/notes${search.size ? `?${search}` : ""}`);
};
export const listNoteCategories = () => http.get<{ items: NoteCategory[] }>("/note-categories");
export const createNoteCategory = (name: string, parentId: string | null) => http.post<NoteCategory>("/note-categories", { name, parentId });
export const updateNoteCategory = (id: string, changes: { name?: string; parentId?: string | null }) => http.patch<NoteCategory>(`/note-categories/${encodeURIComponent(id)}`, changes);
export const deleteNoteCategory = (id: string) => http.del<{ deleted: boolean }>(`/note-categories/${encodeURIComponent(id)}`);
export const listNoteTags = () => http.get<{ items: NoteTagDefinition[] }>("/note-tags");
export const createNoteTag = (name: string) => http.post<NoteTagDefinition>("/note-tags", { name });
export const renameNoteTag = (id: string, name: string) => http.patch<NoteTagDefinition>(`/note-tags/${encodeURIComponent(id)}`, { name });
export const mergeNoteTag = (id: string, targetId: string, expectedUsageCount: number) => http.post<{ sourceId: string; target: NoteTagDefinition; affectedCount: number }>(`/note-tags/${encodeURIComponent(id)}/merge`, { targetId, expectedUsageCount });
export const deleteNoteTag = (id: string, expectedUsageCount: number) => http.del<{ deleted: boolean; id: string; affectedCount: number }>(`/note-tags/${encodeURIComponent(id)}?expectedUsageCount=${expectedUsageCount}`);
export const getNote = (id: string) => http.get<NoteDetailData>(`/notes/${encodeURIComponent(id)}`);
export const getNoteGraph = () => http.get<NoteGraphData>("/notes/graph");
export const getKnowledgeGraph = () => http.get<KnowledgeGraphData>("/knowledge-graph");
export const listNoteVersions = (id: string) => http.get<{ items: NoteVersion[] }>(`/notes/${encodeURIComponent(id)}/versions`);
export const restoreNoteVersion = (id: string, versionId: string) => http.post<Note>(`/notes/${encodeURIComponent(id)}/restore`, { versionId });

export const createNote = (payload: NotePayload) =>
  http.post<Note>("/notes", payload);

export const updateNote = (id: string, payload: NotePayload) =>
  http.put<Note>(`/notes/${id}`, payload);

export const deleteNote = (id: string) =>
  http.del<{ deleted: boolean; id: string }>(`/notes/${id}`);
