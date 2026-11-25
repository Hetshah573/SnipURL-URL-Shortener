const BLOCKED_HOSTS = new Set([
  "169.254.169.254", // AWS/GCP cloud metadata
  "metadata.google.internal",
]);

/**
 * Checks if targetUrl points back to the SnipURL host itself (prevents infinite redirect loops).
 */
function isSelfRedirect(targetUrl, reqHost) {
  try {
    const parsed = new global.URL(targetUrl);
    const targetHost = parsed.host.toLowerCase();
    const currentHost = (reqHost || "").toLowerCase();
    const configuredHost = (process.env.APP_HOST || "").toLowerCase();

    if (currentHost && targetHost === currentHost) return true;
    if (configuredHost && targetHost === configuredHost) return true;
    return false;
  } catch {
    return false;
  }
}

/**
 * Checks if targetUrl points to a blocked internal/metadata host.
 */
function isBlockedHost(targetUrl) {
  try {
    const parsed = new global.URL(targetUrl);
    return BLOCKED_HOSTS.has(parsed.hostname.toLowerCase());
  } catch {
    return true;
  }
}

/**
 * Optional Google Safe Browsing v4 check (active when GOOGLE_SAFE_BROWSING_API_KEY is set).
 * Returns { safe: boolean, reason?: string }.
 */
async function checkSafeBrowsing(targetUrl) {
  const apiKey = process.env.GOOGLE_SAFE_BROWSING_API_KEY;
  if (!apiKey) return { safe: true };

  try {
    const endpoint = `https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client: { clientId: "snipurl", clientVersion: "1.0.0" },
        threatInfo: {
          threatTypes: ["MALWARE", "SOCIAL_ENGINEERING", "UNWANTED_SOFTWARE", "POTENTIALLY_HARMFUL_APPLICATION"],
          platformTypes: ["ANY_PLATFORM"],
          threatEntryTypes: ["URL"],
          threatEntries: [{ url: targetUrl }],
        },
      }),
      signal: AbortSignal.timeout(2500),
    });
    if (!res.ok) return { safe: true }; // fail-open if API errors
    const data = await res.json();
    if (data && Array.isArray(data.matches) && data.matches.length > 0) {
      return { safe: false, reason: `Flagged by Google Safe Browsing (${data.matches[0].threatType}).` };
    }
    return { safe: true };
  } catch {
    return { safe: true };
  }
}

/**
 * Runs all safety checks on a destination URL.
 * Returns { ok: true } or { ok: false, error: string }.
 */
async function validateTargetUrlSafety(targetUrl, reqHost) {
  if (isSelfRedirect(targetUrl, reqHost)) {
    return { ok: false, error: "Self-redirect detected: you cannot shorten a URL pointing to this SnipURL host." };
  }
  if (isBlockedHost(targetUrl)) {
    return { ok: false, error: "This destination host is blocked for security reasons." };
  }
  const sb = await checkSafeBrowsing(targetUrl);
  if (!sb.safe) {
    return { ok: false, error: sb.reason || "Destination URL was flagged as unsafe." };
  }
  return { ok: true };
}

module.exports = {
  isSelfRedirect,
  isBlockedHost,
  checkSafeBrowsing,
  validateTargetUrlSafety,
};
