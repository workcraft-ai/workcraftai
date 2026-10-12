/** Add a hard deadline to outbound HTTP calls while preserving caller aborts. */
export function createBoundedFetch(timeoutMs = 5_000): typeof fetch {
  return (input, init) => {
    const requestSignal = init?.signal
      ?? (typeof Request !== "undefined" && input instanceof Request ? input.signal : undefined);
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const signal = requestSignal
      ? AbortSignal.any([requestSignal, timeoutSignal])
      : timeoutSignal;

    return fetch(input, { ...init, signal });
  };
}
