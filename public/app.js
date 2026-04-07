import { initializeApp } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
} from "https://www.gstatic.com/firebasejs/12.7.0/firebase-auth.js";
import { doc, getDoc, getFirestore, setDoc } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyAJP_rVcyXlJGgpDzBUS0cu-tKZ_NwQ9KQ",
  authDomain: "pittsburgh-marketing-platform.firebaseapp.com",
  projectId: "pittsburgh-marketing-platform",
  storageBucket: "pittsburgh-marketing-platform.firebasestorage.app",
  messagingSenderId: "70518498827",
  appId: "1:70518498827:web:5926830d3cddb26adec90e",
  measurementId: "G-5BV98YBFFE",
};
const UI_STORAGE_KEY = "marketing-platform-ui-v2";
const DEPARTMENT_ORDER = ["BMW Sales", "MINI Sales", "BMW Service", "MINI Service", "Collision"];
const PLATFORM_COLLECTION = "platform";
const CURRENT_DOC_ID = "current";
const SEED_DOC_ID = "seed";
const WRITER_ROLES = ["marketing", "accounting", "sales", "service", "admin"];
const IMPORTER_ROLES = ["marketing", "admin"];

const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);
const db = getFirestore(firebaseApp);
const googleProvider = new GoogleAuthProvider();

googleProvider.setCustomParameters({ prompt: "select_account" });

const views = [
  { id: "budgets", label: "Budget Management" },
  { id: "dashboard", label: "Executive Dashboard" },
  { id: "actuals", label: "Actuals Entry" },
  { id: "roi", label: "ROI & Performance" },
  { id: "contracts", label: "Vendor Contracts" },
  { id: "reports", label: "Reporting Center" },
];
const roleViewAccess = {
  executive: ["dashboard", "roi", "reports"],
  marketing: views.map((view) => view.id),
  accounting: ["dashboard", "actuals", "reports"],
  sales: ["dashboard", "budgets", "roi", "reports"],
  service: ["dashboard", "budgets", "roi", "reports"],
  admin: views.map((view) => view.id),
};
const roleLabels = {
  executive: "Executive",
  marketing: "Marketing Manager",
  accounting: "Accounting",
  sales: "Sales Manager",
  service: "Service Manager",
  admin: "Administrator",
};

const appEl = document.querySelector("#app");
const navEl = document.querySelector("#nav");
const roleSelectEl = document.querySelector("#role-select");
const alertPanelEl = document.querySelector("#alert-panel");
const userPanelEl = document.querySelector("#user-panel");
const pageTitleEl = document.querySelector("#page-title");
const pageSubtitleEl = document.querySelector("#page-subtitle");
const exportButtonEl = document.querySelector("#export-button");
const resetButtonEl = document.querySelector("#reset-button");
const signOutButtonEl = document.querySelector("#signout-button");
const importButtonEl = document.querySelector("#import-button");
const importInputEl = document.querySelector("#import-input");

let state = {
  view: "dashboard",
  role: "executive",
  user: null,
  profile: null,
  data: null,
  isLoading: true,
  authError: "",
  budgetGrid: {
    department: "All",
    measure: "budget",
    expandedDepartments: [],
    expandedVendors: [],
  },
};

initialize();

function initialize() {
  const saved = loadSavedState();
  const defaultBudgetGrid = {
    department: "All",
    measure: "budget",
    expandedDepartments: [],
    expandedVendors: [],
  };
  state = {
    ...state,
    view: saved?.view || "dashboard",
    budgetGrid: {
      ...defaultBudgetGrid,
      ...(saved?.budgetGrid || {}),
      expandedDepartments: [],
      expandedVendors: [],
    },
  };
  bindEvents();
  onAuthStateChanged(auth, handleAuthStateChange);
}

function loadSavedState() {
  try {
    const raw = localStorage.getItem(UI_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveState() {
  localStorage.setItem(
    UI_STORAGE_KEY,
    JSON.stringify({
      view: state.view,
      budgetGrid: state.budgetGrid,
    })
  );
}

function normalizePlatformData(data) {
  if (!data) return null;
  return {
    ...data,
    departments: data.departments || DEPARTMENT_ORDER,
    budgetRecords: (data.budgetRecords || []).map((record) => deriveBudgetRecord(record)),
    vendorContracts: data.vendorContracts || [],
    roiRecords: data.roiRecords || [],
    alerts: data.alerts || [],
  };
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function platformDoc(docId) {
  return doc(db, PLATFORM_COLLECTION, docId);
}

async function handleAuthStateChange(user) {
  state.user = user;
  state.profile = null;
  state.authError = "";
  state.isLoading = true;
  state.data = null;
  render();

  if (!user) {
    state.role = "executive";
    state.isLoading = false;
    render();
    return;
  }

  try {
    const profile = await ensureUserProfile(user);
    state.profile = profile;
    state.role = profile.role || "executive";
    state.data = await loadPlatformData();
  } catch (error) {
    state.authError = error?.message || "Could not load your secure workspace.";
  } finally {
    state.isLoading = false;
    render();
  }
}

async function ensureUserProfile(user) {
  const userRef = doc(db, "users", user.uid);
  const existing = await getDoc(userRef);
  if (existing.exists()) {
    const profile = { ...existing.data(), uid: user.uid };
    await setDoc(userRef, { lastLoginAt: new Date().toISOString() }, { merge: true });
    return profile;
  }

  const baseProfile = {
    uid: user.uid,
    email: user.email || "",
    displayName: user.displayName || user.email || "Unknown user",
    createdAt: new Date().toISOString(),
    lastLoginAt: new Date().toISOString(),
  };

  // Try to bootstrap the first authenticated user as admin.
  // Once Firestore is initialized, rules reject that role and we retry
  // with the normal executive default for subsequent users.
  const adminProfile = { ...baseProfile, role: "admin" };
  try {
    await setDoc(userRef, adminProfile);
    return adminProfile;
  } catch (error) {
    if (error?.code !== "permission-denied") throw error;
  }

  const executiveProfile = { ...baseProfile, role: "executive" };
  await setDoc(userRef, executiveProfile);
  return executiveProfile;
}

async function loadPlatformData() {
  const snapshot = await getDoc(platformDoc(CURRENT_DOC_ID));
  return snapshot.exists() ? normalizePlatformData(snapshot.data()) : null;
}

async function loadSeedData() {
  const snapshot = await getDoc(platformDoc(SEED_DOC_ID));
  return snapshot.exists() ? normalizePlatformData(snapshot.data()) : null;
}

async function persistPlatformData() {
  if (!state.data || !canWriteData()) return;
  await setDoc(platformDoc(CURRENT_DOC_ID), deepClone(state.data));
}

function canWriteData() {
  return WRITER_ROLES.includes(state.role);
}

function canImportData() {
  return IMPORTER_ROLES.includes(state.role);
}

function isSignedIn() {
  return Boolean(state.user);
}

function deriveBudgetRecord(record) {
  const lifecycle = normalizeLifecycle(record);
  const annualBudget = sum(record.monthly_budget);
  const annualActual = sum(record.monthly_actual);
  const coopAmount = annualActual * record.coop_rate;
  return {
    ...record,
    ...lifecycle,
    annual_budget: round(annualBudget),
    annual_actual: round(annualActual),
    annual_variance: round(annualBudget - annualActual),
    coop_amount: round(coopAmount),
    net_cost: round(annualActual - coopAmount),
  };
}

function bindEvents() {
  roleSelectEl.disabled = true;
  exportButtonEl.addEventListener("click", exportSummary);
  resetButtonEl.addEventListener("click", handleResetWorkspace);
  signOutButtonEl.addEventListener("click", async () => {
    await signOut(auth);
  });
  importButtonEl.addEventListener("click", () => importInputEl.click());
  importInputEl.addEventListener("change", handleImportFile);
}

async function handleResetWorkspace() {
  if (!canImportData()) return;
  const seedData = await loadSeedData();
  if (!seedData) {
    state.authError = "No baseline seed exists in Firestore yet. Import your local seed JSON first.";
    render();
    return;
  }
  state.data = normalizePlatformData(seedData);
  await persistPlatformData();
  render();
}

async function handleImportFile(event) {
  const [file] = event.target.files || [];
  if (!file || !canImportData()) return;
  try {
    const imported = normalizePlatformData(JSON.parse(await file.text()));
    await setDoc(platformDoc(SEED_DOC_ID), deepClone(imported));
    await setDoc(platformDoc(CURRENT_DOC_ID), deepClone(imported));
    state.data = imported;
    state.authError = "";
  } catch (error) {
    state.authError = error?.message || "That file could not be imported.";
  } finally {
    event.target.value = "";
    render();
  }
}

async function handleGoogleSignIn() {
  try {
    await signInWithPopup(auth, googleProvider);
  } catch (error) {
    state.authError = error?.message || "Google sign-in is not enabled yet.";
    render();
  }
}

function render() {
  renderChrome();

  if (!isSignedIn()) {
    navEl.innerHTML = "";
    alertPanelEl.innerHTML = "";
    renderSignedOut();
    saveState();
    return;
  }

  if (state.isLoading) {
    navEl.innerHTML = "";
    alertPanelEl.innerHTML = "";
    renderStatusScreen("Loading secure workspace", "Checking your access and retrieving protected data from Firestore.");
    saveState();
    return;
  }

  if (!state.data) {
    navEl.innerHTML = "";
    alertPanelEl.innerHTML = "";
    renderEmptyWorkspace();
    saveState();
    return;
  }

  renderNav();
  renderAlerts();
  const pages = {
    dashboard: renderDashboard,
    budgets: renderBudgets,
    actuals: renderActuals,
    roi: renderROI,
    contracts: renderContracts,
    reports: renderReports,
  };
  pages[state.view]();
  saveState();
}

function renderChrome() {
  const assignedRole = state.profile?.role || state.role || "executive";
  roleSelectEl.value = assignedRole;
  roleSelectEl.disabled = true;
  signOutButtonEl.hidden = !isSignedIn();
  importButtonEl.hidden = !canImportData();
  resetButtonEl.hidden = !canImportData() || !state.data;
  exportButtonEl.hidden = !isSignedIn() || !state.data;
  userPanelEl.innerHTML = isSignedIn()
    ? `<p class="eyebrow">Signed in</p><strong>${state.profile?.displayName || state.user?.email || "User"}</strong><p class="subtle">${state.profile?.email || state.user?.email || ""}</p><p class="subtle">${roleLabels[assignedRole] || assignedRole}</p>`
    : '<p class="eyebrow">Secure access</p><p class="subtle">Sign in with Google to load protected Firestore data.</p>';
}

function renderSignedOut() {
  pageTitleEl.textContent = "Secure sign-in";
  pageSubtitleEl.textContent = "Use Google sign-in to access the protected Firestore-backed marketing workspace.";
  appEl.innerHTML = `
    <section class="form-card auth-screen">
      <p class="eyebrow">Authentication required</p>
      <h3 class="section-title">Sign in to continue</h3>
      <p class="subtle">This deployment now protects the budget data behind Firebase Authentication and Firestore rules.</p>
      ${state.authError ? `<p class="text-danger" style="margin-top:14px;">${state.authError}</p>` : ""}
      <div class="form-actions" style="margin-top:18px;">
        <button id="google-signin-button">Sign in with Google</button>
      </div>
    </section>
  `;
  document.querySelector("#google-signin-button")?.addEventListener("click", handleGoogleSignIn);
}

function renderStatusScreen(title, message) {
  pageTitleEl.textContent = title;
  pageSubtitleEl.textContent = message;
  appEl.innerHTML = `<section class="panel-card auth-screen"><p class="eyebrow">Please wait</p><h3 class="section-title">${title}</h3><p class="subtle">${message}</p></section>`;
}

function renderEmptyWorkspace() {
  pageTitleEl.textContent = "Firestore setup";
  pageSubtitleEl.textContent = canImportData()
    ? "Import your local seed JSON once to initialize the protected workspace."
    : "No protected dataset has been loaded yet.";
  appEl.innerHTML = `
    <section class="panel-card auth-screen">
      <p class="eyebrow">Protected data</p>
      <h3 class="section-title">${canImportData() ? "Initialize workspace" : "Waiting for admin setup"}</h3>
      <p class="subtle">${canImportData() ? "Generate the latest seed locally, then use Import Seed to upload it into Firestore as the baseline and current dataset." : "An administrator needs to import the budget seed into Firestore before this workspace can be used."}</p>
      ${state.authError ? `<p class="text-danger" style="margin-top:14px;">${state.authError}</p>` : ""}
      ${canImportData() ? '<div class="form-actions" style="margin-top:18px;"><button id="empty-import-button">Import local seed JSON</button></div>' : ""}
    </section>
  `;
  document.querySelector("#empty-import-button")?.addEventListener("click", () => importInputEl.click());
}

function renderNav() {
  const visibleViews = views.filter((view) => roleViewAccess[state.role].includes(view.id));
  if (!visibleViews.some((view) => view.id === state.view)) state.view = visibleViews[0].id;
  navEl.innerHTML = visibleViews.map((view) => `<button class="${view.id === state.view ? "active" : ""}" data-view="${view.id}">${view.label}</button>`).join("");
  navEl.querySelectorAll("button").forEach((button) => button.addEventListener("click", () => { state.view = button.dataset.view; render(); }));
}

function renderAlerts() {
  const contracts = upcomingContracts().slice(0, 3);
  const overspends = overspendWatchlist().slice(0, 3);
  alertPanelEl.innerHTML = `
    <p class="eyebrow">Live alerts</p>
    <div class="alert-list">
      ${contracts.map((item) => `<article><div class="chip ${item.daysRemaining <= 30 ? "danger" : "warning"}">${item.daysRemaining} days</div><p><strong>${item.vendor_name}</strong> renews on ${formatDate(item.contract_end)}</p></article>`).join("")}
      ${overspends.map((item) => `<article><div class="chip danger">${item.deltaPercent}% over</div><p><strong>${item.vendor}</strong> in ${item.department} is above plan for ${item.month}.</p></article>`).join("")}
    </div>
  `;
}

function renderDashboard() {
  pageTitleEl.textContent = "Executive dashboard";
  pageSubtitleEl.textContent = "See budget vs. actuals, co-op recovery, top vendors, and renewal risk without digging through spreadsheets.";
  const summary = computeDepartmentSummary();
  const totals = summary.reduce((acc, item) => ({ budget: acc.budget + item.annualBudget, actual: acc.actual + item.annualActual, coop: acc.coop + item.coop, net: acc.net + item.net }), { budget: 0, actual: 0, coop: 0, net: 0 });
  const monthlyTotals = monthlyTotalsAll();
  const topVendors = [...state.data.budgetRecords].sort((a, b) => b.annual_actual - a.annual_actual).slice(0, 5);
  appEl.innerHTML = `
    <div class="grid metrics">
      ${metricCard("Total budget", formatCurrency(totals.budget), "Annual plan across all active departments")}
      ${metricCard("Actual spend", formatCurrency(totals.actual), "Captured invoice spend to date")}
      ${metricCard("Co-op recovered", formatCurrency(totals.coop), "Projected OEM reimbursement earned")}
      ${metricCard("Net cost", formatCurrency(totals.net), "True out-of-pocket marketing cost")}
    </div>
    <div class="grid two-up" style="margin-top:18px;">
      <section class="chart-card"><h3 class="section-title">Budget utilization by department</h3><div class="bars">${summary.map((item) => utilizationRow(item)).join("")}</div></section>
      <section class="chart-card"><h3 class="section-title">Monthly spend trend</h3><div class="sparkline">${monthlyTotals.map((item) => sparkBar(item, monthlyTotals)).join("")}</div></section>
    </div>
    <div class="grid two-up" style="margin-top:18px;">
      <section class="table-card"><h3 class="section-title">Top vendors by spend</h3><div class="table-wrap"><table><thead><tr><th>Vendor</th><th>Department</th><th>Actual</th><th>Net</th></tr></thead><tbody>${topVendors.map((vendor) => `<tr><td>${vendor.vendor_name}</td><td>${vendor.department}</td><td>${formatCurrency(vendor.annual_actual)}</td><td>${formatCurrency(vendor.net_cost)}</td></tr>`).join("")}</tbody></table></div></section>
      <section class="panel-card"><h3 class="section-title">Leadership briefing</h3><div class="summary-list">${summary.map((item) => `<div class="summary-row"><span>${item.department}</span><strong class="${varianceTone(item)}">${formatCurrency(item.variance)}</strong></div>`).join("")}</div><p style="margin-top:16px;">${roleLabels[state.role]} view prioritizes a zero-training summary: headline numbers, exposure alerts, and export-ready insights.</p></section>
    </div>
  `;
}

function renderBudgets() {
  pageTitleEl.textContent = "Budget management";
  pageSubtitleEl.textContent = "Review budget by department first, then expand into vendors only where you want more detail.";
  const summary = computeDepartmentSummary();
  const departmentOptions = ["All", ...state.data.departments]
    .map((department) => `<option value="${department}" ${department === state.budgetGrid.department ? "selected" : ""}>${department}</option>`)
    .join("");
  const measureOptions = [
    { value: "budget", label: "Budget" },
    { value: "actual", label: "Actual" },
    { value: "variance", label: "Variance" },
  ]
    .map((measure) => `<button type="button" class="toggle-pill ${measure.value === state.budgetGrid.measure ? "active" : ""}" data-measure="${measure.value}">${measure.label}</button>`)
    .join("");
  const visibleDepartments = state.budgetGrid.department === "All" ? state.data.departments : [state.budgetGrid.department];
  appEl.innerHTML = `
    <div class="grid three-up">${state.data.departments.map((department) => budgetHighlightCard(summary.find((row) => row.department === department))).join("")}</div>
    <section class="table-card" style="margin-top:18px;">
      <div class="budget-grid-header">
        <div>
          <h3 class="section-title">Department drill-down grid</h3>
          <p class="subtle">Departments stay collapsed by default. Expand only the areas you want to work in.</p>
        </div>
        <div class="budget-grid-controls">
          <label class="budget-grid-filter">
            <span class="eyebrow">Department</span>
            <select id="budget-grid-department">${departmentOptions}</select>
          </label>
          <div>
            <span class="eyebrow">Measure</span>
            <div class="toggle-group">${measureOptions}</div>
          </div>
        </div>
      </div>
      <div class="table-wrap monthly-grid-wrap"><table class="monthly-grid hierarchy-grid"><thead><tr><th>Name</th>${state.data.meta.months.map((month) => `<th>${month}</th>`).join("")}<th>Total</th></tr></thead><tbody>${visibleDepartments.map((department) => renderDepartmentGroup(department)).join("")}</tbody></table></div>
    </section>
    <section class="table-card" style="margin-top:18px;">
      <h3 class="section-title">Annual rollup</h3>
      <p class="subtle" style="margin-bottom:12px;">Set when a vendor starts, when it cancels, and the recurring monthly charge. The budget projection fills active months for 2026 automatically.</p>
      <div class="table-wrap"><table><thead><tr><th>Vendor</th><th>Department</th><th>Category</th><th>Added</th><th>Cancelled</th><th>Monthly charge</th><th>Co-op</th><th>Budget</th><th>Actual</th><th>Variance</th><th>Co-op $</th></tr></thead><tbody>${state.data.budgetRecords.slice().sort((a, b) => departmentSortValue(a.department) - departmentSortValue(b.department) || (a.display_order ?? 0) - (b.display_order ?? 0)).map((record) => `<tr><td>${record.vendor_name}</td><td>${record.department}</td><td>${record.category}</td><td><select class="lifecycle-input" data-record-id="${record.id}" data-field="start_month" ${canWriteData() ? "" : "disabled"}>${renderLifecycleMonthOptions(record.start_month, false)}</select></td><td><select class="lifecycle-input" data-record-id="${record.id}" data-field="end_month" ${canWriteData() ? "" : "disabled"}>${renderLifecycleMonthOptions(record.end_month, true)}</select></td><td><input class="lifecycle-input lifecycle-charge" type="number" min="0" step="0.01" value="${Number(record.recurring_charge || 0)}" data-record-id="${record.id}" data-field="recurring_charge" ${canWriteData() ? "" : "disabled"} /></td><td>${formatPercent(record.coop_rate)}</td><td>${formatCurrency(record.annual_budget)}</td><td>${formatCurrency(record.annual_actual)}</td><td class="${record.annual_variance < 0 ? "currency negative" : ""}">${formatCurrency(record.annual_variance)}</td><td>${formatCurrency(record.coop_amount)}</td></tr>`).join("")}</tbody></table></div>
    </section>
  `;
  document.querySelector("#budget-grid-department").addEventListener("change", (event) => {
    state.budgetGrid.department = event.target.value;
    state.budgetGrid.expandedDepartments = [];
    state.budgetGrid.expandedVendors = [];
    render();
  });
  document.querySelectorAll("[data-measure]").forEach((button) => button.addEventListener("click", () => {
    state.budgetGrid.measure = button.dataset.measure;
    render();
  }));
  document.querySelectorAll("[data-toggle-department]").forEach((button) => button.addEventListener("click", () => toggleExpanded(button.dataset.toggleDepartment, "department")));
  document.querySelectorAll("[data-toggle-vendor]").forEach((button) => button.addEventListener("click", () => toggleExpanded(button.dataset.toggleVendor, "vendor")));
  document.querySelectorAll(".grid-input").forEach((input) => input.addEventListener("change", handleBudgetGridInput));
  document.querySelectorAll(".lifecycle-input").forEach((input) => input.addEventListener("change", handleLifecycleInput));
}
function renderActuals() {
  const formDisabled = canWriteData() ? "" : "disabled";
  pageTitleEl.textContent = "Guided actuals entry";
  pageSubtitleEl.textContent = "Accounting can enter one vendor, one month, one amount. The system updates variance and co-op impact immediately.";
  appEl.innerHTML = `
    <div class="grid two-up">
      <section class="form-card">
        <h3 class="section-title">Monthly actuals form</h3>
        <form id="actuals-form">
          <div class="form-grid">
            <label><span class="eyebrow">Vendor</span><select name="recordId" required ${formDisabled}>${state.data.budgetRecords.map((record) => `<option value="${record.id}">${record.vendor_name} (${record.department})</option>`).join("")}</select></label>
            <label><span class="eyebrow">Month</span><select name="month" required ${formDisabled}>${state.data.meta.months.map((month, index) => `<option value="${index}">${month}</option>`).join("")}</select></label>
            <label class="full"><span class="eyebrow">Actual spend</span><input name="amount" type="number" min="0" step="0.01" placeholder="Enter invoice amount" required ${formDisabled} /></label>
          </div>
          <div class="form-actions">
            <button type="submit" ${formDisabled}>Save actual</button>
            <button type="button" class="secondary" id="autofill-button" ${formDisabled}>Autofill current month gaps</button>
          </div>
          <p id="actuals-feedback" class="subtle" style="margin-top:16px;"></p>
        </form>
      </section>
      <section class="panel-card">
        <h3 class="section-title">Overspend watchlist</h3>
        <div class="alert-list">${renderOverspends()}</div>
      </section>
    </div>
    <section class="table-card" style="margin-top:18px;">
      <h3 class="section-title">Latest actuals snapshot</h3>
      <div class="table-wrap"><table><thead><tr><th>Vendor</th><th>Department</th><th>Apr budget</th><th>Apr actual</th><th>Annual variance</th><th>Projected co-op</th></tr></thead><tbody>${state.data.budgetRecords.slice().sort((a, b) => b.monthly_actual[3] - a.monthly_actual[3]).slice(0, 12).map((record) => `<tr><td>${record.vendor_name}</td><td>${record.department}</td><td>${formatCurrency(record.monthly_budget[3])}</td><td>${formatCurrency(record.monthly_actual[3])}</td><td class="${record.annual_variance < 0 ? "currency negative" : ""}">${formatCurrency(record.annual_variance)}</td><td>${formatCurrency(record.coop_amount)}</td></tr>`).join("")}</tbody></table></div>
    </section>
  `;
  document.querySelector("#actuals-form").addEventListener("submit", handleActualSubmit);
  document.querySelector("#autofill-button").addEventListener("click", autofillCurrentMonth);
}

function renderROI() {
  const formDisabled = canWriteData() ? "" : "disabled";
  pageTitleEl.textContent = "ROI and performance";
  pageSubtitleEl.textContent = "Track CPL, CPU, CPRO, and CPS by department with monthly trends and manual-edit fallback for disconnected systems.";
  const roiDepartments = availableROIDepartments();
  const selectedDepartment = roiDepartments[0];
  const records = state.data.roiRecords.filter((record) => record.department === selectedDepartment);
  appEl.innerHTML = `
    <div class="grid two-up">
      <section class="panel-card"><h3 class="section-title">ROI summary</h3><div class="kpi-list">${renderROISummaryRows()}</div></section>
      <section class="form-card">
        <h3 class="section-title">Manual KPI override</h3>
        <form id="roi-form">
          <div class="form-grid">
            <label><span class="eyebrow">Department</span><select name="department" ${formDisabled}>${availableROIDepartments().map((department) => `<option value="${department}">${department}</option>`).join("")}</select></label>
            <label><span class="eyebrow">Month</span><select name="month" ${formDisabled}>${state.data.meta.months.map((month, index) => `<option value="${index + 1}">${month}</option>`).join("")}</select></label>
            <label><span class="eyebrow">Leads</span><input type="number" min="0" step="1" name="leads" required ${formDisabled} /></label>
            <label><span class="eyebrow">Sessions</span><input type="number" min="0" step="1" name="sessions" required ${formDisabled} /></label>
            <label><span class="eyebrow">Units sold</span><input type="number" min="0" step="1" name="units_sold" required ${formDisabled} /></label>
            <label><span class="eyebrow">Service ROs</span><input type="number" min="0" step="1" name="service_ros" required ${formDisabled} /></label>
          </div>
          <div class="form-actions"><button type="submit" ${formDisabled}>Update metrics</button></div>
          <p id="roi-feedback" class="subtle" style="margin-top:16px;"></p>
        </form>
      </section>
    </div>
    <section class="table-card" style="margin-top:18px;">
      <h3 class="section-title">${selectedDepartment} monthly ROI</h3>
      <div class="table-wrap"><table><thead><tr><th>Month</th><th>Net spend</th><th>Leads</th><th>Sessions</th><th>CPL</th><th>CPU</th><th>CPRO</th><th>CPS</th></tr></thead><tbody>${records.map((record) => `<tr><td>${record.month_name}</td><td>${formatCurrency(record.net_spend)}</td><td>${record.leads}</td><td>${record.sessions}</td><td>${formatCurrency(record.cpl)}</td><td>${record.cpu ? formatCurrency(record.cpu) : "n/a"}</td><td>${record.cpro ? formatCurrency(record.cpro) : "n/a"}</td><td>${formatCurrency(record.cps)}</td></tr>`).join("")}</tbody></table></div>
    </section>
  `;
  document.querySelector("#roi-form").addEventListener("submit", handleROIForm);
}

function renderContracts() {
  pageTitleEl.textContent = "Vendor contracts";
  pageSubtitleEl.textContent = "Keep renewal risk, monthly rate drift, and co-op eligibility visible so no vendor rolls over unnoticed.";
  const contracts = [...state.data.vendorContracts].sort((a, b) => daysUntil(a.contract_end) - daysUntil(b.contract_end));
  appEl.innerHTML = `
    <div class="grid two-up">
      <section class="panel-card"><h3 class="section-title">Upcoming renewals</h3><div class="contract-list">${contracts.slice(0, 8).map((contract) => `<article><div class="chip ${daysUntil(contract.contract_end) <= 30 ? "danger" : "warning"}">${daysUntil(contract.contract_end)} days left</div><p><strong>${contract.vendor_name}</strong> | ${contract.departments}</p><p class="subtle">${formatDate(contract.contract_end)} | ${formatCurrency(contract.monthly_rate)} / month</p></article>`).join("")}</div></section>
      <section class="highlight-card"><p class="eyebrow">Contract discipline</p><h3 class="section-title">Zero renewal surprises</h3><p>The PRD calls for 90-day and 30-day alerts, rate-change visibility, and a home for negotiation notes.</p><div class="summary-list" style="margin-top:16px;"><div class="summary-row"><span>Contracts inside 90 days</span><strong>${contracts.filter((item) => daysUntil(item.contract_end) <= 90).length}</strong></div><div class="summary-row"><span>Co-op eligible vendors</span><strong>${contracts.filter((item) => item.coop_eligible).length}</strong></div><div class="summary-row"><span>Average monthly rate</span><strong>${formatCurrency(average(contracts.map((item) => item.monthly_rate)))}</strong></div></div></section>
    </div>
    <section class="table-card" style="margin-top:18px;">
      <h3 class="section-title">Contract tracker</h3>
      <div class="table-wrap"><table><thead><tr><th>Vendor</th><th>Departments</th><th>Category</th><th>Rate</th><th>Ends</th><th>Co-op</th><th>Price delta</th></tr></thead><tbody>${contracts.map((contract) => { const delta = contract.monthly_rate - contract.previous_rate; return `<tr><td>${contract.vendor_name}</td><td>${contract.departments}</td><td>${contract.category}</td><td>${formatCurrency(contract.monthly_rate)}</td><td>${formatDate(contract.contract_end)}</td><td>${contract.coop_eligible ? formatPercent(contract.coop_rate) : "No"}</td><td class="${delta > 0 ? "text-warning" : "text-success"}">${formatCurrency(delta)}</td></tr>`; }).join("")}</tbody></table></div>
    </section>
  `;
}

function renderReports() {
  pageTitleEl.textContent = "Reporting center";
  pageSubtitleEl.textContent = "Export-ready rollups for monthly leadership reviews, co-op claims, and department check-ins.";
  const summary = computeDepartmentSummary();
  const contracts = upcomingContracts().slice(0, 5);
  const overspends = overspendWatchlist().slice(0, 5);
  appEl.innerHTML = `
    <div class="grid three-up">
      <section class="highlight-card"><p class="eyebrow">Monthly exec packet</p><h3 class="section-title">Leadership snapshot</h3><p>${summary.length} departments summarized with budget, actual, net cost, and variance status.</p></section>
      <section class="highlight-card"><p class="eyebrow">Co-op packet</p><h3 class="section-title">${formatCurrency(sum(state.data.budgetRecords.map((record) => record.coop_amount)))}</h3><p>Projected reimbursement available for claim support and OEM submission prep.</p></section>
      <section class="highlight-card"><p class="eyebrow">Renewal packet</p><h3 class="section-title">${contracts.length} urgent renewals</h3><p>Vendor agreements needing review in the next 90 days.</p></section>
    </div>
    <div class="grid two-up" style="margin-top:18px;">
      <section class="panel-card"><h3 class="section-title">Department summary</h3><div class="summary-list">${summary.map((item) => `<div class="summary-row"><span>${item.department}</span><span>${formatCurrency(item.annualActual)} actual / ${formatCurrency(item.annualBudget)} budget</span></div>`).join("")}</div></section>
      <section class="panel-card"><h3 class="section-title">Action queue</h3><div class="alert-list">${overspends.map((item) => `<article><p><strong>${item.vendor}</strong> is ${item.deltaPercent}% over in ${item.month}</p><p class="subtle">${item.department}</p></article>`).join("")}${contracts.map((item) => `<article><p><strong>${item.vendor_name}</strong> contract ends ${formatDate(item.contract_end)}</p><p class="subtle">${item.departments}</p></article>`).join("")}</div></section>
    </div>
  `;
}
async function handleBudgetGridInput(event) {
  const input = event.target;
  const record = state.data.budgetRecords.find((entry) => entry.id === input.dataset.recordId);
  const monthIndex = Number(input.dataset.monthIndex);
  const field = input.dataset.field;
  const rawValue = Number(input.value || 0);
  if (field === "budget") {
    record.monthly_budget[monthIndex] = round(Math.max(0, rawValue));
  } else if (field === "actual") {
    record.monthly_actual[monthIndex] = round(Math.max(0, rawValue));
  } else {
    const budget = Number(record.monthly_budget[monthIndex] || 0);
    record.monthly_actual[monthIndex] = round(Math.max(0, budget - rawValue));
  }
  Object.assign(record, deriveBudgetRecord(record));
  syncROIForDepartment(record.department);
  await persistPlatformData();
  render();
}

async function handleLifecycleInput(event) {
  const input = event.target;
  const record = state.data.budgetRecords.find((entry) => entry.id === input.dataset.recordId);
  const field = input.dataset.field;
  if (field === "recurring_charge") {
    record.recurring_charge = round(Math.max(0, Number(input.value || 0)));
  } else if (field === "start_month") {
    record.start_month = Number(input.value || 0);
  } else if (field === "end_month") {
    record.end_month = input.value === "" ? null : Number(input.value);
  }
  applyLifecycleProjection(record);
  Object.assign(record, deriveBudgetRecord(record));
  syncROIForDepartment(record.department);
  await persistPlatformData();
  render();
}

async function handleActualSubmit(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const recordId = form.get("recordId");
  const monthIndex = Number(form.get("month"));
  const amount = Number(form.get("amount"));
  const record = state.data.budgetRecords.find((entry) => entry.id === recordId);
  record.monthly_actual[monthIndex] = amount;
  Object.assign(record, deriveBudgetRecord(record));
  syncROIForDepartment(record.department);
  const budget = record.monthly_budget[monthIndex];
  const variancePercent = budget ? Math.round(((amount - budget) / budget) * 100) : 0;
  document.querySelector("#actuals-feedback").textContent = variancePercent > 10 ? `Saved. ${record.vendor_name} is now ${variancePercent}% over budget for ${state.data.meta.months[monthIndex]}.` : `Saved. ${record.vendor_name} now shows ${formatCurrency(amount)} actuals for ${state.data.meta.months[monthIndex]}.`;
  await persistPlatformData();
  render();
}

async function autofillCurrentMonth() {
  const monthIndex = 3;
  state.data.budgetRecords.forEach((record) => {
    if (!record.monthly_actual[monthIndex]) {
      record.monthly_actual[monthIndex] = round(record.monthly_budget[monthIndex] * 0.96);
      Object.assign(record, deriveBudgetRecord(record));
    }
  });
  state.data.departments.forEach(syncROIForDepartment);
  await persistPlatformData();
  render();
}

async function handleROIForm(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const department = form.get("department");
  const month = Number(form.get("month"));
  const record = state.data.roiRecords.find((entry) => entry.department === department && entry.month === month);
  record.leads = Number(form.get("leads"));
  record.sessions = Number(form.get("sessions"));
  record.units_sold = Number(form.get("units_sold"));
  record.service_ros = Number(form.get("service_ros"));
  recalculateROIRecord(record);
  document.querySelector("#roi-feedback").textContent = `Updated ${department} for ${state.data.meta.months[month - 1]}.`;
  await persistPlatformData();
  render();
}

function syncROIForDepartment(department) {
  const departmentBudgetRecords = state.data.budgetRecords.filter((record) => record.department === department);
  state.data.meta.months.forEach((monthName, index) => {
    const totalSpend = sum(departmentBudgetRecords.map((record) => record.monthly_actual[index]));
    const netSpend = sum(departmentBudgetRecords.map((record) => record.monthly_actual[index] * (1 - record.coop_rate)));
    const roiRecord = state.data.roiRecords.find((entry) => entry.department === department && entry.month === index + 1);
    roiRecord.total_spend = round(totalSpend);
    roiRecord.net_spend = round(netSpend);
    recalculateROIRecord(roiRecord);
  });
}

function recalculateROIRecord(record) {
  record.cpl = record.leads ? round(record.net_spend / record.leads) : 0;
  record.cpu = record.units_sold ? round(record.net_spend / record.units_sold) : 0;
  record.cpro = record.service_ros ? round(record.net_spend / record.service_ros) : 0;
  record.cps = record.sessions ? round(record.net_spend / record.sessions) : 0;
}

function renderROISummaryRows() {
  return state.data.departments.map((department) => {
    const records = state.data.roiRecords.filter((record) => record.department === department);
    const netSpend = sum(records.map((record) => record.net_spend));
    const leads = sum(records.map((record) => record.leads));
    const sessions = sum(records.map((record) => record.sessions));
    const units = sum(records.map((record) => record.units_sold));
    const ros = sum(records.map((record) => record.service_ros));
    return `<div class="summary-row"><span>${department}</span><span>${formatCurrency(leads ? netSpend / leads : 0)} CPL | ${formatCurrency(sessions ? netSpend / sessions : 0)} CPS | ${units ? formatCurrency(netSpend / units) : "n/a"} CPU | ${ros ? formatCurrency(netSpend / ros) : "n/a"} CPRO</span></div>`;
  }).join("");
}

function computeDepartmentSummary() {
  return state.data.departments.map((department) => {
    const records = state.data.budgetRecords.filter((record) => record.department === department);
    const annualBudget = sum(records.map((record) => record.annual_budget));
    const annualActual = sum(records.map((record) => record.annual_actual));
    const coop = sum(records.map((record) => record.coop_amount));
    const net = sum(records.map((record) => record.net_cost));
    return { department, annualBudget: round(annualBudget), annualActual: round(annualActual), variance: round(annualBudget - annualActual), coop: round(coop), net: round(net) };
  });
}

function monthlyTotalsAll() {
  return state.data.meta.months.map((month, index) => ({ month, budget: round(sum(state.data.budgetRecords.map((record) => record.monthly_budget[index]))), actual: round(sum(state.data.budgetRecords.map((record) => record.monthly_actual[index]))) }));
}

function upcomingContracts() {
  return state.data.vendorContracts.map((contract) => ({ ...contract, daysRemaining: daysUntil(contract.contract_end) })).filter((contract) => contract.daysRemaining <= 90).sort((a, b) => a.daysRemaining - b.daysRemaining);
}

function overspendWatchlist() {
  const alerts = [];
  state.data.budgetRecords.forEach((record) => {
    record.monthly_budget.forEach((budget, index) => {
      const actual = record.monthly_actual[index];
      if (budget && actual > budget * 1.1) alerts.push({ vendor: record.vendor_name, department: record.department, month: state.data.meta.months[index], budget, actual, deltaPercent: Math.round(((actual - budget) / budget) * 100) });
    });
  });
  return alerts.sort((a, b) => b.deltaPercent - a.deltaPercent);
}

function renderOverspends() {
  const watchlist = overspendWatchlist().slice(0, 8);
  if (!watchlist.length) return '<p class="subtle">No vendors are over budget right now.</p>';
  return watchlist.map((item) => `<article><div class="chip ${item.deltaPercent > 20 ? "danger" : "warning"}">${item.deltaPercent}% over</div><p><strong>${item.vendor}</strong> in ${item.department}</p><p class="subtle">${item.month} budget ${formatCurrency(item.budget)} vs actual ${formatCurrency(item.actual)}</p></article>`).join("");
}
function renderDepartmentGroup(department) {
  const records = state.data.budgetRecords.filter((record) => record.department === department);
  const departmentId = slugify(department);
  const expanded = isExpanded(departmentId, "department");
  const summaryValues = aggregateRows(records);
  const entries = groupedDepartmentEntries(department, records);
  let rows = summaryHierarchyRow({
    label: department,
    meta: `${entries.length} lines`,
    values: summaryValues,
    expanded,
    toggleAttr: `data-toggle-department="${departmentId}"`,
    rowClass: "department-row",
    indentClass: "indent-0",
  });
  if (!expanded) return rows;
  rows += entries.map((entry) => renderHierarchyEntry(entry)).join("");
  return rows;
}

function groupedDepartmentEntries(department, records) {
  const groups = new Map();
  const entries = [];
  records.forEach((record) => {
    const groupLabel = groupedVendorLabel(record);
    if (!groupLabel) {
      entries.push({ type: "record", label: record.vendor_name, record });
      return;
    }
    if (!groups.has(groupLabel)) {
      const groupEntry = {
        type: "group",
        label: groupLabel,
        groupId: `group:${slugify(department)}:${slugify(groupLabel)}`,
        records: [],
      };
      groups.set(groupLabel, groupEntry);
      entries.push(groupEntry);
    }
    groups.get(groupLabel).records.push(record);
  });
  return entries;
}

function groupedVendorLabel(record) {
  if (/vinsolutions/i.test(record.vendor_name)) return "VinSolutions";
  if (/events?/i.test(record.category) || record.vendor_name === "Events") return "Events";
  return "";
}

function renderHierarchyEntry(entry) {
  if (entry.type === "group") return renderGroupedVendorRow(entry);
  return renderVendorRow(entry.record, "indent-1", "vendor-leaf-row");
}

function renderGroupedVendorRow(entry) {
  const expanded = isExpanded(entry.groupId, "vendor");
  const values = aggregateRows(entry.records);
  let rows = summaryHierarchyRow({
    label: entry.label,
    meta: `${entry.records.length} items`,
    values,
    expanded,
    toggleAttr: `data-toggle-vendor="${entry.groupId}"`,
    rowClass: "group-row",
    indentClass: "indent-1",
  });
  if (!expanded) return rows;
  rows += entry.records
    .map((record) => renderVendorRow(record, "indent-2", "vendor-child-row"))
    .join("");
  return rows;
}

function renderVendorRow(record, indentClass = "indent-1", rowClass = "vendor-row") {
  const values = state.data.meta.months.map((_, index) => monthlyMeasureValue(record, index));
  const total = sum(values);
  return `<tr class="hierarchy-row ${rowClass}"><td class="name-stack ${indentClass}"><div class="name-line"><span class="tree-spacer" aria-hidden="true"></span><span>${record.vendor_name}</span></div><div class="name-meta vendor-meta">${record.category}</div></td>${values.map((value, index) => monthlyGridCell(record, value, index)).join("")}<td class="${total < 0 ? "currency negative" : ""}">${formatCurrency(total)}</td></tr>`;
}

function summaryHierarchyRow({ label, meta, values, expanded, toggleAttr, rowClass, indentClass }) {
  const total = sum(values);
  return `<tr class="hierarchy-row ${rowClass}"><td class="name-stack ${indentClass}"><div class="name-line"><button type="button" class="tree-toggle" ${toggleAttr}>${expanded ? "-" : "+"}</button><span>${label}</span></div>${meta ? `<div class="name-meta">${meta}</div>` : ""}</td>${values.map((value) => `<td class="${value < 0 ? "currency negative" : ""}">${formatCurrency(value)}</td>`).join("")}<td class="${total < 0 ? "currency negative" : ""}">${formatCurrency(total)}</td></tr>`;
}

function aggregateRows(records) {
  return state.data.meta.months.map((_, index) => sum(records.map((record) => monthlyMeasureValue(record, index))));
}

function isExpanded(id, type) {
  const key = type === "department" ? "expandedDepartments" : "expandedVendors";
  return Array.isArray(state.budgetGrid[key]) && state.budgetGrid[key].includes(id);
}

function toggleExpanded(id, type) {
  const key = type === "department" ? "expandedDepartments" : "expandedVendors";
  const current = new Set(state.budgetGrid[key] || []);
  if (current.has(id)) current.delete(id);
  else current.add(id);
  state.budgetGrid[key] = Array.from(current);
  if (type === "department" && !current.has(id)) {
    const recordIds = new Set(
      state.data.budgetRecords
        .filter((record) => slugify(record.department) === id)
        .map((record) => record.id)
    );
    const groupPrefix = `group:${id}:`;
    state.budgetGrid.expandedVendors = (state.budgetGrid.expandedVendors || []).filter(
      (vendorId) => !recordIds.has(vendorId) && !vendorId.startsWith(groupPrefix)
    );
  }
  render();
}

function departmentSortValue(department) {
  const index = DEPARTMENT_ORDER.indexOf(department);
  return index === -1 ? DEPARTMENT_ORDER.length : index;
}

function availableROIDepartments() {
  return DEPARTMENT_ORDER.filter((department) => state.data.roiRecords.some((record) => record.department === department));
}

function slugify(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function monthlyGridCell(record, value, index) {
  const minValue = state.budgetGrid.measure === "variance" ? "" : 'min="0"';
  const negativeClass = value < 0 ? "negative" : "";
  return `<td><input class="grid-input ${state.budgetGrid.measure} ${negativeClass}" type="number" step="0.01" ${minValue} value="${Number(value || 0)}" data-record-id="${record.id}" data-month-index="${index}" data-field="${state.budgetGrid.measure}" ${canWriteData() ? "" : "disabled"} /></td>`;
}

function monthlyMeasureValue(record, index) {
  if (state.budgetGrid.measure === "budget") return record.monthly_budget[index];
  if (state.budgetGrid.measure === "actual") return record.monthly_actual[index];
  return round(record.monthly_budget[index] - record.monthly_actual[index]);
}

function normalizeLifecycle(record) {
  const startMonth = Number.isInteger(record.start_month) ? clampMonth(record.start_month) : inferStartMonth(record);
  const inferredEnd = inferEndMonth(record);
  const endMonth = record.end_month === null || record.end_month === "" ? null : (Number.isInteger(record.end_month) ? clampMonth(record.end_month) : inferredEnd);
  const recurringCharge = round(Math.max(0, Number(record.recurring_charge ?? inferRecurringCharge(record) ?? 0)));
  return {
    start_month: startMonth,
    end_month: endMonth !== null && endMonth < startMonth ? startMonth : endMonth,
    recurring_charge: recurringCharge,
  };
}

function inferStartMonth(record) {
  const idx = record.monthly_budget.findIndex((value) => Number(value || 0) > 0);
  return idx >= 0 ? idx : 0;
}

function inferEndMonth(record) {
  for (let index = record.monthly_budget.length - 1; index >= 0; index -= 1) {
    if (Number(record.monthly_budget[index] || 0) > 0) {
      return index === record.monthly_budget.length - 1 ? null : index;
    }
  }
  return null;
}

function inferRecurringCharge(record) {
  const firstBudget = record.monthly_budget.find((value) => Number(value || 0) > 0);
  return Number(record.contract_rate || firstBudget || 0);
}

function clampMonth(value) {
  return Math.max(0, Math.min(11, Number(value || 0)));
}

function applyLifecycleProjection(record) {
  const lifecycle = normalizeLifecycle(record);
  const endMonth = lifecycle.end_month === null ? state.data.meta.months.length - 1 : lifecycle.end_month;
  record.start_month = lifecycle.start_month;
  record.end_month = lifecycle.end_month !== null && lifecycle.end_month < lifecycle.start_month ? lifecycle.start_month : lifecycle.end_month;
  record.recurring_charge = lifecycle.recurring_charge;
  record.monthly_budget = state.data.meta.months.map((_, index) => (index >= lifecycle.start_month && index <= endMonth ? lifecycle.recurring_charge : 0));
}

function renderLifecycleMonthOptions(selectedMonth, allowBlank) {
  const options = [];
  if (allowBlank) {
    options.push(`<option value="" ${selectedMonth === null || selectedMonth === "" ? "selected" : ""}>Active</option>`);
  }
  return options.concat(state.data.meta.months.map((month, index) => `<option value="${index}" ${selectedMonth === index ? "selected" : ""}>${month}</option>`)).join("");
}

function budgetHighlightCard(item) {
  return `<section class="highlight-card"><p class="eyebrow">${item.department}</p><h3 class="section-title">${formatCurrency(item.annualBudget)}</h3><p>${formatCurrency(item.annualActual)} actual, ${formatCurrency(item.variance)} variance, ${formatCurrency(item.coop)} co-op.</p></section>`;
}

function utilizationRow(item) {
  const utilization = item.annualBudget ? Math.round((item.annualActual / item.annualBudget) * 100) : 0;
  const tone = utilization > 110 ? "danger" : utilization > 95 ? "warning" : "";
  return `<div class="bar-row"><div class="bar-label"><span>${item.department}</span><span>${utilization}%</span></div><div class="bar-track"><div class="bar-fill ${tone}" style="width:${Math.min(utilization, 140)}%"></div></div></div>`;
}

function sparkBar(item, monthlyTotals) {
  const max = Math.max(...monthlyTotals.map((row) => row.actual), 1);
  const height = Math.max(18, (item.actual / max) * 180);
  return `<div style="height:${height}px" title="${item.month}: ${formatCurrency(item.actual)}"><span>${item.month}</span></div>`;
}

function varianceTone(item) {
  if (item.variance < 0) return "text-danger";
  if (item.variance < item.annualBudget * 0.1) return "text-warning";
  return "text-success";
}

function metricCard(label, value, caption) {
  return `<section class="metric-card"><span>${label}</span><strong>${value}</strong><small>${caption}</small></section>`;
}

function exportSummary() {
  const summary = computeDepartmentSummary();
  const lines = [
    "BMW/MINI of Pittsburgh Marketing Platform Summary",
    `Role: ${roleLabels[state.role]}`,
    "",
    "Department totals:",
    ...summary.map((item) => `${item.department}: budget ${formatCurrency(item.annualBudget)}, actual ${formatCurrency(item.annualActual)}, variance ${formatCurrency(item.variance)}, co-op ${formatCurrency(item.coop)}`),
    "",
    "Upcoming renewals:",
    ...upcomingContracts().slice(0, 5).map((item) => `${item.vendor_name}: ${formatDate(item.contract_end)} (${item.daysRemaining} days)`),
    "",
    "Overspend watchlist:",
    ...overspendWatchlist().slice(0, 5).map((item) => `${item.vendor} ${item.month}: ${item.deltaPercent}% over budget`),
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "marketing-platform-summary.txt";
  link.click();
  URL.revokeObjectURL(link.href);
}

function formatCurrency(value) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value || 0);
}

function formatPercent(value) { return `${Math.round((value || 0) * 100)}%`; }
function formatDate(value) { return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(`${value}T00:00:00`)); }
function round(value) { return Math.round((value + Number.EPSILON) * 100) / 100; }
function sum(values) { return round(values.reduce((total, value) => total + Number(value || 0), 0)); }
function average(values) { return values.length ? sum(values) / values.length : 0; }
function daysUntil(dateString) { return Math.round((new Date(`${dateString}T00:00:00`) - new Date("2026-04-05T00:00:00")) / 86400000); }

