import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { canRead, isBranchScoped, maskingFor } from "@/lib/permissions";
import { maskName } from "@/lib/format";

interface SearchResult {
  type: string;
  label: string;
  sublabel?: string;
  href: string;
}

// Global entity search. Respects role module access and branch scoping.
export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  if (q.length < 2) return NextResponse.json({ results: [] });

  const role = user.role;
  const masking = maskingFor(role);
  const branchFilter = isBranchScoped(role) && user.branchId ? { branchId: user.branchId } : {};
  const results: SearchResult[] = [];
  const TAKE = 4;

  const tasks: Promise<void>[] = [];

  if (canRead(role, "branches")) {
    tasks.push(
      db.branch
        .findMany({
          where: { OR: [{ name: { contains: q } }, { city: { contains: q } }, { code: { contains: q } }] },
          take: TAKE,
        })
        .then((rows) => {
          for (const b of rows) results.push({ type: "Branch", label: b.name, sublabel: b.city, href: `/branches/${b.id}` });
        }),
    );
  }

  if (canRead(role, "employees")) {
    tasks.push(
      db.employee
        .findMany({
          where: {
            ...branchFilter,
            OR: [
              { firstName: { contains: q } },
              { lastName: { contains: q } },
              { employeeCode: { contains: q } },
              { jobTitle: { contains: q } },
            ],
          },
          include: { branch: { select: { name: true } } },
          take: TAKE,
        })
        .then((rows) => {
          for (const e of rows) {
            const name = masking.employeeContact ? maskName(e.firstName, e.lastName) : `${e.firstName} ${e.lastName}`;
            results.push({ type: "Employee", label: name, sublabel: `${e.jobTitle} · ${e.branch.name}`, href: `/employees/${e.id}` });
          }
        }),
    );
  }

  if (canRead(role, "patients")) {
    tasks.push(
      db.patient
        .findMany({
          where: {
            OR: [{ publicRef: { contains: q } }, { firstName: { contains: q } }, { lastName: { contains: q } }],
          },
          take: TAKE,
        })
        .then((rows) => {
          for (const p of rows) {
            results.push({
              type: "Patient",
              label: p.publicRef,
              sublabel: maskName(p.firstName, p.lastName),
              href: `/patients?q=${encodeURIComponent(p.publicRef)}`,
            });
          }
        }),
    );
  }

  if (canRead(role, "finance.expenses") && !masking.financeDetail) {
    tasks.push(
      db.expense
        .findMany({
          where: { ...branchFilter, OR: [{ description: { contains: q } }, { vendor: { contains: q } }] },
          include: { branch: { select: { name: true } } },
          take: TAKE,
        })
        .then((rows) => {
          for (const e of rows) {
            results.push({
              type: "Expense",
              label: e.description,
              sublabel: e.branch.name,
              href: `/finance/expenses?q=${encodeURIComponent(q)}`,
            });
          }
        }),
    );
  }

  if (canRead(role, "alerts")) {
    tasks.push(
      db.alert
        .findMany({
          where: { ...branchFilter, title: { contains: q } },
          take: TAKE,
          orderBy: { detectedAt: "desc" },
        })
        .then((rows) => {
          for (const a of rows) results.push({ type: "Alert", label: a.title, sublabel: a.severity, href: `/alerts?q=${encodeURIComponent(q)}` });
        }),
    );
  }

  if (canRead(role, "incidents")) {
    tasks.push(
      db.incident
        .findMany({ where: { ...branchFilter, title: { contains: q } }, take: TAKE })
        .then((rows) => {
          for (const i of rows) results.push({ type: "Incident", label: i.title, sublabel: i.status, href: `/incidents/${i.id}` });
        }),
    );
  }

  if (canRead(role, "inventory")) {
    tasks.push(
      db.inventoryItem
        .findMany({
          where: { ...branchFilter, name: { contains: q } },
          include: { branch: { select: { name: true } } },
          take: TAKE,
        })
        .then((rows) => {
          for (const i of rows) results.push({ type: "Inventory", label: i.name, sublabel: i.branch.name, href: `/inventory?q=${encodeURIComponent(q)}` });
        }),
    );
  }

  if (canRead(role, "referrals")) {
    tasks.push(
      db.referralDoctor
        .findMany({ where: { name: { contains: q } }, take: TAKE })
        .then((rows) => {
          for (const d of rows) results.push({ type: "Referral Dr", label: d.name, sublabel: d.specialty ?? undefined, href: `/operations/referrals` });
        }),
    );
  }

  if (canRead(role, "policies")) {
    tasks.push(
      db.policy
        .findMany({ where: { title: { contains: q } }, take: TAKE })
        .then((rows) => {
          for (const p of rows) results.push({ type: "Policy", label: p.title, sublabel: `v${p.version}`, href: `/policies/${p.id}` });
        }),
    );
  }

  await Promise.all(tasks);
  return NextResponse.json({ results: results.slice(0, 24) });
}
