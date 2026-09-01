#!/usr/bin/env bash
set -euo pipefail

mapfile -t containers < <(
  docker ps -a \
    --filter 'name=family-planner-review' \
    --format '{{.ID}}'
)

if (( ${#containers[@]} == 0 )); then
  echo 'No container matching family-planner-review was found.'
  echo 'Related running containers:'
  docker ps \
    --filter 'name=family-planner' \
    --format 'name={{.Names}} image={{.Image}} status={{.Status}}'
  exit 1
fi

for container_id in "${containers[@]}"; do
  docker inspect --format \
    'name={{.Name}} image={{.Config.Image}} image_id={{.Image}} status={{.State.Status}} health={{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}} restart={{.HostConfig.RestartPolicy.Name}} compose_project={{index .Config.Labels "com.docker.compose.project"}} compose_file={{index .Config.Labels "com.docker.compose.project.config_files"}} compose_workdir={{index .Config.Labels "com.docker.compose.project.working_dir"}} revision={{index .Config.Labels "org.opencontainers.image.revision"}}' \
    "$container_id"

  docker inspect --format \
    '{{range $name, $_ := .NetworkSettings.Networks}}network={{$name}} {{end}}' \
    "$container_id"

  docker port "$container_id" || true
done

echo 'Review health:'
curl --fail --silent --show-error --max-time 15 \
  https://family-review.ashbi.ca/api/health
