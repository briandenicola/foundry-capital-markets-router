# Documentation

| Document | Purpose |
|---|---|
| architecture.md | How the system is put together and why |
| agent-architecture.md | The three lane agents, their tools, and where their authority stops |
| ui-design.md | Screen inventory, component and state architecture, required states |
| threat-model.md | What can go wrong, and what stops it |
| demo-runbook.md | The narrative beats, timings, and failure recovery |
| decisions-needed.md | Forks between requirements.md and the locked decisions |
| requirements.md | The original demo script this repository is built from |
| diagrams/ | Five generated architecture diagrams, `.excalidraw` source plus `.svg` render |
| adr/ | Architecture decision records |

## A note on what these documents claim

The documents here describe the **target** architecture, and parts of it are not built. The
authority on what exists today is the README's
[status table](../README.md#status--what-is-built-today), and
[`diagrams/05-src-architecture`](diagrams/05-src-architecture.svg), which draws unbuilt components
in a red dashed band rather than leaving them out.

That convention is deliberate. A document that silently describes only what works reads as
finished, and the reader discovers the gap at the worst possible moment — usually while trying to
use it.

Governing documents live outside this directory:

- `.specify/memory/constitution.md` — the principles that override everything here.
- `specs/001-router-core/` — the specification, contracts, data model, and task plan.
