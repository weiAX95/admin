import type { Note, NotePayload } from "../types";
import { http } from "./client";

export const listNotes = (taskId?: string) => http.get<{ items: Note[] }>(`/notes${taskId ? `?taskId=${encodeURIComponent(taskId)}` : ""}`);
export const getNote = (id: string) => http.get<Note>(`/notes/${encodeURIComponent(id)}`);

export const createNote = (payload: NotePayload) =>
  http.post<Note>("/notes", payload);

export const updateNote = (id: string, payload: NotePayload) =>
  http.put<Note>(`/notes/${id}`, payload);

export const deleteNote = (id: string) =>
  http.del<{ deleted: boolean; id: string }>(`/notes/${id}`);
