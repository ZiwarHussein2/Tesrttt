"use server";

import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { canRead } from "@/lib/permissions";
import { getScope } from "@/lib/scope";
import { LocalMernaAIProvider, applyAnswerMasking } from "@/lib/ai/local-provider";
import type { MernaAIAnswer } from "@/lib/ai/provider";

const provider = new LocalMernaAIProvider();

export interface AskResult {
  ok: boolean;
  error?: string;
  conversationId?: string;
  answer?: MernaAIAnswer;
  question?: string;
}

export async function askMerna(conversationId: string | null, questionRaw: string): Promise<AskResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Session expired — sign in again." };
  if (!canRead(user.role, "ai")) return { ok: false, error: "Your role does not have access to Merna AI." };

  const question = questionRaw.trim().slice(0, 500);
  if (question.length < 3) return { ok: false, error: "Ask a question." };

  const scope = await getScope(user);

  let convo = conversationId
    ? await db.aIConversation.findFirst({ where: { id: conversationId, userId: user.id } })
    : null;
  if (!convo) {
    convo = await db.aIConversation.create({
      data: { userId: user.id, title: question.slice(0, 80) },
    });
  }

  await db.aIMessage.create({
    data: { conversationId: convo.id, role: "USER", content: question },
  });

  const raw = await provider.answer({
    question,
    userRole: user.role,
    branchIds: scope.branchIds,
    branchName: scope.branchName,
    range: { from: scope.from, to: scope.to },
    prevRange: { from: scope.prevFrom, to: scope.prevTo },
  });
  const answer = applyAnswerMasking(raw, user.role);

  await db.aIMessage.create({
    data: { conversationId: convo.id, role: "ASSISTANT", content: JSON.stringify(answer) },
  });
  await db.aIConversation.update({ where: { id: convo.id }, data: { updatedAt: new Date() } });

  // Every AI question is part of the audit trail.
  await logAudit(user, {
    action: "ai.question",
    resourceType: "AIConversation",
    resourceId: convo.id,
    resourceLabel: question.slice(0, 120),
    branchId: scope.branchId,
    riskLevel: "LOW",
  });

  return { ok: true, conversationId: convo.id, answer, question };
}

export async function saveInsight(conversationId: string, title: string): Promise<{ ok: boolean; error?: string }> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Session expired." };
  const convo = await db.aIConversation.findFirst({ where: { id: conversationId, userId: user.id } });
  if (!convo) return { ok: false, error: "Conversation not found." };
  await db.savedReport.create({
    data: {
      userId: user.id,
      type: "CUSTOM_AI",
      title: title.slice(0, 120) || convo.title,
      params: JSON.stringify({ conversationId }),
    },
  });
  await logAudit(user, {
    action: "ai.save-insight",
    resourceType: "SavedReport",
    resourceLabel: title,
    riskLevel: "LOW",
  });
  return { ok: true };
}
