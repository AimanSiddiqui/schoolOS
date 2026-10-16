# SchoolOS Interface

The public Clast.io dashboard preview was used as a reference for navigation hierarchy,
consistent spacing, and readable operational information. SchoolOS uses its own layout,
green identity, copy, and components; no Clast artwork or source code is shipped.

Active styles are split into `frontend/app/styles/base.css`, `workspace.css`, and `public.css`.
The previous `globals.css` is retained but is no longer imported.

The dashboard uses one main navigation and a compact page header. Students, academic setup,
attendance, and account details have distinct routes. Student creation uses native dialogs;
academic records open in searchable lists with separate creation and editing dialogs.
The editor loads the selected record, and each category has status filters and pagination.
Overview values come from the existing
tenant-scoped APIs. Missing roster denominators are displayed without a percentage.

Icons come from Lucide. The locally stored education photograph was downloaded from:
https://images.unsplash.com/photo-1541339907198-e08756dedf3f

The landing-page workspace preview is captured from SchoolOS with synthetic local data.
To regenerate it against a running local app, set `SCHOOLOS_CAPTURE_PREVIEW=1` and run
`npm run test:e2e`. Only the desktop dashboard capture updates `public/workspace-preview.png`.
This preview is a snapshot; the authenticated dashboard reads live data.

Landing motion uses a continuous hero photo pan with a pause/resume control, staggered
text entrances, and one-time scroll reveals. CSS handles transforms and opacity; IntersectionObserver activates content
below the viewport. Reduced-motion preferences disable animation and keep every section visible.

Signup remains first-school onboarding. Open registration, member invitations, and password
recovery are separate product work and are not represented as functional controls.
