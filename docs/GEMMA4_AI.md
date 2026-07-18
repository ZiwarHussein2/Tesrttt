# Merna AI — Future Gemma 4 Integration Boundary

Today, Merna AI is a **local deterministic engine** (`src/lib/ai/local-provider.ts`) behind the
`MernaAIProvider` interface (`src/lib/ai/provider.ts`). No external AI service is called, no
API key exists anywhere in this codebase, and no data leaves the system.

## The boundary

```ts
interface MernaAIProvider {
  answer(request: MernaAIRequest): Promise<MernaAIAnswer>;
}

class LocalMernaAIProvider implements MernaAIProvider {}   // current — deterministic rules
class Gemma4MernaAIProvider implements MernaAIProvider {}  // future only — do not implement now
```

The request already carries the resolved, permission-checked scope (user role, allowed branch
ids, date range), and the response is a structured object (direct answer, findings, evidence,
calculations, risks, actions, confidence, sources). The UI, storage, masking and audit layers
are provider-agnostic — swapping providers changes no page.

## Rules for the future Gemma 4 provider

```
Merna User
→ Authentication and Permission Check
→ Merna AI Gateway (server-side only)
→ Approved Tools
→ Filtered Reporting APIs
→ Gemma 4 Provider
→ Structured Response
→ Output Validation
→ Audit Log
→ User
```

- **Server-side only.** No key or model call ever reaches the browser.
- **Role-aware and branch-aware**: the gateway passes only the caller's allowed scope.
- **Read-only initially**, via tool-based access to the same `metrics.ts` functions — never
  unrestricted database access.
- **Prompt-injection defenses** on any free text included in tool results.
- **Output validation** against the `MernaAIAnswer` schema before anything is shown or stored.
- **Masking after generation** (`applyAnswerMasking`) stays in place regardless of provider.
- **Audit logging** of every question and every tool invocation.
- **Rate limits, timeouts, cost controls, provider fallback** (fall back to the local engine).
- **Human review** required for sensitive report categories (legal, security, shareholder).
- The clinical safety rules are non-negotiable for any provider: Merna AI never diagnoses
  patients, never interprets medical scans, never replaces doctors, and never makes
  accusations — suspicious patterns are always "requires review".
