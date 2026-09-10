import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { createCaseForApprovedApplication } from "./caseLifecycle";

// Integration test against the real test DB — case auto-creation on
// application approval is the load-bearing hinge of the whole Phase 4
// mobility lifecycle (SRS FR-4.1), so it's worth verifying against a real
// write, not just reasoning about the code.

let recruiterId: string;
let candidateId: string;
let jobId: string;
let applicationId: string;
let actorId: string;

beforeAll(async () => {
  const recruiter = await prisma.user.create({
    data: { full_name: "Case Lifecycle Recruiter", email: "case-lifecycle-recruiter@test.local", role: "regional_recruiter" },
  });
  recruiterId = recruiter.id;
  actorId = recruiter.id;

  const candidate = await prisma.candidate.create({
    data: { source: "recruiter_sourced", recruiter_id: recruiterId, lifecycle_status: "approved" },
  });
  candidateId = candidate.id;

  const job = await prisma.job.create({
    data: {
      title: "Case Lifecycle Test Job",
      country: "Kenya",
      city: "Nairobi",
      job_description: "A job created solely for the case-lifecycle integration test.",
      requirements: "None.",
      status: "active",
      application_fee: 0,
    },
  });
  jobId = job.id;

  const application = await prisma.application.create({
    data: { candidate_id: candidateId, job_id: jobId, application_status: "approved" },
  });
  applicationId = application.id;
});

afterAll(async () => {
  await prisma.case.deleteMany({ where: { application_id: applicationId } });
  await prisma.application.delete({ where: { id: applicationId } });
  await prisma.job.delete({ where: { id: jobId } });
  await prisma.candidate.delete({ where: { id: candidateId } });
  await prisma.user.delete({ where: { id: recruiterId } });
  await prisma.$disconnect();
});

describe("createCaseForApprovedApplication", () => {
  it("creates a Case starting at registration_document_submission with an opening stage event", async () => {
    const created = await createCaseForApprovedApplication(applicationId, actorId);
    expect(created.application_id).toBe(applicationId);
    expect(created.current_stage).toBe("registration_document_submission");

    const events = await prisma.caseStageEvent.findMany({ where: { case_id: created.id } });
    expect(events).toHaveLength(1);
    expect(events[0].stage).toBe("registration_document_submission");
    expect(events[0].completed_at).toBeNull();
  });

  it("is idempotent — calling it again for the same application returns the existing case, not a duplicate", async () => {
    const first = await createCaseForApprovedApplication(applicationId, actorId);
    const second = await createCaseForApprovedApplication(applicationId, actorId);
    expect(second.id).toBe(first.id);

    const allCases = await prisma.case.findMany({ where: { application_id: applicationId } });
    expect(allCases).toHaveLength(1);
  });

  it("logs the case creation to the audit trail", async () => {
    const created = await createCaseForApprovedApplication(applicationId, actorId);
    const auditEntries = await prisma.auditLog.findMany({ where: { entity_type: "Case", entity_id: created.id } });
    expect(auditEntries.length).toBeGreaterThan(0);
  });
});
