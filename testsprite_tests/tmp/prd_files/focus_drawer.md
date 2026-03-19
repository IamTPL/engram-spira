# Engram Spira — Focus Mode Drawer PRD

## Overview
Engram Spira is a flashcard study app with a built-in Focus Mode feature. The Focus Mode Drawer is a slide-in panel from the right side of the screen that enables Pomodoro-style focus sessions. Users can set a duration, start a countdown timer, stop the session, earn dice-roll rewards, and view customizable reward labels for each dice face.

## Feature: Focus Mode Drawer

### Entry Point
- A button in the app sidebar/nav opens the drawer
- The `FocusDrawer` component is globally mounted at app root level (lazy-loaded) and toggled via `focus.store`

### Sub-components
- **FocusDrawer** (`src/components/focus/focus-drawer.tsx`): Main drawer container
- **RewardPopup** (`src/components/focus/reward-popup.tsx`): 3D dice animation shown after session
- **DurationStepper**: Inline component for adjusting focus duration via +/- buttons
- **Focus Store** (`src/stores/focus.store.ts`): Manages all timer state and session logic

### Behavior Requirements

#### Drawer Open/Close
- Drawer slides in from the right when opened (`translate-x-0`)
- Drawer slides out when closed (`translate-x-full`)
- Clicking the backdrop (dark overlay) closes the drawer
- Clicking the X button in the header closes the drawer
- Pressing the Escape key closes the drawer
- Notification permission is requested on first open

#### Timer Display
- Timer displays in MM:SS format (e.g. 25:00)
- Circular SVG progress ring shows elapsed progress (0% to 100%)
- When not running, shows the selected duration
- When running, shows remaining time counting down
- Status text: "Ready" when idle, "Focusing..." when running

#### Duration Stepper (visible only when NOT running)
- Duration steps: [1s, 5, 10, 15, 20, 25, 30, 45, 60, 90, 120] minutes
- Minus button decrements to previous step (disabled at minimum)
- Plus button increments to next step (disabled at maximum)
- Display shows "1s" for the shortest step, or "X min" for others

#### Start / Stop
- "Start Focus" button (gradient style) starts the session
- Once running, the button changes to "Stop Session" (red)
- Stopping early halts the timer
- Completing the session triggers: sound chime, browser notification, reward popup

#### Reward Settings Panel
- Gear icon button in header toggles the settings panel
- Settings panel shows 6 dice face inputs (Dice1–Dice6 icons)
- Each input has a max of 40 characters
- Editing an input updates the corresponding reward label in the store

#### Stats Section (always visible)
- Shows Today's Progress: Minutes, Sessions, Day Streak
- Three stat cards with distinct color schemes

## Known Limitations
- FocusDrawer is always in DOM (hidden when closed), not conditionally mounted
- Reward popup 3D dice uses WebGL/Three.js — may not render in headless environments
