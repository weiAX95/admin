import { http } from './client';

export interface ProjectLearningReviewItem {
  evidenceId: string;
  repositoryId: string;
  analysisId: string;
  suggestionId: string;
  repositoryName: string;
  private: boolean;
  kind: 'understanding' | 'practice';
  response: string;
  artifactUrl: string | null;
  submittedAt: string;
  requestedAt: string;
  topic: string;
  practice: string;
  acceptance: string;
}

export const listProjectLearningReviews = (repositoryId?: string, page = 1) =>
  http.get<{ items: ProjectLearningReviewItem[]; page: number; hasMore: boolean }>('/project-learning-reviews', {
    repositoryId, page: String(page),
  });

export const submitProjectLearningReview = (evidenceId: string, body: {
  coreCorrect: boolean;
  boundaryVerified: boolean;
  rationale: string;
}) => http.post<{ evidenceId: string; state: 'verified' | 'needs_revision'; reviewedAt: string }>(`/project-learning-reviews/${evidenceId}`, body);
