// Example tools used by the playground, the CLI example and the evals.
// They are real code: in demo mode only the *model* is scripted, the tools run for real.
import { defineTool } from "../src/index.ts";

export const calculator = defineTool<{ expression: string }>({
  name: "calculator",
  description: "Evaluate an arithmetic expression. Supports + - * / ( ) and decimals. Example: (18400 / 4) - 3000",
  input: { type: "object", properties: { expression: { type: "string" } }, required: ["expression"] },
  run: ({ expression }) => {
    if (!/^[\d\s+\-*/().]+$/.test(expression)) throw new Error("Only numbers and + - * / ( ) are allowed");
    const value = evaluate(expression);
    if (!Number.isFinite(value)) throw new Error("Result is not a finite number");
    return String(Math.round(value * 100) / 100);
  },
});

export const settleDebts = defineTool<{ payments: { name: string; paid: number }[] }>({
  name: "settle_debts",
  description:
    "Given what each person paid toward a shared expense (split equally), return the fewest transfers that settle everyone up.",
  input: {
    type: "object",
    properties: {
      payments: {
        type: "array",
        items: {
          type: "object",
          properties: { name: { type: "string" }, paid: { type: "number", minimum: 0 } },
          required: ["name", "paid"],
        },
      },
    },
    required: ["payments"],
  },
  run: ({ payments }) => {
    if (payments.length < 2) throw new Error("Need at least two people");
    const total = payments.reduce((s, p) => s + p.paid, 0);
    const share = total / payments.length;
    const bal = payments.map((p) => ({ name: p.name, bal: Math.round((p.paid - share) * 100) / 100 }));
    const owe = bal.filter((b) => b.bal < 0).sort((a, b) => a.bal - b.bal);
    const get = bal.filter((b) => b.bal > 0).sort((a, b) => b.bal - a.bal);
    const transfers: { from: string; to: string; amount: number }[] = [];
    let i = 0, j = 0;
    while (i < owe.length && j < get.length) {
      const amt = Math.min(-owe[i].bal, get[j].bal);
      transfers.push({ from: owe[i].name, to: get[j].name, amount: Math.round(amt * 100) / 100 });
      owe[i].bal += amt;
      get[j].bal -= amt;
      if (Math.abs(owe[i].bal) < 0.01) i++;
      if (Math.abs(get[j].bal) < 0.01) j++;
    }
    return { total, share: Math.round(share * 100) / 100, transfers };
  },
});

// Fixed reference rates so demo output is reproducible. Not live market data.
const INR_PER: Record<string, number> = { INR: 1, USD: 84.5, EUR: 89.2, GBP: 106.8, AED: 23.0, SGD: 63.1 };

export const convertCurrency = defineTool<{ amount: number; from: string; to: string }>({
  name: "convert_currency",
  description: `Convert money between ${Object.keys(INR_PER).join(", ")} using fixed reference rates (not live).`,
  input: {
    type: "object",
    properties: {
      amount: { type: "number" },
      from: { type: "string", enum: Object.keys(INR_PER) },
      to: { type: "string", enum: Object.keys(INR_PER) },
    },
    required: ["amount", "from", "to"],
  },
  run: ({ amount, from, to }) => {
    const out = (amount * INR_PER[from]) / INR_PER[to];
    return { amount: Math.round(out * 100) / 100, currency: to, note: "fixed reference rate" };
  },
});

export const sendMessage = defineTool<{ to: string; text: string }>({
  name: "send_message",
  description: "Send a message to a person. Requires the user's approval before it runs.",
  needsApproval: true,
  input: {
    type: "object",
    properties: { to: { type: "string" }, text: { type: "string" } },
    required: ["to", "text"],
  },
  run: ({ to }) => ({ delivered: true, to, note: "playground: nothing is actually sent" }),
});

export const lookupFlight = defineTool<{ code: string }>({
  name: "lookup_flight",
  description: "Look up the status of a flight by code. (Playground stub: this service is always down.)",
  input: { type: "object", properties: { code: { type: "string" } }, required: ["code"] },
  run: () => {
    throw new Error("503 from flight status service");
  },
});

export const allTools = [calculator, settleDebts, convertCurrency, sendMessage, lookupFlight];

/** Tiny recursive-descent parser so we never call eval(). */
function evaluate(src: string): number {
  let pos = 0;
  const peek = () => src[pos];
  const skip = () => { while (src[pos] === " ") pos++; };
  const num = (): number => {
    skip();
    if (peek() === "(") { pos++; const v = expr(); skip(); if (src[pos++] !== ")") throw new Error("Missing )"); return v; }
    if (peek() === "-") { pos++; return -num(); }
    const m = /^\d+(\.\d+)?/.exec(src.slice(pos));
    if (!m) throw new Error(`Unexpected "${peek() ?? "end"}" at ${pos}`);
    pos += m[0].length;
    return parseFloat(m[0]);
  };
  const term = (): number => {
    let v = num();
    for (skip(); peek() === "*" || peek() === "/"; skip()) { const op = src[pos++]; const r = num(); v = op === "*" ? v * r : v / r; }
    return v;
  };
  const expr = (): number => {
    let v = term();
    for (skip(); peek() === "+" || peek() === "-"; skip()) { const op = src[pos++]; const r = term(); v = op === "+" ? v + r : v - r; }
    return v;
  };
  const v = expr();
  skip();
  if (pos < src.length) throw new Error(`Unexpected "${src[pos]}" at ${pos}`);
  return v;
}
