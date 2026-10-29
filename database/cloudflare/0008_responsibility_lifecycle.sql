-- Port responsibility target epochs and identity retirement from migration-zzzzzz-responsibility.sql.

CREATE TRIGGER "Chore_responsibility_identity" BEFORE UPDATE ON "Chore"
WHEN NEW.responsibility_generation IS NOT OLD.responsibility_generation
BEGIN SELECT RAISE(ABORT,'Responsibility generation is immutable'); END;
CREATE TRIGGER "Chore_responsibility_family" BEFORE UPDATE OF family_id ON "Chore"
WHEN NEW.family_id IS NOT OLD.family_id
BEGIN DELETE FROM "ResponsibilityState" WHERE family_id=OLD.family_id AND chore_id=OLD.id; END;
CREATE TRIGGER "Chore_responsibility_epoch" AFTER UPDATE ON "Chore"
WHEN (NEW."family_id" IS NOT OLD."family_id" OR NEW."title" IS NOT OLD."title" OR NEW."description" IS NOT OLD."description" OR NEW."points" IS NOT OLD."points" OR NEW."assigned_to" IS NOT OLD."assigned_to" OR NEW."assigned_member_id" IS NOT OLD."assigned_member_id" OR NEW."member_subject_erased" IS NOT OLD."member_subject_erased" OR NEW."due_date" IS NOT OLD."due_date" OR NEW."frequency" IS NOT OLD."frequency" OR NEW."weekly_days" IS NOT OLD."weekly_days" OR NEW."difficulty" IS NOT OLD."difficulty" OR NEW."recurrence_id" IS NOT OLD."recurrence_id" OR NEW."is_template" IS NOT OLD."is_template" OR NEW."rotation_member_ids" IS NOT OLD."rotation_member_ids" OR NEW."rotation_index" IS NOT OLD."rotation_index" OR NEW."routine" IS NOT OLD."routine" OR NEW."routine_order" IS NOT OLD."routine_order" OR NEW."routine_stack_id" IS NOT OLD."routine_stack_id" OR NEW."routine_anchor" IS NOT OLD."routine_anchor" OR NEW."routine_duration_minutes" IS NOT OLD."routine_duration_minutes" OR NEW."routine_series_config" IS NOT OLD."routine_series_config" OR NEW."icon" IS NOT OLD."icon") OR NEW.responsibility_epoch<OLD.responsibility_epoch
BEGIN
  UPDATE "Chore" SET responsibility_epoch=min(2147483647,max(OLD.responsibility_epoch,NEW.responsibility_epoch)+CASE WHEN NEW."family_id" IS NOT OLD."family_id" OR NEW."title" IS NOT OLD."title" OR NEW."description" IS NOT OLD."description" OR NEW."points" IS NOT OLD."points" OR NEW."assigned_to" IS NOT OLD."assigned_to" OR NEW."assigned_member_id" IS NOT OLD."assigned_member_id" OR NEW."member_subject_erased" IS NOT OLD."member_subject_erased" OR NEW."due_date" IS NOT OLD."due_date" OR NEW."frequency" IS NOT OLD."frequency" OR NEW."weekly_days" IS NOT OLD."weekly_days" OR NEW."difficulty" IS NOT OLD."difficulty" OR NEW."recurrence_id" IS NOT OLD."recurrence_id" OR NEW."is_template" IS NOT OLD."is_template" OR NEW."rotation_member_ids" IS NOT OLD."rotation_member_ids" OR NEW."rotation_index" IS NOT OLD."rotation_index" OR NEW."routine" IS NOT OLD."routine" OR NEW."routine_order" IS NOT OLD."routine_order" OR NEW."routine_stack_id" IS NOT OLD."routine_stack_id" OR NEW."routine_anchor" IS NOT OLD."routine_anchor" OR NEW."routine_duration_minutes" IS NOT OLD."routine_duration_minutes" OR NEW."routine_series_config" IS NOT OLD."routine_series_config" OR NEW."icon" IS NOT OLD."icon" THEN 1 ELSE 0 END) WHERE id=NEW.id;
END;
CREATE TRIGGER "Chore_responsibility_bounds_insert" BEFORE INSERT ON "Chore"
WHEN typeof(NEW.responsibility_epoch)<>'integer' OR NEW.responsibility_epoch<0 OR NEW.responsibility_epoch>2147483647
BEGIN SELECT RAISE(ABORT,'Invalid responsibility epoch'); END;
CREATE TRIGGER "Chore_responsibility_bounds_update" BEFORE UPDATE ON "Chore"
WHEN typeof(NEW.responsibility_epoch)<>'integer' OR NEW.responsibility_epoch<0 OR NEW.responsibility_epoch>2147483647
BEGIN SELECT RAISE(ABORT,'Invalid responsibility epoch'); END;

CREATE TRIGGER "Pickup_responsibility_identity" BEFORE UPDATE ON "Pickup"
WHEN NEW.responsibility_generation IS NOT OLD.responsibility_generation
BEGIN SELECT RAISE(ABORT,'Responsibility generation is immutable'); END;
CREATE TRIGGER "Pickup_responsibility_family" BEFORE UPDATE OF family_id ON "Pickup"
WHEN NEW.family_id IS NOT OLD.family_id
BEGIN DELETE FROM "ResponsibilityState" WHERE family_id=OLD.family_id AND pickup_id=OLD.id; END;
CREATE TRIGGER "Pickup_responsibility_epoch" AFTER UPDATE ON "Pickup"
WHEN (NEW."family_id" IS NOT OLD."family_id" OR NEW."title" IS NOT OLD."title" OR NEW."location" IS NOT OLD."location" OR NEW."pickup_time" IS NOT OLD."pickup_time" OR NEW."assigned_to" IS NOT OLD."assigned_to" OR NEW."notes" IS NOT OLD."notes") OR NEW.responsibility_epoch<OLD.responsibility_epoch
BEGIN
  UPDATE "Pickup" SET responsibility_epoch=min(2147483647,max(OLD.responsibility_epoch,NEW.responsibility_epoch)+CASE WHEN NEW."family_id" IS NOT OLD."family_id" OR NEW."title" IS NOT OLD."title" OR NEW."location" IS NOT OLD."location" OR NEW."pickup_time" IS NOT OLD."pickup_time" OR NEW."assigned_to" IS NOT OLD."assigned_to" OR NEW."notes" IS NOT OLD."notes" THEN 1 ELSE 0 END) WHERE id=NEW.id;
END;
CREATE TRIGGER "Pickup_responsibility_bounds_insert" BEFORE INSERT ON "Pickup"
WHEN typeof(NEW.responsibility_epoch)<>'integer' OR NEW.responsibility_epoch<0 OR NEW.responsibility_epoch>2147483647
BEGIN SELECT RAISE(ABORT,'Invalid responsibility epoch'); END;
CREATE TRIGGER "Pickup_responsibility_bounds_update" BEFORE UPDATE ON "Pickup"
WHEN typeof(NEW.responsibility_epoch)<>'integer' OR NEW.responsibility_epoch<0 OR NEW.responsibility_epoch>2147483647
BEGIN SELECT RAISE(ABORT,'Invalid responsibility epoch'); END;

CREATE TRIGGER "Handoff_responsibility_identity" BEFORE UPDATE ON "Handoff"
WHEN NEW.responsibility_generation IS NOT OLD.responsibility_generation
BEGIN SELECT RAISE(ABORT,'Responsibility generation is immutable'); END;
CREATE TRIGGER "Handoff_responsibility_family" BEFORE UPDATE OF family_id ON "Handoff"
WHEN NEW.family_id IS NOT OLD.family_id
BEGIN DELETE FROM "ResponsibilityState" WHERE family_id=OLD.family_id AND handoff_id=OLD.id; END;
CREATE TRIGGER "Handoff_responsibility_epoch" AFTER UPDATE ON "Handoff"
WHEN (NEW."family_id" IS NOT OLD."family_id" OR NEW."sitter_name" IS NOT OLD."sitter_name" OR NEW."sitter_phone" IS NOT OLD."sitter_phone" OR NEW."arrival_time" IS NOT OLD."arrival_time" OR NEW."departure_time" IS NOT OLD."departure_time" OR NEW."kids_bedtimes" IS NOT OLD."kids_bedtimes" OR NEW."where_snacks" IS NOT OLD."where_snacks" OR NEW."pickup_authorized" IS NOT OLD."pickup_authorized" OR NEW."code_words" IS NOT OLD."code_words" OR NEW."pet_care" IS NOT OLD."pet_care" OR NEW."emergency_notes" IS NOT OLD."emergency_notes" OR NEW."house_notes" IS NOT OLD."house_notes" OR NEW."general_notes" IS NOT OLD."general_notes") OR NEW.responsibility_epoch<OLD.responsibility_epoch
BEGIN
  UPDATE "Handoff" SET responsibility_epoch=min(2147483647,max(OLD.responsibility_epoch,NEW.responsibility_epoch)+CASE WHEN NEW."family_id" IS NOT OLD."family_id" OR NEW."sitter_name" IS NOT OLD."sitter_name" OR NEW."sitter_phone" IS NOT OLD."sitter_phone" OR NEW."arrival_time" IS NOT OLD."arrival_time" OR NEW."departure_time" IS NOT OLD."departure_time" OR NEW."kids_bedtimes" IS NOT OLD."kids_bedtimes" OR NEW."where_snacks" IS NOT OLD."where_snacks" OR NEW."pickup_authorized" IS NOT OLD."pickup_authorized" OR NEW."code_words" IS NOT OLD."code_words" OR NEW."pet_care" IS NOT OLD."pet_care" OR NEW."emergency_notes" IS NOT OLD."emergency_notes" OR NEW."house_notes" IS NOT OLD."house_notes" OR NEW."general_notes" IS NOT OLD."general_notes" THEN 1 ELSE 0 END) WHERE id=NEW.id;
END;
CREATE TRIGGER "Handoff_responsibility_bounds_insert" BEFORE INSERT ON "Handoff"
WHEN typeof(NEW.responsibility_epoch)<>'integer' OR NEW.responsibility_epoch<0 OR NEW.responsibility_epoch>2147483647
BEGIN SELECT RAISE(ABORT,'Invalid responsibility epoch'); END;
CREATE TRIGGER "Handoff_responsibility_bounds_update" BEFORE UPDATE ON "Handoff"
WHEN typeof(NEW.responsibility_epoch)<>'integer' OR NEW.responsibility_epoch<0 OR NEW.responsibility_epoch>2147483647
BEGIN SELECT RAISE(ABORT,'Invalid responsibility epoch'); END;

CREATE TRIGGER "User_responsibility_retire_update" BEFORE UPDATE ON "User"
WHEN NEW.family_id IS NOT OLD.family_id OR NEW.role IS NOT OLD.role
BEGIN
  UPDATE "Chore" SET responsibility_epoch=min(2147483647,responsibility_epoch+1) WHERE assigned_to=OLD.id;
  UPDATE "Pickup" SET responsibility_epoch=min(2147483647,responsibility_epoch+1) WHERE assigned_to=OLD.id;
  UPDATE "Chore" SET responsibility_epoch=min(2147483647,responsibility_epoch+1) WHERE EXISTS(SELECT 1 FROM "ResponsibilityState" r WHERE r.chore_id="Chore".id AND r.family_id="Chore".family_id AND OLD.id IN (r.coordinator_id,r.backup_account_id,r.primary_subject_account_id,r.primary_by_id,r.backup_by_id));
  UPDATE "Pickup" SET responsibility_epoch=min(2147483647,responsibility_epoch+1) WHERE EXISTS(SELECT 1 FROM "ResponsibilityState" r WHERE r.pickup_id="Pickup".id AND r.family_id="Pickup".family_id AND OLD.id IN (r.coordinator_id,r.backup_account_id,r.primary_subject_account_id,r.primary_by_id,r.backup_by_id));
  UPDATE "Handoff" SET responsibility_epoch=min(2147483647,responsibility_epoch+1) WHERE EXISTS(SELECT 1 FROM "ResponsibilityState" r WHERE r.handoff_id="Handoff".id AND r.family_id="Handoff".family_id AND OLD.id IN (r.coordinator_id,r.backup_account_id,r.primary_subject_account_id,r.primary_by_id,r.backup_by_id));
  DELETE FROM "ResponsibilityState" AS r WHERE OLD.id IN (r.coordinator_id,r.backup_account_id,r.primary_subject_account_id,r.primary_by_id,r.backup_by_id);
END;

CREATE TRIGGER "User_responsibility_retire_delete" BEFORE DELETE ON "User"
BEGIN
  UPDATE "Chore" SET responsibility_epoch=min(2147483647,responsibility_epoch+1) WHERE assigned_to=OLD.id;
  UPDATE "Pickup" SET responsibility_epoch=min(2147483647,responsibility_epoch+1) WHERE assigned_to=OLD.id;
  UPDATE "Chore" SET responsibility_epoch=min(2147483647,responsibility_epoch+1) WHERE EXISTS(SELECT 1 FROM "ResponsibilityState" r WHERE r.chore_id="Chore".id AND r.family_id="Chore".family_id AND OLD.id IN (r.coordinator_id,r.backup_account_id,r.primary_subject_account_id,r.primary_by_id,r.backup_by_id));
  UPDATE "Pickup" SET responsibility_epoch=min(2147483647,responsibility_epoch+1) WHERE EXISTS(SELECT 1 FROM "ResponsibilityState" r WHERE r.pickup_id="Pickup".id AND r.family_id="Pickup".family_id AND OLD.id IN (r.coordinator_id,r.backup_account_id,r.primary_subject_account_id,r.primary_by_id,r.backup_by_id));
  UPDATE "Handoff" SET responsibility_epoch=min(2147483647,responsibility_epoch+1) WHERE EXISTS(SELECT 1 FROM "ResponsibilityState" r WHERE r.handoff_id="Handoff".id AND r.family_id="Handoff".family_id AND OLD.id IN (r.coordinator_id,r.backup_account_id,r.primary_subject_account_id,r.primary_by_id,r.backup_by_id));
  DELETE FROM "ResponsibilityState" AS r WHERE OLD.id IN (r.coordinator_id,r.backup_account_id,r.primary_subject_account_id,r.primary_by_id,r.backup_by_id);
END;

CREATE TRIGGER "HouseholdMember_responsibility_retire_update" BEFORE UPDATE ON "HouseholdMember"
WHEN NEW.family_id IS NOT OLD.family_id OR NEW.role IS NOT OLD.role OR NEW.age IS NOT OLD.age OR NEW.archived_at IS NOT OLD.archived_at OR NEW.erasure_user_id IS NOT OLD.erasure_user_id
BEGIN
  UPDATE "Chore" SET responsibility_epoch=min(2147483647,responsibility_epoch+1) WHERE assigned_member_id=OLD.id;
  UPDATE "Chore" SET responsibility_epoch=min(2147483647,responsibility_epoch+1) WHERE EXISTS(SELECT 1 FROM "ResponsibilityState" r WHERE r.chore_id="Chore".id AND r.family_id="Chore".family_id AND OLD.id IN (r.backup_member_id,r.primary_subject_member_id));
  UPDATE "Pickup" SET responsibility_epoch=min(2147483647,responsibility_epoch+1) WHERE EXISTS(SELECT 1 FROM "ResponsibilityState" r WHERE r.pickup_id="Pickup".id AND r.family_id="Pickup".family_id AND OLD.id IN (r.backup_member_id,r.primary_subject_member_id));
  UPDATE "Handoff" SET responsibility_epoch=min(2147483647,responsibility_epoch+1) WHERE EXISTS(SELECT 1 FROM "ResponsibilityState" r WHERE r.handoff_id="Handoff".id AND r.family_id="Handoff".family_id AND OLD.id IN (r.backup_member_id,r.primary_subject_member_id));
  DELETE FROM "ResponsibilityState" AS r WHERE OLD.id IN (r.backup_member_id,r.primary_subject_member_id);
END;

CREATE TRIGGER "HouseholdMember_responsibility_retire_delete" BEFORE DELETE ON "HouseholdMember"
BEGIN
  UPDATE "Chore" SET responsibility_epoch=min(2147483647,responsibility_epoch+1) WHERE assigned_member_id=OLD.id;
  UPDATE "Chore" SET responsibility_epoch=min(2147483647,responsibility_epoch+1) WHERE EXISTS(SELECT 1 FROM "ResponsibilityState" r WHERE r.chore_id="Chore".id AND r.family_id="Chore".family_id AND OLD.id IN (r.backup_member_id,r.primary_subject_member_id));
  UPDATE "Pickup" SET responsibility_epoch=min(2147483647,responsibility_epoch+1) WHERE EXISTS(SELECT 1 FROM "ResponsibilityState" r WHERE r.pickup_id="Pickup".id AND r.family_id="Pickup".family_id AND OLD.id IN (r.backup_member_id,r.primary_subject_member_id));
  UPDATE "Handoff" SET responsibility_epoch=min(2147483647,responsibility_epoch+1) WHERE EXISTS(SELECT 1 FROM "ResponsibilityState" r WHERE r.handoff_id="Handoff".id AND r.family_id="Handoff".family_id AND OLD.id IN (r.backup_member_id,r.primary_subject_member_id));
  DELETE FROM "ResponsibilityState" AS r WHERE OLD.id IN (r.backup_member_id,r.primary_subject_member_id);
END;

CREATE TRIGGER "HouseholdMemberLegacyMapping_responsibility_retire_insert" AFTER INSERT ON "HouseholdMemberLegacyMapping"
BEGIN
  UPDATE "Chore" SET responsibility_epoch=min(2147483647,responsibility_epoch+1) WHERE assigned_member_id=NEW.member_id;
  UPDATE "Chore" SET responsibility_epoch=min(2147483647,responsibility_epoch+1) WHERE EXISTS(SELECT 1 FROM "ResponsibilityState" r WHERE r.chore_id="Chore".id AND r.family_id="Chore".family_id AND NEW.member_id IN (r.backup_member_id,r.primary_subject_member_id));
  UPDATE "Pickup" SET responsibility_epoch=min(2147483647,responsibility_epoch+1) WHERE EXISTS(SELECT 1 FROM "ResponsibilityState" r WHERE r.pickup_id="Pickup".id AND r.family_id="Pickup".family_id AND NEW.member_id IN (r.backup_member_id,r.primary_subject_member_id));
  UPDATE "Handoff" SET responsibility_epoch=min(2147483647,responsibility_epoch+1) WHERE EXISTS(SELECT 1 FROM "ResponsibilityState" r WHERE r.handoff_id="Handoff".id AND r.family_id="Handoff".family_id AND NEW.member_id IN (r.backup_member_id,r.primary_subject_member_id));
  DELETE FROM "ResponsibilityState" AS r WHERE NEW.member_id IN (r.backup_member_id,r.primary_subject_member_id);
END;

CREATE TRIGGER "HouseholdMemberLegacyMapping_responsibility_retire_update" AFTER UPDATE ON "HouseholdMemberLegacyMapping"
BEGIN
  UPDATE "Chore" SET responsibility_epoch=min(2147483647,responsibility_epoch+1) WHERE assigned_member_id=OLD.member_id;
  UPDATE "Chore" SET responsibility_epoch=min(2147483647,responsibility_epoch+1) WHERE EXISTS(SELECT 1 FROM "ResponsibilityState" r WHERE r.chore_id="Chore".id AND r.family_id="Chore".family_id AND OLD.member_id IN (r.backup_member_id,r.primary_subject_member_id));
  UPDATE "Pickup" SET responsibility_epoch=min(2147483647,responsibility_epoch+1) WHERE EXISTS(SELECT 1 FROM "ResponsibilityState" r WHERE r.pickup_id="Pickup".id AND r.family_id="Pickup".family_id AND OLD.member_id IN (r.backup_member_id,r.primary_subject_member_id));
  UPDATE "Handoff" SET responsibility_epoch=min(2147483647,responsibility_epoch+1) WHERE EXISTS(SELECT 1 FROM "ResponsibilityState" r WHERE r.handoff_id="Handoff".id AND r.family_id="Handoff".family_id AND OLD.member_id IN (r.backup_member_id,r.primary_subject_member_id));
  DELETE FROM "ResponsibilityState" AS r WHERE OLD.member_id IN (r.backup_member_id,r.primary_subject_member_id);
  UPDATE "Chore" SET responsibility_epoch=min(2147483647,responsibility_epoch+1) WHERE assigned_member_id=NEW.member_id;
  UPDATE "Chore" SET responsibility_epoch=min(2147483647,responsibility_epoch+1) WHERE EXISTS(SELECT 1 FROM "ResponsibilityState" r WHERE r.chore_id="Chore".id AND r.family_id="Chore".family_id AND NEW.member_id IN (r.backup_member_id,r.primary_subject_member_id));
  UPDATE "Pickup" SET responsibility_epoch=min(2147483647,responsibility_epoch+1) WHERE EXISTS(SELECT 1 FROM "ResponsibilityState" r WHERE r.pickup_id="Pickup".id AND r.family_id="Pickup".family_id AND NEW.member_id IN (r.backup_member_id,r.primary_subject_member_id));
  UPDATE "Handoff" SET responsibility_epoch=min(2147483647,responsibility_epoch+1) WHERE EXISTS(SELECT 1 FROM "ResponsibilityState" r WHERE r.handoff_id="Handoff".id AND r.family_id="Handoff".family_id AND NEW.member_id IN (r.backup_member_id,r.primary_subject_member_id));
  DELETE FROM "ResponsibilityState" AS r WHERE NEW.member_id IN (r.backup_member_id,r.primary_subject_member_id);
END;

CREATE TRIGGER "HouseholdMemberLegacyMapping_responsibility_retire_delete" AFTER DELETE ON "HouseholdMemberLegacyMapping"
BEGIN
  UPDATE "Chore" SET responsibility_epoch=min(2147483647,responsibility_epoch+1) WHERE assigned_member_id=OLD.member_id;
  UPDATE "Chore" SET responsibility_epoch=min(2147483647,responsibility_epoch+1) WHERE EXISTS(SELECT 1 FROM "ResponsibilityState" r WHERE r.chore_id="Chore".id AND r.family_id="Chore".family_id AND OLD.member_id IN (r.backup_member_id,r.primary_subject_member_id));
  UPDATE "Pickup" SET responsibility_epoch=min(2147483647,responsibility_epoch+1) WHERE EXISTS(SELECT 1 FROM "ResponsibilityState" r WHERE r.pickup_id="Pickup".id AND r.family_id="Pickup".family_id AND OLD.member_id IN (r.backup_member_id,r.primary_subject_member_id));
  UPDATE "Handoff" SET responsibility_epoch=min(2147483647,responsibility_epoch+1) WHERE EXISTS(SELECT 1 FROM "ResponsibilityState" r WHERE r.handoff_id="Handoff".id AND r.family_id="Handoff".family_id AND OLD.member_id IN (r.backup_member_id,r.primary_subject_member_id));
  DELETE FROM "ResponsibilityState" AS r WHERE OLD.member_id IN (r.backup_member_id,r.primary_subject_member_id);
END;

CREATE TRIGGER "HouseholdMemberAccountLink_responsibility_retire_insert" AFTER INSERT ON "HouseholdMemberAccountLink"
BEGIN
  UPDATE "Chore" SET responsibility_epoch=min(2147483647,responsibility_epoch+1) WHERE assigned_member_id=NEW.member_id;
  UPDATE "Chore" SET responsibility_epoch=min(2147483647,responsibility_epoch+1) WHERE EXISTS(SELECT 1 FROM "ResponsibilityState" r WHERE r.chore_id="Chore".id AND r.family_id="Chore".family_id AND NEW.member_id IN (r.backup_member_id,r.primary_subject_member_id));
  UPDATE "Pickup" SET responsibility_epoch=min(2147483647,responsibility_epoch+1) WHERE EXISTS(SELECT 1 FROM "ResponsibilityState" r WHERE r.pickup_id="Pickup".id AND r.family_id="Pickup".family_id AND NEW.member_id IN (r.backup_member_id,r.primary_subject_member_id));
  UPDATE "Handoff" SET responsibility_epoch=min(2147483647,responsibility_epoch+1) WHERE EXISTS(SELECT 1 FROM "ResponsibilityState" r WHERE r.handoff_id="Handoff".id AND r.family_id="Handoff".family_id AND NEW.member_id IN (r.backup_member_id,r.primary_subject_member_id));
  DELETE FROM "ResponsibilityState" AS r WHERE NEW.member_id IN (r.backup_member_id,r.primary_subject_member_id);
END;

CREATE TRIGGER "HouseholdMemberAccountLink_responsibility_retire_update" AFTER UPDATE ON "HouseholdMemberAccountLink"
BEGIN
  UPDATE "Chore" SET responsibility_epoch=min(2147483647,responsibility_epoch+1) WHERE assigned_member_id=OLD.member_id;
  UPDATE "Chore" SET responsibility_epoch=min(2147483647,responsibility_epoch+1) WHERE EXISTS(SELECT 1 FROM "ResponsibilityState" r WHERE r.chore_id="Chore".id AND r.family_id="Chore".family_id AND OLD.member_id IN (r.backup_member_id,r.primary_subject_member_id));
  UPDATE "Pickup" SET responsibility_epoch=min(2147483647,responsibility_epoch+1) WHERE EXISTS(SELECT 1 FROM "ResponsibilityState" r WHERE r.pickup_id="Pickup".id AND r.family_id="Pickup".family_id AND OLD.member_id IN (r.backup_member_id,r.primary_subject_member_id));
  UPDATE "Handoff" SET responsibility_epoch=min(2147483647,responsibility_epoch+1) WHERE EXISTS(SELECT 1 FROM "ResponsibilityState" r WHERE r.handoff_id="Handoff".id AND r.family_id="Handoff".family_id AND OLD.member_id IN (r.backup_member_id,r.primary_subject_member_id));
  DELETE FROM "ResponsibilityState" AS r WHERE OLD.member_id IN (r.backup_member_id,r.primary_subject_member_id);
  UPDATE "Chore" SET responsibility_epoch=min(2147483647,responsibility_epoch+1) WHERE assigned_member_id=NEW.member_id;
  UPDATE "Chore" SET responsibility_epoch=min(2147483647,responsibility_epoch+1) WHERE EXISTS(SELECT 1 FROM "ResponsibilityState" r WHERE r.chore_id="Chore".id AND r.family_id="Chore".family_id AND NEW.member_id IN (r.backup_member_id,r.primary_subject_member_id));
  UPDATE "Pickup" SET responsibility_epoch=min(2147483647,responsibility_epoch+1) WHERE EXISTS(SELECT 1 FROM "ResponsibilityState" r WHERE r.pickup_id="Pickup".id AND r.family_id="Pickup".family_id AND NEW.member_id IN (r.backup_member_id,r.primary_subject_member_id));
  UPDATE "Handoff" SET responsibility_epoch=min(2147483647,responsibility_epoch+1) WHERE EXISTS(SELECT 1 FROM "ResponsibilityState" r WHERE r.handoff_id="Handoff".id AND r.family_id="Handoff".family_id AND NEW.member_id IN (r.backup_member_id,r.primary_subject_member_id));
  DELETE FROM "ResponsibilityState" AS r WHERE NEW.member_id IN (r.backup_member_id,r.primary_subject_member_id);
END;

CREATE TRIGGER "HouseholdMemberAccountLink_responsibility_retire_delete" AFTER DELETE ON "HouseholdMemberAccountLink"
BEGIN
  UPDATE "Chore" SET responsibility_epoch=min(2147483647,responsibility_epoch+1) WHERE assigned_member_id=OLD.member_id;
  UPDATE "Chore" SET responsibility_epoch=min(2147483647,responsibility_epoch+1) WHERE EXISTS(SELECT 1 FROM "ResponsibilityState" r WHERE r.chore_id="Chore".id AND r.family_id="Chore".family_id AND OLD.member_id IN (r.backup_member_id,r.primary_subject_member_id));
  UPDATE "Pickup" SET responsibility_epoch=min(2147483647,responsibility_epoch+1) WHERE EXISTS(SELECT 1 FROM "ResponsibilityState" r WHERE r.pickup_id="Pickup".id AND r.family_id="Pickup".family_id AND OLD.member_id IN (r.backup_member_id,r.primary_subject_member_id));
  UPDATE "Handoff" SET responsibility_epoch=min(2147483647,responsibility_epoch+1) WHERE EXISTS(SELECT 1 FROM "ResponsibilityState" r WHERE r.handoff_id="Handoff".id AND r.family_id="Handoff".family_id AND OLD.member_id IN (r.backup_member_id,r.primary_subject_member_id));
  DELETE FROM "ResponsibilityState" AS r WHERE OLD.member_id IN (r.backup_member_id,r.primary_subject_member_id);
END;
