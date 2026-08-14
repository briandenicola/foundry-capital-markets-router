#!/usr/bin/env bash
#
# Fails the build if any code path could render simulated agent reasoning.
#
# ADR-007: a fallback is permitted when it changes *where real evidence is read from*, and
# forbidden when it changes *whether the evidence is real*. The demo's one irreplaceable claim is
# live agent reasoning inside a governed environment; a replayed transcript rendered in the product
# UI falsifies exactly that claim, and no on-screen label repairs it.
#
# This is a grep-based guard, so it is a tripwire rather than a proof. It catches the mechanism
# being reintroduced by habit -- which is the realistic failure -- not a determined author. That is
# the same bargain scripts/policy-no-public-endpoints.sh makes.

set -euo pipefail

fail=0

# Directories where live inference is the product. Test projects are excluded: a unit test *must*
# be able to fake a model client, and doing so there is correct rather than suspect.
SCAN_DIRS=()
for d in src/router-service src/research-service src/surveillance-service src/orderrouting-service src/webui/src; do
  [ -d "$d" ] && SCAN_DIRS+=("$d")
done

if [ ${#SCAN_DIRS[@]} -eq 0 ]; then
  echo "SKIP: no service or UI source directories present yet."
  exit 0
fi

# Terms that denote standing in for inference. Deliberately does not include "fallback" alone:
# ADR-004's telemetry read-path fallback is permitted, and a rule that cries wolf gets disabled.
BANNED='replayTranscript|ReplayTranscript|transcript_replay|TranscriptReplay|RecordedAgent|recordedAgent|FakeAgent|fakeAgent|MockAgent|mockAgent|StubAgent|stubAgent|SimulatedAgent|simulatedAgent|CannedResponse|cannedResponse|FakeModel|fakeModel|MockModel|mockModel|SimulatedInference|simulatedInference|replayAgent|ReplayAgent'

hits=$(grep -rnE "$BANNED" "${SCAN_DIRS[@]}" \
  --include='*.cs' --include='*.ts' --include='*.tsx' \
  2>/dev/null | grep -v '/node_modules/' | grep -v '/obj/' | grep -v '/bin/' || true)

if [ -n "$hits" ]; then
  echo "FAIL: a code path appears able to substitute recorded output for live agent reasoning."
  echo "$hits"
  echo
  echo "ADR-007 forbids this. If the agent cannot run, the demo must say so rather than replay a"
  echo "transcript. Recordings may be narrated out of the product UI, never rendered inside it."
  fail=1
fi

# The simulated OMS is permitted and required (T-034), but only for *market execution*. If the
# word 'simulate' migrates from execution into the reasoning path, the exception is being widened.
oms_hits=$(grep -rniE 'simulat' "${SCAN_DIRS[@]}" \
  --include='*.cs' --include='*.ts' --include='*.tsx' \
  2>/dev/null | grep -v '/node_modules/' | grep -v '/obj/' | grep -v '/bin/' \
  | grep -iE 'agent|reason|inference|model|completion|prompt' || true)

if [ -n "$oms_hits" ]; then
  echo "FAIL: 'simulated' appears alongside agent/model/reasoning terms."
  echo "$oms_hits"
  echo
  echo "The simulated-OMS exception covers market execution only. Simulating reasoning is ADR-007's"
  echo "central prohibition."
  fail=1
fi

if [ "$fail" -eq 0 ]; then
  echo "PASS: no path can render simulated agent reasoning."
fi

exit "$fail"
