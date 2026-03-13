---
description: Concise skill router for Engram. Invoke named skills explicitly, follow hard gates, and keep domain packs swappable
---

## Language

- Code and artifacts: English only
- Chat, reasoning, and plans: Vietnamese only

## Core Flow

1. Classify the task into one route
2. **Invoke the named skill exactly**
3. Add only the needed domain skills
4. Reuse existing patterns before creating new ones
5. Verify before done

## Routes

### New feature, new page, or behavior change

1. Invoke skill `brainstorming`
2. After design approval, invoke skill `writing-plans`
3. Then invoke skill `executing-plans`

### Clear multi-step task or existing spec

1. Invoke skill `writing-plans`
2. Then invoke skill `executing-plans`

### Small obvious edit or direct question

1. Skip heavy workflow
2. Answer directly or make the minimal verified change

## Hard Gates

- Creative or behavior-changing work: invoke skill `brainstorming` before coding
- Bug fixing: invoke skill `systematic-debugging` before proposing fixes
- Multi-step work: invoke skill `writing-plans` before skill `executing-plans`
- No unrelated refactors
- No completion without verification

## Domain Skill Packs

- Frontend: invoke skill `solid-js-best-practices`
- Backend/API: invoke skill `elysiajs`
- Database/performance: invoke skill `supabase-postgres-best-practices`
