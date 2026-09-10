export async function getPayPalAccessToken() {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
  
  if (!clientId || !clientSecret) {
    throw new Error("PayPal credentials not configured.");
  }
  
  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  
  const res = await fetch(`${process.env.PAYPAL_API_BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error_description || "Failed to generate PayPal Auth Token");
  }
  
  return data.access_token;
}
