# Architecture diagrams

Four Excalidraw diagrams of the Governed AI Exchange. They are **generated build output, not
drawings** — do not hand-edit the `.excalidraw` files; edit the generator and re-run it.

| File | Answers |
|---|---|
| `01-platform-topology.excalidraw` | Where does everything run, and what is reachable from the internet? |
| `02-request-decision-flow.excalidraw` | What happens to one request, and in what order? |
| `03-agent-architecture.excalidraw` | Who are the agents, what may they touch, and where does a human intervene? |
| `04-ui-screen-map.excalidraw` | Which screen carries which demo beat? |

Each diagram states its claim in a `Conclusion:` subtitle. If a diagram no longer supports its own
conclusion, the architecture changed and the conclusion is the thing to revisit first.

## Viewing

Open <https://excalidraw.com>, then **Menu → Open** and pick the file. Everything is local; nothing
is uploaded. VS Code users can install the Excalidraw extension and open the file in place.

## Regenerating

```bash
node scripts/diagrams/generate-diagrams.mjs --out docs/diagrams
node scripts/diagrams/validate.mjs docs/diagrams
```

Or `task lint:diagrams`, which runs the drift check and the validator together.

Generation is byte-for-byte reproducible: element ids come from a counter-based PRNG with a fixed
seed and `updated` is pinned to `1`, so re-running never produces a spurious diff. CI runs
`--check` and fails if the committed files differ from what the generator produces — which is what
keeps the picture and the system from quietly diverging.

## Editing

- **Content** — `scripts/diagrams/diagrams.mjs`. One exported definition per diagram.
- **Layout and element primitives** — `scripts/diagrams/diagram-kit.mjs`.
- **Structural rules** — `scripts/diagrams/validate.mjs` checks text fits its container, boxes do
  not overlap, arrow bindings resolve in both directions, and no box straddles a group border.

## A standing caveat

These diagrams follow the **Terraform**, not the prose, wherever the two disagree. Components that
appear in `docs/architecture.md` but do not exist in the IaC are drawn as red dashed
`NOT IN TERRAFORM` boxes rather than omitted, so the gap is visible instead of invisible. The
current divergences are catalogued in [`../decisions-needed.md`](../decisions-needed.md) items 5–7.
