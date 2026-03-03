const ACCESS_CONFIG = {
  storageKey: "nanopath_beta_access_key",
  validKeyHashes: [
    "e860b3d7e556ebd81f4f1d8c5adfa4bfc55d40cbb7a213682faed15d49eea1cf",
    "4614d42a75056835c1ecf373a846e127cf0e840f6bbcc90301ea762fe97c6f2c"
  ],
  releaseApiUrl: "https://api.github.com/repos/Majdiscode/NanoPath-Landing-Page/releases/latest"
};

// Resolved at runtime from GitHub API
const downloadUrls = { mac: null, windows: null };
let releaseVersion = "";

const elements = {
  accessForm: document.getElementById("access-form"),
  accessKeyInput: document.getElementById("access-key"),
  accessStatus: document.getElementById("access-status"),
  copyLinkButton: document.getElementById("copy-link-button"),
  downloadMac: document.getElementById("download-mac"),
  downloadWindows: document.getElementById("download-windows"),
  versionBadge: document.getElementById("version-badge")
};

let activeKey = "";

function normalizeKey(value) {
  return value.trim().toUpperCase();
}

async function sha256Hex(text) {
  const encoded = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function isValidKey(rawKey) {
  if (!rawKey || !window.crypto?.subtle) {
    return false;
  }

  const normalized = normalizeKey(rawKey);
  if (!normalized) {
    return false;
  }

  const hash = await sha256Hex(normalized);
  return ACCESS_CONFIG.validKeyHashes.includes(hash);
}

function setStatus(type, message) {
  elements.accessStatus.className = `status ${type}`;
  elements.accessStatus.textContent = message;
}

async function fetchReleaseInfo() {
  try {
    const response = await fetch(ACCESS_CONFIG.releaseApiUrl);
    if (!response.ok) return;
    const release = await response.json();

    releaseVersion = release.tag_name || "";
    if (elements.versionBadge && releaseVersion) {
      elements.versionBadge.textContent = `Latest: ${releaseVersion}`;
    }

    for (const asset of release.assets || []) {
      const name = asset.name.toLowerCase();
      if (name.endsWith(".dmg")) {
        downloadUrls.mac = asset.browser_download_url;
      } else if (name.endsWith(".exe") && !name.endsWith(".blockmap")) {
        downloadUrls.windows = asset.browser_download_url;
      }
    }
  } catch {
    // Silently fail — buttons stay disabled if no release found
  }
}

function updateDownloadState(isUnlocked) {
  const items = [
    {
      node: elements.downloadMac,
      url: downloadUrls.mac,
      enabledLabel: "Download for macOS",
      unavailableLabel: "macOS build unavailable"
    },
    {
      node: elements.downloadWindows,
      url: downloadUrls.windows,
      enabledLabel: "Download for Windows",
      unavailableLabel: "Windows build unavailable"
    }
  ];

  for (const item of items) {
    if (isUnlocked && item.url) {
      item.node.href = item.url;
      item.node.textContent = item.enabledLabel;
      item.node.classList.remove("is-disabled");
      item.node.removeAttribute("aria-disabled");
      item.node.removeAttribute("tabindex");
    } else if (isUnlocked && !item.url) {
      item.node.href = "#";
      item.node.textContent = item.unavailableLabel;
      item.node.classList.add("is-disabled");
      item.node.setAttribute("aria-disabled", "true");
      item.node.setAttribute("tabindex", "-1");
    } else {
      item.node.href = "#";
      item.node.textContent = "Unlock with Tester Key";
      item.node.classList.add("is-disabled");
      item.node.setAttribute("aria-disabled", "true");
      item.node.setAttribute("tabindex", "-1");
    }
  }
}

function setUnlockedState(key) {
  const normalized = normalizeKey(key);
  activeKey = normalized;
  localStorage.setItem(ACCESS_CONFIG.storageKey, normalized);
  updateDownloadState(true);
  elements.copyLinkButton.disabled = false;
  setStatus("status-success", "Free beta access enabled. You can now download for macOS or Windows.");
}

function resetAccessState(message) {
  activeKey = "";
  localStorage.removeItem(ACCESS_CONFIG.storageKey);
  updateDownloadState(false);
  elements.copyLinkButton.disabled = true;
  setStatus("status-error", message);
}

function clearKeyFromUrl() {
  const url = new URL(window.location.href);
  if (url.searchParams.has("key")) {
    url.searchParams.delete("key");
    window.history.replaceState({}, "", url.toString());
  }
}

async function tryUnlockFromSource(rawKey) {
  if (!rawKey) {
    return false;
  }

  if (await isValidKey(rawKey)) {
    setUnlockedState(rawKey);
    return true;
  }

  return false;
}

async function initializeAccess() {
  updateDownloadState(false);

  // Fetch release info in parallel with key validation
  await fetchReleaseInfo();

  if (!window.crypto?.subtle) {
    setStatus("status-error", "Secure key validation is unavailable in this browser.");
    return;
  }

  const params = new URLSearchParams(window.location.search);
  const keyFromQuery = params.get("key");

  if (keyFromQuery) {
    const unlockedFromQuery = await tryUnlockFromSource(keyFromQuery);
    if (unlockedFromQuery) {
      clearKeyFromUrl();
      return;
    }
    resetAccessState("This invite key is invalid or expired.");
    clearKeyFromUrl();
    return;
  }

  const savedKey = localStorage.getItem(ACCESS_CONFIG.storageKey);
  if (savedKey) {
    const unlockedFromStorage = await tryUnlockFromSource(savedKey);
    if (unlockedFromStorage) {
      setStatus("status-success", "Free beta access is active on this device.");
      return;
    }

    localStorage.removeItem(ACCESS_CONFIG.storageKey);
  }

  setStatus("status-neutral", "Access locked. Enter a valid tester key to enable downloads.");
}

async function onAccessSubmit(event) {
  event.preventDefault();

  const enteredKey = elements.accessKeyInput.value;
  if (!enteredKey.trim()) {
    setStatus("status-error", "Enter a tester key to continue.");
    return;
  }

  const valid = await isValidKey(enteredKey);
  if (!valid) {
    setStatus("status-error", "That key did not match an invite. Check the key and try again.");
    return;
  }

  setUnlockedState(enteredKey);
  elements.accessKeyInput.value = "";
}

async function onCopyLinkClick() {
  if (!activeKey) {
    return;
  }

  const inviteUrl = new URL(window.location.href);
  inviteUrl.searchParams.set("key", activeKey);

  try {
    await navigator.clipboard.writeText(inviteUrl.toString());
    setStatus("status-success", "Private invite link copied to clipboard.");
  } catch {
    setStatus("status-error", "Could not copy link automatically. Copy it manually from the address bar.");
  }
}

elements.accessForm.addEventListener("submit", onAccessSubmit);
elements.copyLinkButton.addEventListener("click", onCopyLinkClick);

initializeAccess();
