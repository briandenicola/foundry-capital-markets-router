#!/usr/bin/env bash
# Enforces a line-coverage threshold for a named assembly.
#
# Usage: ./scripts/check-coverage.sh <threshold-percent> <assembly-name>
#
# This is a gate, not a report. Coverage below the threshold fails the build, per the
# constitution's quality gate.
set -euo pipefail

THRESHOLD="${1:?usage: check-coverage.sh <threshold> <assembly>}"
ASSEMBLY="${2:?usage: check-coverage.sh <threshold> <assembly>}"
RESULTS_DIR="${3:-./TestResults}"

REPORT=$(find "$RESULTS_DIR" -name 'coverage.cobertura.xml' -print -quit 2>/dev/null || true)

if [ -z "$REPORT" ]; then
  echo "FAIL: no coverage report found under ${RESULTS_DIR}."
  echo "Run: dotnet test --collect:\"XPlat Code Coverage\" --results-directory ${RESULTS_DIR}"
  exit 1
fi

RATE=$(python3 - "$REPORT" "$ASSEMBLY" <<'PY'
import sys, xml.etree.ElementTree as ET
report, assembly = sys.argv[1], sys.argv[2]
root = ET.parse(report).getroot()
covered = valid = 0
for pkg in root.iter('package'):
    if assembly.lower() not in (pkg.get('name') or '').lower():
        continue
    for line in pkg.iter('line'):
        valid += 1
        if int(line.get('hits', '0')) > 0:
            covered += 1
print(round(100.0 * covered / valid, 2) if valid else -1.0)
PY
)

if [ "$(python3 -c "print(1 if float('$RATE') < 0 else 0)")" = "1" ]; then
  echo "FAIL: assembly '${ASSEMBLY}' not found in the coverage report."
  exit 1
fi

if [ "$(python3 -c "print(1 if float('$RATE') < float('$THRESHOLD') else 0)")" = "1" ]; then
  echo "FAIL: ${ASSEMBLY} coverage ${RATE}% is below the ${THRESHOLD}% threshold."
  exit 1
fi

echo "PASS: ${ASSEMBLY} coverage ${RATE}% meets the ${THRESHOLD}% threshold."
