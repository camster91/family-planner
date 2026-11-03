-- Match the canonical preparation cue/ordering contract on all future writes.
-- Existing malformed legacy rows remain readable for recovery, not editable.
-- Reordering uses a guarded atomic batch: remove selected links then reinsert
-- their stable identities at the reviewed positions. SQLite unique indexes are
-- immediate; no invalid temporary negative/oversized positions are permitted.
CREATE TRIGGER "EventPreparationStep_bounds_insert" BEFORE INSERT ON "EventPreparationStep"
WHEN typeof(NEW.position)<>'integer' OR NEW.position<1 OR NEW.position>99
  OR NOT ((NEW.cue_anchor IS NULL AND NEW.cue_direction IS NULL AND NEW.cue_minutes IS NULL)
    OR (NEW.cue_anchor IS NOT NULL AND NEW.cue_anchor IN ('start','end')
      AND NEW.cue_direction IS NOT NULL AND NEW.cue_direction IN ('before','after')
      AND NEW.cue_minutes IS NOT NULL AND typeof(NEW.cue_minutes)='integer'
      AND NEW.cue_minutes BETWEEN 0 AND 525600))
BEGIN SELECT RAISE(ABORT,'Invalid preparation step position or cue'); END;
CREATE TRIGGER "EventPreparationStep_bounds_update" BEFORE UPDATE ON "EventPreparationStep"
WHEN typeof(NEW.position)<>'integer' OR NEW.position<1 OR NEW.position>99
  OR NOT ((NEW.cue_anchor IS NULL AND NEW.cue_direction IS NULL AND NEW.cue_minutes IS NULL)
    OR (NEW.cue_anchor IS NOT NULL AND NEW.cue_anchor IN ('start','end')
      AND NEW.cue_direction IS NOT NULL AND NEW.cue_direction IN ('before','after')
      AND NEW.cue_minutes IS NOT NULL AND typeof(NEW.cue_minutes)='integer'
      AND NEW.cue_minutes BETWEEN 0 AND 525600))
BEGIN SELECT RAISE(ABORT,'Invalid preparation step position or cue'); END;
