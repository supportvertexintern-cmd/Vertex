import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser, requireAuth } from "@/lib/api-auth";
import { getPayPalAccessToken } from "@/lib/paypal";
import { createReceiptPdf } from "@/lib/invoice";

export async function POST(req: NextRequest) {
  const tokenPayload = await getAuthUser(req);
  const guardRes = requireAuth(tokenPayload);
  if (guardRes) return guardRes;

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const parsed = body as { orderID: string, jobId: string };
  if (!parsed.orderID || !parsed.jobId) return NextResponse.json({ error: "Missing required fields" }, { status: 400 });

  const job = await prisma.job.findUnique({ where: { id: parsed.jobId } });
  if (!job) return NextResponse.json({ error: "Job not found." }, { status: 404 });

  const dbUser = await prisma.user.findUnique({ where: { id: tokenPayload!.userId } });
  if (!dbUser) return NextResponse.json({ error: "User not found." }, { status: 404 });

  try {
    const accessToken = await getPayPalAccessToken();
    
    // Capture the order
    const res = await fetch(`${process.env.PAYPAL_API_BASE}/v2/checkout/orders/${parsed.orderID}/capture`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });
    
    const captureData = await res.json();
    
    if (!res.ok || captureData.status !== "COMPLETED") {
      console.error("PayPal Capture Error:", captureData);
      return NextResponse.json({ error: "Payment could not be captured." }, { status: 400 });
    }
    
    const captureId = captureData.purchase_units[0].payments.captures[0].id;

    // Payment is successful, save record
    const payment = await prisma.payment.create({
      data: {
        user_id: dbUser.id,
        job_id: job.id,
        amount: job.application_fee || 0,
        currency: "USD",
        payment_method: "paypal",
        payment_status: "completed",
        transaction_id: captureId,
      }
    });

    // Generate Invoice PDF & Send Email
    try {
       await createReceiptPdf(payment.id, dbUser.full_name, dbUser.email, job.title, payment.amount, payment.transaction_id as string, payment.created_at);
    } catch (receiptErr) {
       console.error("Failed to send receipt:", receiptErr);
    }

    return NextResponse.json({ success: true, paymentId: payment.id });
  } catch (err) {
    console.error("PayPal Capture Exception:", err);
    return NextResponse.json({ error: "An unexpected error occurred during capture." }, { status: 500 });
  }
}
