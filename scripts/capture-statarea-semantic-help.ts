import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";

/**
 * Diagnostic capture utility only. The B006 evidence capture has already been
 * completed and is preserved under ignored runtime directories. This script is
 * never called by the operational assessment; network-capable actions require
 * one explicit allowlisted flag and retain strict host, redirect, size and hash
 * checks. `--offline-audit` performs no request.
 */

const FAQ_URL = "https://old.statarea.com/faq";
const MODERN_TIPS_URL = "https://www.statarea.com/tips/date/2026-07-21/";
const EXPECTED_DATE = "2026-07-21";
const MAX_BYTES = 5_000_000;
const faqEvidenceRoot = join(process.cwd(), "var", "evidence", "semantics", "statarea-legacy-faq");
const tipsEvidenceRoot = join(process.cwd(), "var", "evidence", "semantics", "statarea-modern-tips", EXPECTED_DATE);
const modernPredictionEvidence = join(process.cwd(), "var", "evidence", "statarea", EXPECTED_DATE, "e5aed325cbd61b2ccd8b5a74c621709d33e5842da6546ad663c43fed0a6bff23.html");
const referencedAssetRoot = join(process.cwd(), "var", "evidence", "semantics", "statarea-referenced-assets");
const consumedTipsDiagnostic = join(process.cwd(), "var", "diagnostics", "semantics", "b006-r1", "official-modern-tips.json");
const LEGACY_HOME_URL = "https://old.statarea.com/";
const legacyHomeRoot = join(process.cwd(), "var", "diagnostics", "semantics", "b006-r2", "old-statarea-home");
const legacyHomeMetadataPath = join(legacyHomeRoot, "capture-metadata.json");
const REFERENCED_ASSET_URLS = [
  "https://www.statarea.com/public/js/pages/predictions.js?1784728917",
  "https://www.statarea.com/public/js/pages/common_predictions.js?1784728917",
] as const;

type Evidence = {
  status: "REUSED" | "CAPTURED";
  url: string;
  finalUrl: string;
  httpStatus: number;
  contentType: string;
  hash: string;
  bytes: number;
  path: string;
  networkRequests: number;
  dateValidation?: {
    expectedDate: string;
    headingMatches: number;
    dateValueMatches: number;
    validated: boolean;
  };
};

const repoRelative = (path: string) => relative(process.cwd(), path).replaceAll("\\", "/");

async function existingEvidence() {
  const entries = await readdir(faqEvidenceRoot).catch(() => [] as string[]);
  const htmlFiles = entries.filter((entry) => /^[a-f0-9]{64}\.html$/.test(entry));
  if (htmlFiles.length > 1) throw new Error("MULTIPLE_FAQ_EVIDENCE_FILES");
  if (!htmlFiles.length) return null;
  const path = join(faqEvidenceRoot, htmlFiles[0]);
  const body = await readFile(path);
  const hash = createHash("sha256").update(body).digest("hex");
  if (`${hash}.html` !== htmlFiles[0]) throw new Error("FAQ_EVIDENCE_HASH_MISMATCH");
  return {
    status: "REUSED" as const,
    url: FAQ_URL,
    finalUrl: FAQ_URL,
    httpStatus: 200,
    contentType: "text/html; charset=utf-8",
    hash,
    bytes: body.byteLength,
    path,
    networkRequests: 0,
  };
}

function validateTipsDate(html: string) {
  const headingMatches = (html.match(/Match tips, statistics and predictions for 2026-07-21/gi) ?? []).length;
  const dateValueMatches = (html.match(/id=["']cdate["'][^>]*>\s*2026-07-21\s*</gi) ?? []).length;
  const conflictingHeading = /Match tips, statistics and predictions for (?!2026-07-21)\d{4}-\d{2}-\d{2}/i.test(html);
  const validated = headingMatches > 0 && dateValueMatches > 0 && !conflictingHeading;
  return { expectedDate: EXPECTED_DATE, headingMatches, dateValueMatches, validated };
}

async function existingTipsEvidence(): Promise<Evidence | null> {
  const entries = await readdir(tipsEvidenceRoot).catch(() => [] as string[]);
  const htmlFiles = entries.filter((entry) => /^[a-f0-9]{64}\.html$/.test(entry));
  if (htmlFiles.length > 1) throw new Error("MULTIPLE_MODERN_TIPS_EVIDENCE_FILES");
  if (!htmlFiles.length) return null;
  const path = join(tipsEvidenceRoot, htmlFiles[0]);
  const body = await readFile(path);
  const hash = createHash("sha256").update(body).digest("hex");
  if (`${hash}.html` !== htmlFiles[0]) throw new Error("MODERN_TIPS_EVIDENCE_HASH_MISMATCH");
  const dateValidation = validateTipsDate(body.toString("utf8"));
  if (!dateValidation.validated) throw new Error("MODERN_TIPS_DATE_MISMATCH");
  return {
    status: "REUSED",
    url: MODERN_TIPS_URL,
    finalUrl: MODERN_TIPS_URL,
    httpStatus: 200,
    contentType: "text/html; charset=UTF-8",
    hash,
    bytes: body.byteLength,
    path,
    networkRequests: 0,
    dateValidation,
  };
}

async function captureModernTips(): Promise<Evidence> {
  const reused = await existingTipsEvidence();
  if (reused) return reused;
  const priorDiagnostic = await readFile(consumedTipsDiagnostic, "utf8").catch(() => "");
  if (priorDiagnostic.includes('"requestCount":1') && priorDiagnostic.includes('"captureStatus":"REJECTED_DATE_UNVALIDATED"')) {
    throw new Error("MODERN_TIPS_REQUEST_ALREADY_CONSUMED_WITH_REJECTED_DATE");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(MODERN_TIPS_URL, {
      redirect: "manual",
      signal: controller.signal,
      headers: {
        accept: "text/html,application/xhtml+xml",
        "accept-language": "en-US,en;q=0.9",
        "user-agent": "OU25-Consensus-Lab/0.6 semantic-evidence",
      },
    });
    if (response.status !== 200) throw new Error(`MODERN_TIPS_HTTP_${response.status}`);
    if (response.url !== MODERN_TIPS_URL) throw new Error("MODERN_TIPS_FINAL_URL_MISMATCH");
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("text/html")) throw new Error("MODERN_TIPS_NOT_HTML");
    const declaredBytes = Number(response.headers.get("content-length") ?? 0);
    if (declaredBytes > MAX_BYTES) throw new Error("MODERN_TIPS_TOO_LARGE");
    const body = Buffer.from(await response.arrayBuffer());
    if (body.byteLength > MAX_BYTES) throw new Error("MODERN_TIPS_TOO_LARGE");
    const dateValidation = validateTipsDate(body.toString("utf8"));
    if (!dateValidation.validated) throw new Error("MODERN_TIPS_DATE_MISMATCH");
    const hash = createHash("sha256").update(body).digest("hex");
    const path = join(tipsEvidenceRoot, `${hash}.html`);
    await mkdir(tipsEvidenceRoot, { recursive: true });
    await writeFile(path, body, { flag: "wx" });
    return {
      status: "CAPTURED",
      url: MODERN_TIPS_URL,
      finalUrl: response.url,
      httpStatus: response.status,
      contentType,
      hash,
      bytes: body.byteLength,
      path,
      networkRequests: 1,
      dateValidation,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function captureReferencedAssets() {
  const referringHtml = await readFile(modernPredictionEvidence, "utf8");
  const evidence = [];
  for (const url of REFERENCED_ASSET_URLS) {
    if (!referringHtml.includes(`src="${url}"`) && !referringHtml.includes(`src='${url}'`)) {
      throw new Error(`ASSET_NOT_EXPLICITLY_REFERENCED:${url}`);
    }
    const entries = await readdir(referencedAssetRoot).catch(() => [] as string[]);
    const metadataFiles = entries.filter((entry) => entry.endsWith(".json"));
    let reused: Record<string, unknown> | null = null;
    for (const metadataFile of metadataFiles) {
      const metadata = JSON.parse(await readFile(join(referencedAssetRoot, metadataFile), "utf8")) as Record<string, unknown>;
      if (metadata.url !== url) continue;
      const path = join(referencedAssetRoot, String(metadata.file));
      const body = await readFile(path);
      const hash = createHash("sha256").update(body).digest("hex");
      if (hash !== metadata.sha256) throw new Error(`ASSET_HASH_MISMATCH:${url}`);
      reused = { ...metadata, status: "REUSED", path: repoRelative(path), networkRequests: 0 };
    }
    if (reused) {
      evidence.push(reused);
      continue;
    }
    const response = await fetch(url, {
      redirect: "manual",
      headers: {
        accept: "text/javascript,application/javascript,*/*;q=0.1",
        "accept-language": "en-US,en;q=0.9",
        "user-agent": "OU25-Consensus-Lab/0.6 semantic-evidence",
      },
    });
    if (response.status !== 200) throw new Error(`ASSET_HTTP_${response.status}:${url}`);
    if (response.url !== url) throw new Error(`ASSET_FINAL_URL_MISMATCH:${url}`);
    const body = Buffer.from(await response.arrayBuffer());
    if (body.byteLength > MAX_BYTES) throw new Error(`ASSET_TOO_LARGE:${url}`);
    const sha256 = createHash("sha256").update(body).digest("hex");
    const file = `${sha256}.js`;
    const metadataFile = `${sha256}.json`;
    await mkdir(referencedAssetRoot, { recursive: true });
    await writeFile(join(referencedAssetRoot, file), body, { flag: "wx" });
    const metadata = {
      url,
      finalUrl: response.url,
      httpStatus: response.status,
      contentType: response.headers.get("content-type") ?? "",
      bytes: body.byteLength,
      sha256,
      file,
      referringEvidence: repoRelative(modernPredictionEvidence),
    };
    await writeFile(join(referencedAssetRoot, metadataFile), `${JSON.stringify(metadata, null, 2)}\n`, { flag: "wx" });
    evidence.push({ ...metadata, status: "CAPTURED", path: repoRelative(join(referencedAssetRoot, file)), networkRequests: 1 });
  }
  console.log(JSON.stringify({ assets: evidence, totalNetworkRequests: evidence.reduce((sum, item) => sum + Number(item.networkRequests), 0) }, null, 2));
}

async function captureLegacyHome() {
  const existingMetadata = await readFile(legacyHomeMetadataPath, "utf8").catch(() => "");
  if (existingMetadata) {
    const metadata = JSON.parse(existingMetadata) as { sha256: string; evidenceFile: string };
    const body = await readFile(join(legacyHomeRoot, metadata.evidenceFile));
    if (sha256Buffer(body) !== metadata.sha256) throw new Error("LEGACY_HOME_EVIDENCE_HASH_MISMATCH");
    console.log(JSON.stringify({ status: "REUSED", networkRequests: 0, ...metadata }, null, 2));
    return;
  }

  let currentUrl = LEGACY_HOME_URL;
  const redirects: Array<{ status: number; from: string; to: string }> = [];
  const cookieNames = new Set<string>();
  let response: Response | null = null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    for (let requestIndex = 0; requestIndex <= 2; requestIndex++) {
      const parsed = new URL(currentUrl);
      if (parsed.protocol !== "https:" || parsed.hostname !== "old.statarea.com") throw new Error("LEGACY_HOME_REDIRECT_SCOPE_VIOLATION");
      response = await fetch(currentUrl, {
        redirect: "manual",
        signal: controller.signal,
        headers: {
          accept: "text/html,application/xhtml+xml",
          "accept-language": "en-US,en;q=0.9",
          "user-agent": "OU25-Consensus-Lab/0.6 semantic-evidence",
        },
      });
      const getSetCookie = (response.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;
      const setCookies = getSetCookie ? getSetCookie.call(response.headers) : [response.headers.get("set-cookie") ?? ""];
      for (const cookie of setCookies) {
        const name = cookie.split(";", 1)[0]?.split("=", 1)[0]?.trim();
        if (name) cookieNames.add(name);
      }
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      if (requestIndex === 2) throw new Error("LEGACY_HOME_TOO_MANY_REDIRECTS");
      const location = response.headers.get("location");
      if (!location) throw new Error("LEGACY_HOME_REDIRECT_WITHOUT_LOCATION");
      const target = new URL(location, currentUrl);
      if (target.protocol !== "https:" || target.hostname !== "old.statarea.com") throw new Error("LEGACY_HOME_REDIRECT_SCOPE_VIOLATION");
      redirects.push({ status: response.status, from: currentUrl, to: target.href });
      currentUrl = target.href;
    }
    if (!response) throw new Error("LEGACY_HOME_NO_RESPONSE");
    if (response.status !== 200) throw new Error(`LEGACY_HOME_HTTP_${response.status}`);
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("text/html")) throw new Error("LEGACY_HOME_NOT_HTML");
    const declaredBytes = Number(response.headers.get("content-length") ?? 0);
    if (declaredBytes > MAX_BYTES) throw new Error("LEGACY_HOME_TOO_LARGE");
    const body = Buffer.from(await response.arrayBuffer());
    if (body.byteLength > MAX_BYTES) throw new Error("LEGACY_HOME_TOO_LARGE");
    if (!/<html\b/i.test(body.toString("utf8"))) throw new Error("LEGACY_HOME_HTML_MARKER_MISSING");
    const hash = sha256Buffer(body);
    const evidenceFile = `${hash}.html`;
    await mkdir(legacyHomeRoot, { recursive: true });
    await writeFile(join(legacyHomeRoot, evidenceFile), body, { flag: "wx" });
    const responseHeaders = Object.fromEntries([
      "cache-control", "content-length", "content-type", "date", "etag", "last-modified", "server",
    ].flatMap((name) => {
      const value = response!.headers.get(name);
      return value ? [[name, value]] : [];
    }));
    const metadata = {
      captureVersion: "statarea-legacy-home-semantic-evidence/1.0.0",
      capturedAtUtc: new Date().toISOString(),
      requestedUrl: LEGACY_HOME_URL,
      finalUrl: currentUrl,
      httpStatus: response.status,
      contentType,
      bytes: body.byteLength,
      sha256: hash,
      redirects,
      responseHeaders,
      cookieNames: [...cookieNames].sort(),
      requestHeaders: {
        accept: "text/html,application/xhtml+xml",
        acceptLanguage: "en-US,en;q=0.9",
        authorizationSent: false,
        cookieSent: false,
        refererSent: false,
      },
      evidenceFile,
    };
    await writeFile(legacyHomeMetadataPath, `${JSON.stringify(metadata, null, 2)}\n`, { flag: "wx" });
    console.log(JSON.stringify({ status: "CAPTURED", networkRequests: redirects.length + 1, ...metadata }, null, 2));
  } finally {
    clearTimeout(timeout);
  }
}

function sha256Buffer(body: Buffer) {
  return createHash("sha256").update(body).digest("hex");
}

async function assertFaqDiscoveredOffline() {
  const legacyRoot = join(process.cwd(), "var", "evidence", "statarea-legacy");
  const dates = await readdir(legacyRoot, { withFileTypes: true });
  let references = 0;
  for (const date of dates.filter((entry) => entry.isDirectory())) {
    const directory = join(legacyRoot, date.name);
    const files = await readdir(directory);
    for (const file of files.filter((entry) => entry.endsWith(".html"))) {
      const html = await readFile(join(directory, file), "utf8");
      if (html.includes(`href="${FAQ_URL}"`)) references++;
    }
  }
  if (references !== 21) throw new Error(`FAQ_NOT_DISCOVERED_IN_ALL_FROZEN_HTML:${references}`);
  return references;
}

async function main() {
  const argumentsReceived = process.argv.slice(2);
  if (argumentsReceived.length !== 1) throw new Error("EXPECTED_ONE_ALLOWLISTED_DIAGNOSTIC_ACTION");
  const [action] = argumentsReceived;
  if (action === "--r2-home") {
    await captureLegacyHome();
    return;
  }
  if (action === "--assets-only") {
    await captureReferencedAssets();
    return;
  }
  if (action === "--r1-modern-tips") {
    const references = await assertFaqDiscoveredOffline();
    const faq = await existingEvidence();
    if (!faq) throw new Error("FAQ_EVIDENCE_MISSING_R1_MUST_NOT_RECAPTURE");
    const tips = await captureModernTips();
    console.log(JSON.stringify({
      faq: { ...faq, path: repoRelative(faq.path), references },
      modernTips: { ...tips, path: repoRelative(tips.path) },
      totalNetworkRequests: tips.networkRequests,
    }, null, 2));
    return;
  }
  if (action !== "--offline-audit") throw new Error(`DIAGNOSTIC_ACTION_NOT_ALLOWED:${action}`);
  const references = await assertFaqDiscoveredOffline();
  const faq = await existingEvidence();
  if (!faq) throw new Error("FAQ_EVIDENCE_MISSING_R1_MUST_NOT_RECAPTURE");
  const tips = await existingTipsEvidence();
  if (!tips) throw new Error("MODERN_TIPS_EVIDENCE_MISSING_OFFLINE");
  console.log(JSON.stringify({
    faq: { ...faq, path: repoRelative(faq.path), references },
    modernTips: { ...tips, path: repoRelative(tips.path) },
    totalNetworkRequests: 0,
  }, null, 2));
}

void main();
