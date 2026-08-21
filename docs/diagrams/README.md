# Architecture diagrams

Five diagrams of the Governed AI Exchange. They are **generated build output, not drawings** — do
not hand-edit either the `.excalidraw` or the `.svg` files; edit the generator and re-run it.

| Diagram | Answers |
|---|---|
| `01-platform-topology` | Where does everything run, and what is reachable from the internet? |
| `02-request-decision-flow` | What happens to one request, and in what order? |
| `03-agent-architecture` | Who are the agents, what may they touch, and where does a human intervene? |
| `04-ui-screen-map` | Which screen carries which demo beat? |
| `05-src-architecture` | What code actually exists in this repository today, and what is deliberately still empty? |

## Two files per diagram

Each diagram is written twice, from one source:

- **`.excalidraw`** — the editable source of truth. Open it at <https://excalidraw.com> to explore
  or to lift a fragment into a slide.
- **`.svg`** — a render of the same element array, so the diagram is visible in the README and on
  GitHub without downloading anything, with the text still selectable and searchable.

The SVG is **generated, not exported**. That distinction is the point: a PNG dragged out of
Excalidraw is a binary nothing can verify, so it silently stops matching the system the first time
the generator changes. The SVG is produced by `render-svg.mjs` from the same elements, hashed, and
drift-checked in CI alongside the source — a diagram cannot fall out of date without failing the
build.

`render-svg.mjs` handles exactly the element types this generator emits, and **throws on any
other** rather than skipping it. A renderer that silently drops an element it does not understand
produces a picture that omits part of the system while looking complete, which is worse than no
picture at all.

Each diagram states its claim in a `Conclusion:` subtitle. If a diagram no longer supports its own
conclusion, the architecture changed and the conclusion is the thing to revisit first.

## Viewing

Open the `.svg` in any browser, or view it inline in the README. To edit or explore, open
<https://excalidraw.com>, then **Menu → Open** and pick the `.excalidraw` file. Everything is
local; nothing is uploaded. VS Code users can install the Excalidraw extension and open the file
in place.

## Regenerating

```bash
node scripts/diagrams/generate-diagrams.mjs --out docs/diagrams
node scripts/diagrams/validate.mjs docs/diagrams
```

Or `task lint:diagrams`, which runs the drift check and the validator together.

Generation is byte-for-byte reproducible: element ids come from a counter-based PRNG with a fixed
seed and `updated` is pinned to `1`, so re-running never produces a spurious diff. CI runs
`--check` over **both** artefacts and fails if either differs from what the generator produces —
which is what keeps the picture and the system from quietly diverging.

## Editing

- **Content** — `scripts/diagrams/diagrams.mjs`. One exported definition per diagram.
- **Layout and element primitives** — `scripts/diagrams/diagram-kit.mjs`.
- **Structural rules** — `scripts/diagrams/validate.mjs` checks text fits its container, boxes do
  not overlap, arrow bindings resolve in both directions, no box straddles a group border, and no
  text drops below 16px. That last one is a legibility floor, not a style preference: these are
  read off a projector from the back of a room.
- **SVG rendering** — `scripts/diagrams/render-svg.mjs`. Only touch this to support a new element
  type or fix a rendering fidelity bug; it holds no content.

## A standing caveat

These diagrams follow the **repository**, not the prose, wherever the two disagree — the Terraform
for what is deployed, and the source tree for what is built. Components that appear in
`docs/architecture.md` but do not exist in the IaC are drawn as red dashed `NOT IN TERRAFORM`
boxes; services that exist as a directory but hold no code are drawn in the red dashed
`NOT IMPLEMENTED` band of diagram 05. Neither is omitted, so the gap is visible instead of
invisible. The current divergences are catalogued in
[`../decisions-needed.md`](../decisions-needed.md) items 5–7.

This is the reason the diagrams are worth trusting over the documents around them: a diagram that
only ever draws what works is a sales asset, not an architecture record.
