import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser, requireAuth } from "@/lib/api-auth";
import { getPayPalAccessToken } from "@/lib/paypal";

export async function POST(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireAuth(user);
  if (guardRes) return guardRes;

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const parsed = body as { jobId: string };
  if (!parsed.jobId) return NextResponse.json({ error: "Missing jobId" }, { status: 400 });

  const job = await prisma.job.findUnique({ where: { id: parsed.jobId } });
  if (!job) return NextResponse.json({ error: "Job not found." }, { status: 404 });
  if (!job.application_fee || job.application_fee <= 0) {
    return NextResponse.json({ error: "This job does not require an application fee." }, { status: 400 });
  }

  try {
    const accessToken = await getPayPalAccessToken();
    
    // Create the PayPal Order
    const res = await fetch(`${process.env.PAYPAL_API_BASE}/v2/checkout/orders`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        intent: "CAPTURE",
        purchase_units: [
          {
            reference_id: `${job.id}_${user!.userId}`,
            custom_id: `${job.id}_${user!.userId}`, 
            amount: {
              currency_code: "USD",
              value: job.application_fee.toFixed(2),
            },
            description: `Application Fee for ${job.title}`,
          },
        ],
      }),
    });
    
    const order = await res.json();
    
    if (!res.ok) {
      console.error("PayPal Create Order Error:", order);
      return NextResponse.json({ error: "Failed to initialize PayPal order." }, { status: 500 });
    }
    
    return NextResponse.json({ id: order.id });
  } catch (err) {
    console.error("PayPal Error:", err);
    return NextResponse.json({ error: "An unexpected error occurred with PayPal." }, { status: 500 });
  }
}
