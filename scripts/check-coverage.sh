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

# Every report is read, not just the first. Each test project emits its own file, and taking
# only one silently measures the wrong assembly the moment a second test project is added.
mapfile -t REPORTS < <(find "$RESULTS_DIR" -name 'coverage.cobertura.xml' 2>/dev/null || true)

if [ "${#REPORTS[@]}" -eq 0 ]; then
  echo "FAIL: no coverage report found under ${RESULTS_DIR}."
  echo "Run: dotnet test --collect:\"XPlat Code Coverage\" --results-directory ${RESULTS_DIR}"
  exit 1
fi

RATE=$(python3 - "$ASSEMBLY" "${REPORTS[@]}" <<'COVPY'
import sys, xml.etree.ElementTree as ET
assembly, reports = sys.argv[1], sys.argv[2:]
# A line is covered if any report covers it, so the union is taken rather than the sum. Summing
# would double-count lines appearing in more than one report and inflate the result.
seen = {}
for report in reports:
    root = ET.parse(report).getroot()
    for pkg in root.iter('package'):
        if assembly.lower() not in (pkg.get('name') or '').lower():
            continue
        for cls in pkg.iter('class'):
            filename = cls.get('filename') or ''
            # Different test projects report the same source file under different roots: one
            # emits 'TierSelector.cs', another 'Fcmr.Router.Decisions/TierSelector.cs'. Keyed
            # raw, the same line counts twice — once covered and once not — and the union
            # understates coverage by exactly the duplicated set. The leading assembly directory
            # is stripped so the two spellings collapse onto one key.
            prefix = assembly.lower() + '/'
            while filename.lower().startswith(prefix):
                filename = filename[len(prefix):]
            for line in cls.iter('line'):
                key = (filename, line.get('number'))
                seen[key] = max(seen.get(key, 0), int(line.get('hits', '0')))
valid = len(seen)
covered = sum(1 for h in seen.values() if h > 0)
print(round(100.0 * covered / valid, 2) if valid else -1.0)
COVPY
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
