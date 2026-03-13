# Design System: Engram Spira

**Project ID:** N/A (repository-based extraction from `IamTPL/engram-spira`)

## 0. Core Principle: Performance First

**THIS IS THE MOST CRITICAL RULE.**
Every design decision and new logic implementation must consider performance impact first. Do not sacrifice a smooth experience for complex features.

- **Evaluate before coding:** Before adding any logic, animation, or library, ask: "Will this slow down the app?".
- **Instant feedback:** UI must respond to user actions within 100ms.
- **Optimize rendering:** Limit unnecessary re-renders. Prioritize CSS transform/opacity for motion.
- **Mobile is the standard:** Always test smoothness on low-end mobile devices.

---

## 1. Visual Theme & Atmosphere

Engram Spira embodies **calm productivity**: bright, clean, and optimized for deep focus.

- **Light Mode:** Very pale blue background combined with slate gray to create an airy feel.
- **Dark Mode:** Uses a "blue-silver" background instead of pure black to be easier on the eyes.

Visual language priorities:

- **Airy but Structured:** Generous whitespace, hairline borders, clear hierarchy via surfaces.
- **Soft Confidence:** Moderate corner rounding, gentle shadows, snappy transition effects.
- **Playful Learning Accents:** Uses pastel palette (1→7) and mint-green gradients for CTAs to reduce stress.
- **Readable-first:** Text avoids absolute black (#000), using slate gray to reduce eye strain during long study sessions.

## 2. Color Palette & Roles

### Semantic Core Colors (Light / Dark)

| Descriptive Name                       | Token                      | Light     | Dark      | Functional Role                          |
| -------------------------------------- | -------------------------- | --------- | --------- | ---------------------------------------- |
| Misty Study Canvas                     | `--color-background`       | `#f7fbff` | `#222933` | Overall app background                   |
| Elevated Surface White / Night Surface | `--color-surface`          | `#ffffff` | `#1e2135` | Secondary surface layer, content area    |
| Learning Card Surface                  | `--color-card`             | `#ffffff` | `#16202e` | Cards, drawers, menus                    |
| Primary Reading Ink                    | `--color-foreground`       | `#1e293b` | `#e3e6f3` | Main text                                |
| Action Blue / Soft Periwinkle          | `--color-primary`          | `#2563eb` | `#8aabf0` | Primary actions, links, focus            |
| Gentle Secondary Surface               | `--color-secondary`        | `#f1f5f9` | `#424452` | Secondary buttons, side panels           |
| Quiet Supporting Text                  | `--color-muted-foreground` | `#64748b` | `#8b90b4` | Secondary labels, metadata               |
| Hover Accent Wash                      | `--color-accent`           | `#eff6ff` | `#2a2f4e` | Light background on hover/active         |
| Destructive Signal Red                 | `--color-destructive`      | `#ef4444` | `#f07070` | Error alerts, dangerous actions (delete) |
| Success Signal Green                   | `--color-success`          | `#10b981` | `#5ad4a0` | Success state, completion                |
| Hairline Divider                       | `--color-border`           | `#e2e8f0` | `#34447a` | Borders, separators                      |
| Input Stroke                           | `--color-input`            | `#e2e8f0` | `#6885e4` | Border of input/textarea fields          |
| Focus Halo                             | `--color-ring`             | `#2563eb` | `#8aabf0` | Glowing ring during keyboard focus       |

### Brand & Supporting Palettes

| Descriptive Name       | Token                      | Light     | Dark      | Functional Role                           |
| ---------------------- | -------------------------- | --------- | --------- | ----------------------------------------- |
| Priority Sky Blue      | `--color-palette-1`        | `#8dccf5` | `#4d8db8` | Chips/cards mild emphasis, main icon zone |
| Lavender Pink          | `--color-palette-2`        | `#f0cbf1` | `#9f60a3` | Secondary accent for stats                |
| Teal Calm              | `--color-palette-3`        | `#afe5e3` | `#3f9996` | Secondary accent for progress/stats       |
| Soft Purple            | `--color-palette-4`        | `#e2cffc` | `#7a5ab8` | Content grouping classification           |
| Periwinkle Link Accent | `--color-palette-5`        | `#8eb0fb` | `#5e7fd8` | Link variant, spinner gradient            |
| Bright Pink Accent     | `--color-palette-6`        | `#fec7e7` | `#c0608a` | Playful, lively accent                    |
| Mint Finish            | `--color-palette-7`        | `#abf6d0` | `#3da870` | Gradient end point/positive               |
| Mint Card Tint         | `--color-bg-card-mint`     | `#eafdf9` | `#1a2e30` | "Simulate" type card background           |
| Pink Card Tint         | `--color-bg-card-pink`     | `#fff0f6` | `#2e1a28` | "Evaluate" type card background           |
| Lavender Card Tint     | `--color-bg-card-lavender` | `#f3f6fd` | `#1e2035` | "Remediate" type card background          |

### Functional Gradients

- **Primary CTA Gradient (Light):** Cloud Periwinkle → Mint Glow (`#b5ccff` → `#abf6d0`)
- **Primary CTA Gradient (Dark):** Muted Periwinkle → Cool Mint (`#7498e8` → `#6dd4a0`)
- **Section Background Gradient (Light):** (`#e6eefe` → `#e4faee`)
- **Section Background Gradient (Dark):** (`#1e2340` → `#18283a`)

### Utility Scales

- **Blue scale (50..900):** `#eff6ff` → `#1e3a8a`
- **Slate scale (50..900):** `#f7fbff` → `#0f172a`
- **Status scale:** Green `#10b981/#059669`, Amber `#f59e0b`, Red `#ef4444/#dc2626`

## 3. Typography Rules

- **Primary Typeface:** `Inter` variable (`300–800`), fallback: `system-ui, -apple-system, sans-serif`.
- **Body Baseline:** Font size `15px` (`0.9375rem`), line height `1.6`, enable OpenType features `'cv02', 'cv03', 'cv04', 'cv11'` for better legibility.
- **Heading Character:** Bold `font-weight: 600`, tight tracking `-0.02em`, line height `1.3`.
- **Heading Scale:**
  - `h1`: `30px` (`1.875rem`)
  - `h2`: `24px` (`1.5rem`)
  - `h3`: `20px` (`1.25rem`)
  - `h4`: `18px` (`1.125rem`)
- **Paragraph Rhythm:** `line-height: 1.7` for long paragraphs to improve readability.
- **Usage Patterns:** `text-xs` for labels/metadata, `text-sm` for default buttons/controls, `text-base/lg/xl` for internal headers, `text-2xl..5xl` for major emphasis.

## 4. Component Stylings

- **Buttons:** Default subtly rounded corners (`rounded-md`), mint-green gradient, bold slate text (`text-slate-800`).
  - Feedback: `hover:opacity-90` and slight press effect `active:scale-[0.98]`.
  - Variants: Destructive (red), Outline (bordered), Secondary (light gray background), Ghost (transparent), Link (palette-5 color).
- **Cards/Containers:** `bg-card` background, thin border (`--color-border`), corner radius from `rounded-lg` to `rounded-2xl`.
  - Depth: Very light shadows (**whisper-soft shadows**), Study Flashcards use a more prominent shadow (`--shadow-card-study`).
- **Inputs/Forms:** Transparent background (`bg-transparent`), `border-input` border, `rounded-md` corners, light shadow `shadow-sm`.
  - Focus: Bright `2px` ring (`--color-ring`) surrounding.
- **Feedback Components:** Toasts and Badges use direct semantic colors (`success`, `destructive`, `palette-5`) with alpha borders to maintain soft contrast.
- **Motion Language:** Transition duration `200–300ms`, `ease` easing. Accents (pop-ups, dice) use spring effect: `cubic-bezier(0.34, 1.56, 0.64, 1)`.

## 5. Layout Principles

Engram Spira follows a **layered productivity shell** model: Header + Sidebar + Content + Mobile Bottom Nav.

- Layout prioritizes clear Grid.
- Spacing follows a 4px/8px rhythm.
- Areas separated by thin borders instead of heavy shadows.

### Spacing System (Extracted from UI usage)

| Descriptive Name    | Value                     | Typical Usage                                  |
| ------------------- | ------------------------- | ---------------------------------------------- |
| Hairline Micro Gap  | `2px` (`0.125rem`)        | `gap-0.5`, spacing between icon and small text |
| Tight Control Gap   | `4px` (`0.25rem`)         | `gap-1`, tight action button rows              |
| Compact Cluster Gap | `6px` (`0.375rem`)        | `gap-1.5`, dense control groups                |
| Standard Gap        | `8px` (`0.5rem`)          | `gap-2`, standard icon/button spacing          |
| Comfortable Gap     | `12px` (`0.75rem`)        | `gap-3`, spacing for items in panels           |
| Breathing Gap       | `16px` (`1rem`)           | `p-4`, inner padding of small cards            |
| Section Padding     | `24px` (`1.5rem`)         | `p-6`, padding for drawers or large cards      |
| Hero Padding        | `32–40px` (`p-8`, `p-10`) | Focal blocks (timer, flashcard)                |

### Radius Tokens

| Descriptive Name    | Token           | Value    | Usage Character                       |
| ------------------- | --------------- | -------- | ------------------------------------- |
| Slightly Rounded    | `--radius-xs`   | `4px`    | Keyboard shortcuts (Kbd), small pills |
| Soft Rounded        | `--radius-sm`   | `6px`    | Focus ring edge                       |
| Subtle Rounded      | `--radius-md`   | `8px`    | Default Inputs/Buttons                |
| Comfortable Rounded | `--radius-lg`   | `12px`   | Common Cards, Dropdowns               |
| Generously Rounded  | `--radius-xl`   | `16px`   | CTA Panels, Modal sections            |
| Plush Rounded       | `--radius-2xl`  | `24px`   | Hero Cards, reward dialogs            |
| Pill / Circular     | `--radius-full` | `9999px` | Avatars, Badges, Pills                |

### Elevation & Shadow Tokens

| Descriptive Name  | Token                 | Light                                       | Dark                                          | Role                          |
| ----------------- | --------------------- | ------------------------------------------- | --------------------------------------------- | ----------------------------- |
| Hairline Lift     | `--shadow-xs`         | `0 1px 2px 0 rgb(15 23 42 / 0.04)`          | `0 1px 2px 0 rgb(0 0 0 / 0.3)`                | Slightly lifted flat controls |
| Soft Lift         | `--shadow-sm`         | `0 1px 3px 0 rgb(15 23 42 / 0.06)...`       | `0 1px 3px 0 rgb(0 0 0 / 0.4)...`             | Normal Inputs, Buttons        |
| Medium Panel Lift | `--shadow-md`         | `0 4px 6px -1px rgb(15 23 42 / 0.06)...`    | `0 4px 6px -1px rgb(0 0 0 / 0.4)...`          | Popovers, Floating Cards      |
| Overlay Lift      | `--shadow-lg`         | `0 10px 15px -3px rgb(15 23 42 / 0.07)...`  | `0 10px 15px -3px rgb(0 0 0 / 0.4)...`        | Menus, Drawers                |
| High Overlay Lift | `--shadow-xl`         | `0 20px 25px -5px rgb(15 23 42 / 0.08)...`  | `0 20px 25px -5px rgb(0 0 0 / 0.5)...`        | Modals, Large Popups          |
| Study Hero        | `--shadow-card-study` | `0 24px 40px -8px rgb(37 99 235 / 0.12)...` | `0 24px 40px -8px rgb(100 130 230 / 0.12)...` | Study Flashcard state         |

### Layout Constants

- **Desktop Sidebar:** Width `16rem` (`256px`), collapsed `56px`. Class: `w-sidebar`.
- **Header:** Height `h-14` (`56px`).
- **Mobile Bottom Nav:** Height `h-14` + safe area.
- **Progress Bar:** Thickness `4px`.
- **Scrollbar:** Thickness `6px` (webkit custom).

---

**Scanned Token Sources:**
`apps/web/src/app.css`, `apps/web/index.html`, `apps/web/vite.config.ts`, `apps/web/src/components/**`, `packages/browser-extension/popup.html`.
