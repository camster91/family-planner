-- Port event-preparation relationship identity/lifecycle from PostgreSQL.
-- Existing 0008/0009/0010 migrations own responsibility, event and task epochs.
-- This migration does not enable the preparation writer or advertise readiness.
-- SQLite cannot rewrite NEW: reject identity changes and counter rewinds.
CREATE TRIGGER "EventPreparation_identity" BEFORE UPDATE ON "EventPreparation"
WHEN NEW.id IS NOT OLD.id OR NEW.family_id IS NOT OLD.family_id
  OR NEW.event_id IS NOT OLD.event_id OR NEW.revision<OLD.revision
BEGIN SELECT RAISE(ABORT,'Preparation identity is immutable and revision cannot rewind'); END;

CREATE TRIGGER "EventPreparation_bounds_insert" BEFORE INSERT ON "EventPreparation"
WHEN typeof(NEW.revision)<>'integer' OR NEW.revision<0 OR NEW.revision>2147483647
  OR length(NEW.reviewed_event_source)<>64 OR NEW.reviewed_event_source GLOB '*[^a-f0-9]*'
BEGIN SELECT RAISE(ABORT,'Invalid preparation source or revision'); END;
CREATE TRIGGER "EventPreparation_bounds_update" BEFORE UPDATE ON "EventPreparation"
WHEN typeof(NEW.revision)<>'integer' OR NEW.revision<0 OR NEW.revision>2147483647
  OR length(NEW.reviewed_event_source)<>64 OR NEW.reviewed_event_source GLOB '*[^a-f0-9]*'
BEGIN SELECT RAISE(ABORT,'Invalid preparation source or revision'); END;

CREATE TRIGGER "EventPreparation_source_version" AFTER UPDATE ON "EventPreparation"
WHEN NEW.reviewed_event_source IS NOT OLD.reviewed_event_source
BEGIN
  UPDATE "EventPreparation" SET revision=min(2147483647,max(OLD.revision,NEW.revision)+1) WHERE id=NEW.id;
END;
CREATE TRIGGER "EventPreparation_lifecycle_insert" AFTER INSERT ON "EventPreparation"
BEGIN
  UPDATE "Event" SET preparation_epoch=min(2147483647,preparation_epoch+1)
    WHERE id=NEW.event_id AND family_id=NEW.family_id;
END;
CREATE TRIGGER "EventPreparation_lifecycle_delete" AFTER DELETE ON "EventPreparation"
BEGIN
  UPDATE "Event" SET preparation_epoch=min(2147483647,preparation_epoch+1)
    WHERE id=OLD.event_id AND family_id=OLD.family_id;
END;

CREATE TRIGGER "EventPreparationStep_identity" BEFORE UPDATE ON "EventPreparationStep"
WHEN NEW.id IS NOT OLD.id OR NEW.family_id IS NOT OLD.family_id
  OR NEW.preparation_id IS NOT OLD.preparation_id OR NEW.chore_id IS NOT OLD.chore_id
BEGIN SELECT RAISE(ABORT,'Preparation step identity is immutable'); END;
CREATE TRIGGER "EventPreparationStep_version_insert" AFTER INSERT ON "EventPreparationStep"
BEGIN
  UPDATE "EventPreparation" SET revision=min(2147483647,revision+1)
    WHERE id=NEW.preparation_id AND family_id=NEW.family_id;
END;
CREATE TRIGGER "EventPreparationStep_version_update" AFTER UPDATE ON "EventPreparationStep"
WHEN NEW.position IS NOT OLD.position OR NEW.cue_anchor IS NOT OLD.cue_anchor
  OR NEW.cue_direction IS NOT OLD.cue_direction OR NEW.cue_minutes IS NOT OLD.cue_minutes
BEGIN
  UPDATE "EventPreparation" SET revision=min(2147483647,revision+1)
    WHERE id=NEW.preparation_id AND family_id=NEW.family_id;
END;
-- Deliberately no step DELETE revision update, matching the canonical contract.
-- Membership is part of the source fingerprint; recreating it advances revision.
CREATE TRIGGER "Chore_preparation_move" BEFORE UPDATE ON "Chore"
WHEN NEW.id IS NOT OLD.id OR NEW.family_id IS NOT OLD.family_id
BEGIN
  DELETE FROM "EventPreparationStep" WHERE chore_id=OLD.id AND family_id=OLD.family_id;
END;
-- D1 foreign-key checks are immediate. Clean before the Event moves; the
-- lifecycle trigger updates only its epoch, not the columns that cause a move.
CREATE TRIGGER "Event_preparation_move" BEFORE UPDATE ON "Event"
WHEN NEW.id IS NOT OLD.id OR NEW.family_id IS NOT OLD.family_id
BEGIN
  DELETE FROM "EventPreparation" WHERE event_id=OLD.id AND family_id=OLD.family_id;
END;
