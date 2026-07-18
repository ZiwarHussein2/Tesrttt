"use client";

import * as React from "react";
import { Download, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

// Exports the first table inside #export-region (or a given element id) to CSV.
export function ExportCsvButton({
  filename = "merna-export.csv",
  targetId = "export-region",
  label = "Export CSV",
}: {
  filename?: string;
  targetId?: string;
  label?: string;
}) {
  const onExport = () => {
    const region = document.getElementById(targetId) ?? document;
    const table = region.querySelector("table");
    if (!table) return;
    const rows: string[] = [];
    table.querySelectorAll("tr").forEach((tr) => {
      const cells = Array.from(tr.querySelectorAll("th,td")).map((cell) => {
        const text = (cell.textContent ?? "").replace(/\s+/g, " ").trim();
        return `"${text.replace(/"/g, '""')}"`;
      });
      if (cells.length) rows.push(cells.join(","));
    });
    const blob = new Blob(["﻿" + rows.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <Button variant="secondary" size="sm" onClick={onExport}>
      <Download size={13} />
      {label}
    </Button>
  );
}

export function PrintButton({ label = "Print / PDF" }: { label?: string }) {
  return (
    <Button variant="secondary" size="sm" onClick={() => window.print()}>
      <Printer size={13} />
      {label}
    </Button>
  );
}
