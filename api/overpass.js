const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];
const REQUEST_TIMEOUT_MS = 10_000;
const RETRYABLE_STATUS = new Set([406, 429, 502, 503, 504]);

function isAllowedMethod(method) {
  return method === "POST" || method === "OPTIONS";
}

function readDataParam(body) {
  if (!body) return null;

  if (typeof body === "string") {
    const trimmed = body.trim();
    if (!trimmed) return null;
    if (trimmed.startsWith("data=")) {
      return new URLSearchParams(trimmed).get("data");
    }
    return trimmed;
  }

  if (body instanceof URLSearchParams) return body.get("data");

  if (Buffer.isBuffer(body)) return readDataParam(body.toString("utf8"));

  if (ArrayBuffer.isView(body)) {
    return readDataParam(Buffer.from(body.buffer, body.byteOffset, body.byteLength));
  }

  if (typeof body === "object") {
    return typeof body.data === "string" ? body.data : null;
  }

  return null;
}

async function fetchFromOverpass(body, signal) {
  let lastResponse = null;

  for (let i = 0; i < OVERPASS_ENDPOINTS.length; i += 1) {
    const endpoint = OVERPASS_ENDPOINTS[i];
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        Accept: "application/json, text/plain;q=0.9, */*;q=0.8",
      },
      body,
      signal,
    });

    if (response.ok) {
      return response;
    }

    lastResponse = response;
    if (!RETRYABLE_STATUS.has(response.status) || i === OVERPASS_ENDPOINTS.length - 1) {
      return response;
    }
  }

  return lastResponse;
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

  const query = readDataParam(req.body);
  if (!query) {
    return res.status(400).json({ error: "Missing Overpass query in request body." });
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const requestBody = new URLSearchParams({ data: query }).toString();
    const upstreamResponse = await fetchFromOverpass(requestBody, controller.signal);

    if (!upstreamResponse) {
      return res.status(502).json({ error: "No Overpass upstream response." });
    }

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
