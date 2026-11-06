"""The payment receipt's PDF (reads handover R7b): lib/invoice.ts's
createReceiptPdf, drawn with fpdf2 instead of pdf-lib, the same page and
lines in the same places.

pdf-lib measured from the page's foot and fpdf2 from its head, so each line
is placed at HEIGHT minus pdf-lib's y. The built-in Helvetica covers Latin-1
only: any other character is drawn as "?" rather than failing the receipt
(pdf-lib threw on it).
"""

from __future__ import annotations

from datetime import UTC, datetime

from fpdf import FPDF
from pydantic import BaseModel

WIDTH, HEIGHT = 600, 800
START, LINE = HEIGHT - 160, 30
TABLE = START - LINE * 7


def _latin1(text: str) -> str:
    return text.encode("latin-1", "replace").decode("latin-1")


def _when(iso: str) -> str:
    """The payment's time as JavaScript's en-US toLocaleString() wrote it, in UTC."""
    at = datetime.fromisoformat(iso.replace("Z", "+00:00")).astimezone(UTC)
    hour = at.hour % 12 or 12
    return f"{at.month}/{at.day}/{at.year}, {hour}:{at:%M:%S} {'AM' if at.hour < 12 else 'PM'} UTC"


def receipt_pdf(n: BaseModel) -> bytes:
    """The receipt for a PaymentReceiptEmail notice."""
    from app.services.emails import fixed2  # emails imports this module

    pdf = FPDF(unit="pt", format=(WIDTH, HEIGHT))
    pdf.set_auto_page_break(False)
    pdf.add_page()

    def text(x: float, y: float, value: str, size: int, *, bold: bool = False, color: tuple[int, int, int] = (0, 0, 0)) -> None:
        pdf.set_font("helvetica", "B" if bold else "", size)
        pdf.set_text_color(*color)
        pdf.text(x, HEIGHT - y, _latin1(value))

    amount = f"${fixed2(n.amount)} USD"
    text(50, HEIGHT - 80, "Vertex International Recruitment", 24, bold=True, color=(26, 26, 128))
    text(50, HEIGHT - 110, "Payment Receipt", 20, bold=True)

    text(50, START, f"Date: {_when(n.date)}", 12)
    text(50, START - LINE, f"Receipt ID: {n.payment_id}", 12)
    text(50, START - LINE * 2, f"Transaction ID: {n.transaction_id}", 12)

    text(50, START - LINE * 4, "Billed To:", 14, bold=True)
    text(50, START - LINE * 4.6, n.full_name, 12)
    text(50, START - LINE * 5.2, n.email, 12)

    pdf.set_fill_color(230, 230, 230)
    pdf.rect(50, HEIGHT - (TABLE - 5) - 25, 500, 25, style="F")
    text(60, TABLE, "Description", 12, bold=True)
    text(450, TABLE, "Amount", 12, bold=True)

    text(60, TABLE - 30, f"Application Processing Fee: {n.job_title}", 12)
    text(450, TABLE - 30, amount, 12)

    text(350, TABLE - 80, "Total Paid:", 14, bold=True)
    text(450, TABLE - 80, amount, 14, bold=True, color=(0, 128, 0))

    text(50, 100, "Thank you for your payment.", 12, color=(102, 102, 102))
    return bytes(pdf.output())
