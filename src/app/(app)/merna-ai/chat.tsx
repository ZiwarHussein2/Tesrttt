"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, Bookmark, Download, Loader2, Send, Sparkles } from "lucide-react";
import type { MernaAIAnswer } from "@/lib/ai/provider";
import { askMerna, saveInsight } from "./actions";
import { downloadAnswerPdf } from "@/lib/pdf/pdf";
import { Button } from "@/components/ui/button";

export interface ChatMessage {
  role: "USER" | "ASSISTANT";
  content: string; // question text or JSON answer
}

const SUGGESTED = [
  "Give me today's executive briefing.",
  "Which branch needs attention?",
  "Find the main bottlenecks.",
  "Compare the branches.",
  "Which branch has the highest expense growth?",
  "Explain employee expenses.",
  "Find attendance problems.",
  "Which department has the longest queue?",
  "Which department wastes the most inventory?",
  "Find unusual management activity.",
  "Show report delays.",
  "Prepare a shareholder report.",
  "Show legal accountability risks.",
  "Summarize security exceptions.",
  "What changed since last week?",
  "What should management discuss tomorrow?",
];

export function MernaChat({
  conversationId,
  initialMessages,
  companyName,
  scopeLabel,
}: {
  conversationId: string | null;
  initialMessages: ChatMessage[];
  companyName: string;
  scopeLabel: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [messages, setMessages] = React.useState<ChatMessage[]>(initialMessages);
  const [convoId, setConvoId] = React.useState<string | null>(conversationId);
  const [input, setInput] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [savedNote, setSavedNote] = React.useState(false);
  const endRef = React.useRef<HTMLDivElement>(null);
  const autoAsked = React.useRef(false);

  const ask = React.useCallback(async (question: string) => {
    if (!question.trim() || pending) return;
    setError(null);
    setPending(true);
    setMessages((m) => [...m, { role: "USER", content: question }]);
    setInput("");
    try {
      const result = await askMerna(convoId, question);
      if (!result.ok || !result.answer) {
        setError(result.error ?? "Something went wrong.");
        setMessages((m) => m.slice(0, -1));
      } else {
        setConvoId(result.conversationId ?? null);
        setMessages((m) => [...m, { role: "ASSISTANT", content: JSON.stringify(result.answer) }]);
        if (!convoId && result.conversationId) {
          window.history.replaceState(null, "", `/merna-ai?c=${result.conversationId}`);
        }
        router.refresh();
      }
    } catch {
      setError("Request failed. Try again.");
      setMessages((m) => m.slice(0, -1));
    } finally {
      setPending(false);
    }
  }, [convoId, pending, router]);

  // Prefilled prompt from deep links (?prompt=…)
  React.useEffect(() => {
    const prompt = searchParams.get("prompt");
    if (prompt && !autoAsked.current && initialMessages.length === 0) {
      autoAsked.current = true;
      void ask(prompt);
    }
  }, [searchParams, ask, initialMessages.length]);

  React.useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, pending]);

  return (
    <div className="flex min-h-[60vh] flex-col">
      <div className="flex-1 space-y-4">
        {messages.length === 0 && !pending && (
          <div className="rounded-lg bg-canvas p-5 shadow-card">
            <p className="flex items-center gap-2 text-sm font-semibold text-ink">
              <Sparkles size={15} className="text-violet-deep" />
              Ask about {scopeLabel.toLowerCase()} — answers come from live system data.
            </p>
            <p className="mt-1 text-[12.5px] leading-relaxed text-body">
              Merna AI runs a local deterministic analysis engine over the same figures as the dashboards.
              It respects your role&apos;s permissions, masks restricted data, never makes clinical judgments and
              never accuses individuals — suspicious patterns are marked “requires review”.
            </p>
            <div className="mt-4 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {SUGGESTED.map((s) => (
                <button
                  key={s}
                  onClick={() => void ask(s)}
                  className="flex items-center gap-2 rounded-md border border-hairline px-3 py-2 text-left text-[12.5px] text-body transition-colors hover:border-violet hover:bg-ai-soft hover:text-ink"
                >
                  <ArrowRight size={12} className="shrink-0 text-mute" />
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) =>
          m.role === "USER" ? (
            <div key={i} className="flex justify-end">
              <div className="max-w-[85%] rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-[13.5px] text-on-primary">
                {m.content}
              </div>
            </div>
          ) : (
            <AnswerCard
              key={i}
              json={m.content}
              question={i > 0 ? messages[i - 1]?.content ?? "" : ""}
              companyName={companyName}
              onSave={async () => {
                if (!convoId) return;
                const r = await saveInsight(convoId, messages[i - 1]?.content ?? "Merna AI insight");
                if (r.ok) {
                  setSavedNote(true);
                  setTimeout(() => setSavedNote(false), 2500);
                }
              }}
            />
          ),
        )}

        {pending && (
          <div className="flex items-center gap-2.5 rounded-lg bg-canvas p-4 text-[13px] text-body shadow-card">
            <Loader2 size={15} className="animate-spin text-violet-deep" />
            Analyzing live data…
          </div>
        )}
        {error && (
          <p role="alert" className="rounded-md border border-critical-soft bg-critical-soft/40 px-3 py-2 text-[13px] text-critical-deep">
            {error}
          </p>
        )}
        {savedNote && (
          <p className="rounded-md border border-good-soft bg-good-soft/50 px-3 py-2 text-[13px] text-good-deep">
            Insight saved to your report library.
          </p>
        )}
        <div ref={endRef} />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void ask(input);
        }}
        className="sticky bottom-16 mt-4 flex items-center gap-2 rounded-xl bg-canvas p-2 shadow-float lg:bottom-4"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask Merna AI about branches, finance, queues, waste, attendance…"
          aria-label="Ask Merna AI"
          className="h-10 flex-1 bg-transparent px-2 text-sm text-ink outline-none placeholder:text-mute"
          disabled={pending}
        />
        <Button type="submit" variant="ai" size="lg" disabled={pending || input.trim().length < 3} aria-label="Send">
          {pending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
        </Button>
      </form>
    </div>
  );
}

function AnswerCard({
  json,
  question,
  companyName,
  onSave,
}: {
  json: string;
  question: string;
  companyName: string;
  onSave: () => void;
}) {
  let answer: MernaAIAnswer | null = null;
  try {
    answer = JSON.parse(json) as MernaAIAnswer;
  } catch {
    return <div className="rounded-lg bg-canvas p-4 text-[13px] text-body shadow-card">{json}</div>;
  }
  if (!answer) return null;

  return (
    <div className="rounded-lg bg-canvas shadow-card">
      <div className="flex items-center justify-between gap-2 border-b border-hairline px-4 py-2.5">
        <p className="flex items-center gap-2 text-[12px] font-medium text-violet-deep">
          <Sparkles size={13} /> Merna AI
          <span className="font-normal text-mute">· {answer.scope} · {answer.period} · confidence {answer.confidence.toLowerCase()}</span>
        </p>
        <div className="flex items-center gap-1.5">
          <Button variant="ghost" size="sm" onClick={onSave} aria-label="Save insight">
            <Bookmark size={12} /> Save
          </Button>
          <Button variant="ghost" size="sm" onClick={() => downloadAnswerPdf(answer!, question, companyName)} aria-label="Download PDF">
            <Download size={12} /> PDF
          </Button>
        </div>
      </div>
      <div className="space-y-3.5 p-4">
        <p className="text-[13.5px] leading-relaxed text-ink">{answer.direct}</p>

        {answer.findings.length > 0 && (
          <Section label="Key findings">
            <ul className="space-y-1">
              {answer.findings.map((f, i) => (
                <li key={i} className="flex gap-2 text-[12.5px] leading-relaxed text-body">
                  <span aria-hidden className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-hairline-strong" />
                  {f}
                </li>
              ))}
            </ul>
          </Section>
        )}

        {answer.evidence.length > 0 && (
          <Section label="Evidence">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {answer.evidence.map((e, i) => (
                <div key={i} className="rounded-md bg-canvas-soft p-2.5">
                  <p className="text-[10.5px] font-medium uppercase tracking-wide text-mute">{e.label}</p>
                  <p className="text-[14px] font-semibold tabular-nums text-ink">{e.value}</p>
                  {e.sublabel && <p className="text-[10.5px] text-mute">{e.sublabel}</p>}
                </div>
              ))}
            </div>
          </Section>
        )}

        {answer.risks.length > 0 && (
          <Section label="Risks">
            <ul className="space-y-1">
              {answer.risks.map((r, i) => (
                <li key={i} className="flex gap-2 text-[12.5px] leading-relaxed text-warning-deep">
                  <span aria-hidden className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-warning" />
                  {r}
                </li>
              ))}
            </ul>
          </Section>
        )}

        {answer.actions.length > 0 && (
          <Section label="Recommended actions">
            <ol className="list-decimal space-y-1 pl-5">
              {answer.actions.map((a, i) => (
                <li key={i} className="text-[12.5px] leading-relaxed text-body">{a}</li>
              ))}
            </ol>
          </Section>
        )}

        {answer.calculations.length > 0 && (
          <details className="group">
            <summary className="cursor-pointer font-mono text-[10.5px] font-medium uppercase tracking-wider text-mute hover:text-body">
              Calculations & data sources
            </summary>
            <ul className="mt-1.5 space-y-1">
              {answer.calculations.map((c, i) => (
                <li key={i} className="font-mono text-[11px] leading-relaxed text-mute">{c}</li>
              ))}
              {answer.sources.length > 0 && (
                <li className="font-mono text-[11px] text-mute">Sources: {answer.sources.join(", ")}</li>
              )}
            </ul>
          </details>
        )}

        {answer.link && (
          <Link
            href={answer.link.href}
            className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-link hover:underline"
          >
            {answer.link.label} <ArrowRight size={12} />
          </Link>
        )}
      </div>
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 font-mono text-[10.5px] font-medium uppercase tracking-wider text-mute">{label}</p>
      {children}
    </div>
  );
}
