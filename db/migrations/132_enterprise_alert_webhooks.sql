ALTER TABLE outbound_webhooks
  ADD COLUMN provider text NOT NULL DEFAULT 'generic'
    CHECK (provider IN ('generic','wecom','feishu','dingtalk')),
  ADD COLUMN endpoint_cipher bytea,
  ADD COLUMN endpoint_nonce bytea,
  ADD COLUMN endpoint_tag bytea;
ALTER TABLE outbound_webhooks ADD CONSTRAINT outbound_webhooks_endpoint_storage_check CHECK (
  (provider='generic' AND endpoint_cipher IS NULL AND endpoint_nonce IS NULL AND endpoint_tag IS NULL)
  OR (provider<>'generic' AND endpoint_cipher IS NOT NULL AND endpoint_nonce IS NOT NULL AND endpoint_tag IS NOT NULL)
);
ALTER TABLE outbound_webhooks ADD CONSTRAINT outbound_webhooks_enterprise_event_check
  CHECK (provider='generic' OR event_type='alert.firing');
