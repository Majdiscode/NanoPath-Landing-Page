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
  validKeyHashes: [
    "e860b3d7e556ebd81f4f1d8c5adfa4bfc55d40cbb7a213682faed15d49eea1cf",
    "4614d42a75056835c1ecf373a846e127cf0e840f6bbcc90301ea762fe97c6f2c"
  ],
  releaseApiUrl:
    "https://api.github.com/repos/Majdiscode/NanoPath-Landing-Page/releases/latest"
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
// GitHub release info
// ---------------------------------------------------------------------------
async function fetchRelease() {
  try {
    const res = await fetch(CONFIG.releaseApiUrl);
    if (!res.ok) return;
    const data = await res.json();

    if (el.versionBadge && data.tag_name) {
      el.versionBadge.textContent = `Latest: ${data.tag_name}`;
    }

    for (const asset of data.assets || []) {
      const name = asset.name.toLowerCase();
      if (name.endsWith(".dmg")) downloadUrls.mac = asset.browser_download_url;
      else if (name.endsWith(".exe") && !name.endsWith(".blockmap"))
        downloadUrls.windows = asset.browser_download_url;
    }
  } catch {
    /* silent */
  }
}

// ---------------------------------------------------------------------------
// Download state
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

  if (!window.crypto?.subtle) {
    setStatus("status-error", "Secure key validation is unavailable in this browser.");
    return;
  }

  // Auto-unlock from query param
  const keyFromUrl = new URLSearchParams(location.search).get("key");
  if (keyFromUrl) {
    if (await isValidKey(keyFromUrl)) {
      setUnlocked(keyFromUrl);
    } else {
      clearAccess("This invite key is invalid.");
    }
    clearKeyFromUrl();
    return;
  }

  // Restore from storage
  const saved = localStorage.getItem(CONFIG.storageKey);
  if (saved && (await isValidKey(saved))) {
    setUnlocked(saved);
    return;
  }

  if (saved) localStorage.removeItem(CONFIG.storageKey);
  setStatus("status-neutral", "Enter a valid invite key to enable downloads.");
}

async function onAccessSubmit(e) {
  e.preventDefault();
  const raw = el.accessKey.value;
  if (!raw.trim()) {
    setStatus("status-error", "Enter a tester key.");
    return;
  }
  if (await isValidKey(raw)) {
    setUnlocked(raw);
    el.accessKey.value = "";
  } else {
    setStatus("status-error", "Invalid key. Check and try again.");
  }
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

  // Show the success panel
  el.purchaseSuccess.hidden = false;
  el.licenseKeyValue.textContent = "Retrieving your license…";

  // Scroll to it
  el.purchaseSuccess.scrollIntoView({ behavior: "smooth", block: "center" });

  // Clean URL
  const cleanUrl = new URL(location.href);
  cleanUrl.searchParams.delete("session_id");
  history.replaceState({}, "", cleanUrl.toString());

  try {
    const res = await fetch(`${apiBase()}/v1/license-by-session?session_id=${encodeURIComponent(sessionId)}`);
    const data = await res.json();

    if (!res.ok) throw new Error(data.error || "Could not retrieve license");

    el.licenseKeyValue.textContent = data.license_key;
    el.licenseStatus.textContent = "Paste this key into the NanoPath app → Settings → License to activate.";
    el.licenseStatus.className = "caption";
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
// Init
// ---------------------------------------------------------------------------
handlePostPurchase();
initAccess();
