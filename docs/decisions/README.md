# Architecture Decision Records

This directory holds lightweight ADRs (Architecture Decision Records) for
Solarly. An ADR captures a decision worth remembering — why we chose one
approach over the alternatives — so future contributors don't have to
reconstruct the reasoning from git history.

## Convention

- File name: `docs/decisions/NNNN-title.md`, where `NNNN` is a four-digit,
  zero-padded number and `title` is a short kebab-case summary. Numbers
  must be unique but do **not** need to be contiguous. Before picking a
  number, check `docs/decisions/` for the existing ADRs (including on
  other in-progress branches, if you can see them) and pick any number
  not already in use. Gaps between numbers are expected and fine — don't
  renumber existing ADRs on merge just to remove them. There's no formal
  registry of which number ranges belong to which workstream; picking an
  unused number is sufficient to avoid collisions. (`0001-project-scaffolding.md`
  predates this convention and doesn't itself reserve a block.)
- Each file uses this structure:

  ```markdown
  # NNNN. Title

  Status: accepted

  ## Context

  What's the situation/problem that prompted this decision?

  ## Decision

  What did we decide to do?

  ## Consequences

  What follows from this decision — trade-offs, follow-up work, things
  that become easier or harder?
  ```

- `Status` is typically `accepted`. Use `superseded by NNNN` if a later
  ADR replaces this one; leave the original file in place rather than
  deleting it.
- Numbers are never reused, even if a decision is later superseded.

## When to write one

Write an ADR for decisions that are hard to reverse or non-obvious in
hindsight: choice of framework/library, module boundaries, data model
shape, deployment approach. Small implementation details don't need one.
