
# TestSprite AI Testing Report(MCP)

---

## 1️⃣ Document Metadata
- **Project Name:** engram-spira
- **Date:** 2026-03-18
- **Prepared by:** TestSprite AI Team

---

## 2️⃣ Requirement Validation Summary

#### Test TC001 Open Focus Mode Drawer and verify core UI is visible
- **Test Code:** [TC001_Open_Focus_Mode_Drawer_and_verify_core_UI_is_visible.py](./TC001_Open_Focus_Mode_Drawer_and_verify_core_UI_is_visible.py)
- **Test Error:** TEST FAILURE

ASSERTIONS:
- Loading spinner present and prevented access to the application's interactive UI after multiple attempts to load.
- 0 interactive elements detected on the page, so login and dashboard controls were not accessible.
- Navigation to /login did not reveal the login form or any input fields required for authentication.
- Focus Drawer could not be tested because the application UI did not render and the drawer/open button was not available.
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/90368ba8-0366-4040-9b16-2cdada5e7a6d/4214f32f-e9af-4ad9-ade0-ac97f58f9323
- **Status:** ❌ Failed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC002 Adjust focus duration with plus and minus controls while Ready
- **Test Code:** [TC002_Adjust_focus_duration_with_plus_and_minus_controls_while_Ready.py](./TC002_Adjust_focus_duration_with_plus_and_minus_controls_while_Ready.py)
- **Test Error:** TEST FAILURE

ASSERTIONS:
- Loading spinner present on the /login page and 0 interactive elements available, preventing any interactions.
- Login form fields (email and password) are not present on the page, so login cannot be performed.
- Sidebar / FocusDrawer controls are not accessible because the UI did not render, so the duration stepper cannot be tested.
- SPA did not finish rendering after two wait attempts, preventing further progress on the test.
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/90368ba8-0366-4040-9b16-2cdada5e7a6d/f21c1eed-4167-49e3-90f0-50d25c38e44a
- **Status:** ❌ Failed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC003 Start a focus session and verify status and countdown appear
- **Test Code:** [TC003_Start_a_focus_session_and_verify_status_and_countdown_appear.py](./TC003_Start_a_focus_session_and_verify_status_and_countdown_appear.py)
- **Test Error:** TEST FAILURE

ASSERTIONS:
- Loading indicator 'Loading...' remains visible and the page shows 0 interactive elements after multiple waits.
- Email and Password input fields are not present on the page.
- "Log in" button is not present on the page.
- Focus drawer open button (sidebar control) is not available because the UI has not finished rendering.
- SPA did not finish rendering after two 3-second waits, preventing continuation of the test flow.
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/90368ba8-0366-4040-9b16-2cdada5e7a6d/e40885e2-a514-4ff5-ab47-6a6620b36f74
- **Status:** ❌ Failed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC004 Duration stepper is hidden while session is running and Stop ends session early
- **Test Code:** [TC004_Duration_stepper_is_hidden_while_session_is_running_and_Stop_ends_session_early.py](./TC004_Duration_stepper_is_hidden_while_session_is_running_and_Stop_ends_session_early.py)
- **Test Error:** TEST FAILURE

ASSERTIONS:
- Loading indicator 'Loading...' is present and blocking the UI, preventing access to controls.
- No interactive elements (inputs, buttons, sidebar navigation) are available on the page; the login form and focus drawer controls did not render.
- Navigated to /login (http://localhost:3002/login) but the page remained stuck on the loading screen after multiple wait attempts.
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/90368ba8-0366-4040-9b16-2cdada5e7a6d/865c7981-fd6d-4101-ab65-9f73581e995c
- **Status:** ❌ Failed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC007 Close Focus Mode Drawer using Escape key
- **Test Code:** [TC007_Close_Focus_Mode_Drawer_using_Escape_key.py](./TC007_Close_Focus_Mode_Drawer_using_Escape_key.py)
- **Test Error:** TEST FAILURE

ASSERTIONS:
- Loading spinner ('Loading...') remains visible after multiple waits, preventing the application from rendering its interactive UI.
- No interactive elements (login form, sidebar, or drawer controls) were detected on the page, so navigation to /login and opening the Focus Drawer is not possible.
- Verification of Escape-key dismissal cannot be performed because the Focus Drawer cannot be opened or interacted with due to the app's persistent loading state.
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/90368ba8-0366-4040-9b16-2cdada5e7a6d/e8f44526-6a56-4831-a0fa-e2a358b5b013
- **Status:** ❌ Failed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC010 Successful login redirects to dashboard
- **Test Code:** [TC010_Successful_login_redirects_to_dashboard.py](./TC010_Successful_login_redirects_to_dashboard.py)
- **Test Error:** TEST FAILURE

ASSERTIONS:
- Login page is stuck on a loading screen; spinner and 'Loading...' text are displayed and no interactive elements are present.
- Email input field not found on the /login page.
- Password input field not found on the /login page.
- Login button not found on the /login page.
- Dashboard page could not be reached because the login flow cannot be completed due to the loading screen.
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/90368ba8-0366-4040-9b16-2cdada5e7a6d/e04b5cc4-c494-4a18-9e35-97314d553323
- **Status:** ❌ Failed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC011 Invalid credentials show error message
- **Test Code:** [TC011_Invalid_credentials_show_error_message.py](./TC011_Invalid_credentials_show_error_message.py)
- **Test Error:** TEST FAILURE

ASSERTIONS:
- Login form not present on /login after navigation and allowed waits; the page remains on a loading screen and did not render the login UI.
- No interactive elements are present on the page (0 interactive elements), so email/password fields and the Login button cannot be located or interacted with.
- SPA did not render the expected login UI after two wait attempts and explicit navigation to /login, preventing further test steps.
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/90368ba8-0366-4040-9b16-2cdada5e7a6d/f82dc139-3efe-41b8-8c8f-454cd7f93b13
- **Status:** ❌ Failed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC012 Client-side validation when email is empty
- **Test Code:** [TC012_Client_side_validation_when_email_is_empty.py](./TC012_Client_side_validation_when_email_is_empty.py)
- **Test Error:** TEST FAILURE

ASSERTIONS:
- Login form not rendered: page shows loading spinner and no input fields or buttons are present.
- No interactive elements detected after repeated waits and navigation; cannot perform form interactions.
- Unable to type password or click 'Login' because the password input and Login button are not available.
- Login page URL (/login) loaded but expected login form did not render.
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/90368ba8-0366-4040-9b16-2cdada5e7a6d/48ed2cbd-2d8d-4e2c-a4c7-fcd8ae788e51
- **Status:** ❌ Failed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC017 Invalid email format shows inline validation error
- **Test Code:** [TC017_Invalid_email_format_shows_inline_validation_error.py](./TC017_Invalid_email_format_shows_inline_validation_error.py)
- **Test Error:** TEST FAILURE

ASSERTIONS:
- Registration form not present on /register: loading spinner visible and 0 interactive elements on the page.
- Input fields for email and password are not available, so typing into the form is not possible.
- Register button not found on the page, preventing form submission.
- Cannot verify 'Invalid email' validation message because the form cannot be submitted or interacted with.
- SPA appears to be stuck loading despite multiple waits and navigation attempts, so the feature cannot be tested.
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/90368ba8-0366-4040-9b16-2cdada5e7a6d/e7744702-4c1e-48a0-a304-b1c308e67187
- **Status:** ❌ Failed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC018 Too-short password shows inline validation error
- **Test Code:** [TC018_Too_short_password_shows_inline_validation_error.py](./TC018_Too_short_password_shows_inline_validation_error.py)
- **Test Error:** TEST FAILURE

ASSERTIONS:
- Register page stuck on 'Loading...' with no interactive elements after multiple waits, preventing interaction with the registration form.
- Email and password input fields and the Register button are not present on /register, so form submission cannot be performed.
- Password validation message ('too short') could not be verified because the registration form could not be accessed.
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/90368ba8-0366-4040-9b16-2cdada5e7a6d/7e0a3172-145b-4708-b673-51b144429162
- **Status:** ❌ Failed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC019 Start a study session from the dashboard and view the first card front
- **Test Code:** [TC019_Start_a_study_session_from_the_dashboard_and_view_the_first_card_front.py](./TC019_Start_a_study_session_from_the_dashboard_and_view_the_first_card_front.py)
- **Test Error:** TEST FAILURE

ASSERTIONS:
- Loading indicator ('Loading...') is displayed on the page and blocks access to the app UI.
- Login form fields and the 'Log in' button are not present on the /login page (no email/password inputs detected).
- No interactive elements (inputs, buttons, links, deck items, or sidebar opener) are present in the DOM snapshot, preventing progress through the test steps.
- The SPA did not render after multiple wait attempts and a scroll, leaving the application in a persistent loading state.
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/90368ba8-0366-4040-9b16-2cdada5e7a6d/c6d8e706-291e-41d4-87ca-13db3aa7a2d7
- **Status:** ❌ Failed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC020 Flip a flashcard to reveal the back side
- **Test Code:** [TC020_Flip_a_flashcard_to_reveal_the_back_side.py](./TC020_Flip_a_flashcard_to_reveal_the_back_side.py)
- **Test Error:** TEST FAILURE

ASSERTIONS:
- ASSERTION: Login page did not load — loading spinner remained visible and no interactive elements were detected on http://localhost:3002/login after multiple waits and a scroll attempt.
- ASSERTION: Email and password input fields and the 'Log in' button were not found on the login page, so authentication steps could not be performed.
- ASSERTION: Dashboard, deck items, and Study controls were not accessible, preventing execution of the study flow (open deck → Study → flip flashcard).
- ASSERTION: FocusDrawer and other feature controls could not be tested because the app did not render interactive UI elements.
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/90368ba8-0366-4040-9b16-2cdada5e7a6d/ea31d350-bfcc-4720-bd98-26edd4b9023d
- **Status:** ❌ Failed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC021 Rate a card as Good and advance to the next card
- **Test Code:** [TC021_Rate_a_card_as_Good_and_advance_to_the_next_card.py](./TC021_Rate_a_card_as_Good_and_advance_to_the_next_card.py)
- **Test Error:** TEST FAILURE

ASSERTIONS:
- Loading spinner is visible on the /login page and no interactive elements (email, password, login button) are present.
- Login form inputs and the 'Log in' button are not found, preventing authentication and progression to the dashboard.
- Dashboard and deck elements required to start a study session are not accessible due to the persistent loading state.
- The FocusDrawer cannot be opened or tested because the UI controls to open it are not rendered.
- Multiple wait attempts did not resolve the loading state; the SPA appears stuck and the test cannot continue.
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/90368ba8-0366-4040-9b16-2cdada5e7a6d/ee73f5da-8601-4263-b84b-77df4ed7b7a8
- **Status:** ❌ Failed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC022 Rate a card as Again and observe the card is re-shown later in the session
- **Test Code:** [TC022_Rate_a_card_as_Again_and_observe_the_card_is_re_shown_later_in_the_session.py](./TC022_Rate_a_card_as_Again_and_observe_the_card_is_re_shown_later_in_the_session.py)
- **Test Error:** TEST FAILURE

ASSERTIONS:
- Login form not found; page shows a persistent loading spinner and the text 'Loading...'.
- 0 interactive elements available on the page, preventing typing credentials or clicking the Log in button.
- Dashboard and study flow cannot be reached because the authentication step cannot be completed.
- FocusDrawer and other UI features cannot be tested because the app did not render interactive UI during the session.
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/90368ba8-0366-4040-9b16-2cdada5e7a6d/f9cbcd3a-ceae-4f92-9aa7-71d4d8374fc2
- **Status:** ❌ Failed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC023 Complete a study session until finished screen appears
- **Test Code:** [TC023_Complete_a_study_session_until_finished_screen_appears.py](./TC023_Complete_a_study_session_until_finished_screen_appears.py)
- **Test Error:** TEST FAILURE

ASSERTIONS:
- Loading spinner with text 'Loading...' is displayed and the application UI did not render.
- No interactive elements (inputs, buttons, or links) are present on the page, so login and study flow cannot be executed.
- Navigation to /login and two wait attempts did not resolve the loading state; the SPA did not render within available attempts.
- FocusDrawer and dashboard controls cannot be accessed because their triggers are not present while the app remains stuck on the loading screen.
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/90368ba8-0366-4040-9b16-2cdada5e7a6d/f2d006ca-9183-4e34-a574-30d725b556d8
- **Status:** ❌ Failed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---


## 3️⃣ Coverage & Matching Metrics

- **0.00** of tests passed

| Requirement        | Total Tests | ✅ Passed | ❌ Failed  |
|--------------------|-------------|-----------|------------|
| ...                | ...         | ...       | ...        |
---


## 4️⃣ Key Gaps / Risks
{AI_GNERATED_KET_GAPS_AND_RISKS}
---