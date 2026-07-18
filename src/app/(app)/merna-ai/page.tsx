import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { getScope } from "@/lib/scope";
import { relativeTime } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/cn";
import { MernaChat, type ChatMessage } from "./chat";

export const metadata: Metadata = { title: "Merna AI" };

export default async function MernaAIPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string; prompt?: string }>;
}) {
  const user = await requireUser("ai");
  const scope = await getScope(user);
  const sp = await searchParams;

  const [company, conversations, savedInsights] = await Promise.all([
    db.company.findFirst({ select: { name: true } }),
    db.aIConversation.findMany({
      where: { userId: user.id },
      orderBy: { updatedAt: "desc" },
      take: 12,
    }),
    db.savedReport.findMany({
      where: { userId: user.id, type: "CUSTOM_AI" },
      orderBy: { updatedAt: "desc" },
      take: 6,
    }),
  ]);

  const active = sp.c
    ? await db.aIConversation.findFirst({
        where: { id: sp.c, userId: user.id },
        include: { messages: { orderBy: { createdAt: "asc" } } },
      })
    : null;

  const initialMessages: ChatMessage[] =
    active?.messages.map((m) => ({ role: m.role as "USER" | "ASSISTANT", content: m.content })) ?? [];

  return (
    <>
      <PageHeader
        title="Merna AI"
        subtitle={`Management and operational intelligence over live data — scoped to ${scope.branchName ?? "all branches"} and your role's permissions. No clinical use: Merna AI never diagnoses patients or interprets medical scans.`}
      />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-4">
        <div className="xl:col-span-3">
          <MernaChat
            key={active?.id ?? "new"}
            conversationId={active?.id ?? null}
            initialMessages={initialMessages}
            companyName={company?.name ?? "Merna Medical Company"}
            scopeLabel={scope.branchName ?? "All branches"}
          />
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader
              title="Conversations"
              actions={<Link href="/merna-ai" className="text-[12px] font-medium text-link hover:underline">New</Link>}
            />
            <CardBody>
              {conversations.length === 0 ? (
                <p className="py-4 text-center text-[12.5px] text-mute">No conversations yet.</p>
              ) : (
                <ul className="space-y-1">
                  {conversations.map((c) => (
                    <li key={c.id}>
                      <Link
                        href={`/merna-ai?c=${c.id}`}
                        className={cn(
                          "block rounded-md px-2.5 py-2 text-[12.5px] transition-colors hover:bg-canvas-soft-2",
                          active?.id === c.id ? "bg-canvas-soft-2 font-medium text-ink" : "text-body",
                        )}
                      >
                        <span className="block truncate">{c.title}</span>
                        <span className="text-[10.5px] text-mute">{relativeTime(c.updatedAt)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Saved insights" />
            <CardBody>
              {savedInsights.length === 0 ? (
                <p className="py-4 text-center text-[12.5px] text-mute">Save answers to build your insight library.</p>
              ) : (
                <ul className="space-y-2">
                  {savedInsights.map((s) => {
                    let convoId: string | null = null;
                    try { convoId = (JSON.parse(s.params) as { conversationId?: string }).conversationId ?? null; } catch { /* ignore */ }
                    return (
                      <li key={s.id} className="border-t border-hairline pt-2 first:border-0 first:pt-0">
                        <Link href={convoId ? `/merna-ai?c=${convoId}` : "/merna-ai"} className="block truncate text-[12.5px] font-medium text-ink hover:underline">
                          {s.title}
                        </Link>
                        <span className="text-[10.5px] text-mute">{relativeTime(s.updatedAt)}</span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Engine & boundaries" />
            <CardBody className="space-y-1.5 text-[11.5px] leading-relaxed text-mute">
              <p>Local deterministic engine — no external AI service is called and no data leaves the system.</p>
              <p>The interface is provider-based: a future Gemma 4 integration plugs in server-side behind permissions, output validation and audit logging.</p>
              <p>Every question is recorded in the audit trail.</p>
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
