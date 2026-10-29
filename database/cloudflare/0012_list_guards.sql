-- Canonical recipe-source convergence: a checked row can reopen only while
-- no matching open source/ingredient row already exists on that list.
CREATE UNIQUE INDEX ListItem_open_recipe_source_key
ON ListItem(list_id,ingredient_id,source_key)
WHERE checked=0 AND source_key IS NOT NULL AND ingredient_id IS NOT NULL;
