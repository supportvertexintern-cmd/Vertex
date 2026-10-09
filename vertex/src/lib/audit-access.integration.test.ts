// Gap G16: bulk exports must leave an audit trail (zero-trust policy §9).
import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/prisma";
import { auditAccess } from "./audit";

describe("auditAccess", () => {
  it("records who exported what and how much, not the data itself", async () => {
    const actorId = `ctest-auditor-${Date.now()}`;
    await auditAccess(actorId, "CandidateExport", "export", { rows: 42, filters: { country: "Testland" } });

    const entry = await prisma.auditLog.findFirst({ where: { actor_id: actorId } });
    expect(entry).toMatchObject({ entity_type: "CandidateExport", entity_id: "bulk", action: "export", actor_id: actorId });
    expect(entry?.after).toEqual({ rows: 42, filters: { country: "Testland" } });
    expect(entry?.before).toBeNull();
  });
});
