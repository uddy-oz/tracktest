export type HistoryCursor = { id: string; played_at: string };
function micros(value: string) {
  const date=Date.parse(value);
  if(!Number.isFinite(date))throw Error("Invalid history timestamp");
  const fraction=(value.match(/\.(\d+)/)?.[1]||"").padEnd(6,"0");
  return BigInt(date)*1000n+BigInt(fraction.slice(3,6)||"0");
}
export function historyCursorFilter(cursor: HistoryCursor) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cursor.id) || !/^\d{4}-\d{2}-\d{2}T[\d:.]+(?:Z|[+-]\d{2}:\d{2})$/.test(cursor.played_at) || !Number.isFinite(Date.parse(cursor.played_at))) throw Error("Invalid history cursor");
  // Keep PostgreSQL microseconds intact: Date.toISOString() would truncate them.
  return `played_at.lt.${cursor.played_at},and(played_at.eq.${cursor.played_at},id.lt.${cursor.id})`;
}
export async function collectHistoryPages<T extends HistoryCursor>(fetchPage: (cursor: HistoryCursor | null, size: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>, size = 250) {
  const rows = new Map<string,T>(); let cursor: HistoryCursor | null = null;
  for (let page=0;page<10000;page++) {
    let result;
    try { result=await fetchPage(cursor,size); } catch { return {data:null,error:{message:"History could not be loaded completely."}}; }
    if (result.error) return { data: null, error: result.error };
    const batch = result.data || [];
    // A server can enforce a smaller row cap than requested; only empty means done.
    if (!batch.length) return { data: [...rows.values()], error: null };
    const next = batch[batch.length-1];
    try { historyCursorFilter(next); } catch { return {data:null,error:{message:"Invalid history pagination data."}}; }
    if (cursor && (micros(next.played_at) > micros(cursor.played_at) || (micros(next.played_at) === micros(cursor.played_at) && next.id >= cursor.id))) return {data:null,error:{message:"History pagination did not advance."}};
    batch.forEach(row=>rows.set(row.id,row)); cursor={ id:next.id, played_at:next.played_at };
  }
  return { data:null, error:{message:"History is too large to load safely. No partial total was used."} };
}
