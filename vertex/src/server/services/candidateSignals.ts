import { prisma } from "@/lib/prisma";

export interface CandidateAttentionSignals {
  pending_documents_count: number;
  message_count: number;
  awaiting_reply: boolean;
}

/**
 * "Is there something new here for staff to look at" (2026-07-31), shared
 * between the Partner Submissions queue and HR's Self Applications
 * queue — the only difference between the two is which role on the
 * other end of the message thread counts as "the ball is in our court"
 * (a partner vs. the candidate themselves).
 */
export async function getCandidateAttentionSignals(
  candidateId: string,
  externalSenderRole: string
): Promise<CandidateAttentionSignals> {
  const [pending_documents_count, message_count, lastMessage] = await Promise.all([
    prisma.document.count({ where: { candidate_id: candidateId, verification_status: "pending" } }),
    prisma.candidateMessage.count({ where: { candidate_id: candidateId } }),
    prisma.candidateMessage.findFirst({
      where: { candidate_id: candidateId },
      orderBy: { created_at: "desc" },
      select: { sender: { select: { role: true } } },
    }),
  ]);
  return { pending_documents_count, message_count, awaiting_reply: lastMessage?.sender.role === externalSenderRole };
}
