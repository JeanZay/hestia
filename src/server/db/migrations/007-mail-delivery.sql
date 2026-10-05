ALTER TABLE hestia_mail_outbox ADD COLUMN proof_id uuid REFERENCES hestia_identity_proof(id);
ALTER TABLE hestia_mail_outbox ADD COLUMN first_attempt_at timestamptz;
-- The old encrypted OTP cannot be safely attributed to one proof. Require a
-- fresh OTP rather than guessing. Existing sent mail remains historical.
UPDATE hestia_mail_outbox SET state='cancelled',ciphertext=NULL,lease_id=NULL,lease_until=NULL
 WHERE template='otp' AND state IN ('pending','sending','failed');
-- An old attempted row has no precise first-attempt clock. Creation is a safe
-- lower bound: migration must never renew the provider's idempotency window.
UPDATE hestia_mail_outbox SET first_attempt_at=created_at WHERE attempts>0;
