-- Passwords imported before the policy existed have no trustworthy change time.
-- Start their 90-day window at policy activation instead of locking legacy users out.
UPDATE password_history h SET changed_at=now()
WHERE h.id IN (
  SELECT min(id) FROM password_history GROUP BY user_id HAVING count(*)=1
);
