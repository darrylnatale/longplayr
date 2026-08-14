# Recommended Claude Code Environment — longplayr

What the project's Claude Code infrastructure should look like, staged by when it earns its place. See `docs/claude-course-analysis.md` for the reasoning and `docs/claude-code-playbook.md` for how to actually use each piece. Principle throughout: infrastructure should follow a demonstrated need, not precede it.

---

## 1. Recommended structure (end state, not day one)

```
longplayr/
  CLAUDE.md                     # project root, 200-500 lines
  .claude/
    rules/                      # added once CLAUDE.md gets crowded
      schema.md
      api-conventions.md
      frontend.md
      testing.md
    agents/                     # added once real code exists to review
      reviewer.md
      qa.md
    skills/                     # added once a workflow is proven manually 2-3x
      (empty until earned)
    settings.json                # permission rules; added when defaults need tightening
    settings.local.json          # gitignored, machine-local overrides / secrets
  .mcp.json                     # added only when a specific MCP server is needed
```

Nothing here should be scaffolded speculatively. The sections below say what to build now vs. later vs. never-unless-triggered.

---

## 2. What should be implemented immediately

**`CLAUDE.md` (project root).**
Why it exists: it's the injected context for every session from day one, and starting it early — even sparse — is far cheaper than reconstructing conventions retroactively once the codebase has drifted. Start with: chosen stack, core data-model shape as it's decided, and a small number of non-negotiable rules. Grow it as decisions get made; don't pad it with placeholders for decisions that don't exist yet.

**Plan-mode-first habit.**
No infrastructure required — it's a workflow discipline (see playbook §2). Worth establishing from the very first feature, since undoing bad early architectural assumptions (schema shape, auth model) is the most expensive kind of rework this project can incur.

**Narrow-prompt discipline and routine `/clear` between unrelated tasks.**
Also no infrastructure — just a habit worth having from the start since it costs nothing and compounds.

**Baseline permission posture.**
Set a sane default now rather than drifting into bypass-mode-by-default out of convenience: auto-accept-edits for routine work, ask-before-edit around auth/migrations/deletions. This is a one-time settings decision, cheap to make early, expensive to unwind after bad habits form.

---

## 3. What should be added later (with concrete triggers)

**`.claude/rules/`** — trigger: CLAUDE.md approaches its size ceiling, or distinct convention domains (schema, API, frontend, testing) are each substantial enough to stand alone. Realistic point: after auth, core schema, and one full vertical feature (e.g., log + rate an album) exist.

**`.claude/agents/reviewer.md` and `.claude/agents/qa.md`** — trigger: there's real code worth reviewing and a real test suite worth running against. Don't create these against an empty or trivial codebase; a reviewer with nothing substantive to review adds no value.

**`.mcp.json` with Chrome DevTools MCP** — trigger: there's an actual UI (album/artist pages, list views) worth screenshot-testing. Not needed while the project is schema/backend-only.

**Git worktrees as a documented convention in CLAUDE.md** — trigger: the first time two features are genuinely developed in parallel and risk touching overlapping files. Document the convention once it's actually used, not preemptively.

**`.claude/skills/`** — trigger: the same multi-step, deterministic dev workflow has been done manually 2-3 times (e.g., "scaffold route + migration + test," "run full verify pipeline and summarize"). Build the skill as a refactor of a trusted manual process, not speculatively.

**CI pipeline (lint/typecheck/test/build gating on PRs)** — trigger: as soon as there's a shared repo with more than one contributor path (human or agent) merging work. This isn't Claude-Code-specific infrastructure, but it's the load-bearing safety net that makes every other technique here (subagent review, QA, worktrees) actually trustworthy at scale. Don't wait long on this one — it should follow shortly after the first few real features land, not after the app is already sprawling.

**Modal-style serverless backend functions** — trigger: an actual need for isolated background/async jobs (recomputing trending albums, sending digest emails, scheduled recalculation of feed rankings). Don't provision this ahead of a concrete job to run.

---

## 4. What should NOT be added unless a specific need arises

**Agent teams (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS`).** This project's normal workload doesn't need independent parallel agents with cross-agent debate. Only consider enabling this for an occasional, deliberately-scoped exploratory task (e.g., comparing several discovery-algorithm designs) or an audit sweep — never as standing infrastructure. If enabled for a one-off task, disable again afterward.

**MCP servers beyond Chrome DevTools.** Every additional MCP server adds tool-schema overhead to every session, whether or not it's used that session, and third-party servers are a real supply-chain trust surface. Add only when a specific integration need exists and after checking the server's provenance.

**Skills for business-automation-style tasks** (email management, lead scraping, purchasing agents, etc.) — this project has no such surface. Not relevant unless the product itself grows an operational/business-automation dimension, which is out of scope for the current vision.

**Plugins/marketplace exploration.** Low expected value for this project specifically; the course itself predicts plugin functionality gets absorbed into skills over time. Revisit only if a specific plugin solves a concrete, otherwise-unaddressed need.

**Hooks.** The course promises but never actually demonstrates hook configuration, so there's no course-derived guidance to lean on here, and no identified need yet (e.g., a pre-commit-style gate, or a notification hook for long-running sessions). If a concrete need shows up later (e.g., "block commits that touch the schema without a migration file"), design it then, based on current Anthropic hook documentation rather than this course.

**Bypass/"dangerously skip permissions" as a standing default.** Explicitly rejected as a default posture given this project will eventually hold real user credentials and possibly payment data (see playbook §8). Fine as an occasional, deliberate, scoped choice for genuinely low-risk work; never a session-wide default.

**Full split-pane agent-team viewing mode, custom status-line theming, chime/notification hooks, and other cosmetic course features.** Harmless if someone wants them personally, but not project infrastructure — don't standardize on them.

---

## 5. Why each component exists (summary table)

| Component             | Exists to...                                                                               | Add when...                                        |
| --------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------- |
| `CLAUDE.md`           | Keep every session aligned on stack/conventions/non-negotiables without re-explaining them | Immediately                                        |
| Plan-mode habit       | Catch bad architectural assumptions before they're expensive to unwind                     | Immediately                                        |
| Permission posture    | Prevent unreviewed changes to auth/data/deletion paths                                     | Immediately                                        |
| `.claude/rules/`      | Keep conventions readable and independently updatable as they grow                         | CLAUDE.md gets crowded                             |
| Reviewer/QA subagents | Catch implementation blind spots and enforce test coverage                                 | Real code + real tests exist                       |
| Chrome DevTools MCP   | Enable build→screenshot→compare verification for UI work                                   | A real UI exists                                   |
| Git worktrees         | Prevent file-conflict corruption across parallel workstreams                               | Genuine parallel feature work starts               |
| Skills                | Make proven, repeatable dev workflows near-free to keep around                             | A manual workflow repeats 2-3+ times               |
| CI pipeline           | Make every other technique here trustworthy at scale                                       | First few real features land                       |
| Modal/serverless jobs | Run isolated background/async work                                                         | A concrete async job is needed                     |
| Agent teams           | Support rare, deliberate exploratory/audit work                                            | A specific exploratory task justifies the ~7x cost |

---

## 6. Guiding principle

Every row above exists to solve a problem longplayr will actually have, not to demonstrate Claude Code capability. If a future session is tempted to add infrastructure from this document's "later" or "not unless needed" sections, the bar is: what specific, current problem does this solve, and is there a simpler fix first?
