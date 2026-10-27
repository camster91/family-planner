-- #134 expand-only support for full-intent project calendar sends.
-- Source only: no index creation, migration or activation has been run.
CREATE INDEX IF NOT EXISTS "ProjectTask_project_id_id_idx"
  ON "ProjectTask" ("project_id", "id");
CREATE INDEX IF NOT EXISTS "Event_family_id_project_id_is_task_source_uid_idx"
  ON "Event" ("family_id", "project_id", "is_task", "source_uid");
CREATE INDEX IF NOT EXISTS "Event_family_id_project_id_is_task_title_idx"
  ON "Event" ("family_id", "project_id", "is_task", "title");
