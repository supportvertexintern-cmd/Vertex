import { google } from "@ai-sdk/google";
import { generateText } from "ai";
import { prisma } from "@/lib/prisma";

export const maxDuration = 30;
export const dynamic = "force-dynamic";

// Hardcoded knowledge base as fallback when DB is unavailable
const FALLBACK_KB = `
Vertex International Recruitment Ltd. is a UK-incorporated, globally integrated human capital and mobility
enterprise. We connect talented professionals, employers, agencies, and institutional partners through
ethical recruitment, compliant mobility solutions, and dedicated end-to-end support — from sourcing to
settlement.

WORKFORCE CATEGORIES:
- Unskilled and General Workforce: agriculture, logistics, facilities management, manufacturing, food
  processing, construction support, large-scale infrastructure support
- Semi-Skilled and Vocational Trades: plumbers, electricians, welders, machinery operators, hospitality
  professionals, and other practical trade roles
- Technical and Engineering Professionals: civil, mechanical, electrical, petroleum, project supervision,
  and EPC-related technical talent

WHAT WE DO:
- Global Recruitment Services: sourcing, screening, and coordinating candidates across industries
- Work Visa & Employment Support: work permit, employment visa, and overseas employment processing
- Business Invitation Assistance: official business invitation and corporate travel support
- Agency Support & Expansion: helping recruitment agencies, travel agencies, visa consultancies, and
  manpower suppliers expand into international recruitment and mobility services

ELIGIBILITY & DOCUMENTATION:
- Valid passport required
- CV, educational records, and professional credentials
- Experience certificates where applicable
- Police clearance and medical checks required
- Unskilled roles: high school diploma
- Semi-skilled roles: trade certificate
- Technical/engineering roles: degree or diploma required

GLOBAL PRESENCE:
- European Command — London, United Kingdom (global headquarters)
- Middle East & Gulf Operations — UAE Strategic Hub
- Africa Regional Directorate — multi-city presence
- Network reach spans Europe, Canada, Australia, UAE, South Korea, New Zealand, USA, and other destinations

COMPLIANCE:
- Governed by UK corporate governance standards
- Quality Management aligned with ISO 9001:2015
- Anti-human trafficking, modern slavery safeguards, and ethical recruitment principles
- No hidden fees, no opaque processes

CONTACT:
- WhatsApp: +44 7438 613251
- Office: +44 20 3026 3403
- Email: vertex@vertexintern.com (general), inquiries@vertexintern.com, support@vertexintern.com
- Address: 5 Brayford Square, London, E1 0SG, United Kingdom / Chester, International House, Kingsfield Court, United Kingdom
- Company Registration Number: 16943308
`;

export async function POST(req: Request) {
  try {
    const { messages } = await req.json();

    // 1. Check if AI is enabled (fail open if DB unavailable)
    let aiEnabled: any = null;
    try {
      aiEnabled = await prisma.systemSetting.findUnique({ where: { key: "ai_enabled" } });
    } catch {
      // DB unavailable — default to enabled
    }

    if (aiEnabled && aiEnabled.value === "false") {
      return Response.json({ error: "AI Assistant is currently offline." }, { status: 403 });
    }

    // 2. Fetch Knowledge Base (fallback to hardcoded if DB unavailable)
    let kbText = "";
    try {
      const knowledgeItems = await prisma.knowledgeArticle.findMany({
        select: { title: true, content: true },
      });
      if (knowledgeItems && (knowledgeItems as any[]).length > 0) {
        kbText = (knowledgeItems as any[])
          .map((k: any) => `--- ${k.title} ---\n${k.content}`)
          .join("\n\n");
      }
    } catch {
      // DB unavailable — use hardcoded knowledge base
    }

    const systemPrompt = `You are the official AI Assistant for Vertex International Recruitment Ltd.
Answer user questions about jobs, the application process, visas, and documentation professionally and concisely.

Rules:
- Be polite, professional, and concise.
- Use the Knowledge Base below for specific process questions.
- Never invent information not in the Knowledge Base.
- If unsure, direct users to WhatsApp +44 7438 613251 or email vertex@vertexintern.com.
- Do NOT screen CVs or make hiring decisions.

--- VERTEX KNOWLEDGE BASE ---
${kbText || FALLBACK_KB}`;

    // 3. Generate response using Google Gemini
    const { text } = await generateText({
      model: google("gemini-2.5-flash"),
      system: systemPrompt,
      messages,
    });

    return Response.json({ text });
  } catch (error) {
    console.error("Chat API Error:", error);
    return Response.json(
      { error: "An error occurred while processing your request." },
      { status: 500 }
    );
  }
}
