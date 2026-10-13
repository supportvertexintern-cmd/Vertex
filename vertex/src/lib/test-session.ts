import type { Role } from "@prisma/client";
import { prisma } from "./prisma";
import { startSession } from "./session";

// Tests only. Since G19 an access token is accepted only for an existing
// user with a live session, so tests sign in for real: this creates the
// user if needed, starts a session and returns its access token.
export async function sessionToken(who: { userId: string; email: string; role: Role }): Promise<string> {
  const user = await prisma.user.upsert({
    where: { id: who.userId },
    update: {},
    create: { id: who.userId, full_name: `Session test ${who.userId}`, email: who.email, role: who.role },
  });
  return (await startSession(user, null)).accessToken;
}
