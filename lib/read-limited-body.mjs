/** @returns {Promise<{ok: true, value: string} | {ok: false, reason: "too_large" | "invalid"}>} */
export async function readLimitedText(request, maxBytes, timeoutMs) {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    void request.body?.cancel().catch(() => undefined);
    return { ok: false, reason: "too_large" };
  }

  const reader = request.body?.getReader();
  if (!reader) return { ok: false, reason: "invalid" };
  const chunks = [];
  let totalBytes = 0;
  let timedOut = false;
  const timeout = Number.isFinite(timeoutMs) && timeoutMs > 0
    ? setTimeout(() => {
        timedOut = true;
        void reader.cancel().catch(() => undefined);
      }, timeoutMs)
    : undefined;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (timedOut) return { ok: false, reason: "invalid" };
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        void reader.cancel().catch(() => undefined);
        return { ok: false, reason: "too_large" };
      }
      chunks.push(value);
    }
    if (timedOut) return { ok: false, reason: "invalid" };
    const body = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return { ok: true, value: new TextDecoder().decode(body) };
  } catch {
    return { ok: false, reason: "invalid" };
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

/** @returns {Promise<{ok: true, value: Record<string, unknown>} | {ok: false, reason: "too_large" | "invalid"}>} */
export async function readLimitedJsonObject(request, maxBytes) {
  const text = await readLimitedText(request, maxBytes);
  if (!text.ok) return text;
  try {
    const parsed = JSON.parse(text.value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { ok: false, reason: "invalid" };
    return { ok: true, value: parsed };
  } catch {
    return { ok: false, reason: "invalid" };
  }
}
