/**
 * A deterministic OpenAI-compatible chat-completions server for parity runs.
 *
 * It answers with canned findings that exercise every anchor outcome (exact,
 * repaired, conflict, failed), the ambiguous-quote rule, the unknown-severity
 * fallback, `example` trimming, and the malformed-JSON retry. Pointing both
 * implementations at it makes their outputs comparable record for record.
 *
 * Run: `npx tsx scripts/parity/fake-llm-server.ts` (listens on 48333).
 */

import { appendFileSync } from "node:fs";
import { createServer } from "node:http";

interface ChatMessage {
  readonly role: string;
  readonly content: string | readonly { readonly text?: string }[];
}

interface Finding {
  readonly line?: number;
  readonly severity: string;
  readonly body: string;
  readonly existing_code: string | null;
  readonly example?: string | null;
}

const PORT = Number(process.env["PARITY_LLM_PORT"] ?? 48_333);

/** Message content as one string, whichever shape the client sent. */
function textOf(content: ChatMessage["content"]): string {
  return typeof content === "string" ? content : content.map((part) => part.text ?? "").join("");
}

/** The per-file prompt, recognised by its first line. */
function filePrompt(messages: readonly ChatMessage[]): string {
  return messages.map((m) => textOf(m.content)).find((t) => t.startsWith("File: ")) ?? "";
}

const ROUTE_FINDINGS: readonly Finding[] = [
  {
    line: 3,
    severity: "bug",
    body: "Unbounded query.",
    existing_code: "const rows = await repo.find();",
  },
  { line: 2, severity: "performance", body: "Repaired from quote.", existing_code: "return rows;" },
  { line: 4, severity: "security", body: "Quote points elsewhere.", existing_code: "return rows;" },
  {
    line: 99,
    severity: "readability",
    body: "Nowhere to land.",
    existing_code: "nothing like this",
  },
  {
    line: 4,
    severity: "bug",
    body: "Ambiguous quote keeps the line.",
    existing_code: "check(value);",
  },
  {
    line: 5,
    severity: "weird",
    body: "Unknown severity falls back.",
    existing_code: "other();",
    example: "  fix();  ",
  },
];

const MODEL_FINDINGS: readonly Finding[] = [
  { line: 3, severity: "bug", body: "Decrement quoted with marker.", existing_code: "+--count;" },
  {
    severity: "security",
    body: "Missing line, multi-line quote.",
    existing_code: "const total = items.reduce((s, i) => s + i.price, 0);\nconst count = 5;",
  },
];

const README_FINDINGS: readonly Finding[] = [
  {
    line: 2,
    severity: "readability",
    body: "Readme finding.",
    existing_code: "new line in readme",
  },
];

const DEFAULT_FINDINGS: readonly Finding[] = [
  { line: 1, severity: "bug", body: "  Padded body  ", existing_code: null, example: null },
];

/** Canned findings by file suffix; the first matching suffix wins. */
const FINDINGS_BY_SUFFIX: readonly (readonly [suffix: string, findings: readonly Finding[]])[] = [
  ["route.ts", ROUTE_FINDINGS],
  ["m.ts", MODEL_FINDINGS],
  ["README.md", README_FINDINGS],
];

function findingsFor(file: string): readonly Finding[] {
  const match = FINDINGS_BY_SUFFIX.find(([suffix]) => file.endsWith(suffix));
  return match === undefined ? DEFAULT_FINDINGS : match[1];
}

const MALFORMED_ANSWER = '{"findings": [{"line": 1 "severity": "bug"}]}';

/** The assistant text: fenced JSON, except a first malformed answer for `new.py`. */
function answer(messages: readonly ChatMessage[]): string {
  // The system prompt is recorded so a run can prove which policy reached the model.
  if (process.env["PARITY_USER_LOG"] !== undefined) {
    appendFileSync(process.env["PARITY_USER_LOG"], `${filePrompt(messages)}\n---\n`);
  }
  if (process.env["PARITY_SYSTEM_LOG"] !== undefined) {
    const system = messages.find((m) => m.role === "system");
    if (system !== undefined) {
      appendFileSync(process.env["PARITY_SYSTEM_LOG"], `${textOf(system.content)}\n---\n`);
    }
  }
  const file = /^File: (.*)$/mu.exec(filePrompt(messages))?.[1] ?? "";
  const isFirstAttempt = messages.length !== 3;
  const isMalformedTurn = isFirstAttempt && file.endsWith("new.py");
  const fenced = `\`\`\`json\n${JSON.stringify({ findings: findingsFor(file) })}\n\`\`\``;
  return isMalformedTurn ? MALFORMED_ANSWER : fenced;
}

function parseMessages(body: string): ChatMessage[] | null {
  try {
    const parsed = JSON.parse(body) as { messages?: ChatMessage[] };
    return Array.isArray(parsed.messages) ? parsed.messages : null;
  } catch {
    return null;
  }
}

const server = createServer((request, response) => {
  let body = "";
  request.on("data", (chunk: Buffer) => {
    body += chunk.toString();
  });
  request.on("end", () => {
    const messages = parseMessages(body);
    response.setHeader("content-type", "application/json");
    if (messages === null) {
      response.statusCode = 400;
      response.end(JSON.stringify({ error: { message: "request body is not a chat completion" } }));
      return;
    }
    response.end(
      JSON.stringify({
        id: "parity",
        object: "chat.completion",
        created: 0,
        model: "fake",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: answer(messages) },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
    );
  });
});

server.listen(PORT, () => {
  process.stderr.write(`parity llm on ${PORT}\n`);
});
