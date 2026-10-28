-- Preserve the existing one-way audit-subject erasure invariant.
CREATE TRIGGER device_audit_erasure_guard
BEFORE UPDATE ON "DeviceAuditEvent"
BEGIN
  SELECT CASE WHEN OLD.subject_member_erased=1 AND NEW.subject_member_erased=0
    THEN RAISE(ABORT, 'erased audit member subject cannot be restored') END;
  SELECT CASE WHEN OLD.subject_member_id IS NOT NULL AND NEW.subject_member_id IS NULL AND NEW.subject_member_erased=0
    THEN RAISE(ABORT, 'audit member subject requires explicit erasure') END;
END;
