import type { ModuleKey } from "@/lib/permissions";

// Sidebar structure. Icons are lucide icon names resolved in the client shell.
export interface NavItem {
  label: string;
  href: string;
  module: ModuleKey;
  icon: string;
}

export interface NavSection {
  title: string;
  items: NavItem[];
}

export const NAV_SECTIONS: NavSection[] = [
  {
    title: "Overview",
    items: [
      { label: "Executive Dashboard", href: "/dashboard", module: "dashboard", icon: "LayoutDashboard" },
      { label: "Branches", href: "/branches", module: "branches", icon: "Building2" },
      { label: "Live Operations", href: "/live", module: "live", icon: "Activity" },
      { label: "Merna AI", href: "/merna-ai", module: "ai", icon: "Sparkles" },
    ],
  },
  {
    title: "Finance",
    items: [
      { label: "Financial Overview", href: "/finance", module: "finance", icon: "ChartPie" },
      { label: "Income", href: "/finance/income", module: "finance.income", icon: "TrendingUp" },
      { label: "Expenses", href: "/finance/expenses", module: "finance.expenses", icon: "Receipt" },
      { label: "Employee Expenses", href: "/finance/employee-expenses", module: "finance.employee-expenses", icon: "Wallet" },
      { label: "Payroll", href: "/finance/payroll", module: "finance.payroll", icon: "Banknote" },
      { label: "Budgets", href: "/finance/budgets", module: "finance.budgets", icon: "Target" },
      { label: "Discounts", href: "/finance/discounts", module: "finance.discounts", icon: "BadgePercent" },
    ],
  },
  {
    title: "Workforce",
    items: [
      { label: "Employees", href: "/employees", module: "employees", icon: "Users" },
      { label: "Attendance", href: "/attendance", module: "attendance", icon: "CalendarCheck" },
      { label: "Overtime", href: "/overtime", module: "overtime", icon: "Clock" },
      { label: "Agreements", href: "/agreements", module: "agreements", icon: "FileSignature" },
      { label: "Policies", href: "/policies", module: "policies", icon: "BookOpen" },
      { label: "Workforce Analytics", href: "/workforce-analytics", module: "workforce-analytics", icon: "ChartColumn" },
    ],
  },
  {
    title: "Operations",
    items: [
      { label: "Departments", href: "/departments", module: "departments", icon: "Grid2x2" },
      { label: "Queues", href: "/queues", module: "queues", icon: "ListOrdered" },
      { label: "Radiology Operations", href: "/operations/radiology", module: "radiology", icon: "Scan" },
      { label: "Report Workflow", href: "/operations/reports", module: "report-workflow", icon: "FileText" },
      { label: "Referrals", href: "/operations/referrals", module: "referrals", icon: "UserPlus" },
      { label: "Patients", href: "/patients", module: "patients", icon: "HeartPulse" },
      { label: "Inventory", href: "/inventory", module: "inventory", icon: "Package" },
      { label: "Waste & Variance", href: "/inventory/waste", module: "waste", icon: "PackageX" },
      { label: "Management Activities", href: "/management-activities", module: "management-activities", icon: "History" },
    ],
  },
  {
    title: "Governance",
    items: [
      { label: "Shareholders", href: "/governance/shareholders", module: "shareholders", icon: "Landmark" },
      { label: "Board Reports", href: "/governance/board", module: "board-reports", icon: "Presentation" },
      { label: "Legal Accountability", href: "/governance/legal", module: "legal", icon: "Scale" },
      { label: "Audit Logs", href: "/audit", module: "audit", icon: "ScrollText" },
      { label: "Privacy Center", href: "/privacy", module: "privacy", icon: "ShieldCheck" },
      { label: "Security Center", href: "/security", module: "security", icon: "Lock" },
      { label: "Incidents", href: "/incidents", module: "incidents", icon: "TriangleAlert" },
    ],
  },
  {
    title: "System",
    items: [
      { label: "Alerts", href: "/alerts", module: "alerts", icon: "Bell" },
      { label: "Report Builder", href: "/reports", module: "reports", icon: "FileOutput" },
      { label: "Settings", href: "/settings", module: "settings", icon: "Settings" },
    ],
  },
];
