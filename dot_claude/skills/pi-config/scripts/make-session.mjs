// make-session.mjs <out.jsonl> <project-cwd> : writes a fake Pi session that exercises the main transcript elements
// (user text, thinking, markdown with a table and code, read/bash/edit/write calls, a failing call). Edit diffs come
// from Pi's own exported helpers, so the edit renderer receives the details a real edit produces. Its messages name
// the default model of ~/.pi/agent/settings.json, so Pi restores it without a warning, as in a real session.
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const [outPath, cwd] = process.argv.slice(2);
if (!outPath || !cwd) {
	console.error("usage: node make-session.mjs <out.jsonl> <project-cwd>");
	process.exit(2);
}

// The managed install keeps one release per version; current-version names the one `pi` runs (see ~/.pi/agent/bin/pi).
const install = join(homedir(), ".pi/agent/install");
let pkg;
try {
	const version = readFileSync(join(install, "current-version"), "utf8").trim();
	pkg = join(install, "releases", version, "node_modules/@earendil-works/pi-coding-agent/dist/index.js");
} catch (error) {
	console.error(`make-session: no managed Pi install in ${install} (${error.message}); install Pi or fix the path.`);
	process.exit(1);
}
const { generateDiffString, generateUnifiedPatch } = await import(pkg);

const settingsPath = join(homedir(), ".pi/agent/settings.json");
let model;
try {
	const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
	model = { provider: settings.defaultProvider, id: settings.defaultModel };
} catch (error) {
	console.error(`make-session: cannot read ${settingsPath} (${error.message}).`);
	process.exit(1);
}
if (!model.provider || !model.id) {
	console.error(`make-session: ${settingsPath} needs defaultProvider and defaultModel; choose them with /model in Pi.`);
	process.exit(1);
}

// A fixed start time, so every run writes the same session apart from its id.
const start = Date.parse("2026-01-05T09:00:00.000Z");
let clock = start;
let parentId = null;
let idCounter = 0;
const entries = [];

const nextId = () => (0x10000000 + ++idCounter).toString(16);
const tick = (ms = 1500) => (clock += ms);

function push(entry) {
	const id = nextId();
	entries.push({ ...entry, id, parentId, timestamp: new Date(clock).toISOString() });
	parentId = id;
	return id;
}

const usage = (input, output) => ({
	input,
	output,
	cacheRead: 9000,
	cacheWrite: 400,
	totalTokens: input + output + 9400,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
});

function user(text) {
	tick(4000);
	push({ type: "message", message: { role: "user", content: [{ type: "text", text }], timestamp: clock } });
}

let callCounter = 0;
function assistant(blocks, stopReason = "toolUse") {
	tick(2500);
	const content = blocks.map((b) =>
		b.toolCall ? { type: "toolCall", id: `call_${++callCounter}`, name: b.toolCall, arguments: b.args } : b,
	);
	push({
		type: "message",
		message: {
			role: "assistant",
			content,
			api: "openai-completions",
			provider: model.provider,
			model: model.id,
			usage: usage(1200, 380),
			stopReason,
			thinkingLevel: "high",
			durationMs: 2400,
			timestamp: clock,
		},
	});
	return content.filter((b) => b.type === "toolCall");
}

function result(call, text, { isError = false, details } = {}) {
	tick(700);
	push({
		type: "message",
		message: {
			role: "toolResult",
			toolCallId: call.id,
			toolName: call.name,
			content: [{ type: "text", text }],
			...(details ? { details } : {}),
			isError,
			timestamp: clock,
		},
	});
}

function editDetails(path, before, after) {
	const { diff, firstChangedLine } = generateDiffString(before, after);
	return { diff, patch: generateUnifiedPatch(path, before, after), firstChangedLine };
}

// --- Session header and model ---
entries.push({
	type: "session",
	version: 3,
	id: randomUUID(),
	timestamp: new Date(start).toISOString(),
	cwd,
});
push({ type: "model_change", provider: model.provider, modelId: model.id });

// --- Conversation ---
const signupBefore = `import { createUser } from "./db";

export async function signup(req: Request) {
  const { email, password } = await req.json();
  const user = await createUser(email, password);
  return Response.json({ id: user.id }, { status: 201 });
}
`;
const signupAfter = `import { createUser } from "./db";
import { validateSignup } from "./validation";

export async function signup(req: Request) {
  const body = await req.json();
  const errors = validateSignup(body);
  if (errors.length > 0) {
    return Response.json({ errors }, { status: 422 });
  }
  const user = await createUser(body.email, body.password);
  return Response.json({ id: user.id }, { status: 201 });
}
`;
const validationTs = `export interface SignupInput {
  email?: unknown;
  password?: unknown;
}

const EMAIL = /^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/;

export function validateSignup(input: SignupInput): string[] {
  const errors: string[] = [];
  if (typeof input.email !== "string" || !EMAIL.test(input.email)) {
    errors.push("email must be a valid address");
  }
  if (typeof input.password !== "string" || input.password.length < 12) {
    errors.push("password must be at least 12 characters");
  }
  return errors;
}
`;

user("Add input validation to the signup handler, then run the tests.");

let [c] = assistant([
	{
		type: "thinking",
		thinking:
			"The user wants validation on signup. I should read the handler first, then check whether a validation helper already exists before writing a new one.",
	},
	{ type: "text", text: "Let me look at the current handler first." },
	{ toolCall: "read", args: { path: "src/signup.ts" } },
]);
result(c, signupBefore);

[c] = assistant([{ toolCall: "bash", args: { command: "rg -n 'validat' src || echo 'no matches'" } }]);
result(c, "no matches\n");

[c] = assistant([
	{ type: "text", text: "No helper exists yet. I'll add a small `validateSignup` module and wire it in." },
	{ toolCall: "write", args: { path: "src/validation.ts", content: validationTs } },
]);
result(c, `Successfully wrote ${Buffer.byteLength(validationTs)} bytes to src/validation.ts`);

[c] = assistant([
	{
		toolCall: "edit",
		args: {
			path: "src/signup.ts",
			edits: [
				{
					oldText: 'import { createUser } from "./db";\n',
					newText: 'import { createUser } from "./db";\nimport { validateSignup } from "./validation";\n',
				},
				{
					oldText:
						"  const { email, password } = await req.json();\n  const user = await createUser(email, password);\n",
					newText:
						"  const body = await req.json();\n  const errors = validateSignup(body);\n  if (errors.length > 0) {\n    return Response.json({ errors }, { status: 422 });\n  }\n  const user = await createUser(body.email, body.password);\n",
				},
			],
		},
	},
]);
result(c, "Successfully replaced 2 block(s) in src/signup.ts.", {
	details: editDetails("src/signup.ts", signupBefore, signupAfter),
});

[c] = assistant([{ toolCall: "bash", args: { command: "npm test" } }]);
result(
	c,
	`> app@1.0.0 test
> vitest run

 ✓ src/db.test.ts (3 tests) 12ms
 ✗ src/signup.test.ts (4 tests | 1 failed) 31ms
   ✗ signup > accepts a valid signup
     AssertionError: expected 422 to be 201

 Test Files  1 failed | 1 passed (2)
      Tests  1 failed | 6 passed (7)

Command exited with code 1`,
	{ isError: true },
);

[c] = assistant([
	{
		type: "thinking",
		thinking:
			"The valid-signup test now gets 422, so its fixture must break one of the new rules. Let me look at the body it posts.",
	},
	{ toolCall: "bash", args: { command: "rg -n 'valid signup' -A3 src/signup.test.ts" } },
]);
result(
	c,
	`8:  it("accepts a valid signup", async () => {
9-    const res = await signup(post({ email: "ada@example.com", password: "hunter2025" }));
10-    expect(res.status).toBe(201);
11-  });`,
);

[c] = assistant([
	{
		type: "text",
		text: "The fixture password `hunter2025` is 10 characters, below the new 12-character minimum. The rule is intended, so I'll update the fixture.",
	},
	{
		toolCall: "edit",
		args: {
			path: "src/signup.test.ts",
			edits: [{ oldText: 'password: "hunter2025"', newText: 'password: "correct-horse-42"' }],
		},
	},
]);
result(c, "Successfully replaced 1 block(s) in src/signup.test.ts.", {
	details: editDetails(
		"src/signup.test.ts",
		'  it("accepts a valid signup", async () => {\n    const res = await signup(post({ email: "ada@example.com", password: "hunter2025" }));\n    expect(res.status).toBe(201);\n  });\n',
		'  it("accepts a valid signup", async () => {\n    const res = await signup(post({ email: "ada@example.com", password: "correct-horse-42" }));\n    expect(res.status).toBe(201);\n  });\n',
	),
});

[c] = assistant([{ toolCall: "bash", args: { command: "npm test" } }]);
result(
	c,
	`> app@1.0.0 test
> vitest run

 ✓ src/db.test.ts (3 tests) 11ms
 ✓ src/signup.test.ts (4 tests) 28ms

 Test Files  2 passed (2)
      Tests  7 passed (7)`,
);

assistant(
	[
		{
			type: "text",
			text: `## Done

Signup now validates its input before touching the database.

- **\`src/validation.ts\`** — new \`validateSignup()\` returning a list of messages
- **\`src/signup.ts\`** — returns \`422\` with \`{ errors }\` when validation fails
- **\`src/signup.test.ts\`** — the valid fixture now uses a 16-character password

| Check | Rule |
|---|---|
| email | must match \`local@domain.tld\` |
| password | string, at least 12 characters |

\`\`\`ts
const errors = validateSignup(body);
if (errors.length > 0) return Response.json({ errors }, { status: 422 });
\`\`\`

All 7 tests pass.`,
		},
	],
	"stop",
);

writeFileSync(outPath, entries.map((e) => JSON.stringify(e)).join("\n") + "\n");
