-- A used invitation remains an audit fact after its account is eventually purged.
-- The FK sets consumed_user_id to NULL, so the original non-null check must not block deletion.
ALTER TABLE account_invitations DROP CONSTRAINT account_invitations_check;
