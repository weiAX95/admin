-- Earlier accepted suggestions created tasks without the repository-task link.
-- Keep their task and decision IDs; only add missing visible associations.
INSERT INTO project_repository_tasks(repository_id,task_id,linked_by,requirement_id)
SELECT d.repository_id,d.task_id,d.owner_id,f.requirement_id
FROM project_suggestion_decisions d
JOIN project_analysis_suggestions s ON s.id=d.suggestion_id AND s.analysis_id=d.analysis_id
LEFT JOIN project_analysis_findings f ON f.id=s.finding_id AND f.analysis_id=s.analysis_id
JOIN tasks t ON t.id=d.task_id AND t.owner_id=d.owner_id
WHERE d.state='accepted' AND t.deleted_at IS NULL
ON CONFLICT (repository_id,task_id) DO NOTHING;
