export function snapshotDecision(existingHashes: readonly string[], contentHash: string): "REUSE"|"CREATE" { return existingHashes.includes(contentHash)?"REUSE":"CREATE"; }
export function appendAudit<T>(events: readonly T[], event:T): readonly T[]{return Object.freeze([...events,event])}
