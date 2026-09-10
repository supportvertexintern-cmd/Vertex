import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import nodemailer from "nodemailer";

export async function createReceiptPdf(
  paymentId: string,
  candidateName: string,
  candidateEmail: string,
  jobTitle: string,
  amount: number,
  transactionId: string,
  date: Date
) {
  // 1. Create PDF
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([600, 800]);
  const { height } = page.getSize();
  
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  
  // Header
  page.drawText("Vertex International Recruitment", { x: 50, y: height - 80, size: 24, font: boldFont, color: rgb(0.1, 0.1, 0.5) });
  page.drawText("Payment Receipt", { x: 50, y: height - 110, size: 20, font: boldFont });
  
  // Receipt Details
  const startY = height - 160;
  const lineSpacing = 30;
  
  page.drawText(`Date: ${new Date(date).toLocaleString()}`, { x: 50, y: startY, size: 12, font });
  page.drawText(`Receipt ID: ${paymentId}`, { x: 50, y: startY - lineSpacing, size: 12, font });
  page.drawText(`Transaction ID: ${transactionId}`, { x: 50, y: startY - lineSpacing * 2, size: 12, font });
  
  page.drawText(`Billed To:`, { x: 50, y: startY - lineSpacing * 4, size: 14, font: boldFont });
  page.drawText(candidateName, { x: 50, y: startY - lineSpacing * 4.6, size: 12, font });
  page.drawText(candidateEmail, { x: 50, y: startY - lineSpacing * 5.2, size: 12, font });
  
  // Table Header
  const tableY = startY - lineSpacing * 7;
  page.drawRectangle({ x: 50, y: tableY - 5, width: 500, height: 25, color: rgb(0.9, 0.9, 0.9) });
  page.drawText("Description", { x: 60, y: tableY, size: 12, font: boldFont });
  page.drawText("Amount", { x: 450, y: tableY, size: 12, font: boldFont });
  
  // Table Row
  page.drawText(`Application Processing Fee: ${jobTitle}`, { x: 60, y: tableY - 30, size: 12, font });
  page.drawText(`$${amount.toFixed(2)} USD`, { x: 450, y: tableY - 30, size: 12, font });
  
  // Total
  page.drawText("Total Paid:", { x: 350, y: tableY - 80, size: 14, font: boldFont });
  page.drawText(`$${amount.toFixed(2)} USD`, { x: 450, y: tableY - 80, size: 14, font: boldFont, color: rgb(0, 0.5, 0) });
  
  // Footer
  page.drawText("Thank you for your payment.", { x: 50, y: 100, size: 12, font, color: rgb(0.4, 0.4, 0.4) });
  
  const pdfBytes = await pdfDoc.save();

  // 2. Email Receipt
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT),
    secure: process.env.SMTP_SECURE === "true",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASSWORD,
    },
  });

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden;">
      <div style="background-color: #0f172a; padding: 24px; text-align: center;">
        <h1 style="color: #ffffff; margin: 0; font-size: 24px;">Payment Receipt</h1>
      </div>
      <div style="padding: 32px; background-color: #ffffff;">
        <p style="font-size: 16px; color: #334155;">Hello ${candidateName},</p>
        <p style="font-size: 16px; color: #334155;">
          Thank you for your payment of <strong>$${amount.toFixed(2)}</strong> for the <strong>${jobTitle}</strong> application fee.
        </p>
        <p style="font-size: 16px; color: #334155;">
          Your official receipt is attached to this email as a PDF. You can now finalize submitting your job application from the candidate dashboard.
        </p>
      </div>
    </div>
  `;

  await transporter.sendMail({
    from: `"Vertex Recruitment" <${process.env.SMTP_FROM}>`,
    to: candidateEmail,
    subject: `Payment Receipt - Vertex International`,
    html,
    attachments: [
      {
        filename: `Receipt_${paymentId.substring(0, 8)}.pdf`,
        content: Buffer.from(pdfBytes),
        contentType: "application/pdf",
      },
    ],
  });
}
