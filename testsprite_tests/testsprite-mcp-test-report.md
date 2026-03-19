# TestSprite AI Testing Report (MCP)

---

## 1️⃣ Document Metadata

| Field | Value |
|---|---|
| **Project Name** | engram-spira |
| **Date** | 2026-03-18 |
| **Prepared by** | TestSprite AI + Antigravity |
| **Test Mode** | Development (dev server on port 3002) |
| **Total Tests Run** | 15 / 22 (dev mode cap) |
| **Test Plan File** | `testsprite_tests/testsprite_frontend_test_plan.json` |
| **Target Component** | `src/components/focus/focus-drawer.tsx` |
| **Dashboard** | https://www.testsprite.com/dashboard/mcp/tests/90368ba8-0366-4040-9b16-2cdada5e7a6d |

---

## 2️⃣ Requirement Validation Summary

### 🎯 Focus Mode Drawer

| ID | Title | Priority | Status |
|---|---|---|---|
| TC001 | Open Focus Mode Drawer and verify core UI is visible | High | ❌ Failed |
| TC002 | Adjust focus duration with +/– controls while Ready | High | ❌ Failed |
| TC003 | Start a focus session and verify status and countdown appear | High | ❌ Failed |
| TC004 | Duration stepper is hidden during session; Stop halts session | High | ❌ Failed |
| TC005 | Open settings panel and edit a dice reward label | Medium | ❌ Failed |
| TC007 | Close Focus Mode Drawer using Escape key | High | ❌ Failed |
| TC008 | Close Focus Mode Drawer using the X close button | Medium | ❌ Failed |
| TC009 | Verify Today's stats are visible in the drawer | Low | ❌ Failed |

**Common Root Cause:** The SPA loads a persistent `Loading...` spinner on mount due to `fetchCurrentUser()` waiting for the backend API (port 3001). Since the backend was **not running** during test execution, the loading state never resolved and the login form never rendered. No tests could proceed past the loading screen.

**Test Visualizations:**
- TC001: https://www.testsprite.com/dashboard/mcp/tests/90368ba8-0366-4040-9b16-2cdada5e7a6d/4214f32f-e9af-4ad9-ade0-ac97f58f9323
- TC002: https://www.testsprite.com/dashboard/mcp/tests/90368ba8-0366-4040-9b16-2cdada5e7a6d/f21c1eed-4167-49e3-90f0-50d25c38e44a
- TC003: https://www.testsprite.com/dashboard/mcp/tests/90368ba8-0366-4040-9b16-2cdada5e7a6d/e40885e2-a514-4ff5-ab47-6a6620b36f74
- TC004: https://www.testsprite.com/dashboard/mcp/tests/90368ba8-0366-4040-9b16-2cdada5e7a6d/865c7981-fd6d-4101-ab65-9f73581e995c
- TC007: https://www.testsprite.com/dashboard/mcp/tests/90368ba8-0366-4040-9b16-2cdada5e7a6d/e8f44526-6a56-4831-a0fa-e2a358b5b013

---

### 🔐 User Login

| ID | Title | Priority | Status |
|---|---|---|---|
| TC010 | Successful login redirects to dashboard | High | ❌ Failed |
| TC011 | Invalid credentials show error message | High | ❌ Failed |
| TC012 | Client-side validation when email is empty | High | ❌ Failed |
| TC017 | Invalid email format shows inline validation error | High | ❌ Failed |
| TC018 | Too-short password shows inline validation error | High | ❌ Failed |

**Common Root Cause:** Same as above — app stuck on loading screen, login form never rendered.

---

### 📚 Flashcard Study Mode

| ID | Title | Priority | Status |
|---|---|---|---|
| TC019 | Start a study session and view the first card front | High | ❌ Failed |
| TC020 | Flip a flashcard to reveal the back side | High | ❌ Failed |
| TC021 | Rate a card as Good and advance to the next card | High | ❌ Failed |
| TC022 | Rate a card as Again — card re-shown later | High | ❌ Failed |
| TC023 | Complete a study session until finished screen appears | High | ❌ Failed |

**Common Root Cause:** Same loading screen issue blocked all authenticated route tests.

---

## 3️⃣ Coverage & Matching Metrics

| Requirement Group | Total Tests | ✅ Passed | ❌ Failed |
|---|---|---|---|
| Focus Mode Drawer | 8 | 0 | 8 |
| User Login | 5 | 0 | 5 |
| User Registration | 0* | 0 | 0 |
| Flashcard Study Mode | 5 | 0 | 5 |
| **Total** | **15** | **0** | **15** |

> *TC006, TC013, TC014, TC015, TC016 were not run (dev mode cap: 15 tests max)

**Pass Rate:** 0% (0/15)

---

## 4️⃣ Key Gaps / Risks

### 🔴 Critical — Backend Not Running During Tests
**Issue:** The Vite app calls `fetchCurrentUser()` in `src/app.tsx:onMount` which hits `http://localhost:3001` (the Elysia API). When the API is unavailable, the `isLoading()` signal stays `true` forever, showing a loading spinner that blocks the entire UI.

**Impact:** 100% test failure — zero tests could interact with the app.

**Fix Options:**

1. **Run the backend during tests** (recommended):
   ```bash
   # Start both API + web before running tests
   cd apps/api && bun run dev &
   cd apps/web && bun run dev
   ```
   Then re-run TestSprite with valid `LOGIN_USER` / `LOGIN_PASSWORD` credentials set.

2. **Add a timeout/fallback in the auth store** — if `fetchCurrentUser()` fails or times out after N ms, set `isLoading(false)` so the UI renders the guest/login state.

3. **Use environment variable to skip auth check in test mode** — detect `VITE_TEST_MODE=true` and skip the initial `fetchCurrentUser()`.

### 🟡 Medium — Login Credentials Not Configured
The test plan uses `{{LOGIN_USER}}` and `{{LOGIN_PASSWORD}}` placeholders. These must be set in TestSprite's environment configuration before authenticated tests can pass.

### 🟡 Medium — Focus Drawer Opened Via Store, Not URL
The `FocusDrawer` is globally mounted at app root level and toggled via `focus.store`. TestSprite needs to find and click the sidebar button that sets `isDrawerOpen = true`. This button's exact selector should be verified once the app loads correctly.

### 🟢 Low — WebGL Reward Popup
The `RewardPopup` uses Three.js with WebGL. Headless browser environments may not support WebGL, meaning the 3D dice animation after session completion may not render. Tests should verify text/UI fallback rather than the 3D render.
