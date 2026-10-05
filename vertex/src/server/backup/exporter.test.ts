import { describe, it, expect, afterAll } from "vitest";
import { inflateRawSync } from "zlib";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { buildZip } from "@/lib/zip";
import {
  CATEGORIES,
  allowedModels,
  describeCatalog,
  exportableFields,
  getModel,
  relationFields,
  relationLink,
} from "./catalog";
import { buildExport, ExportValidationError } from "./exporter";

// Read-only integration tests — buildExport only ever reads, so these run
// against whatever database .env.test (or .env) points at without
// modifying it. Assertions compare against live counts rather than fixed
// numbers so they hold on any dataset.

function unzip(buf: Buffer): Map<string, string> {
  const files = new Map<string, string>();
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buf.readUInt16LE(eocd + 10);
  let ptr = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
    const compSize = buf.readUInt32LE(ptr + 20);
    const nameLen = buf.readUInt16LE(ptr + 28);
    const extraLen = buf.readUInt16LE(ptr + 30);
    const commentLen = buf.readUInt16LE(ptr + 32);
    const localOffset = buf.readUInt32LE(ptr + 42);
    const name = buf.subarray(ptr + 46, ptr + 46 + nameLen).toString("utf8");
    const localNameLen = buf.readUInt16LE(localOffset + 26);
    const localExtraLen = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    files.set(name, inflateRawSync(buf.subarray(dataStart, dataStart + compSize)).toString("utf8"));
    ptr += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

// Minimal RFC-4180 parser (quoted fields may contain commas/newlines).
function parseCsv(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const text = csv.replace(/^\uFEFF/, "");
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\r" && text[i + 1] === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      i++;
    } else cell += ch;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function csvRows(csv: string): string[] {
  return parseCsv(csv).map((r) => r.join(","));
}

function csvIds(csv: string): Set<string> {
  const [header, ...rows] = parseCsv(csv);
  const idx = header.indexOf("id");
  return new Set(rows.map((r) => r[idx]));
}

const ids = (rows: { id: string }[]) => rows.map((r) => r.id);

afterAll(async () => {
  await prisma.$disconnect();
});

describe("backup catalog", () => {
  it("places every Prisma model in a category, so a new table can't silently drop out of full backups", () => {
    const categorized = new Set(CATEGORIES.flatMap((c) => c.models));
    const missing = Prisma.dmmf.datamodel.models.map((m) => m.name).filter((m) => !categorized.has(m));
    expect(missing).toEqual([]);
  });

  it("gives admin/director every table and keeps restricted tables away from HR", () => {
    expect(allowedModels("admin")).toHaveLength(Prisma.dmmf.datamodel.models.length);
    expect(allowedModels("director")).toHaveLength(Prisma.dmmf.datamodel.models.length);
    const hr = allowedModels("hr");
    expect(hr).toEqual(expect.arrayContaining(["Candidate", "PartnerCandidate", "Case", "Document", "User"]));
    for (const restricted of ["AuditLog", "ReferralAgent", "SystemSetting", "StaffScorecard", "EmailTemplate"]) {
      expect(hr).not.toContain(restricted);
    }
    expect(allowedModels("regional_recruiter")).toEqual([]);
    expect(allowedModels("partner")).toEqual([]);
  });

  it("never exposes credential columns", () => {
    const names = exportableFields(getModel("User")!).map((f) => f.name);
    expect(names).not.toContain("password_hash");
    expect(names).not.toContain("google_id");
    expect(names).toContain("email");
  });

  it("only lists relationships to tables the role can also export", () => {
    const hrCatalog = describeCatalog("hr");
    const allowed = new Set(allowedModels("hr"));
    for (const table of hrCatalog.tables) {
      for (const rel of table.relations) expect(allowed.has(rel.model)).toBe(true);
    }
    const user = hrCatalog.tables.find((t) => t.name === "User")!;
    expect(user.relations.map((r) => r.model)).not.toContain("Report");
  });

  it("resolves relationship joins in both directions, including self-relations", () => {
    const caseModel = getModel("Case")!;
    const rel = (m: typeof caseModel, n: string) => relationFields(m).find((r) => r.name === n)!;
    expect(relationLink(caseModel, rel(caseModel, "application"))).toEqual({ parentColumn: "application_id", relatedColumn: "id" });
    expect(relationLink(caseModel, rel(caseModel, "stage_events"))).toEqual({ parentColumn: "id", relatedColumn: "case_id" });
    const user = getModel("User")!;
    expect(relationLink(user, rel(user, "reports"))).toEqual({ parentColumn: "id", relatedColumn: "supervisor_id" });
    expect(relationLink(user, rel(user, "supervisor"))).toEqual({ parentColumn: "supervisor_id", relatedColumn: "id" });
  });
});

describe("zip writer", () => {
  it("round-trips UTF-8 file names and content", () => {
    const files = unzip(buildZip([{ name: "a/Ünïcode.csv", content: "x,y\r\nJosé,Ł\r\n" }, { name: "b.txt", content: "" }]));
    expect(files.get("a/Ünïcode.csv")).toBe("x,y\r\nJosé,Ł\r\n");
    expect(files.get("b.txt")).toBe("");
  });
});

describe("buildExport", () => {
  const hr = { userId: "test-hr", role: "hr" as const, name: "Test HR", email: "hr@test.local" };

  // Other test files (scope.test.ts) create/delete their own fixtures in
  // the same database concurrently, so this compares the records that
  // existed both before and after the export rather than exact counts.
  it("full backup includes every HR table with complete rows and no partner drafts", async () => {
    const before = {
      candidates: ids(await prisma.candidate.findMany({ select: { id: true } })),
      cases: ids(await prisma.case.findMany({ select: { id: true } })),
      submissions: ids(await prisma.partnerCandidate.findMany({ where: { status: { not: "draft" } }, select: { id: true } })),
    };
    const { zip, filename, manifest } = await buildExport(hr, { mode: "full" });
    expect(filename).toMatch(/^vertex-full-backup_\d{4}-\d{2}-\d{2}\.zip$/);
    expect(manifest.export_type).toBe("full_backup");
    const files = unzip(zip);

    for (const model of allowedModels("hr")) expect(files.has(`${model}.csv`)).toBe(true);
    expect(files.has("AuditLog.csv")).toBe(false);
    expect(files.get("README.txt")).toContain("FULL BACKUP");
    expect(files.get("User.csv")).not.toContain("password_hash");

    const stillExisting = async (delegate: { findMany: (a: object) => Promise<{ id: string }[]> }, list: string[]) =>
      ids(await delegate.findMany({ where: { id: { in: list } }, select: { id: true } }));
    const expectAll = (csv: string, list: string[]) => {
      const exported = csvIds(csv);
      expect(list.filter((id) => !exported.has(id))).toEqual([]);
    };
    expectAll(files.get("Candidate.csv")!, await stillExisting(prisma.candidate, before.candidates));
    expectAll(files.get("Case.csv")!, await stillExisting(prisma.case, before.cases));
    expectAll(files.get("PartnerCandidate.csv")!, await stillExisting(prisma.partnerCandidate, before.submissions));

    const exportedSubmissions = [...csvIds(files.get("PartnerCandidate.csv")!)];
    expect(await prisma.partnerCandidate.count({ where: { id: { in: exportedSubmissions }, status: "draft" } })).toBe(0);
  });

  it("custom export applies status filters, column selection and follows related tables", async () => {
    type CaseRow = { id: string; application: { candidate_id: string } };
    const cases: CaseRow[] = await prisma.case.findMany({
      where: { status: "active" },
      select: { id: true, application: { select: { candidate_id: true } } },
    });
    const { zip, manifest } = await buildExport(hr, {
      mode: "custom",
      sections: [
        {
          title: "Active cases",
          root: {
            model: "Case",
            fields: ["current_stage", "application_id", "id"],
            relations: {
              application: { model: "Application", relations: { candidate: { model: "Candidate", fields: ["id", "full_name"] } } },
              stage_events: { model: "CaseStageEvent" },
            },
          },
          filters: { enums: { status: ["active"] } },
        },
      ],
    });
    expect(manifest.export_type).toBe("custom_export");
    const files = unzip(zip);
    expect(files.get("README.txt")).toContain("NOT a complete backup");

    const caseRows = csvRows(files.get("01-active-cases/Case.csv")!);
    expect(caseRows[0]).toBe("id,application_id,current_stage"); // schema order, only chosen columns
    expect(caseRows.length - 1).toBe(cases.length);

    const candidateIds = new Set(cases.map((c) => c.application.candidate_id));
    const candidateRows = csvRows(files.get("01-active-cases/Candidate.csv")!);
    expect(candidateRows[0]).toBe("id,full_name");
    expect(candidateRows.length - 1).toBe(candidateIds.size);

    expect(csvRows(files.get("01-active-cases/CaseStageEvent.csv")!).length - 1).toBe(
      await prisma.caseStageEvent.count({ where: { case_id: { in: cases.map((c) => c.id) } } })
    );
    expect(files.get("01-active-cases/relationships.csv")).toContain("Case,application_id,Application,id");
  });

  it("filters to specific records and by date range", async () => {
    const some: { id: string }[] = await prisma.candidate.findMany({ take: 2, select: { id: true } });
    const { zip } = await buildExport(hr, {
      mode: "custom",
      sections: [
        { title: "Picked", root: { model: "Candidate" }, filters: { ids: some.map((c) => c.id) } },
        {
          title: "Future",
          root: { model: "Candidate" },
          filters: { dateField: "created_at", start: "2999-01-01" },
        },
      ],
    });
    const files = unzip(zip);
    expect([...csvIds(files.get("01-picked/Candidate.csv")!)].sort()).toEqual(ids(some).sort());
    expect(csvRows(files.get("02-future/Candidate.csv")!).length - 1).toBe(0);
  });

  it("rejects tables, columns and relationships outside the role's catalog", async () => {
    const custom = (root: object, filters?: object) =>
      buildExport(hr, { mode: "custom", sections: [{ title: "x", root: root as never, filters: filters as never }] });
    await expect(custom({ model: "AuditLog" })).rejects.toBeInstanceOf(ExportValidationError);
    await expect(custom({ model: "User", fields: ["password_hash"] })).rejects.toBeInstanceOf(ExportValidationError);
    await expect(custom({ model: "User", relations: { submitted_reports: { model: "Report" } } })).rejects.toBeInstanceOf(
      ExportValidationError
    );
    await expect(custom({ model: "Case", relations: { application: { model: "Candidate" } } })).rejects.toBeInstanceOf(
      ExportValidationError
    );
    await expect(custom({ model: "Case" }, { enums: { status: ["bogus"] } })).rejects.toBeInstanceOf(ExportValidationError);
  });
});
