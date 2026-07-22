function order(value:unknown):unknown{if(Array.isArray(value))return value.map(order);if(value!==null&&typeof value==="object")return Object.fromEntries(Object.entries(value as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b)).map(([key,nested])=>[key,order(nested)]));return value}
export function canonicalJson(value:unknown):string{return JSON.stringify(order(value))}
