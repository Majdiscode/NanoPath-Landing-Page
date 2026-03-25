/* ====================================================================
   NanoPath Landing Page — script.js
   Beta access + Stripe checkout + post-purchase license lookup
   ==================================================================== */

const CONFIG = {
  apiBase:
    window.NANOPATH_API_BASE_URL ||
    "https://nanopath-download-gate.majdiscode.workers.dev",
  fallbackLocal: "http://127.0.0.1:8787",
  storageKey: "nanopath_beta_access_key",
  purchaseStorageKey: "nanopath_purchased",
  validKeyHashes: [
    "e860b3d7e556ebd81f4f1d8c5adfa4bfc55d40cbb7a213682faed15d49eea1cf",
    "4614d42a75056835c1ecf373a846e127cf0e840f6bbcc90301ea762fe97c6f2c"
  ],
};

// ---------------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------------
const el = {
  accessForm: document.getElementById("access-form"),
  accessKey: document.getElementById("access-key"),
  accessStatus: document.getElementById("access-status"),
  downloadMac: document.getElementById("download-mac"),
  downloadWindows: document.getElementById("download-windows"),
  versionBadge: document.getElementById("version-badge"),
  purchaseSuccess: document.getElementById("purchase-success"),
  licenseKeyValue: document.getElementById("license-key-value"),
  copyLicenseKey: document.getElementById("copy-license-key"),
  licenseStatus: document.getElementById("license-status")
};

const downloadUrls = { mac: null, windows: null };
let activeKey = "";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function apiBase() {
  const host = window.location.hostname;
  if (host === "localhost" || host === "127.0.0.1") return CONFIG.fallbackLocal;
  return CONFIG.apiBase;
}

function normalizeKey(key) {
  return key.trim().toUpperCase();
}

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text)
  );
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function isValidKey(raw) {
  if (!raw || !window.crypto?.subtle) return false;
  const hash = await sha256Hex(normalizeKey(raw));
  return CONFIG.validKeyHashes.includes(hash);
}

function setStatus(type, message) {
  el.accessStatus.className = `status ${type}`;
  el.accessStatus.textContent = message;
}

// ---------------------------------------------------------------------------
// Release info (fetched from Worker — no direct GitHub URLs exposed)
// ---------------------------------------------------------------------------
async function fetchRelease() {
  try {
    const res = await fetch(`${apiBase()}/v1/release-info`);
    if (!res.ok) return;
    const data = await res.json();

    if (el.versionBadge && data.version) {
      el.versionBadge.textContent = `Latest: ${data.version}`;
    }

    // Store platform availability (not direct URLs)
    downloadUrls.mac = data.platforms?.mac ? `${apiBase()}/v1/download/mac` : null;
    downloadUrls.windows = data.platforms?.windows ? `${apiBase()}/v1/download/windows` : null;
  } catch {
    /* silent */
  }
}

// ---------------------------------------------------------------------------
// Download state — buttons point to Worker proxy (requires session cookie)
// ---------------------------------------------------------------------------
function updateDownloads(unlocked) {
  const items = [
    { node: el.downloadMac, url: downloadUrls.mac, label: "Download macOS", na: "Unavailable" },
    { node: el.downloadWindows, url: downloadUrls.windows, label: "Download Windows", na: "Unavailable" }
  ];

  for (const { node, url, label, na } of items) {
    if (unlocked && url) {
      node.href = url;
      node.textContent = label;
      node.classList.remove("is-disabled");
      node.removeAttribute("aria-disabled");
      node.removeAttribute("tabindex");
    } else {
      node.href = "#";
      node.textContent = unlocked ? na : "Locked";
      node.classList.add("is-disabled");
      node.setAttribute("aria-disabled", "true");
      node.setAttribute("tabindex", "-1");
    }
  }
}

// ---------------------------------------------------------------------------
// Beta access session
// ---------------------------------------------------------------------------
function setUnlocked(key) {
  activeKey = normalizeKey(key);
  localStorage.setItem(CONFIG.storageKey, activeKey);
  updateDownloads(true);
  setStatus("status-success", "Beta access unlocked. Downloads are available below.");
}

function unlockPurchasedDownloads(licenseKey) {
  localStorage.setItem(CONFIG.purchaseStorageKey, licenseKey);
  updateDownloads(true);
}

function clearAccess(msg) {
  activeKey = "";
  localStorage.removeItem(CONFIG.storageKey);
  updateDownloads(false);
  if (msg) setStatus("status-error", msg);
}

function clearKeyFromUrl() {
  const url = new URL(location.href);
  if (url.searchParams.has("key")) {
    url.searchParams.delete("key");
    history.replaceState({}, "", url.toString());
  }
}

async function initAccess() {
  updateDownloads(false);
  await fetchRelease();

  // Check if user has a purchased license (auto-unlock downloads)
  const purchasedKey = localStorage.getItem(CONFIG.purchaseStorageKey);
  if (purchasedKey) {
    updateDownloads(true);
    setStatus("status-success", "License active. Downloads are available below.");
    return;
  }

  // Check if user redeemed an invite key (stored in localStorage)
  const redeemedKey = localStorage.getItem("nanopath_invite_redeemed");
  if (redeemedKey) {
    updateDownloads(true);
    setStatus("status-success", "Invite key accepted. Downloads are available below.");
    return;
  }

  // Auto-redeem from query param
  const keyFromUrl = new URLSearchParams(location.search).get("key");
  if (keyFromUrl) {
    clearKeyFromUrl();
    await redeemInviteKey(keyFromUrl);
    return;
  }

  setStatus("status-neutral", "Enter a valid invite key to enable downloads.");
}

async function redeemInviteKey(key) {
  try {
    const res = await fetch(`${apiBase()}/v1/redeem-invite`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ key }),
    });
    const data = await res.json();

    if (!res.ok) {
      setStatus("status-error", data.error || "Invalid invite key.");
      return false;
    }

    localStorage.setItem("nanopath_invite_redeemed", key.trim().toUpperCase());
    updateDownloads(true);
    setStatus("status-success", "Invite key accepted! Downloads are available below.");
    return true;
  } catch {
    setStatus("status-error", "Could not validate key. Please try again.");
    return false;
  }
}

async function onAccessSubmit(e) {
  e.preventDefault();
  const raw = el.accessKey.value.trim();
  if (!raw) {
    setStatus("status-error", "Enter an invite key.");
    return;
  }
  setStatus("status-neutral", "Validating…");
  const ok = await redeemInviteKey(raw);
  if (ok) el.accessKey.value = "";
}

el.accessForm.addEventListener("submit", onAccessSubmit);

// ---------------------------------------------------------------------------
// Stripe Checkout
// ---------------------------------------------------------------------------
async function startCheckout(plan) {
  const btn = document.querySelector(`.btn-checkout[data-plan="${plan}"]`);
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Redirecting…";

  try {
    const res = await fetch(`${apiBase()}/v1/create-checkout`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ plan })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to create checkout session");

    // Redirect to Stripe Checkout
    window.location.href = data.url;
  } catch (err) {
    btn.disabled = false;
    btn.textContent = originalText;
    alert(err.message || "Something went wrong. Please try again.");
  }
}

document.querySelectorAll(".btn-checkout").forEach((btn) => {
  btn.addEventListener("click", () => startCheckout(btn.dataset.plan));
});

// ---------------------------------------------------------------------------
// Post-purchase: retrieve license key from session_id
// ---------------------------------------------------------------------------
async function handlePostPurchase() {
  const params = new URLSearchParams(location.search);
  const sessionId = params.get("session_id");
  if (!sessionId) return;

  // Hide ALL other main sections so only the success screen is visible
  document.querySelectorAll(".main-content > .section, .main-content > .hero").forEach((s) => {
    if (s.id !== "purchase-success") s.hidden = true;
  });

  // Show the success panel
  el.purchaseSuccess.hidden = false;
  el.licenseKeyValue.textContent = "Retrieving your license…";

  // Scroll to top
  window.scrollTo({ top: 0, behavior: "smooth" });

  // Clean URL
  const cleanUrl = new URL(location.href);
  cleanUrl.searchParams.delete("session_id");
  history.replaceState({}, "", cleanUrl.toString());

  try {
    const res = await fetch(`${apiBase()}/v1/license-by-session?session_id=${encodeURIComponent(sessionId)}`);
    const data = await res.json();

    if (!res.ok) throw new Error(data.error || "Could not retrieve license");

    el.licenseKeyValue.textContent = data.license_key;
    el.licenseStatus.textContent = "";
    el.licenseStatus.className = "caption";

    // Auto-unlock downloads for paying customers
    unlockPurchasedDownloads(data.license_key);
  } catch (err) {
    el.licenseKeyValue.textContent = "—";
    el.licenseStatus.textContent = err.message || "Could not retrieve your license. Contact support.";
    el.licenseStatus.className = "caption";
  }
}

// Copy license key to clipboard
el.copyLicenseKey.addEventListener("click", async () => {
  const key = el.licenseKeyValue.textContent;
  if (!key || key === "Loading…" || key === "—" || key.startsWith("Retrieving")) return;

  try {
    await navigator.clipboard.writeText(key);
    el.copyLicenseKey.textContent = "Copied!";
    setTimeout(() => (el.copyLicenseKey.textContent = "Copy"), 2000);
  } catch {
    el.licenseStatus.textContent = "Could not copy automatically. Please select and copy manually.";
  }
});

// ---------------------------------------------------------------------------
// Account Login + Dashboard
// ---------------------------------------------------------------------------
const loginForm = document.getElementById("login-form");
const loginEmail = document.getElementById("login-email");
const loginBtn = document.getElementById("login-btn");
const loginStatus = document.getElementById("login-status");
const accountLogin = document.getElementById("account-login");
const accountDashboard = document.getElementById("account-dashboard");

function setLoginStatus(type, message) {
  loginStatus.className = `status ${type}`;
  loginStatus.textContent = message;
}

function formatDate(isoStr) {
  if (!isoStr) return "—";
  return new Date(isoStr).toLocaleDateString("en-US", {
    year: "numeric", month: "short", day: "numeric"
  });
}

function getStatusInfo(data) {
  if (data.revoked) return { label: "Revoked", cssClass: "status-badge--revoked" };
  if (data.cancel_at_period_end) return { label: "Cancels at period end", cssClass: "status-badge--canceled" };
  if (new Date(data.expires_at) < new Date()) return { label: "Expired", cssClass: "status-badge--expired" };
  const status = data.subscription_status || "active";
  if (status === "active" || status === "trialing") return { label: status === "trialing" ? "Trial" : "Active", cssClass: "status-badge--active" };
  if (status === "past_due") return { label: "Past Due", cssClass: "status-badge--canceled" };
  return { label: status, cssClass: "status-badge--active" };
}

function renderDashboard(data) {
  accountLogin.hidden = true;
  accountDashboard.hidden = false;

  document.getElementById("account-email").textContent = data.email || "—";
  document.getElementById("account-license-key").textContent = data.license_key || "—";
  document.getElementById("account-plan").textContent =
    data.plan ? formatPlanName(data.plan) : "—";

  const statusInfo = getStatusInfo(data);
  const statusEl = document.getElementById("account-status");
  statusEl.textContent = statusInfo.label;
  statusEl.className = `status-badge ${statusInfo.cssClass}`;

  document.getElementById("account-expires").textContent =
    data.cancel_at_period_end ? `Ends ${formatDate(data.expires_at)}` : formatDate(data.expires_at);
  document.getElementById("account-devices").textContent =
    `${data.machine_count || 0} of ${data.machine_limit || 2} used`;

  // Also unlock downloads for paying customers
  unlockPurchasedDownloads(data.license_key);

  // Show team panel for lab plan owners
  const teamPanel = document.getElementById("team-panel");
  if (data.org && data.org.role === "owner") {
    teamPanel.hidden = false;
    renderTeamPanel(data.org);
  } else {
    teamPanel.hidden = true;
  }

  // Disable checkout buttons for active subscribers
  if (!data.revoked && data.subscription_status !== "canceled") {
    disableCheckoutButtons();
  }
}

function disableCheckoutButtons() {
  document.querySelectorAll(".btn-checkout").forEach((btn) => {
    btn.disabled = true;
    btn.textContent = "Already subscribed";
    btn.classList.add("is-disabled");
  });
}

function showLoginForm() {
  accountLogin.hidden = false;
  accountDashboard.hidden = true;
}

// Check session on page load
async function checkSession() {
  try {
    const res = await fetch(`${apiBase()}/v1/account`, {
      credentials: "include",
    });
    const data = await res.json();
    if (data.authenticated && data.has_license) {
      renderDashboard(data);
      return true;
    }
  } catch { /* not logged in */ }
  showLoginForm();
  return false;
}

// Login form submit
if (loginForm) {
  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = loginEmail.value.trim();
    if (!email) {
      setLoginStatus("status-error", "Please enter your email.");
      return;
    }

    loginBtn.disabled = true;
    loginBtn.textContent = "Sending…";
    setLoginStatus("status-neutral", "Sending login link…");

    try {
      const res = await fetch(`${apiBase()}/v1/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not send login link");

      setLoginStatus("status-success", "Check your email! We sent you a secure login link.");
      loginBtn.textContent = "Link Sent ✓";
    } catch (err) {
      loginBtn.disabled = false;
      loginBtn.textContent = "Send Login Link";
      setLoginStatus("status-error", err.message || "Something went wrong. Please try again.");
    }
  });
}

// Copy license key from dashboard
const copyAccountKey = document.getElementById("copy-account-key");
if (copyAccountKey) {
  copyAccountKey.addEventListener("click", async () => {
    const key = document.getElementById("account-license-key").textContent;
    if (!key || key === "—") return;
    try {
      await navigator.clipboard.writeText(key);
      copyAccountKey.textContent = "Copied!";
      setTimeout(() => (copyAccountKey.textContent = "Copy"), 2000);
    } catch { /* fallback: user can manually select */ }
  });
}

// Manage subscription via Stripe portal
const managePortalBtn = document.getElementById("manage-portal-btn");
if (managePortalBtn) {
  managePortalBtn.addEventListener("click", async () => {
    const email = document.getElementById("account-email").textContent;
    if (!email || email === "—") return;

    managePortalBtn.disabled = true;
    managePortalBtn.textContent = "Redirecting…";

    try {
      const res = await fetch(`${apiBase()}/v1/create-portal-session`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not open subscription portal");
      window.location.href = data.url;
    } catch (err) {
      managePortalBtn.disabled = false;
      managePortalBtn.textContent = "Manage Subscription";
      alert(err.message);
    }
  });
}

// Logout
const logoutBtn = document.getElementById("logout-btn");
if (logoutBtn) {
  logoutBtn.addEventListener("click", async () => {
    try {
      await fetch(`${apiBase()}/v1/logout`, {
        method: "POST",
        credentials: "include",
      });
    } catch { /* best-effort */ }
    showLoginForm();
    setLoginStatus("status-neutral", "We'll email you a secure login link — no password needed.");
    loginBtn.disabled = false;
    loginBtn.textContent = "Send Login Link";
    loginEmail.value = "";
  });
}

// ---------------------------------------------------------------------------
// Team Management (Lab plan)
// ---------------------------------------------------------------------------

function formatPlanName(plan) {
  const names = { monthly: "Monthly", annual: "Annual", lab: "Lab (Monthly)", "lab-annual": "Lab (Annual)" };
  return names[plan] || plan.charAt(0).toUpperCase() + plan.slice(1);
}

function renderTeamPanel(org) {
  const memberList = document.getElementById("team-member-list");
  const slots = document.getElementById("team-slots");
  const members = org.members || [];

  slots.textContent = `${members.length} of ${org.seat_limit} seats used`;
  memberList.innerHTML = "";

  members.forEach((email) => {
    const li = document.createElement("li");
    li.className = "team-member";

    const emailSpan = document.createElement("span");
    emailSpan.className = "team-member-email";
    emailSpan.textContent = email;
    li.appendChild(emailSpan);

    // Don't show remove button for the owner
    const ownerEmail = document.getElementById("account-email").textContent.toLowerCase();
    if (email.toLowerCase() !== ownerEmail) {
      const removeBtn = document.createElement("button");
      removeBtn.className = "btn btn-ghost btn-sm team-remove-btn";
      removeBtn.textContent = "Remove";
      removeBtn.addEventListener("click", () => removeMember(email));
      li.appendChild(removeBtn);
    } else {
      const badge = document.createElement("span");
      badge.className = "team-owner-badge";
      badge.textContent = "Owner";
      li.appendChild(badge);
    }

    memberList.appendChild(li);
  });
}

async function removeMember(email) {
  if (!confirm(`Remove ${email} from your team?`)) return;

  try {
    const res = await fetch(`${apiBase()}/v1/org/remove`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ email }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to remove member");
    // Refresh dashboard
    await checkSession();
  } catch (err) {
    alert(err.message);
  }
}

const inviteForm = document.getElementById("invite-form");
const inviteEmail = document.getElementById("invite-email");
const inviteBtn = document.getElementById("invite-btn");
const inviteStatus = document.getElementById("invite-status");

if (inviteForm) {
  inviteForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = inviteEmail.value.trim();
    if (!email) return;

    inviteBtn.disabled = true;
    inviteBtn.textContent = "Sending…";
    inviteStatus.hidden = false;
    inviteStatus.className = "status status-neutral";
    inviteStatus.textContent = "Sending invite…";

    try {
      const res = await fetch(`${apiBase()}/v1/org/invite`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to send invite");

      inviteStatus.className = "status status-success";
      inviteStatus.textContent = `Invite sent to ${email}`;
      inviteEmail.value = "";
      inviteBtn.textContent = "Invite";
      inviteBtn.disabled = false;

      // Refresh dashboard to show new member
      await checkSession();
    } catch (err) {
      inviteBtn.disabled = false;
      inviteBtn.textContent = "Invite";
      inviteStatus.className = "status status-error";
      inviteStatus.textContent = err.message;
    }
  });
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
handlePostPurchase();
initAccess();
checkSession().then((loggedIn) => {
  // If URL hash is #account, scroll to account section
  if (window.location.hash === "#account") {
    const section = document.getElementById("manage-subscription");
    if (section) section.scrollIntoView({ behavior: "smooth", block: "start" });
  }
});
