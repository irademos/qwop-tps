const OVERPASS_ENDPOINT = "https://overpass-api.de/api/interpreter";
const REQUEST_TIMEOUT_MS = 10_000;

function isAllowedMethod(method) {
  return method === "POST" || method === "OPTIONS";
}

export default async function handler(req, res) {
  if (!isAllowedMethod(req.method)) {
    res.setHeader("Allow", "POST, OPTIONS");
    return res.status(405).json({ error: "Method not allowed." });
  }

  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    return res.status(204).end();
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const contentType = req.headers["content-type"] || "application/x-www-form-urlencoded;charset=UTF-8";
    const body = typeof req.body === "string"
      ? req.body
      : new URLSearchParams(req.body || {}).toString();

    const upstreamResponse = await fetch(OVERPASS_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": contentType,
      },
      body,
      signal: controller.signal,
    });

    const responseText = await upstreamResponse.text();
    const upstreamContentType = upstreamResponse.headers.get("content-type") || "application/json; charset=utf-8";

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Content-Type", upstreamContentType);
    return res.status(upstreamResponse.status).send(responseText);
  } catch (error) {
    const status = error?.name === "AbortError" ? 504 : 502;
    return res.status(status).json({
      error: status === 504 ? "Overpass request timed out." : "Failed to reach Overpass API.",
      detail: error?.message || "Unknown error",
    });
  } finally {
    clearTimeout(timeoutId);
  }
}
