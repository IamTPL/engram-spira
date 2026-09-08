# Relationship Suggestions — Select All

## Context

AI relationship suggestions must remain pending until the user explicitly
accepts them. Requiring one checkbox click per suggestion, however, adds
friction without improving the quality of that review.

## Chosen interaction

Add one master checkbox to the relationship-suggestions toolbar:

- No suggestions are selected immediately after detection.
- With no selection, the master checkbox is unchecked and labelled
  `Select all`.
- With some suggestions selected, it is indeterminate and remains labelled
  `Select all`.
- With every current suggestion selected, it is checked and labelled
  `Clear selection`.
- Activating the unchecked or indeterminate control selects every current
  suggestion.
- Activating the checked control clears the selection.
- `Accept selected (N)` remains a separate action and stays disabled at
  `N = 0`.

This provides a two-step bulk action without silently accepting AI output.
There is no additional confirmation modal because selection followed by the
accept button is already an explicit confirmation sequence.

## State and data flow

Selection remains client-side and is represented by canonical suggestion
keys. A pure helper derives:

- the master checkbox state: unchecked, indeterminate, or checked;
- the next selection when the master control is activated.

The helper always derives from the current suggestions. Accepted or dismissed
items therefore cannot remain as stale selected keys. Existing per-item
selection and sequential acceptance behavior remain unchanged.

All selection controls are disabled while detection or acceptance is in
flight. A new detection result resets selection to empty.

## Accessibility and responsive behavior

- Use the existing Kobalte-based Checkbox so checked and indeterminate states
  are exposed to assistive technology.
- Give the master control a dynamic accessible label:
  `Select all relationship suggestions` or
  `Clear relationship suggestion selection`.
- Keep a minimum 44px touch target on mobile.
- Keyboard activation with Space must perform the same toggle.
- The selected count remains visible in `Accept selected (N)`.

## Tests

Unit tests cover:

- zero, partial, and complete master states;
- partial activation selecting all;
- complete activation clearing all;
- canonical keys and changing suggestion lists without stale selection.

Run the focused test red before implementation, then the full web suite,
TypeScript typecheck, and browser verification for desktop and mobile.

## Out of scope

- Automatically accepting suggestions after detection.
- A persistent user preference for auto-accept.
- Confidence-threshold bulk acceptance.
- Backend API or database changes.
