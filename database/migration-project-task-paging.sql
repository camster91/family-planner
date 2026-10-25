-- #134 additive task-keyset index. Source only; no backfill or activation.
CREATE INDEX IF NOT EXISTS "ProjectTask_project_id_position_created_at_id_idx"
  ON "ProjectTask" ("project_id", "position", "created_at", "id");
