/** Add a hard deadline to outbound HTTP calls while preserving caller aborts. */
export function createBoundedFetch(timeoutMs = 5_000, deadlineAt?: number): typeof fetch {
  return (input, init) => {
    const requestSignal = init?.signal
      ?? (typeof Request !== "undefined" && input instanceof Request ? input.signal : undefined);
    if (deadlineAt !== undefined && Date.now() >= deadlineAt) {
      return Promise.reject(new Error("Request deadline exceeded."));
    }
    const remaining = deadlineAt === undefined ? timeoutMs : Math.min(timeoutMs, deadlineAt - Date.now());
    const timeoutSignal = AbortSignal.timeout(Math.max(1, Math.floor(remaining)));
    const signal = requestSignal
      ? AbortSignal.any([requestSignal, timeoutSignal])
      : timeoutSignal;

    return fetch(input, { ...init, signal });
  };
}
