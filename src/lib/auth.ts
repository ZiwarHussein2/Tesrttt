import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { createHash, randomBytes } from "crypto";
import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { db } from "@/lib/db";
import type { Role } from "@/types/enums";
import { canRead, type ModuleKey } from "@/lib/permissions";

const COOKIE_NAME = "mcc_session";
const SESSION_DAYS = 7;
const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 10;

function secret(): Uint8Array {
  const s = process.env.AUTH_SECRET || "merna-dev-secret-change-in-production";
  return new TextEncoder().encode(s);
}

export function hashPassword(plain: string): string {
  return bcrypt.hashSync(plain, 10);
}

export function verifyPassword(plain: string, hash: string): boolean {
  return bcrypt.compareSync(plain, hash);
}

function sha256(v: string): string {
  return createHash("sha256").update(v).digest("hex");
}

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  branchId: string | null;
  branchName: string | null;
  employeeId: string | null;
  mustChangePassword: boolean;
  sessionId: string;
}

export async function createSession(userId: string): Promise<void> {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  const h = await headers();
  const session = await db.session.create({
    data: {
      userId,
      tokenHash: sha256(token),
      expiresAt,
      ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() || null,
      userAgent: h.get("user-agent")?.slice(0, 250) || null,
    },
  });
  const jwt = await new SignJWT({ sid: session.id, tok: token })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(expiresAt)
    .sign(secret());
  const store = await cookies();
  store.set(COOKIE_NAME, jwt, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    expires: expiresAt,
    path: "/",
  });
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  const jwt = store.get(COOKIE_NAME)?.value;
  if (jwt) {
    try {
      const { payload } = await jwtVerify(jwt, secret());
      const sid = payload.sid as string;
      await db.session.updateMany({ where: { id: sid, revokedAt: null }, data: { revokedAt: new Date() } });
    } catch {
      // invalid token — nothing to revoke
    }
  }
  store.delete(COOKIE_NAME);
}

// Cached per request.
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const store = await cookies();
  const jwt = store.get(COOKIE_NAME)?.value;
  if (!jwt) return null;
  try {
    const { payload } = await jwtVerify(jwt, secret());
    const sid = payload.sid as string;
    const tok = payload.tok as string;
    if (!sid || !tok) return null;
    const session = await db.session.findUnique({
      where: { id: sid },
      include: { user: { include: { branch: { select: { name: true } } } } },
    });
    if (!session || session.revokedAt || session.expiresAt < new Date()) return null;
    if (session.tokenHash !== sha256(tok)) return null;
    if (!session.user.isActive) return null;
    return {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
      role: session.user.role as Role,
      branchId: session.user.branchId,
      branchName: session.user.branch?.name ?? null,
      employeeId: session.user.employeeId,
      mustChangePassword: session.user.mustChangePassword,
      sessionId: session.id,
    };
  } catch {
    return null;
  }
});

// For server components / actions that require an authenticated user.
export async function requireUser(module?: ModuleKey): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (module && !canRead(user.role, module)) redirect("/dashboard?denied=" + module);
  return user;
}

export interface LoginResult {
  ok: boolean;
  error?: string;
}

export async function attemptLogin(email: string, password: string): Promise<LoginResult> {
  const user = await db.user.findUnique({ where: { email: email.toLowerCase().trim() } });
  if (!user || !user.isActive) return { ok: false, error: "Invalid email or password." };
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    return { ok: false, error: "Account temporarily locked after repeated failures. Try again later." };
  }
  if (!verifyPassword(password, user.passwordHash)) {
    const failed = user.failedLoginCount + 1;
    await db.user.update({
      where: { id: user.id },
      data: {
        failedLoginCount: failed,
        lockedUntil: failed >= MAX_FAILED_LOGINS ? new Date(Date.now() + LOCK_MINUTES * 60 * 1000) : null,
      },
    });
    return { ok: false, error: "Invalid email or password." };
  }
  await db.user.update({
    where: { id: user.id },
    data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
  });
  await createSession(user.id);
  return { ok: true };
}
