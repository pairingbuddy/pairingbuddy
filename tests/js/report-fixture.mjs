// Shared by the report tests: builds the inputs of the HTML report from a recorded run, and pulls sections out of the rendered text.
import { STAGE_STOP_REASONS } from "../../shared-node/stop-codes.mjs";
import { recording, ledgerAtSeq, TDD_ACTIVE_SEQ } from "./glance-fixture.mjs";

const STOP_CODE = "step-failed";

// The stop a real run records: a real code with its real reason text, at the seq where the trimmed ledger ends.
export const RECORDED_STOP = { reason: STAGE_STOP_REASONS[STOP_CODE], seq: TDD_ACTIVE_SEQ, code: STOP_CODE };

const OUTCOMES = ["running", "stopped", "done"];

// The recorded run (probe-2 stopped while code-tdd was still active) in the given outcome. Returns { ledger, spawns, timing }.
export async function recordedReportInput(run, { outcome }) {
  if (!OUTCOMES.includes(outcome)) throw new Error(`outcome must be one of ${OUTCOMES.join(", ")}, got ${outcome}`);
  const ledger = await ledgerAtSeq(run, TDD_ACTIVE_SEQ);
  const byOutcome = {
    running: ledger,
    stopped: { ...ledger, stop: RECORDED_STOP },
    done: { ...ledger, stage: { ...ledger.stage, status: "done" } },
  };
  return { ledger: byOutcome[outcome], spawns: await recording(run, "spawns"), timing: await recording(run, "timing") };
}

// The <header>...</header> section of a rendered report, so header assertions cannot pass on text from the body.
export function headerOf(html) {
  const match = html.match(/<header[\s\S]*?<\/header>/);
  if (!match) throw new Error("the report has no <header> section");
  return match[0];
}

// The <section> that holds the given heading, so assertions cannot pass on text from the header or another section.
export function sectionOf(html, heading) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = html.match(new RegExp(`<section[^>]*>\\s*<h2[^>]*>${escaped}</h2>[\\s\\S]*?</section>`));
  if (!match) throw new Error(`the report has no ${heading} section`);
  return match[0];
}

// The test cards of the TESTS section: one <article> per test, each returned as the text from its opening tag on.
export const cardsOf = (html) => sectionOf(html, "TESTS").split("<article").slice(1);

// The rows of a card as arrays of trimmed cell text (header rows have no <td> and are dropped).
export const rowsOf = (card) =>
  [...card.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)]
    .map(([, row]) => [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(([, cell]) => cell.trim()))
    .filter((cells) => cells.length > 0);

// The "Why it looped" note of a card (the <p> that starts with that label), so assertions cannot pass on text from the try rows.
export function noteOf(card) {
  const match = card.match(/<p><strong>Why it looped<\/strong>[\s\S]*?<\/p>/);
  if (!match) throw new Error("the card has no 'Why it looped' note");
  return match[0];
}
