import crypto from "node:crypto";
import { contentStore, readJSON, writeJSON } from "./blobs.mjs";

const COOKIE_NAME = "pl_admin";

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(String(password), salt, 64);
  return `scrypt$${salt.toString("hex")}$${derived.toString("hex")}`;
}

export function verifyPassword(password, stored) {
  if (typeof stored !== "string") return false;
  const [algorithm, saltHex, hashHex] = stored.split("$");
  if (algorithm !== "scrypt" || !saltHex || !hashHex) return false;

  try {
    const expected = Buffer.from(hashHex, "hex");
    const actual = crypto.scryptSync(String(password), Buffer.from(saltHex, "hex"), expected.length);
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

export async function getPasswordHash() {
  const settings = await readJSON(contentStore(), "settings", {});
  return settings.passwordHash || process.env.ADMIN_PASSWORD_HASH || "";
}

export async function checkPassword(password) {
  const stored = await getPasswordHash();
  return Boolean(stored) && verifyPassword(password, stored);
}

export async function setPasswordHash(password) {
  const settings = await readJSON(contentStore(), "settings", {});
  await writeJSON(contentStore(), "settings", {
    ...settings,
    passwordHash: hashPassword(password),
    passwordUpdatedAt: new Date().toISOString(),
  });
}

export function getSessionSecret() {
  return process.env.SESSION_SECRET || "";
}

function base64url(input) {
  return Buffer.from(input).toString("base64url");
}

function sign(payload, secret) {
  return crypto.createHmac("sha256", secret).update(payload).digest("base64url");
}

export function issueSession(secret) {
  const now = Math.floor(Date.now() / 1000);
  const hours = Number(process.env.ADMIN_SESSION_HOURS || 168);
  const maxAge = Number.isFinite(hours) && hours > 0 ? Math.floor(hours * 3600) : 7 * 24 * 3600;
  const payload = base64url(JSON.stringify({ iat: now, exp: now + maxAge }));
  return { token: `${payload}.${sign(payload, secret)}`, maxAge };
}

export function verifySession(token, secret) {
  if (!token || !secret || typeof token !== "string") return false;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return false;

  const expected = sign(payload, secret);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;

  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return typeof parsed.exp === "number" && parsed.exp > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

export function parseCookies(header = "") {
  return header.split(";").reduce((acc, part) => {
    const separator = part.indexOf("=");
    if (separator === -1) return acc;
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (key) acc[key] = decodeURIComponent(value);
    return acc;
  }, {});
}

export function getSessionToken(request) {
  return parseCookies(request.headers.get("cookie") || "")[COOKIE_NAME] || "";
}

export function isAuthenticated(request) {
  return verifySession(getSessionToken(request), getSessionSecret());
}

export function sessionCookie(token, { secure = true, maxAge = 7 * 24 * 3600 } = {}) {
  return [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    `Max-Age=${maxAge}`,
    secure ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");
}

export function clearSessionCookie({ secure = true } = {}) {
  return [
    `${COOKIE_NAME}=`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    "Max-Age=0",
    secure ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");
}

export function isSecureRequest(request) {
  try {
    return new URL(request.url).protocol === "https:";
  } catch {
    return true;
  }
}
