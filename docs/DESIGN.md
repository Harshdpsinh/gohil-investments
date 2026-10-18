# DESIGN

## Prompt

Match the CRM that is already on screen. Do not invent a new visual system.

## What is already true

- React 18, Tailwind, the existing `btn-primary`, `btn-secondary`, `form-input`, and `badge-*` classes.
- Pages live in `src/pages/`. Shared pieces live in `src/components/`.
- Light and dark classes are both present (`dark:`). Keep both.
- Tables that overflow use `TableHScroll`. Modals use `Modal` or `PortalOverlay`.
- Toasts use `react-hot-toast`. Errors say what the user should do next, in plain language.
- Icons go through `AppIcon`. Do not drop a new icon set in for one button.
- Admin-only pages (`/admin-users`, `/backup`) redirect to `/dashboard` when the role is not admin.

## Routes

`/dashboard` `/clients` `/clients/:id` `/policies` `/renewals` `/pipeline` `/installments` `/cross-sell` `/proposals` `/business` `/inbox` `/commission` `/claims` `/reports` `/wishes` `/calendar` `/admin-users` `/backup`

Public, no login: `/login` `/privacy` `/terms` `/dmca`

## When you add a screen

- Put it behind the existing protected layout in `src/App.jsx`.
- Reuse the page padding (`p-4 sm:p-6 lg:p-8`) and the gray page background.
- Do not restyle neighbouring pages.
- A destructive action needs the existing confirm dialog, not a new one.
- Phone layout matters. The Android app is this same site.

## Do not

- Add a marketing homepage.
- Hide a write button and call that security. Rules in `firestore.rules` are the lock.
