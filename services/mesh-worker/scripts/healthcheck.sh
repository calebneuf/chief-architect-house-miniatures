#!/bin/sh
set -eu
curl -fsS --max-time 5 http://127.0.0.1:8000/health >/dev/null
