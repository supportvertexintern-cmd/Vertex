// Gap G11 (docs/security/phase2-baseline.md): the public job page/API must
// never expose draft jobs or internal fields.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { getPublicJobById } from "./publicJobs";

const ids: Record<"draft" | "active" | "closed", string> = { draft: "", active: "", closed: "" };
let employerClientId = "";

beforeAll(async () => {
  const client = await prisma.employerClient.create({
    data: { name: "G11 Test Employer", country: "Testland", contact_name: "Test", contact_email: "g11@test.invalid", contact_phone: "000" },
  });
  employerClientId = client.id;
  for (const status of ["draft", "active", "closed"] as const) {
    const job = await prisma.job.create({
      data: {
        title: `G11 ${status} job`,
        country: "Testland",
        city: "Test City",
        job_description: "desc",
        requirements: "reqs",
        status,
        application_fee: 99,
        employer_client_id: employerClientId,
      },
    });
    ids[status] = job.id;
  }
});

afterAll(async () => {
  await prisma.job.deleteMany({ where: { id: { in: Object.values(ids) } } });
  await prisma.employerClient.delete({ where: { id: employerClientId } });
});

describe("getPublicJobById", () => {
  it("never returns a draft job", async () => {
    expect(await getPublicJobById(ids.draft)).toBeNull();
  });

  it("returns active and closed jobs (closed ones stay reachable from old links)", async () => {
    expect((await getPublicJobById(ids.active))?.status).toBe("active");
    expect((await getPublicJobById(ids.closed))?.status).toBe("closed");
  });

  it("returns only public fields", async () => {
    const job = (await getPublicJobById(ids.active)) as Record<string, unknown>;
    for (const internal of ["employer_client_id", "employer_client", "application_fee", "updated_at"]) {
      expect(job).not.toHaveProperty(internal);
    }
    expect(job).toHaveProperty("title");
    expect(job).toHaveProperty("requirements");
  });

  it("returns null for an unknown id", async () => {
    expect(await getPublicJobById("does-not-exist")).toBeNull();
  });
});
