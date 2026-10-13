type Page<T> = { data: T[] | null; error: { message: string } | null };
/** Never silently publish a capped REST result as an entire account's data.
 * Callbacks must use a stable unique ordering before applying the range.
 */
export async function readAllPages<T>(page: (from: number, to: number) => PromiseLike<Page<T>>): Promise<Page<T>> {
  const rows: T[] = [];
  for (let from = 0; ; from += 500) {
    const result = await page(from, from + 499);
    if (result.error) return { data: null, error: { message: "Could not load complete account data." } };
    rows.push(...(result.data ?? []));
    if ((result.data?.length ?? 0) < 500) return { data: rows, error: null };
  }
}
