import crypto from "node:crypto";
import { contentStore, readJSON, writeJSON } from "./blobs.mjs";
import { parseCookies } from "./auth.mjs";

export const USER_COOKIE = "cx_user";

const USER_SESSION_HOURS = 720; // 30 días

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

export async function getUsers() {
  const users = await readJSON(contentStore(), "users", null);
  return Array.isArray(users) ? users : [];
}

export async function saveUsers(users) {
  await writeJSON(contentStore(), "users", users);
}

export function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    name: user.name || "",
    products: Array.isArray(user.products) ? user.products : [],
    role: user.role || "cliente",
    active: user.active !== false,
    createdAt: user.createdAt || "",
  };
}

export async function findUserByEmail(email) {
  const users = await getUsers();
  const normalized = String(email || "").trim().toLowerCase();
  return users.find((user) => String(user.email || "").toLowerCase() === normalized) || null;
}

export async function findUserById(id) {
  const users = await getUsers();
  return users.find((user) => user.id === id) || null;
}

function base64url(input) {
  return Buffer.from(input).toString("base64url");
}

function sign(payload, secret) {
  return crypto.createHmac("sha256", secret).update(payload).digest("base64url");
}

export function issueUserSession(userId, secret) {
  const now = Math.floor(Date.now() / 1000);
  const maxAge = USER_SESSION_HOURS * 3600;
  const payload = base64url(
    JSON.stringify({ iat: now, exp: now + maxAge, sub: userId, kind: "cliente" }),
  );
  return { token: `${payload}.${sign(payload, secret)}`, maxAge };
}

export function verifyUserSession(token, secret) {
  if (!token || !secret || typeof token !== "string") return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  const expected = sign(payload, secret);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (parsed.kind !== "cliente") return null;
    if (typeof parsed.exp !== "number" || parsed.exp <= Math.floor(Date.now() / 1000)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function getUserToken(request) {
  return parseCookies(request.headers.get("cookie") || "")[USER_COOKIE] || "";
}

export async function getUserFromRequest(request, secret) {
  const payload = verifyUserSession(getUserToken(request), secret);
  if (!payload || !payload.sub) return null;
  const user = await findUserById(payload.sub);
  if (!user || user.active === false) return null;
  return publicUser(user);
}

export function userSessionCookie(token, { secure = true, maxAge = USER_SESSION_HOURS * 3600 } = {}) {
  return [
    `${USER_COOKIE}=${encodeURIComponent(token)}`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    `Max-Age=${maxAge}`,
    secure ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");
}

export function clearUserSessionCookie({ secure = true } = {}) {
  return [
    `${USER_COOKIE}=`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    "Max-Age=0",
    secure ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");
}
