import { http } from "./client";
import type { ReviewItem, ReviewNotification, ReviewSettings } from "../types";

export const listDueReviews = () => http.get<{ items: ReviewItem[]; today: string }>("/note-reviews");
export const completeReview = (noteId: string, generation: number) => http.post<{ status: string; dueOn: string; generation: number }>(`/note-reviews/${encodeURIComponent(noteId)}/complete`, { generation });
export const listNotifications = () => http.get<{ items: ReviewNotification[]; unread: number }>("/notifications");
export const markNotificationRead = (id: string) => http.post<{ read: boolean }>(`/notifications/${encodeURIComponent(id)}/read`, {});
export const getReviewSettings = () => http.get<ReviewSettings>("/account/review-settings");
export const updateReviewSettings = (email: string, emailEnabled: boolean) => http.put<ReviewSettings>("/account/review-settings", { email, emailEnabled });
