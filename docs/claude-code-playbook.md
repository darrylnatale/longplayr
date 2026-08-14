# Claude Code Playbook — longplayr

Practical reference for using Claude Code on this project. This is not a course summary — it's the subset of techniques we've decided to actually use, with concrete guidance for when to reach for each one. See `docs/claude-course-analysis.md` for the reasoning behind these choices and what we deliberately left out.

---

## 1. CLAUDE.md strategy

**What**: A `CLAUDE.md` at the project root, kept in the 200-500 line range, containing the stack, data-model conventions, non-negotiable rules, and pointers to `.claude/rules/` for anything more detailed.

**Why**: It's injected as a system prompt at the start of every session. It's the cheapest way to keep every session — human or agent-driven — aligned on conventions without re-explaining them, and it directly improves plan and code quality (shorter, higher-density prompts produce better output than re-deriving context from scratch).

**When to use**: Always present, always current.

**When not to use**: Don't dump full API docs, entire style guides, or long prose into it — link out or summarize instead. Don't write vague/aspirational rules ("write good code," "don't make mistakes") — they add tokens without steering anything.

**How it fits our workflow**:

- Put the most important, hardest constraints at the top (auth rules, data-integrity rules, "never do X") — primacy bias means the model weighs the start (and end) of the prompt more heavily than the middle.
- When Claude repeats the same mistake 2-3 times, add a rule to CLAUDE.md so it stops recurring across sessions.
- Review and prune it periodically, the same way you'd review technical debt — stale rules actively mislead future sessions.
- Run `/init` early to bootstrap it from the real codebase rather than writing it from imagination, and re-run/update it as architecture solidifies (schema finalized, auth chosen, core stack settled).

**Prerequisites**: None to start (can begin nearly empty); grows in value as the codebase grows.

**Risks/limitations**: A stale or inaccurate CLAUDE.md is worse than none — it actively misleads plans and code. Someone (human or agent) needs to own keeping it current.

### `.claude/rules/` — splitting CLAUDE.md

**What**: Once CLAUDE.md gets crowded, split it into topic files under `.claude/rules/` (e.g., `schema.md`, `api-conventions.md`, `frontend.md`, `testing.md`).

**Why**: Lets you evolve one domain (say, testing conventions) without touching or re-reviewing unrelated ones, and keeps any single file readable.

**When to use**: Once CLAUDE.md is pushing toward its size ceiling, or once distinct conventions domains (schema vs. frontend vs. testing) are each substantial enough to stand alone. Realistically: once auth, schema, and one full vertical feature (e.g., logging + rating an album) exist.

**When not to use**: Don't split prematurely — a project with one small CLAUDE.md and no crowding doesn't need this yet.

### `~/.claude/CLAUDE.md` — personal global preferences

**What**: A global, machine-level CLAUDE.md for cross-project preferences (e.g., your own communication style, general coding preferences).

**When to use**: Optional, personal. Only if there are preferences you want applied to every project, not just this one.

**When not to use**: Project-specific conventions belong in the project's own CLAUDE.md, not here — don't let personal and project scope blur.

---

## 2. Planning and implementation workflow

**What**: Use plan mode (read-only research + written plan for approval) before building anything non-trivial, rather than going straight to execution.

**Why**: This is the course's most defensible and highest-leverage claim: a wrong assumption caught during planning costs a few minutes; the same assumption discovered mid-build (or worse, after shipping to a real schema with real user data) costs a rebuild plus cleanup. For a social app with a relational data model, wrong assumptions about schema shape or feed semantics are expensive to unwind.

**When to use**: Any schema change, any new feature area (lists, follows, discovery/ranking, activity feed), anything touching auth, anything where you're not certain of the right approach.

**When NOT to use**: Trivial, mechanical changes (fixing a typo, adjusting a CSS value, a one-line bug fix) — planning overhead isn't worth it there. Use judgment; don't ritualize planning for its own sake.

**How it fits our workflow**: Default to plan mode for anything you'd hesitate to describe in one sentence. Let Claude ask clarifying questions before committing to an approach. Review the plan critically — the value is in catching bad assumptions before code exists, not in rubber-stamping.

**Prerequisites**: A reasonably current CLAUDE.md — plan quality depends on the context Claude has to reason from.

---

## 3. Context management

**What**: `/context` (audit usage), `/compact [instructions]` (manual compaction with priorities), `/clear` (wipe history), `/cost` (check token spend), `/status-line` (terminal-only customization), `/model` (switch models / adjust extended-thinking budget).

**Why**: Sessions on this project will span genuinely unrelated work — schema migrations, frontend components, discovery-algorithm design. Carrying stale context across unrelated tasks isn't just wasteful, it's a real correctness risk (irrelevant prior context can bias a plan or implementation).

**When to use**:

- `/clear` when switching to an unrelated task (e.g., finishing a frontend session before starting a migration).
- `/compact` with custom instructions when a session is long-running but should continue (e.g., "keep the schema decisions, drop the UI back-and-forth").
- `/context` periodically once MCP servers or many skills are installed, specifically to catch a tool schema quietly eating a large share of the window.
- Prefer narrow, specific prompts ("fix the star-rating rounding bug in `RatingInput.tsx`") over vague ones ("improve the ratings feature") — this is free and compounds.

**When NOT to use**: Don't obsess over context percentage on a small, early-stage project — this only becomes load-bearing once CLAUDE.md, skills, and any MCP servers have real size.

**Risks/limitations**: Aggressive `/compact` can lose nuance from earlier in a session; use custom compact instructions to preserve what actually matters when you do it mid-task.

---

## 4. Subagents

**What**: `.claude/agents/` definitions for narrow, scoped-tool-access agents. Two archetypes worth having early:

- **Reviewer** — given deliberately minimal prior context (just the diff/changed files), reviews code with "fresh eyes." The value is specifically in _not_ inheriting the implementing session's assumptions.
- **QA** — writes and runs tests against changed code, reports failures back.

**Why**: This is close to human code-review discipline and is one of the few course techniques that scales naturally to a long-lived codebase rather than a one-off demo. Use a cheaper model (Sonnet/Haiku) for these roles — they don't need top-tier capability to review a diff or run a test suite.

**When to use**: After any non-trivial implementation, before considering it "done." Especially valuable around auth, payment-adjacent, or data-integrity code.

**When NOT to use**: Don't spin up many parallel subagents for raw throughput on this project — reliability compounds multiplicatively across parallel agents (roughly `p^n` for n agents each succeeding independently at rate p), so more parallel agents on loosely-scoped tasks means a higher chance something comes back wrong. Keep subagent task definitions narrow.

**Prerequisites**: Real code and (for QA) a real test suite to run.

**Risks/limitations**: A subagent's context is ephemeral and non-recoverable if it goes wrong — a poorly scoped subagent task can waste the whole call. Restart the Claude Code session after adding new agent definitions for them to be picked up.

---

## 5. Skills

**What**: `.claude/skills/<name>/SKILL.md` (orchestrator/checklist) + `scripts/` (deterministic helper scripts). Only the frontmatter loads into context by default — the full body loads only when Claude decides the skill is needed.

**Why**: For repeatable, checklist-shaped internal dev workflows — not business automation (this project has none of that surface). Good candidates once they exist as a _proven manual workflow_ first: "run lint + typecheck + test + build and summarize failures," "scaffold a new API route + migration + test following our conventions," "audit the schema for missing indexes/foreign keys." Because only frontmatter loads by default, keeping unused skills around is nearly free.

**When to use**: Build a skill once you've done the same multi-step task manually 2-3 times and it's clearly deterministic/checklist-shaped. Don't build speculatively.

**When NOT to use**: Don't build skills for fuzzy, judgment-heavy tasks (e.g., "design the discovery algorithm") — skills work well for deterministic orchestration, not for open-ended reasoning.

**How it fits our workflow**: Treat skill creation as a refactor of a workflow you already trust, the same way you'd extract a function once you've copy-pasted it three times.

**Risks/limitations**: A skill that goes stale (references a renamed script, an outdated convention) can quietly fail or mislead — review skills when the underlying workflow changes.

---

## 6. MCP

**What**: Third-party tool servers exposing capabilities (e.g., Chrome DevTools MCP for browser automation) via a JSON config installed into the workspace.

**Why for us specifically**: Chrome DevTools MCP is the practical mechanism behind screenshot-based UI verification (see §7) — worth adding once there's a real UI to test against.

**When to use**: Only when there's a clear, current use case. Prototype an integration via MCP first; if it proves valuable and gets used repeatedly, consider converting it into a skill with direct API calls for token efficiency (the course's own "MCP-to-skill" pattern).

**When NOT to use**: Don't install MCP servers speculatively. Each one adds tool-schema overhead to every session's context regardless of whether it's used that session — a single poorly-designed MCP tool can consume thousands of tokens. Only add third-party MCP servers from trusted/vetted sources; they're a real supply-chain trust surface.

**Risks/limitations**: Context bloat (check with `/context` after installing), and security/trust risk from third-party servers with broad tool access.

---

## 7. Browser and UI testing

**What**: A "build → screenshot → compare against spec/reference → iterate" loop for UI work, using Chrome DevTools (manually or via MCP) to capture and compare renders.

**Why**: longplayr is a design-sensitive consumer product (album/artist pages, list views, activity feed). Don't accept UI work as "done" without visually verifying it — this is the single most transferable technique from the course's design workflow, independent of exactly which reference/inspiration source is used.

**When to use**: Any new page, component, or significant layout/responsive change.

**When NOT to use**: Don't use "clone a reference site's exact design" as the strategy for longplayr's actual production UI — that's fine for quick prototyping but longplayr needs an original, coherent design system, not a stitched-together clone.

**Prerequisites**: A working local dev server; optionally Chrome DevTools MCP for automation.

---

## 8. Tool permissions and security

**What**: Claude Code's permission modes — ask-before-edit (default/safest), auto-accept-edits, granular `/permissions` rules (allow/ask/deny per tool), and bypass/"dangerously skip permissions" (no confirmation at all).

**Why this matters more here than in the course**: longplayr will eventually hold real user credentials and, if monetized, payment-adjacent data. The course's own instructor treats "bypass permissions" as his default despite recounting an incident where it led to a wiped hard drive — that tradeoff is not appropriate for this project.

**Recommended default**: Auto-accept-edits (or granular `/permissions` rules) for routine implementation work; ask-before-edit around anything touching auth, payments, migrations, or deletion. Reserve full bypass mode for narrow, low-risk, easily-reversible work (e.g., iterating on isolated frontend styling in a throwaway branch) — never as a standing default.

**Security discipline for the app itself** (separate from Claude Code's own permission modes, but directly inherited from the course's stated-but-under-practiced advice): don't deploy anything handling real credentials or payments without a human security review; don't rely on "obscure URLs" as a security measure; take the course's own stated safety advice more seriously than its own demo did.

---

## 9. Git and worktree workflows

**What**: Isolated folders/branches per parallel workstream, sharing git history, merged back when done.

**Why**: Once there are genuinely parallel workstreams (e.g., building the activity feed while separately building the artist page), worktrees give real file-conflict isolation without agent teams' cost overhead.

**When to use**: Any time two features are being actively developed in parallel (by you, or by you + an agent, or two agent sessions) and might touch overlapping files.

**When NOT to use**: Don't reach for this on strictly sequential work — it's overhead without benefit if there's no real parallelism.

**How it fits our workflow**: Document the worktree convention in CLAUDE.md once it's actually used, so Claude sets up worktrees automatically when asked to parallelize work, rather than re-explaining the pattern each time.

---

## 10. Testing and verification

**What**: Not a single course feature, but the connective principle across QA subagents, the screenshot loop, and plan mode: never accept generated output (code or UI) without an explicit verification step.

**Why**: This is the course's real thesis, even though the course itself doesn't cover real test-suite/CI practices in any depth — that's a gap this project needs to fill from standard engineering practice, not from the course. For longplayr specifically: schema changes need migration tests, rating/review logic needs unit tests, and the activity/discovery feed needs tests against realistic data shapes (empty states, users with no follows, etc.) since these are exactly the edge cases that look fine in a demo and break in production.

**How it fits our workflow**: Treat "does this have a test, and did it pass" as a completion criterion, not an optional follow-up — enforced via the QA subagent pattern (§4) once a test suite exists.

---

## 11. Agent teams — narrow, deliberate use only

**What**: Multiple full, independent Claude Code instances that can message each other and self-coordinate, at roughly 7x the token cost of a normal session (course's own estimate — verify current figures before relying on them). Disabled by default; must be explicitly enabled.

**Why we're not adopting this as a default**: The course's own security-audit demo burned real money fast (~$80 in 15 minutes) before being manually stopped. longplayr's normal workload — a small number of coherent, dependent features — doesn't need independent parallel agents that can diverge and need reconciling; it needs coherent sequential or worktree-isolated work.

**When it might be worth it**: A genuinely exploratory task where independent parallel takes and cross-agent debate add real value — e.g., comparing 2-3 fundamentally different approaches to the discovery/recommendation algorithm, or an occasional deep audit sweep (security, dependency health) across the whole codebase.

**When NOT to use**: Never as a default parallelization mechanism. Never for routine feature work. Always set a mental (or literal) budget before starting, and shut teams down promptly when done — cost keeps accruing on in-flight work even after you tell it to stop.

**Prerequisites**: Worktree-style isolation to avoid file-conflict corruption between teammates.

---

## 12. Deployment and CI/CD

**What the course actually showed**: Netlify for static/frontend deploys, Modal for backend/webhook-style functions. GitHub Actions and "Claude Code on the web" were promised in the course outline but never actually demonstrated — don't treat the course as a source for those.

**How this applies to us**: Netlify-style static/frontend hosting is plausible for longplayr's frontend; a serverless backend (Modal or equivalent) is only worth adopting once there's an actual need for isolated background jobs (e.g., recomputing trending albums, sending digest emails) — don't provision infrastructure ahead of need.

**Gap to fill from elsewhere**: A real CI pipeline (lint/typecheck/test/build gating on every PR) is standard practice this project needs regardless of Claude Code — the course doesn't cover it, so don't wait for course-derived guidance here; set it up using ordinary CI practice as soon as there's a shared repo.

---

## 13. What we deliberately did not include

No dedicated section for hooks, plugins/marketplaces, or MCP-driven business automation (lead scraping, email management, etc.) — the course covers these, but none map to a clear current need for longplayr. Revisit only if a specific, concrete need arises (see `docs/claude-code-environment.md` for the "add later" list with triggers).
