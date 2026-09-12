# Architecture Decision Records

This directory holds lightweight ADRs (Architecture Decision Records) for
Solarly. An ADR captures a decision worth remembering — why we chose one
approach over the alternatives — so future contributors don't have to
reconstruct the reasoning from git history.

## Convention

- File name: `docs/decisions/NNNN-title.md`, where `NNNN` is a four-digit,
  zero-padded, sequential number (`0001`, `0002`, ...) and `title` is a
  short kebab-case summary.
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
