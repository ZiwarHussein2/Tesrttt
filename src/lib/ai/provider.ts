// Merna AI provider boundary.
//
// The current implementation is a fully local, deterministic engine
// (LocalMernaAIProvider). A future Gemma 4 integration implements the same
// interface server-side — behind authentication, permission checks, tool-based
// data access, output validation and audit logging — without touching the UI.
// Do NOT add API URLs, keys or SDK calls to this layer.

import type { Role } from "@/types/enums";

export interface MernaAIRequest {
  question: string;
  userRole: Role;
  branchIds: string[]; // already resolved to the user's allowed scope
  branchName: string | null; // null = all branches
  range: { from: Date; to: Date };
  prevRange: { from: Date; to: Date };
}

export interface EvidenceCard {
  label: string;
  value: string;
  sublabel?: string;
}

export interface MernaAIAnswer {
  direct: string;
  findings: string[];
  evidence: EvidenceCard[];
  scope: string;
  period: string;
  calculations: string[];
  risks: string[];
  actions: string[];
  confidence: "HIGH" | "MEDIUM" | "LOW";
  sources: string[];
  link?: { href: string; label: string };
}

export interface MernaAIProvider {
  answer(request: MernaAIRequest): Promise<MernaAIAnswer>;
}

// Future only — implemented when the Gemma 4 gateway ships. Kept here so the
// integration point is explicit and reviewed:
//
// class Gemma4MernaAIProvider implements MernaAIProvider { … }
