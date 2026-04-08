# BMW/MINI Marketing Platform

Secure Firebase-backed marketing budget and performance workspace.

## Local workflow

1. Generate the latest seed from the workbook:

```powershell
python scripts/extract_seed.py "C:\Users\chris\Downloads\Marketing_Budget_2026_Enhanced.xlsx" "D:\Projects\Marketing\data\seed.json"
```

2. Start the local server:

```powershell
node server.js
```

3. Open `http://localhost:3000`

## Budget grid page guide

If your day-to-day work is in the **Budget management** page, this is the quickest map of how it works:

- **Main page renderer:** `renderBudgets()` in `public/app.js` draws the department drill-down grid, measure toggle (Budget / Actual / Variance), and annual lifecycle rollup table.
- **Hierarchy behavior:** departments start collapsed and expand on demand; grouped rows (like VinSolutions and Events) are built in `groupedDepartmentEntries()` and rendered through `renderDepartmentGroup()` + `renderHierarchyEntry()`.
- **Inline editing:** only leaf vendor rows are editable in the monthly grid. Inputs are produced by `monthlyGridCell()` and updates flow through `handleBudgetGridInput()`.
- **Lifecycle-driven budget projection:** annual rollup controls (Added, Cancelled, Monthly charge) write through `handleLifecycleInput()`, then `applyLifecycleProjection()` repopulates monthly budget values for active months.
- **Totals and summaries:** department cards and row totals come from `computeDepartmentSummary()`, `aggregateRows()`, and `monthlyMeasureValue()`.
- **State model:** UI state for this page is held in `state.budgetGrid` (selected department, selected measure, and expanded row IDs), then persisted through the app's local state save flow.

### Primary files for budget-grid changes

- `public/app.js` — page rendering, hierarchy logic, edit handlers, lifecycle projection, and totals.
- `public/styles.css` — budget grid layout, sticky header, hierarchy row styling, and input color states.
- `data/seed.json` — baseline vendor/department rows used to populate the page locally.

## Secure deployment flow

1. Enable Google sign-in in Firebase Authentication.
2. Generate the latest local seed:

```powershell
npm run seed
```

3. Build hosting assets. This now removes any public copy of the seed data:

```powershell
npm run build
```

4. Deploy Hosting and Firestore rules:

```powershell
npm run deploy
```

5. Sign in to the deployed app with Google.
   The first signed-in user becomes the bootstrap `admin` if Firestore has not been initialized yet.

6. Use `Import Seed` in the deployed app and upload your local `data/seed.json` file.
   That writes both the protected Firestore baseline seed and the live working dataset.

## Authorization model

- Authentication uses Firebase Authentication with Google sign-in.
- Protected app data lives in Firestore, not in public Hosting files.
- New users default to `executive` access after the workspace has been initialized.
- `marketing` and `admin` can import/reset seed data.
- `marketing`, `accounting`, `sales`, `service`, and `admin` can edit operational data.

## Notes

- The deployed app no longer serves `seed.json` publicly.
- The first authenticated admin bootstrap is intended for internal setup of a new environment.
- If you want full user management in the UI next, the next step is an admin user-management screen for promoting roles without using the Firebase console.

## Automatic redeploys from GitHub

This repo now includes a GitHub Actions workflow at `.github/workflows/deploy.yml`.

Every push to `main` will redeploy Firebase Hosting and Firestore rules after GitHub is given one secret:

- `FIREBASE_SERVICE_ACCOUNT`

### GitHub secret setup

1. In Firebase Console, open **Project settings** for `pittsburgh-marketing-platform`.
2. Open **Service accounts**.
3. Generate a new private key for a deploy-capable service account.
4. In GitHub, open this repository's **Settings > Secrets and variables > Actions**.
5. Create a new repository secret named `FIREBASE_SERVICE_ACCOUNT`.
6. Paste the full JSON key contents into that secret.

### After that

Your deploy flow becomes:

```powershell
git add .
git commit -m "Your change"
git push
```

GitHub Actions will run the deploy automatically on pushes to `main`.
