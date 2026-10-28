-- Internal batch assertion target. Successful assertions insert no rows;
-- failed assertions violate the named CHECK and roll back the entire D1 batch.
CREATE TABLE "_D1WriteCheck" (
  "ok" INTEGER NOT NULL CONSTRAINT "herewoven_d1_write_precondition" CHECK ("ok"=1)
);

CREATE TRIGGER "Chore_subject_insert" BEFORE INSERT ON "Chore"
BEGIN
  SELECT CASE WHEN NEW.member_subject_erased=1 AND NEW.assigned_member_id IS NOT NULL
    THEN RAISE(ABORT,'Erased subject cannot retain a member') END;
  SELECT CASE WHEN NEW.assigned_to IS NULL AND NEW.assigned_member_id IS NULL AND NEW.member_subject_erased=0
    THEN RAISE(ABORT,'Chore needs an account or profile subject') END;
  SELECT CASE WHEN 1 AND NEW.assigned_member_id IS NOT NULL AND NEW.assigned_to IS NULL AND (
    NEW.member_subject_erased=1 OR NOT EXISTS (
      SELECT 1 FROM "HouseholdMember" m WHERE m.id=NEW.assigned_member_id AND m.family_id=NEW.family_id
      AND m.archived_at IS NULL AND m.erasure_user_id IS NULL AND m.role IN ('child','teen','parent')
      AND (m.age IS NULL OR (m.role='child' AND m.age BETWEEN 0 AND 17) OR (m.role='teen' AND m.age BETWEEN 13 AND 17) OR (m.role='parent' AND m.age BETWEEN 18 AND 120))
    ) OR EXISTS (SELECT 1 FROM "HouseholdMemberLegacyMapping" WHERE member_id=NEW.assigned_member_id AND family_id=NEW.family_id)
      OR EXISTS (SELECT 1 FROM "HouseholdMemberAccountLink" WHERE member_id=NEW.assigned_member_id AND family_id=NEW.family_id)
  ) THEN RAISE(ABORT,'Profile chore subject must be active and unlinked') END;
  SELECT CASE WHEN 1 AND NEW.assigned_member_id IS NOT NULL AND NEW.assigned_to IS NOT NULL AND (
    NOT EXISTS (SELECT 1 FROM "HouseholdMember" WHERE id=NEW.assigned_member_id AND family_id=NEW.family_id AND erasure_user_id IS NULL)
    OR NOT (EXISTS (SELECT 1 FROM "HouseholdMemberLegacyMapping" WHERE member_id=NEW.assigned_member_id AND user_id=NEW.assigned_to AND family_id=NEW.family_id)
      OR EXISTS (SELECT 1 FROM "HouseholdMemberAccountLink" WHERE member_id=NEW.assigned_member_id AND user_id=NEW.assigned_to AND family_id=NEW.family_id))
    OR EXISTS (SELECT 1 FROM "HouseholdMemberLegacyMapping" WHERE member_id=NEW.assigned_member_id AND family_id=NEW.family_id AND user_id<>NEW.assigned_to)
    OR EXISTS (SELECT 1 FROM "HouseholdMemberAccountLink" WHERE member_id=NEW.assigned_member_id AND family_id=NEW.family_id AND user_id<>NEW.assigned_to)
  ) THEN RAISE(ABORT,'Chore subject requires explicit account reconciliation') END;
END;

CREATE TRIGGER "Chore_subject_update" BEFORE UPDATE ON "Chore"
BEGIN
  SELECT CASE WHEN NEW.member_subject_erased=1 AND NEW.assigned_member_id IS NOT NULL
    THEN RAISE(ABORT,'Erased subject cannot retain a member') END;
  SELECT CASE WHEN NEW.assigned_to IS NULL AND NEW.assigned_member_id IS NULL AND NEW.member_subject_erased=0
    THEN RAISE(ABORT,'Chore needs an account or profile subject') END;
  SELECT CASE WHEN OLD.member_subject_erased=1 AND (NEW.assigned_to IS NOT OLD.assigned_to OR NEW.assigned_member_id IS NOT OLD.assigned_member_id OR NEW.family_id IS NOT OLD.family_id OR NEW.member_subject_erased<>1)
    THEN RAISE(ABORT,'Erased subject cannot be reassigned or restored') END;
  SELECT CASE WHEN OLD.assigned_member_id IS NOT NULL AND NEW.assigned_member_id IS NULL AND NEW.member_subject_erased<>1
    THEN RAISE(ABORT,'Canonical subject needs explicit erasure') END;
  SELECT CASE WHEN (NEW.assigned_member_id IS NOT OLD.assigned_member_id OR NEW.assigned_to IS NOT OLD.assigned_to OR NEW.family_id IS NOT OLD.family_id) AND NEW.assigned_member_id IS NOT NULL AND NEW.assigned_to IS NULL AND (
    NEW.member_subject_erased=1 OR NOT EXISTS (
      SELECT 1 FROM "HouseholdMember" m WHERE m.id=NEW.assigned_member_id AND m.family_id=NEW.family_id
      AND m.archived_at IS NULL AND m.erasure_user_id IS NULL AND m.role IN ('child','teen','parent')
      AND (m.age IS NULL OR (m.role='child' AND m.age BETWEEN 0 AND 17) OR (m.role='teen' AND m.age BETWEEN 13 AND 17) OR (m.role='parent' AND m.age BETWEEN 18 AND 120))
    ) OR EXISTS (SELECT 1 FROM "HouseholdMemberLegacyMapping" WHERE member_id=NEW.assigned_member_id AND family_id=NEW.family_id)
      OR EXISTS (SELECT 1 FROM "HouseholdMemberAccountLink" WHERE member_id=NEW.assigned_member_id AND family_id=NEW.family_id)
  ) THEN RAISE(ABORT,'Profile chore subject must be active and unlinked') END;
  SELECT CASE WHEN (NEW.assigned_member_id IS NOT OLD.assigned_member_id OR NEW.assigned_to IS NOT OLD.assigned_to OR NEW.family_id IS NOT OLD.family_id) AND NEW.assigned_member_id IS NOT NULL AND NEW.assigned_to IS NOT NULL AND (
    NOT EXISTS (SELECT 1 FROM "HouseholdMember" WHERE id=NEW.assigned_member_id AND family_id=NEW.family_id AND erasure_user_id IS NULL)
    OR NOT (EXISTS (SELECT 1 FROM "HouseholdMemberLegacyMapping" WHERE member_id=NEW.assigned_member_id AND user_id=NEW.assigned_to AND family_id=NEW.family_id)
      OR EXISTS (SELECT 1 FROM "HouseholdMemberAccountLink" WHERE member_id=NEW.assigned_member_id AND user_id=NEW.assigned_to AND family_id=NEW.family_id))
    OR EXISTS (SELECT 1 FROM "HouseholdMemberLegacyMapping" WHERE member_id=NEW.assigned_member_id AND family_id=NEW.family_id AND user_id<>NEW.assigned_to)
    OR EXISTS (SELECT 1 FROM "HouseholdMemberAccountLink" WHERE member_id=NEW.assigned_member_id AND family_id=NEW.family_id AND user_id<>NEW.assigned_to)
  ) THEN RAISE(ABORT,'Chore subject requires explicit account reconciliation') END;
END;

CREATE TRIGGER "ChoreAssignment_subject_insert" BEFORE INSERT ON "ChoreAssignment"
BEGIN
  SELECT CASE WHEN NEW.member_subject_erased=1 AND NEW.assigned_member_id IS NOT NULL
    THEN RAISE(ABORT,'Erased subject cannot retain a member') END;
  SELECT CASE WHEN 1 AND NEW.assigned_member_id IS NOT NULL AND NEW.assigned_to IS NOT NULL AND (
    NOT EXISTS (SELECT 1 FROM "HouseholdMember" WHERE id=NEW.assigned_member_id AND family_id=NEW.family_id AND erasure_user_id IS NULL)
    OR NOT (EXISTS (SELECT 1 FROM "HouseholdMemberLegacyMapping" WHERE member_id=NEW.assigned_member_id AND user_id=NEW.assigned_to AND family_id=NEW.family_id)
      OR EXISTS (SELECT 1 FROM "HouseholdMemberAccountLink" WHERE member_id=NEW.assigned_member_id AND user_id=NEW.assigned_to AND family_id=NEW.family_id))
    OR EXISTS (SELECT 1 FROM "HouseholdMemberLegacyMapping" WHERE member_id=NEW.assigned_member_id AND family_id=NEW.family_id AND user_id<>NEW.assigned_to)
    OR EXISTS (SELECT 1 FROM "HouseholdMemberAccountLink" WHERE member_id=NEW.assigned_member_id AND family_id=NEW.family_id AND user_id<>NEW.assigned_to)
  ) THEN RAISE(ABORT,'Chore subject requires explicit account reconciliation') END;
END;

CREATE TRIGGER "ChoreAssignment_subject_update" BEFORE UPDATE ON "ChoreAssignment"
BEGIN
  SELECT CASE WHEN NEW.member_subject_erased=1 AND NEW.assigned_member_id IS NOT NULL
    THEN RAISE(ABORT,'Erased subject cannot retain a member') END;
  SELECT CASE WHEN OLD.member_subject_erased=1 AND (NEW.assigned_to IS NOT OLD.assigned_to OR NEW.assigned_member_id IS NOT OLD.assigned_member_id OR NEW.family_id IS NOT OLD.family_id OR NEW.member_subject_erased<>1)
    THEN RAISE(ABORT,'Erased subject cannot be reassigned or restored') END;
  SELECT CASE WHEN OLD.assigned_member_id IS NOT NULL AND NEW.assigned_member_id IS NULL AND NEW.member_subject_erased<>1
    THEN RAISE(ABORT,'Canonical subject needs explicit erasure') END;
  SELECT CASE WHEN (NEW.assigned_member_id IS NOT OLD.assigned_member_id OR NEW.assigned_to IS NOT OLD.assigned_to OR NEW.family_id IS NOT OLD.family_id) AND NEW.assigned_member_id IS NOT NULL AND NEW.assigned_to IS NOT NULL AND (
    NOT EXISTS (SELECT 1 FROM "HouseholdMember" WHERE id=NEW.assigned_member_id AND family_id=NEW.family_id AND erasure_user_id IS NULL)
    OR NOT (EXISTS (SELECT 1 FROM "HouseholdMemberLegacyMapping" WHERE member_id=NEW.assigned_member_id AND user_id=NEW.assigned_to AND family_id=NEW.family_id)
      OR EXISTS (SELECT 1 FROM "HouseholdMemberAccountLink" WHERE member_id=NEW.assigned_member_id AND user_id=NEW.assigned_to AND family_id=NEW.family_id))
    OR EXISTS (SELECT 1 FROM "HouseholdMemberLegacyMapping" WHERE member_id=NEW.assigned_member_id AND family_id=NEW.family_id AND user_id<>NEW.assigned_to)
    OR EXISTS (SELECT 1 FROM "HouseholdMemberAccountLink" WHERE member_id=NEW.assigned_member_id AND family_id=NEW.family_id AND user_id<>NEW.assigned_to)
  ) THEN RAISE(ABORT,'Chore subject requires explicit account reconciliation') END;
END;

CREATE TRIGGER "HouseholdMember_profile_chore_age_guard"
BEFORE UPDATE OF role,age,archived_at ON "HouseholdMember"
WHEN (NEW.role IS NOT OLD.role OR NEW.age IS NOT OLD.age OR NEW.archived_at IS NOT OLD.archived_at)
  AND NEW.archived_at IS NULL
  AND EXISTS (SELECT 1 FROM "Chore" WHERE family_id=NEW.family_id AND assigned_member_id=NEW.id AND assigned_to IS NULL AND member_subject_erased=0)
  AND (NEW.role NOT IN ('parent','teen','child') OR (NEW.age IS NOT NULL AND NOT (
    (NEW.role='child' AND NEW.age BETWEEN 0 AND 17) OR (NEW.role='teen' AND NEW.age BETWEEN 13 AND 17) OR (NEW.role='parent' AND NEW.age BETWEEN 18 AND 120))))
BEGIN SELECT RAISE(ABORT,'Profile chore role and age are incompatible'); END;

CREATE TRIGGER "Chore_routine_insert" BEFORE INSERT ON "Chore"
WHEN (NEW.routine_duration_minutes IS NOT NULL AND NEW.routine_duration_minutes NOT BETWEEN 1 AND 1440) OR (NEW.routine_series_config IS NOT NULL AND (json_type(NEW.routine_series_config)<>'object' OR json_extract(NEW.routine_series_config,'$.protocol') IS NOT 'herewoven.routine-step-series.v1'))
BEGIN SELECT RAISE(ABORT,'Unsupported routine protocol or duration'); END;

CREATE TRIGGER "Chore_routine_update" BEFORE UPDATE ON "Chore"
WHEN (NEW.routine_duration_minutes IS NOT NULL AND NEW.routine_duration_minutes NOT BETWEEN 1 AND 1440) OR (NEW.routine_series_config IS NOT NULL AND (json_type(NEW.routine_series_config)<>'object' OR json_extract(NEW.routine_series_config,'$.protocol') IS NOT 'herewoven.routine-step-series.v1'))
BEGIN SELECT RAISE(ABORT,'Unsupported routine protocol or duration'); END;

CREATE TRIGGER "RoutineStack_routine_insert" BEFORE INSERT ON "RoutineStack"
WHEN NEW.schedule_config IS NOT NULL AND (json_type(NEW.schedule_config)<>'object' OR json_extract(NEW.schedule_config,'$.protocol') IS NOT 'herewoven.routine-schedule.v1')
BEGIN SELECT RAISE(ABORT,'Unsupported routine protocol or duration'); END;

CREATE TRIGGER "RoutineStack_routine_update" BEFORE UPDATE ON "RoutineStack"
WHEN NEW.schedule_config IS NOT NULL AND (json_type(NEW.schedule_config)<>'object' OR json_extract(NEW.schedule_config,'$.protocol') IS NOT 'herewoven.routine-schedule.v1')
BEGIN SELECT RAISE(ABORT,'Unsupported routine protocol or duration'); END;
