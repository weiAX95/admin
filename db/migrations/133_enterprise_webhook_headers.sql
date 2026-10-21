ALTER TABLE outbound_webhooks ADD CONSTRAINT outbound_webhooks_enterprise_headers_check CHECK (
  provider='generic' OR (headers_cipher IS NULL AND headers_nonce IS NULL AND headers_tag IS NULL)
);
