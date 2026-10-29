-- Chore state/proof epochs from migration-zzzzzzzz-event-preparation.sql.
-- Keep these distinct from material responsibility epochs; prevent ABA in
-- completion/proof state without rewriting responsibility statements.
CREATE TRIGGER "Chore_completion_epoch_insert" BEFORE INSERT ON "Chore"
WHEN typeof(NEW.preparation_epoch)<>'integer' OR NEW.preparation_epoch<0 OR NEW.preparation_epoch>2147483647
BEGIN SELECT RAISE(ABORT,'Invalid chore completion epoch'); END;
CREATE TRIGGER "Chore_completion_epoch_update" BEFORE UPDATE ON "Chore"
WHEN typeof(NEW.preparation_epoch)<>'integer' OR NEW.preparation_epoch<OLD.preparation_epoch OR NEW.preparation_epoch>2147483647
BEGIN SELECT RAISE(ABORT,'Chore completion epoch cannot rewind'); END;
CREATE TRIGGER "Chore_completion_epoch" AFTER UPDATE ON "Chore"
WHEN NEW.status IS NOT OLD.status OR NEW.photo_url IS NOT OLD.photo_url OR NEW.photo_verified IS NOT OLD.photo_verified
  OR NEW.verified_at IS NOT OLD.verified_at OR NEW.verified_notes IS NOT OLD.verified_notes OR NEW.completed_at IS NOT OLD.completed_at OR NEW.successor_id IS NOT OLD.successor_id
BEGIN
  UPDATE "Chore" SET preparation_epoch=min(2147483647,max(OLD.preparation_epoch,NEW.preparation_epoch)+1) WHERE id=NEW.id;
END;
