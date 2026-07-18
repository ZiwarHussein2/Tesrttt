// Central registry of string-enum values used across the system.
// SQLite has no native enums; every value below is validated at the
// application layer (zod) and can become a native Postgres enum on Supabase.

export const ROLES = [
  "SUPER_ADMIN",
  "EXECUTIVE",
  "FINANCE_DIRECTOR",
  "OPERATIONS_DIRECTOR",
  "HR_DIRECTOR",
  "LEGAL_COMPLIANCE",
  "SHAREHOLDER_VIEWER",
  "BRANCH_ADMIN",
] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  SUPER_ADMIN: "Merna Super Admin",
  EXECUTIVE: "Chairman / Executive",
  FINANCE_DIRECTOR: "Finance Director",
  OPERATIONS_DIRECTOR: "Operations Director",
  HR_DIRECTOR: "HR Director",
  LEGAL_COMPLIANCE: "Legal & Compliance Officer",
  SHAREHOLDER_VIEWER: "Shareholder Viewer",
  BRANCH_ADMIN: "Branch Admin",
};

export const BRANCH_STATUSES = ["OPERATING", "LIMITED", "SUSPENDED", "SETUP", "CLOSED"] as const;
export type BranchStatus = (typeof BRANCH_STATUSES)[number];
export const BRANCH_STATUS_LABELS: Record<BranchStatus, string> = {
  OPERATING: "Operating",
  LIMITED: "Limited operation",
  SUSPENDED: "Suspended",
  SETUP: "In setup",
  CLOSED: "Closed",
};

export const DEPARTMENT_TYPES = ["SONAR", "MRI", "CT", "XRAY", "MAMMOGRAPHY", "DEXA", "OTHER"] as const;
export type DepartmentType = (typeof DEPARTMENT_TYPES)[number];
export const DEPARTMENT_TYPE_LABELS: Record<DepartmentType, string> = {
  SONAR: "Sonar",
  MRI: "MRI",
  CT: "CT Scan",
  XRAY: "X-Ray",
  MAMMOGRAPHY: "Mammography",
  DEXA: "DEXA",
  OTHER: "Other",
};

export const MACHINE_STATUSES = ["AVAILABLE", "IN_USE", "MAINTENANCE", "OFFLINE"] as const;
export type MachineStatus = (typeof MACHINE_STATUSES)[number];
export const MACHINE_STATUS_LABELS: Record<MachineStatus, string> = {
  AVAILABLE: "Available",
  IN_USE: "In use",
  MAINTENANCE: "Maintenance",
  OFFLINE: "Offline",
};

export const EMPLOYMENT_STATUSES = ["ACTIVE", "ON_LEAVE", "SUSPENDED", "TERMINATED"] as const;
export type EmploymentStatus = (typeof EMPLOYMENT_STATUSES)[number];
export const EMPLOYMENT_STATUS_LABELS: Record<EmploymentStatus, string> = {
  ACTIVE: "Active",
  ON_LEAVE: "On leave",
  SUSPENDED: "Suspended",
  TERMINATED: "Terminated",
};

export const ATTENDANCE_STATUSES = ["PRESENT", "LATE", "ABSENT", "LEAVE", "HOLIDAY"] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];
export const ATTENDANCE_STATUS_LABELS: Record<AttendanceStatus, string> = {
  PRESENT: "Present",
  LATE: "Late",
  ABSENT: "Absent",
  LEAVE: "On leave",
  HOLIDAY: "Holiday",
};

export const LOCATION_STATUSES = ["INSIDE_ZONE", "OUTSIDE_ZONE", "UNAVAILABLE", "REVIEW"] as const;
export const LOCATION_STATUS_LABELS: Record<(typeof LOCATION_STATUSES)[number], string> = {
  INSIDE_ZONE: "Inside approved zone",
  OUTSIDE_ZONE: "Outside approved zone",
  UNAVAILABLE: "Location unavailable",
  REVIEW: "Manual review required",
};

export const MATCH_STATUSES = ["MATCHED", "MISMATCH", "UNKNOWN"] as const;

export const AGREEMENT_STATUSES = ["DRAFT", "ISSUED", "ACCEPTED", "DECLINED", "SUPERSEDED", "TERMINATED"] as const;
export type AgreementStatus = (typeof AGREEMENT_STATUSES)[number];
export const AGREEMENT_STATUS_LABELS: Record<AgreementStatus, string> = {
  DRAFT: "Draft",
  ISSUED: "Issued — awaiting acceptance",
  ACCEPTED: "Accepted",
  DECLINED: "Declined",
  SUPERSEDED: "Superseded",
  TERMINATED: "Terminated",
};

export const POLICY_CATEGORIES = [
  "ATTENDANCE",
  "DEVICE_USAGE",
  "LOCATION_MONITORING",
  "DATA_PRIVACY",
  "CONFIDENTIALITY",
  "INFO_SECURITY",
  "MEDICAL_DATA",
  "ACCEPTABLE_USE",
  "CONDUCT",
  "OVERTIME",
  "LEAVE",
  "ASSET_USAGE",
  "INVENTORY",
] as const;
export type PolicyCategory = (typeof POLICY_CATEGORIES)[number];
export const POLICY_CATEGORY_LABELS: Record<PolicyCategory, string> = {
  ATTENDANCE: "Attendance",
  DEVICE_USAGE: "Device usage",
  LOCATION_MONITORING: "Location monitoring",
  DATA_PRIVACY: "Data privacy",
  CONFIDENTIALITY: "Confidentiality",
  INFO_SECURITY: "Information security",
  MEDICAL_DATA: "Medical-data handling",
  ACCEPTABLE_USE: "Acceptable system use",
  CONDUCT: "Workplace conduct",
  OVERTIME: "Overtime",
  LEAVE: "Leave",
  ASSET_USAGE: "Asset usage",
  INVENTORY: "Inventory accountability",
};

export const VISIT_STATUSES = [
  "REGISTERED",
  "PAID",
  "WAITING",
  "CALLED",
  "IN_PROGRESS",
  "SCAN_COMPLETED",
  "PRINTING_COMPLETED",
  "REPORT_PENDING",
  "REPORT_COMPLETED",
  "COMPLETED",
  "CANCELLED",
  "RESCHEDULED",
] as const;
export type VisitStatus = (typeof VISIT_STATUSES)[number];
export const VISIT_STATUS_LABELS: Record<VisitStatus, string> = {
  REGISTERED: "Registered",
  PAID: "Paid",
  WAITING: "Waiting",
  CALLED: "Called",
  IN_PROGRESS: "In progress",
  SCAN_COMPLETED: "Scan completed",
  PRINTING_COMPLETED: "Printing completed",
  REPORT_PENDING: "Report pending",
  REPORT_COMPLETED: "Report completed",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
  RESCHEDULED: "Rescheduled",
};

// Statuses that count as "in the active queue" for a department
export const ACTIVE_QUEUE_STATUSES: VisitStatus[] = ["PAID", "WAITING", "CALLED", "IN_PROGRESS"];

export const PAYMENT_METHODS = ["CASH", "CARD", "TRANSFER"] as const;
export const PAYMENT_METHOD_LABELS: Record<(typeof PAYMENT_METHODS)[number], string> = {
  CASH: "Cash",
  CARD: "Card",
  TRANSFER: "Bank transfer",
};

export const PAYMENT_STATUSES = ["UNPAID", "PARTIAL", "PAID", "REFUNDED"] as const;

export const EXPENSE_CATEGORIES = [
  "SALARIES",
  "OVERTIME",
  "REIMBURSEMENTS",
  "RENT",
  "ELECTRICITY",
  "WATER",
  "INTERNET",
  "MAINTENANCE",
  "EQUIPMENT",
  "MEDICAL_CONSUMABLES",
  "FILMS",
  "PAPERS",
  "DVDS",
  "PRINTING",
  "CLEANING",
  "TRANSPORTATION",
  "MARKETING",
  "PROFESSIONAL_FEES",
  "SOFTWARE",
  "SECURITY",
  "OTHER",
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];
export const EXPENSE_CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  SALARIES: "Salaries",
  OVERTIME: "Overtime",
  REIMBURSEMENTS: "Employee reimbursements",
  RENT: "Rent",
  ELECTRICITY: "Electricity",
  WATER: "Water",
  INTERNET: "Internet",
  MAINTENANCE: "Maintenance",
  EQUIPMENT: "Equipment",
  MEDICAL_CONSUMABLES: "Medical consumables",
  FILMS: "Films",
  PAPERS: "Papers",
  DVDS: "DVDs",
  PRINTING: "Printing",
  CLEANING: "Cleaning",
  TRANSPORTATION: "Transportation",
  MARKETING: "Marketing",
  PROFESSIONAL_FEES: "Professional fees",
  SOFTWARE: "Software",
  SECURITY: "Security",
  OTHER: "Other",
};

export const EXPENSE_STATUSES = ["SUBMITTED", "UNDER_REVIEW", "APPROVED", "REJECTED"] as const;
export type ExpenseStatus = (typeof EXPENSE_STATUSES)[number];
export const EXPENSE_STATUS_LABELS: Record<ExpenseStatus, string> = {
  SUBMITTED: "Submitted",
  UNDER_REVIEW: "Under review",
  APPROVED: "Approved",
  REJECTED: "Rejected",
};

export const EMPLOYEE_EXPENSE_CATEGORIES = [
  "TRAVEL",
  "TRANSPORT",
  "MEALS",
  "SUPPLIES",
  "COMMUNICATION",
  "OVERTIME_COST",
  "TRAINING",
  "PETTY_CASH",
  "OTHER",
] as const;
export type EmployeeExpenseCategory = (typeof EMPLOYEE_EXPENSE_CATEGORIES)[number];
export const EMPLOYEE_EXPENSE_CATEGORY_LABELS: Record<EmployeeExpenseCategory, string> = {
  TRAVEL: "Travel",
  TRANSPORT: "Transport",
  MEALS: "Meals",
  SUPPLIES: "Supplies",
  COMMUNICATION: "Communication",
  OVERTIME_COST: "Overtime-related",
  TRAINING: "Training",
  PETTY_CASH: "Petty cash",
  OTHER: "Other",
};

export const EMPLOYEE_EXPENSE_STATUSES = ["SUBMITTED", "APPROVED", "REJECTED", "REIMBURSED"] as const;

export const PAYROLL_STATUSES = ["DRAFT", "APPROVED", "PAID"] as const;

export const DISCOUNT_TYPES = ["MANUAL", "CODE", "REFERRAL_CONVERSION"] as const;
export const DISCOUNT_STATUSES = ["PENDING", "APPROVED", "REJECTED"] as const;

export const DEAL_TYPES = ["FIXED", "PERCENT", "NONE", "DISCOUNT_CONVERSION"] as const;
export type DealType = (typeof DEAL_TYPES)[number];
export const DEAL_TYPE_LABELS: Record<DealType, string> = {
  FIXED: "Fixed commission",
  PERCENT: "Percentage commission",
  NONE: "No commission",
  DISCOUNT_CONVERSION: "Commission converted to patient discount",
};

export const CONTRACT_STATUSES = ["ACTIVE", "SUSPENDED", "ENDED"] as const;

export const INVENTORY_CATEGORIES = [
  "FILM",
  "PAPER",
  "DVD",
  "ENVELOPE",
  "PAPER_TOWEL",
  "PRINTING",
  "SONAR_CONSUMABLE",
  "MEDICAL_CONSUMABLE",
  "CLEANING",
  "OFFICE",
  "OTHER",
] as const;
export type InventoryCategory = (typeof INVENTORY_CATEGORIES)[number];
export const INVENTORY_CATEGORY_LABELS: Record<InventoryCategory, string> = {
  FILM: "Films",
  PAPER: "Papers",
  DVD: "DVDs",
  ENVELOPE: "Envelopes",
  PAPER_TOWEL: "Paper towels",
  PRINTING: "Printing materials",
  SONAR_CONSUMABLE: "Sonar consumables",
  MEDICAL_CONSUMABLE: "Medical consumables",
  CLEANING: "Cleaning supplies",
  OFFICE: "Office supplies",
  OTHER: "Other assets",
};

export const MOVEMENT_TYPES = [
  "RECEIVED",
  "ISSUED",
  "CONSUMED",
  "WASTED",
  "CORRECTED",
  "RETURNED",
  "TRANSFERRED",
] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];
export const MOVEMENT_TYPE_LABELS: Record<MovementType, string> = {
  RECEIVED: "Received",
  ISSUED: "Issued",
  CONSUMED: "Consumed",
  WASTED: "Wasted",
  CORRECTED: "Corrected",
  RETURNED: "Returned",
  TRANSFERRED: "Transferred",
};

export const ALERT_CATEGORIES = [
  "FINANCIAL",
  "EXPENSE",
  "ATTENDANCE",
  "STAFFING",
  "QUEUE",
  "REPORT_DELAY",
  "INVENTORY",
  "WASTE",
  "SECURITY",
  "PRIVACY",
  "AGREEMENT",
  "POLICY",
  "MACHINE",
  "MANAGEMENT",
  "AI_ANOMALY",
] as const;
export type AlertCategory = (typeof ALERT_CATEGORIES)[number];
export const ALERT_CATEGORY_LABELS: Record<AlertCategory, string> = {
  FINANCIAL: "Financial",
  EXPENSE: "Expense",
  ATTENDANCE: "Attendance",
  STAFFING: "Staffing",
  QUEUE: "Queue",
  REPORT_DELAY: "Report delay",
  INVENTORY: "Inventory",
  WASTE: "Waste",
  SECURITY: "Security",
  PRIVACY: "Privacy",
  AGREEMENT: "Agreement",
  POLICY: "Policy",
  MACHINE: "Machine downtime",
  MANAGEMENT: "Management activity",
  AI_ANOMALY: "AI-detected anomaly",
};

export const ALERT_SEVERITIES = ["INFO", "WARNING", "CRITICAL"] as const;
export type AlertSeverity = (typeof ALERT_SEVERITIES)[number];

export const ALERT_STATUSES = ["OPEN", "ACKNOWLEDGED", "RESOLVED"] as const;

export const INCIDENT_TYPES = [
  "SECURITY",
  "PRIVACY",
  "OPERATIONAL",
  "FINANCIAL",
  "INVENTORY",
  "ATTENDANCE",
  "EQUIPMENT",
  "DATA_QUALITY",
  "ACCESS_CONTROL",
] as const;
export type IncidentType = (typeof INCIDENT_TYPES)[number];
export const INCIDENT_TYPE_LABELS: Record<IncidentType, string> = {
  SECURITY: "Security",
  PRIVACY: "Privacy",
  OPERATIONAL: "Operational",
  FINANCIAL: "Financial",
  INVENTORY: "Inventory",
  ATTENDANCE: "Attendance",
  EQUIPMENT: "Equipment",
  DATA_QUALITY: "Data quality",
  ACCESS_CONTROL: "Access control",
};

export const INCIDENT_STATUSES = [
  "DETECTED",
  "TRIAGED",
  "ASSIGNED",
  "INVESTIGATING",
  "CONTAINED",
  "RESOLVED",
  "REVIEWED",
  "CLOSED",
] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];
export const INCIDENT_STATUS_LABELS: Record<IncidentStatus, string> = {
  DETECTED: "Detected",
  TRIAGED: "Triaged",
  ASSIGNED: "Assigned",
  INVESTIGATING: "Investigating",
  CONTAINED: "Contained",
  RESOLVED: "Resolved",
  REVIEWED: "Reviewed",
  CLOSED: "Closed",
};

export const INCIDENT_SEVERITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;

export const RISK_LEVELS = ["LOW", "MEDIUM", "HIGH"] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export const NOTIFICATION_CATEGORIES = [
  "CRITICAL_ALERT",
  "EXPENSE_ANOMALY",
  "ATTENDANCE",
  "REPORT_DELAY",
  "LOW_STOCK",
  "WASTE",
  "AGREEMENT",
  "POLICY",
  "SECURITY",
  "PRIVACY",
  "AI_INSIGHT",
  "PDF_READY",
  "MANAGEMENT",
] as const;

export const REPORT_TYPES = [
  "EXECUTIVE_SUMMARY",
  "BRANCH_PERFORMANCE",
  "CROSS_BRANCH",
  "FINANCIAL",
  "EXPENSE",
  "EMPLOYEE_EXPENSE",
  "PAYROLL",
  "ATTENDANCE",
  "WORKFORCE",
  "INVENTORY",
  "WASTE_VARIANCE",
  "RADIOLOGY_OPERATIONS",
  "REPORT_TURNAROUND",
  "REFERRAL_DOCTORS",
  "DISCOUNTS",
  "MANAGEMENT_ACTIVITIES",
  "LEGAL_ACCOUNTABILITY",
  "PRIVACY",
  "SECURITY",
  "SHAREHOLDER_BOARD",
  "CUSTOM_AI",
] as const;
export type ReportType = (typeof REPORT_TYPES)[number];
export const REPORT_TYPE_LABELS: Record<ReportType, string> = {
  EXECUTIVE_SUMMARY: "Executive Summary",
  BRANCH_PERFORMANCE: "Branch Performance",
  CROSS_BRANCH: "Cross-Branch Comparison",
  FINANCIAL: "Financial",
  EXPENSE: "Expense",
  EMPLOYEE_EXPENSE: "Employee Expense",
  PAYROLL: "Payroll",
  ATTENDANCE: "Attendance",
  WORKFORCE: "Workforce",
  INVENTORY: "Inventory",
  WASTE_VARIANCE: "Waste and Variance",
  RADIOLOGY_OPERATIONS: "Radiology Operations",
  REPORT_TURNAROUND: "Report Turnaround",
  REFERRAL_DOCTORS: "Referral Doctors",
  DISCOUNTS: "Discounts",
  MANAGEMENT_ACTIVITIES: "Management Activities",
  LEGAL_ACCOUNTABILITY: "Legal Accountability",
  PRIVACY: "Privacy",
  SECURITY: "Security",
  SHAREHOLDER_BOARD: "Shareholder / Board Report",
  CUSTOM_AI: "Custom Merna AI Report",
};

export const DATA_CLASSIFICATIONS = [
  "PUBLIC",
  "INTERNAL",
  "CONFIDENTIAL",
  "HIGHLY_CONFIDENTIAL",
  "MEDICAL_SENSITIVE",
  "HR_SENSITIVE",
  "FINANCIAL_SENSITIVE",
  "SECURITY_SENSITIVE",
] as const;
export type DataClassification = (typeof DATA_CLASSIFICATIONS)[number];
export const DATA_CLASSIFICATION_LABELS: Record<DataClassification, string> = {
  PUBLIC: "Public",
  INTERNAL: "Internal",
  CONFIDENTIAL: "Confidential",
  HIGHLY_CONFIDENTIAL: "Highly Confidential",
  MEDICAL_SENSITIVE: "Medical Sensitive",
  HR_SENSITIVE: "HR Sensitive",
  FINANCIAL_SENSITIVE: "Financial Sensitive",
  SECURITY_SENSITIVE: "Security Sensitive",
};
