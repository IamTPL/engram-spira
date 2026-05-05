---
description: Active skill navigator. Classify task → invoke skills in sequence → prompt user at each gate → auto-suggest next step
---

## Core Flow

1. Classify the task into one route
2. **Invoke the first skill** for that route
3. At each gate: **present result + suggest next step + wait for approval**
4. On approval: **auto-invoke next skill** without user needing to name it
5. Add domain skills as needed
6. Verify before done

## Routes

### New feature, new page, or behavior change

1. Invoke skill `brainstorming`
   - **Gate 1:** Present design → ask user to approve/revise
   - Transition: _"✅ Design approved. Tôi sẽ tạo implementation plan. Approve để tiếp tục."_
2. Invoke skill `writing-plans`
   - **Gate 2:** Present plan → ask user to approve/revise
   - Transition: _"✅ Plan ready (N tasks). Tôi sẽ bắt đầu execute. Approve để tiếp tục."_
3. Invoke skill `executing-plans`
4. Invoke skill `requesting-code-review` — AI self-review completed work
   - **Gate 3:** Present review summary + code changes → ask user to review
   - Transition: _"✅ Implementation done + self-reviewed. Bạn hãy review kết quả."_
5. Handle user feedback with skill `receiving-code-review`
   - If user requests changes → apply fixes → re-invoke `requesting-code-review`
   - If user approves → done

### Clear multi-step task or existing spec

1. Invoke skill `writing-plans`
   - **Gate 1:** Present plan → ask user to approve/revise
   - Transition: _"✅ Plan ready. Approve để execute."_
2. Invoke skill `executing-plans`
3. Invoke skill `requesting-code-review` — AI self-review
   - **Gate 2:** Present review summary → ask user to review
4. Handle user feedback with skill `receiving-code-review`

### Bug fixing

1. Invoke skill `systematic-debugging`
   - **Gate 1:** Present root cause analysis → ask user to confirm approach
   - Transition: _"✅ Root cause identified. Approve fix approach để tiếp tục."_
2. Apply fix with verification
3. Invoke skill `requesting-code-review` — verify fix quality
   - **Gate 2:** Present fix + review → ask user to confirm
4. Handle user feedback with skill `receiving-code-review`

### Small obvious edit or direct question

1. Skip heavy workflow — answer or fix directly
2. Verify before done

## Gate Protocol

At EVERY gate transition between skills:

1. **Summarize** what was completed
2. **Present** the deliverable (design doc / plan / code)
3. **State** the next step clearly
4. **Ask** for explicit approval: "Approve để tiếp tục, hoặc chỉnh sửa nếu cần."
5. **Wait** — do NOT proceed without user response

## Review Protocol

### After execution completes (skill `requesting-code-review`)

- Summarize all changes made (files created/modified, tests added)
- Report any concerns or trade-offs discovered during implementation
- Present to user for review

### When receiving user feedback (skill `receiving-code-review`)

- **Read** complete feedback without reacting
- **Verify** each item against codebase reality before implementing
- **Clarify** unclear items BEFORE implementing any fix
- **Implement** one item at a time, test each
- **Push back** with technical reasoning if feedback is incorrect
- **NEVER** respond with performative agreement ("Great point!", "You're right!")

## Hard Gates

- Creative or behavior-changing work: invoke skill `brainstorming` before coding
- Bug fixing: invoke skill `systematic-debugging` before proposing fixes
- Multi-step work: invoke skill `writing-plans` before skill `executing-plans`
- After executing: invoke skill `requesting-code-review` before declaring done
- No unrelated refactors
- No completion without verification

## Domain Skill Packs

Add these alongside the main flow when relevant:

- Frontend: invoke skill `solid-js-best-practices`
- Backend/API: invoke skill `elysiajs`
- Database/performance: invoke skill `supabase-postgres-best-practices`
