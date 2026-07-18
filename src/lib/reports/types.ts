// Shared report document structure (server assembles, client renders/PDFs).

export interface ReportSection {
  heading: string;
  paragraphs?: string[];
  bullets?: string[];
  kpis?: [string, string][];
  table?: { columns: string[]; rows: (string | number)[][] };
}

export interface ReportDocData {
  title: string;
  reportType: string;
  scope: string;
  period: string;
  preparedFor: string;
  confidentiality: string;
  sections: ReportSection[];
  companyName: string;
}
