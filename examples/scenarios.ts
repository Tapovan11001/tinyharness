// Playground scenarios. Each has a prompt and a scripted model so the run can be
// replayed without an API key. The tools in each replay still execute for real.
import { lastToolResults, type Limits, type ScriptStep } from "../src/index.ts";

export const SYSTEM = `You are a careful assistant with a few tools. Use the calculator for any arithmetic instead of doing it in your head. When a tool fails, say so plainly and work around it. Keep answers short.`;

export interface Scenario {
  id: string;
  title: string;
  shows: string;
  prompt: string;
  limits?: Partial<Limits>;
  script: ScriptStep[];
}

export const scenarios: Scenario[] = [
  {
    id: "split",
    title: "Split a trip bill",
    shows: "Multi-step tool use with structured input",
    prompt: "Goa trip cost us ₹18,400 in total. Riya paid ₹9,000, Kabir paid ₹6,400, Dev paid ₹3,000 and Arjun paid nothing. We're splitting it equally. Who pays whom?",
    script: [
      { text: "I'll work out the settlement from what each person paid.", tools: [{ name: "settle_debts", input: { payments: [{ name: "Riya", paid: 9000 }, { name: "Kabir", paid: 6400 }, { name: "Dev", paid: 3000 }, { name: "Arjun", paid: 0 }] } }] },
      (req) => {
        const r = JSON.parse(lastToolResults(req)[0]);
        const lines = r.transfers.map((t: any) => `- ${t.from} pays ${t.to} ₹${t.amount.toLocaleString("en-IN")}`).join("\n");
        return { text: `Each person's share is ₹${r.share.toLocaleString("en-IN")}.\n\n${lines}\n\nThat settles everyone in ${r.transfers.length} transfers.` };
      },
    ],
  },
  {
    id: "parallel",
    title: "Compare prices abroad",
    shows: "Parallel tool calls answered in one message",
    prompt: "A hoodie costs $49 in the US, €45 in Germany and AED 189 in Dubai. Which is cheapest in rupees?",
    script: [
      {
        text: "Converting all three at once.",
        tools: [
          { name: "convert_currency", input: { amount: 49, from: "USD", to: "INR" } },
          { name: "convert_currency", input: { amount: 45, from: "EUR", to: "INR" } },
          { name: "convert_currency", input: { amount: 189, from: "AED", to: "INR" } },
        ],
      },
      (req) => {
        const [us, de, ae] = lastToolResults(req).map((s) => JSON.parse(s).amount as number);
        const rows = [["US", us], ["Germany", de], ["Dubai", ae]] as const;
        const best = [...rows].sort((a, b) => a[1] - b[1])[0];
        return { text: rows.map(([k, v]) => `- ${k}: ₹${v.toLocaleString("en-IN")}`).join("\n") + `\n\n${best[0]} is cheapest. (Fixed reference rates, not live.)` };
      },
    ],
  },
  {
    id: "recover",
    title: "Recover from bad input",
    shows: "Schema validation errors go back to the model, which fixes its call",
    prompt: "What's 18% GST on ₹2,340, and the total?",
    script: [
      { tools: [{ name: "calculator", input: { expr: "2340 * 0.18" } }] },
      { text: "Wrong field name, retrying.", tools: [{ name: "calculator", input: { expression: "2340 * 0.18" } }] },
      (req) => ({ tools: [{ name: "calculator", input: { expression: `2340 + ${lastToolResults(req)[0]}` } }] }),
      (req) => ({ text: `GST at 18% is ₹421.20. Total is ₹${Number(lastToolResults(req)[0]).toLocaleString("en-IN", { minimumFractionDigits: 2 })}.` }),
    ],
  },
  {
    id: "approval",
    title: "Ask before acting",
    shows: "Human approval gate on a risky tool",
    prompt: "Tell Kabir he owes Riya ₹1,750 for the Goa trip.",
    script: [
      { text: "I'll send Kabir a short message.", tools: [{ name: "send_message", input: { to: "Kabir", text: "Hey Kabir, for the Goa trip you owe Riya ₹1,750. Thanks!" } }] },
      (req) => {
        const r = lastToolResults(req)[0];
        return { text: r.includes("declined") ? "Okay, I didn't send it. Here's the text if you want to send it yourself:\n\n\"Hey Kabir, for the Goa trip you owe Riya ₹1,750. Thanks!\"" : "Sent to Kabir." };
      },
    ],
  },
  {
    id: "flaky",
    title: "A tool that's down",
    shows: "Tool exceptions become error results; repeat guard stops retry loops",
    prompt: "Is flight 6E-2134 on time?",
    limits: { maxRepeats: 2 },
    script: [
      { tools: [{ name: "lookup_flight", input: { code: "6E-2134" } }] },
      { text: "That failed, trying again.", tools: [{ name: "lookup_flight", input: { code: "6E-2134" } }] },
      { text: "Still failing, one more try.", tools: [{ name: "lookup_flight", input: { code: "6E-2134" } }] },
      { text: "The flight status service is down right now (it returned a 503 twice), so I can't check 6E-2134. The IndiGo app or the airport's departures page will have the live status." },
    ],
  },
  {
    id: "runaway",
    title: "Runaway agent",
    shows: "Step budget stops a model that never finishes",
    prompt: "Keep adding 1 until you reach a million.",
    limits: { maxSteps: 5 },
    script: [
      (req) => {
        const prev = Number(lastToolResults(req)[0] ?? "0");
        return { tools: [{ name: "calculator", input: { expression: `${prev} + 1` } }] };
      },
    ],
  },
];
