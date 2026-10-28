-- Preserve insertion identity and material-version invalidation when imported
-- events change. SQLite cannot rewrite NEW: reject identity/counter rewinds,
-- and advance the material epoch with an AFTER trigger in the same statement.
CREATE TRIGGER "Event_schedule_identity_guard" BEFORE UPDATE ON "Event"
WHEN typeof(NEW.schedule_epoch)<>'integer' OR typeof(NEW.preparation_epoch)<>'integer'
  OR NEW.schedule_generation IS NOT OLD.schedule_generation
  OR NEW.schedule_epoch<OLD.schedule_epoch OR NEW.preparation_epoch<OLD.preparation_epoch
  OR NEW.schedule_epoch>2147483647 OR NEW.preparation_epoch>2147483647
BEGIN SELECT RAISE(ABORT,'Event schedule identity or epoch changed'); END;

CREATE TRIGGER "Event_schedule_epoch_insert" BEFORE INSERT ON "Event"
WHEN typeof(NEW.schedule_epoch)<>'integer' OR typeof(NEW.preparation_epoch)<>'integer'
  OR NEW.schedule_epoch<0 OR NEW.schedule_epoch>2147483647
  OR NEW.preparation_epoch<0 OR NEW.preparation_epoch>2147483647
BEGIN SELECT RAISE(ABORT,'Event epoch out of range'); END;

CREATE TRIGGER "Event_schedule_material_epoch" AFTER UPDATE ON "Event"
WHEN NEW.id IS NOT OLD.id OR NEW.family_id IS NOT OLD.family_id
  OR NEW.title IS NOT OLD.title OR NEW.description IS NOT OLD.description
  OR NEW.start_time IS NOT OLD.start_time OR NEW.end_time IS NOT OLD.end_time
  OR NEW.location IS NOT OLD.location OR NEW.event_type IS NOT OLD.event_type
  OR NEW.is_task IS NOT OLD.is_task OR NEW.project_id IS NOT OLD.project_id
  OR NEW.recurrence IS NOT OLD.recurrence OR NEW.created_by IS NOT OLD.created_by
  OR NEW.source_subscription_id IS NOT OLD.source_subscription_id
  OR NEW.source_uid IS NOT OLD.source_uid OR NEW.source_occurrence_start IS NOT OLD.source_occurrence_start
  OR NEW.source_connection_id IS NOT OLD.source_connection_id
BEGIN
  UPDATE "Event" SET schedule_epoch=min(2147483647,max(OLD.schedule_epoch,NEW.schedule_epoch)+1) WHERE id=NEW.id;
END;
