import { describe, expect, it, vi } from "vitest";

// The payment receipt goes out with lib/email.ts's mail settings and sender.
// It once had its own, which read SMTP_PASSWORD and SMTP_FROM (neither is
// set anywhere), so a relay that needs a password refused it and the sender
// was "<undefined>".

const sendMail = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("@/lib/email", () => ({ FROM: "Vertex International <noreply@test.invalid>", transporter: { sendMail } }));

import { createReceiptPdf } from "./invoice";

describe("createReceiptPdf", () => {
  it("emails the PDF from the shared sender", async () => {
    await createReceiptPdf("pay12345678", "Ann Lee", "ann@test.invalid", "Orchard", 50, "txn_1", new Date("2026-11-01T10:00:00Z"));
    const [message] = sendMail.mock.calls[0] as unknown as [{ from: string; to: string; attachments: { filename: string; contentType: string; content: Buffer }[] }];
    expect([message.from, message.to]).toEqual(["Vertex International <noreply@test.invalid>", "ann@test.invalid"]);
    const [pdf] = message.attachments;
    expect([pdf.filename, pdf.contentType]).toEqual(["Receipt_pay12345.pdf", "application/pdf"]);
    expect(pdf.content.subarray(0, 5).toString()).toBe("%PDF-");
  });
});
