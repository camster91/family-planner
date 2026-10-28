-- Retained notification occurrence/recipient evidence from the PostgreSQL
-- notification-event-occurrences and notification-recipient-decisions migrations.
-- Inbox/account deletion may clear links, but must never reopen terminal slots.
CREATE TRIGGER "NotificationEventOccurrence_key_insert" BEFORE INSERT ON "NotificationEventOccurrence"
WHEN length(NEW.occurrence_key)<>64 OR NEW.occurrence_key GLOB '*[^0-9a-f]*'
BEGIN SELECT RAISE(ABORT,'Invalid notification occurrence key'); END;
CREATE TRIGGER "NotificationEventOccurrence_immutable" BEFORE UPDATE ON "NotificationEventOccurrence"
WHEN NEW.id IS NOT OLD.id OR NEW.family_id IS NOT OLD.family_id OR NEW.occurrence_key IS NOT OLD.occurrence_key
  OR NEW.envelope IS NOT OLD.envelope OR NEW.created_at IS NOT OLD.created_at
BEGIN SELECT RAISE(ABORT,'Notification event is immutable'); END;
CREATE TRIGGER "NotificationRecipientDecision_shape_insert" BEFORE INSERT ON "NotificationRecipientDecision"
WHEN typeof(NEW.slot)<>'integer' OR NEW.slot<0 OR NEW.slot>=100 OR NEW.status NOT IN ('created','suppressed')
BEGIN SELECT RAISE(ABORT,'Invalid notification recipient decision'); END;
CREATE TRIGGER "NotificationRecipientDecision_terminal" BEFORE UPDATE ON "NotificationRecipientDecision"
WHEN NEW.id IS NOT OLD.id OR NEW.family_id IS NOT OLD.family_id OR NEW.event_id IS NOT OLD.event_id
  OR NEW.slot IS NOT OLD.slot OR NEW.status IS NOT OLD.status OR NEW.quiet IS NOT OLD.quiet OR NEW.created_at IS NOT OLD.created_at
  OR (NEW.user_id IS NOT OLD.user_id AND NEW.user_id IS NOT NULL)
  OR (NEW.notification_id IS NOT OLD.notification_id AND NEW.notification_id IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'Notification recipient decision is terminal'); END;
