#!/usr/bin/env bash
# Creates infrastructure/passwd with a backend user and a device user (prompts for passwords).
set -euo pipefail
cd "$(dirname "$0")"
touch passwd
docker run --rm -it -v "$PWD/passwd:/passwd" eclipse-mosquitto:2.0.18 mosquitto_passwd /passwd mec-backend
docker run --rm -it -v "$PWD/passwd:/passwd" eclipse-mosquitto:2.0.18 mosquitto_passwd /passwd node1
echo "Done. Start with: MOSQUITTO_CONF=mosquitto.secure.conf docker compose -f infrastructure/docker-compose.yml up -d"
