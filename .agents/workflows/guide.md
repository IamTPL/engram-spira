---
description: Workflow
---

## Language & Communication Protocol (STRICT)
You must adhere to a strict language separation rule:
- **Code & Artifacts (English):** All source code, variable names, inline comments, docstrings, commit messages, and string literals within the codebase must be strictly in **English**.
- **Chat Interaction (Vietnamese):** All explanations, architectural reasoning, execution plans, clarification questions, and general conversation in this chat interface must be in **Vietnamese**.

## Workflow Orchestration

### 1. Plan Node Default
- Enter plan mode for ANY non-trivial task (3+ steps or architectural decisions)
- If something goes sideways, STOP and re-plan immediately - don't keep pushing
- Use plan mode for verification steps, not just building
- Write detailed specs upfront to reduce ambiguity

### 2. Deep Pattern Discovery (CRITICAL)
- Search for a *similar existing feature* or *equivalent logic* in the codebase to use as a "Reference Model".
- Analyze its file structure and architectural pattern based on the project's ecosystem (e.g., Controller -> Service -> Repository for Backend; Components -> Hooks -> Store/Context -> API Utils for Frontend) and adhere to its specific coding style.
- Identify existing modules, utilities, hooks, or logic that can be reused.

### 3. Subagent Strategy
- Use subagents liberally to keep main context window clean
- Offload research, exploration, and parallel analysis to subagents
- For complex problems, throw more compute at it via subagents
- One task per subagent for focused execution

### 4. Self-Improvement Loop
- After ANY correction from the user: update `tasks/lessons.md` with the pattern
- Write rules for yourself that prevent the same mistake
- Ruthlessly iterate on these lessons until mistake rate drops
- Review lessons at session start for relevant project

### 5. Verification Before Done
- Never mark a task complete without proving it works
- Diff behavior between main and your changes when relevant
- Ask yourself: "Would a staff engineer approve this?"
- Run tests, check logs, demonstrate correctness

### 6. Demand Elegance (Balanced)
- For non-trivial changes: pause and ask "is there a more elegant way?"
- If a fix feels hacky: "Knowing everything I know now, implement the elegant solution"
- Skip this for simple, obvious fixes - don't over-engineer
- Challenge your own work before presenting it

### 7. Autonomous Bug Fixing
- When given a bug report: just fix it. Don't ask for hand-holding
- Point at logs, errors, failing tests - then resolve them
- Zero context switching required from the user
- Go fix failing CI tests without being told how

## Task Management
1. **Plan First**: Write plan to `tasks/todo.md` with checkable items
2. **Verify Plan**: Check in before starting implementation
3. **Track Progress**: Mark items complete as you go
4. **Explain Changes**: High-level summary at each step
5. **Document Results**: Add review section to `tasks/todo.md`
6. **Capture Lessons**: Update `tasks/lessons.md` after corrections

## Core Principles & Strict Constraints
- **Simplicity First**: Make every change as simple as possible. Impact minimal code.
- **No Laziness**: Find root causes. No temporary fixes. Senior developer standards.
- **Minimal Impact**: Changes should only touch what's necessary. Avoid introducing bugs.
- **Constraint 1 (Constants, Configs & Collections):** Enforce the use of Constants, Enums, and Environment variables. **Zero tolerance** for hardcoded values (magic numbers/strings). Furthermore, strictly extract all business-logic collections (e.g., arrays of allowed statuses, role types, or mapping objects like `['pending', 'success']`) into centralized constant files. Never define these semantic arrays/objects inline within functions or components.
- **Constraint 2 (DRY & Reuse):** Strict adherence to DRY principles. Do not write new logic or helper functions if an equivalent already exists in codespace. Exhaustively search for reusable code first.
- **Constraint 3 (Security First):** Always sanitize inputs and prevent common vulnerabilities (e.g., XSS in frontend, SQLi/NoSQLi in backend). Never expose secrets or sensitive PII data in logs or client responses.