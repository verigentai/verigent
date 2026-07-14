// functions/lib/tx-export.ts — wallet-transaction export shaping (POST-LAUNCH #15).
// Pure so the CSV rules are unit-testable: the data is financial (tax/reconciliation), so a
// mis-escaped description silently corrupting a spreadsheet row is the failure to prevent.

export interface TxRow {
  id: number;
  created_at: string;
  type: string;
  agent_id: string | null;
  amount_cents: number;
  balance_after_cents: number | null;
  description: string | null;
  related_run_token: string | null;
}

export const TX_CSV_HEADER = [
  'id', 'created_at', 'type', 'agent_id', 'amount_usd', 'balance_after_usd', 'description', 'related_run_token',
] as const;

// RFC-4180 field escape: quote when the value carries a comma, quote, or newline; double quotes.
export function csvField(v: unknown): string {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const usd = (cents: number | null) => cents == null ? '' : (cents / 100).toFixed(2);

export function transactionsToCsv(rows: TxRow[]): string {
  const lines = [TX_CSV_HEADER.join(',')];
  for (const r of rows) {
    lines.push([
      csvField(r.id),
      csvField(r.created_at),
      csvField(r.type),
      csvField(r.agent_id),
      csvField(usd(r.amount_cents)),
      csvField(usd(r.balance_after_cents)),
      csvField(r.description),
      csvField(r.related_run_token),
    ].join(','));
  }
  return lines.join('\r\n') + '\r\n';
}
