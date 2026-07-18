"use client";

import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { downloadReportPdf } from "@/lib/pdf/pdf";
import type { ReportDocData } from "@/lib/reports/types";

export function ReportPdfButton({ data }: { data: ReportDocData }) {
  return (
    <Button variant="primary" size="md" onClick={() => downloadReportPdf(data)}>
      <Download size={14} /> Download PDF
    </Button>
  );
}
