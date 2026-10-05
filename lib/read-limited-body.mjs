/** @returns {Promise<{ok: true, value: string} | {ok: false, reason: "too_large" | "invalid"}>} */
export async function readLimitedText(request, maxBytes) {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    await request.body?.cancel().catch(() => undefined);
    return { ok: false, reason: "too_large" };
  }

  const reader = request.body?.getReader();
  if (!reader) return { ok: false, reason: "invalid" };
  const chunks = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        return { ok: false, reason: "too_large" };
      }
      chunks.push(value);
    }
    const body = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return { ok: true, value: new TextDecoder().decode(body) };
  } catch {
    return { ok: false, reason: "invalid" };
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
