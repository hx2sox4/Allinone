import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { cookies } from "next/headers";
import { db } from "./db";

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;
export const SESSION_COOKIE = "ilson_session";
const SESSION_DAYS = 30;

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(pw, salt, 64);
  return `scrypt$${salt.toString("hex")}$${key.toString("hex")}`;
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [algo, saltHex, keyHex] = stored.split("$");
  if (algo !== "scrypt" || !saltHex || !keyHex) return false;
  const key = await scrypt(pw, Buffer.from(saltHex, "hex"), 64);
  const expected = Buffer.from(keyHex, "hex");
  return key.length === expected.length && timingSafeEqual(key, expected);
}

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

export async function startSession(userId: string) {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400_000);
  await db.session.create({ data: { tokenHash: sha(token), userId, expiresAt } });
  (await cookies()).set(SESSION_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", expires: expiresAt });
}

export async function endSession() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) await db.session.deleteMany({ where: { tokenHash: sha(token) } });
  store.delete(SESSION_COOKIE);
}

export async function currentUser() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const s = await db.session.findUnique({ where: { tokenHash: sha(token) }, include: { user: true } });
  if (!s || s.expiresAt < new Date()) return null;
  return s.user;
}

/** 로그인한 사용자와 그 사용자의 첫 워크스페이스. 없으면 null. */
export async function currentContext() {
  const user = await currentUser();
  if (!user) return null;
  const m = await db.membership.findFirst({ where: { userId: user.id }, include: { workspace: { include: { brand: true } } }, orderBy: { workspaceId: "asc" } });
  if (!m) return null;
  return { user, workspace: m.workspace, role: m.role, brand: m.workspace.brand };
}

export const canEdit = (role: string) => role === "OWNER" || role === "EDITOR";
