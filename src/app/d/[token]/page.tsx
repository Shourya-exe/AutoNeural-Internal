import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { company, documentByToken, paymentsFor, totals, upiLink } from "@/lib/sales";
import { PrintButton } from "./print-button";

export const dynamic = "force-dynamic";

const inr = (n: number) => `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const date = (d: string) => new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

/** Public quotation / invoice page, opened from the emailed link (the token is the credential). */
export default async function DocumentPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ accepted?: string }> }) {
  const { token } = await params;
  const { accepted } = await searchParams;
  const d = documentByToken(token);
  if (!d || d.status === "Cancelled") notFound();
  const c = company();
  const t = totals(d.items, d.customer.state, c.state);
  const due = Math.max(0, Math.round((d.total - d.paid) * 100) / 100);
  const upi = d.kind === "invoice" && due > 0 ? upiLink(d) : null;
  const qr = upi ? await QRCode.toDataURL(upi, { margin: 1, width: 180 }) : null;
  const paid = paymentsFor(d.id);
  const title = d.kind === "quote" ? "Quotation" : "Tax Invoice";
  return (
    <main className="doc-page">
      <div className="doc-actions">
        <PrintButton />
      </div>
      <article className="doc-sheet">
        <header className="doc-head">
          <div>
            <h1>{c.name}</h1>
            <p>{c.address}</p>
            {c.gstin && <p>GSTIN: {c.gstin}</p>}
            <p>{[c.phone, c.email].filter(Boolean).join(" · ")}</p>
          </div>
          <div className="doc-meta">
            <h2>{title}</h2>
            <p><strong>{d.number}</strong></p>
            <p>Date: {date(d.issueDate)}</p>
            {d.dueDate && <p>{d.kind === "quote" ? "Valid until" : "Due"}: {date(d.dueDate)}</p>}
            <p className={`doc-status s-${d.status.replace(/\s/g, "-").toLowerCase()}`}>{d.status}</p>
          </div>
        </header>
        <section className="doc-to">
          <small>Bill to</small>
          <strong>{d.customer.name}</strong>
          {d.customer.company && <span>{d.customer.company}</span>}
          {d.customer.address && <span>{d.customer.address}</span>}
          {d.customer.gstin && <span>GSTIN: {d.customer.gstin}</span>}
          {d.customer.state && <span>State: {d.customer.state}</span>}
        </section>
        <table className="doc-items">
          <thead>
            <tr><th>#</th><th>Description</th><th>HSN/SAC</th><th>Qty</th><th>Rate</th><th>GST</th><th>Amount</th></tr>
          </thead>
          <tbody>
            {d.items.map((i, n) => (
              <tr key={n}>
                <td>{n + 1}</td><td>{i.description}</td><td>{i.hsn}</td><td>{i.qty}</td><td>{inr(i.rate)}</td><td>{i.gst}%</td><td>{inr(i.qty * i.rate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="doc-bottom">
          <div className="doc-notes">
            {d.notes && <p>{d.notes}</p>}
            {c.bank && <p><strong>Bank:</strong> {c.bank}</p>}
            {c.terms && <p className="doc-terms">{c.terms}</p>}
          </div>
          <dl className="doc-totals">
            <dt>Subtotal</dt><dd>{inr(t.subtotal)}</dd>
            {t.igst ? (<><dt>IGST</dt><dd>{inr(t.igst)}</dd></>) : (<><dt>CGST</dt><dd>{inr(t.cgst)}</dd><dt>SGST</dt><dd>{inr(t.sgst)}</dd></>)}
            <dt className="grand">Total</dt><dd className="grand">{inr(d.total)}</dd>
            {d.paid > 0 && (<><dt>Paid</dt><dd>{inr(d.paid)}</dd><dt>Balance due</dt><dd>{inr(due)}</dd></>)}
          </dl>
        </div>
        {paid.length > 0 && (
          <p className="doc-paid">Payments received: {paid.map((p) => `${inr(p.amount)} via ${p.method} on ${date(p.paidAt)}`).join("; ")}</p>
        )}
      </article>

      {d.kind === "quote" && !["Accepted", "Rejected"].includes(d.status) && (
        <form className="doc-pay" method="post" action={`/d/${token}/accept`}>
          <p>Happy with this quotation?</p>
          <button className="button primary">Accept quotation</button>
        </form>
      )}
      {d.kind === "quote" && (accepted || d.status === "Accepted") && <p className="doc-pay">Thank you. {c.name} has been notified and will send the invoice.</p>}

      {d.kind === "invoice" && due > 0 && (
        <section className="doc-pay">
          <h3>Pay {inr(due)}</h3>
          <div className="doc-pay-row">
            {qr && (
              <div className="doc-upi">
                <img src={qr} alt={`UPI QR code to pay ${inr(due)}`} width={180} height={180} />
                <a className="button" href={upi!}>Pay with any UPI app</a>
                <small>{c.upiId}</small>
              </div>
            )}
            <div className="doc-gateways">
              {d.paymentLinks?.razorpay && <a className="button primary" href={d.paymentLinks.razorpay.url}>Pay online (cards, UPI, netbanking)</a>}
              {d.paymentLinks?.stripe && <a className="button" href={d.paymentLinks.stripe.url}>Pay by card (Stripe)</a>}
              {!qr && !d.paymentLinks?.razorpay && !d.paymentLinks?.stripe && <p>Please pay by bank transfer using the details above and quote {d.number}.</p>}
            </div>
          </div>
        </section>
      )}
    </main>
  );
}
