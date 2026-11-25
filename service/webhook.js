/**
 * Dispatches a non-blocking JSON webhook POST when a short link is clicked.
 */
async function fireClickWebhook(webhookUrl, payload) {
  if (!webhookUrl) return false;
  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-SnipURL-Event": "link.clicked",
      },
      body: JSON.stringify({
        event: "link.clicked",
        ...payload,
      }),
      signal: AbortSignal.timeout(3000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

module.exports = { fireClickWebhook };
