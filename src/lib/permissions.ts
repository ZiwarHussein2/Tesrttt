import type { Role } from "@/types/enums";

// Module keys map 1:1 to top-level routes. A role can access a module in
// read-only or read-write mode. Branch scoping is applied separately:
// BRANCH_ADMIN users are always constrained to their own branch.

export type ModuleKey =
  | "dashboard"
  | "branches"
  | "live"
  | "ai"
  | "finance"
  | "finance.income"
  | "finance.expenses"
  | "finance.employee-expenses"
  | "finance.payroll"
  | "finance.budgets"
  | "finance.discounts"
  | "employees"
  | "attendance"
  | "overtime"
  | "agreements"
  | "policies"
  | "workforce-analytics"
  | "departments"
  | "queues"
  | "radiology"
  | "report-workflow"
  | "referrals"
  | "patients"
  | "inventory"
  | "waste"
  | "management-activities"
  | "shareholders"
  | "board-reports"
  | "legal"
  | "audit"
  | "privacy"
  | "security"
  | "incidents"
  | "alerts"
  | "reports"
  | "settings";

export type AccessLevel = "none" | "read" | "write";

const ALL_MODULES: ModuleKey[] = [
  "dashboard", "branches", "live", "ai",
  "finance", "finance.income", "finance.expenses", "finance.employee-expenses",
  "finance.payroll", "finance.budgets", "finance.discounts",
  "employees", "attendance", "overtime", "agreements", "policies", "workforce-analytics",
  "departments", "queues", "radiology", "report-workflow", "referrals", "patients",
  "inventory", "waste", "management-activities",
  "shareholders", "board-reports", "legal", "audit", "privacy", "security", "incidents",
  "alerts", "reports", "settings",
];

const FINANCE_MODULES: ModuleKey[] = [
  "finance", "finance.income", "finance.expenses", "finance.employee-expenses",
  "finance.payroll", "finance.budgets", "finance.discounts",
];
const WORKFORCE_MODULES: ModuleKey[] = [
  "employees", "attendance", "overtime", "agreements", "policies", "workforce-analytics",
];
const OPERATIONS_MODULES: ModuleKey[] = [
  "departments", "queues", "radiology", "report-workflow", "referrals", "patients",
  "inventory", "waste", "management-activities",
];

function grant(read: ModuleKey[], write: ModuleKey[]): Record<ModuleKey, AccessLevel> {
  const map = Object.fromEntries(ALL_MODULES.map((m) => [m, "none"])) as Record<ModuleKey, AccessLevel>;
  for (const m of read) map[m] = "read";
  for (const m of write) map[m] = "write";
  return map;
}

const ACCESS: Record<Role, Record<ModuleKey, AccessLevel>> = {
  SUPER_ADMIN: grant([], ALL_MODULES),

  EXECUTIVE: grant(
    // Executives see everything except system settings, read-only…
    ALL_MODULES.filter((m) => m !== "settings"),
    // …and can work with AI, reports, alerts and incidents.
    ["ai", "reports", "alerts", "incidents", "board-reports"],
  ),

  FINANCE_DIRECTOR: grant(
    ["dashboard", "branches", "live", "departments", "radiology", "referrals",
      "management-activities", "audit", "alerts", "workforce-analytics", "employees",
      "attendance", "overtime", "inventory", "waste", "patients"],
    [...FINANCE_MODULES, "ai", "reports", "alerts"],
  ),

  OPERATIONS_DIRECTOR: grant(
    ["dashboard", "branches", "finance", "employees", "attendance", "overtime",
      "workforce-analytics", "management-activities", "audit", "alerts"],
    [...OPERATIONS_MODULES, "live", "ai", "reports", "alerts", "incidents"],
  ),

  HR_DIRECTOR: grant(
    ["dashboard", "branches", "departments", "management-activities", "audit", "alerts",
      "finance.payroll", "finance.employee-expenses"],
    [...WORKFORCE_MODULES, "ai", "reports", "alerts"],
  ),

  LEGAL_COMPLIANCE: grant(
    ["dashboard", "branches", "employees", "attendance", "management-activities",
      "shareholders", "board-reports", "alerts"],
    ["agreements", "policies", "legal", "audit", "privacy", "security", "incidents", "ai", "reports"],
  ),

  SHAREHOLDER_VIEWER: grant(
    ["dashboard", "branches", "shareholders", "board-reports", "reports", "ai"],
    [],
  ),

  BRANCH_ADMIN: grant(
    ["dashboard", "audit", "management-activities", "workforce-analytics", "finance", "alerts"],
    ["live", "departments", "queues", "radiology", "report-workflow", "referrals", "patients",
      "inventory", "waste", "employees", "attendance", "overtime", "agreements",
      "finance.income", "finance.expenses", "finance.employee-expenses", "finance.discounts",
      "ai", "reports", "alerts", "incidents"],
  ),
};

export function access(role: Role, module: ModuleKey): AccessLevel {
  return ACCESS[role]?.[module] ?? "none";
}

export function canRead(role: Role, module: ModuleKey): boolean {
  return access(role, module) !== "none";
}

export function canWrite(role: Role, module: ModuleKey): boolean {
  return access(role, module) === "write";
}

// Cross-branch visibility. BRANCH_ADMIN sees only its branch.
export function isBranchScoped(role: Role): boolean {
  return role === "BRANCH_ADMIN";
}

// Data-masking profile per role (minimum-necessary access).
export interface MaskingProfile {
  patientContact: boolean; // mask patient phone / full name
  employeeContact: boolean; // mask employee phone / personal email
  employeeSalary: boolean; // hide individual salary figures
  financeDetail: boolean; // hide row-level finance (aggregates only)
  legalEvidence: boolean; // hide agreement/legal evidence detail
  securityDetail: boolean; // hide raw security signals
}

export function maskingFor(role: Role): MaskingProfile {
  const none: MaskingProfile = {
    patientContact: false,
    employeeContact: false,
    employeeSalary: false,
    financeDetail: false,
    legalEvidence: false,
    securityDetail: false,
  };
  switch (role) {
    case "SUPER_ADMIN":
      return none;
    case "EXECUTIVE":
      return { ...none, patientContact: true };
    case "FINANCE_DIRECTOR":
      return { ...none, patientContact: true, legalEvidence: true, securityDetail: true };
    case "OPERATIONS_DIRECTOR":
      return { ...none, patientContact: true, employeeSalary: true, legalEvidence: true, securityDetail: true };
    case "HR_DIRECTOR":
      return { ...none, patientContact: true, securityDetail: true };
    case "LEGAL_COMPLIANCE":
      return { ...none, patientContact: true, employeeSalary: true };
    case "SHAREHOLDER_VIEWER":
      return {
        patientContact: true,
        employeeContact: true,
        employeeSalary: true,
        financeDetail: true,
        legalEvidence: true,
        securityDetail: true,
      };
    case "BRANCH_ADMIN":
      return { ...none, employeeSalary: true, legalEvidence: true, securityDetail: true };
  }
}
