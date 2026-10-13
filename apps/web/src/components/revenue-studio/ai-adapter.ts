// AG Studio's dashboard assistant asks for one model turn at a time through this adapter. It is
// based on the OpenAI Responses adapter in the AG Studio docs, with one change: turns go to the
// GrowthReceipt API, which holds the OpenAI key and decides the model, the output cap and the
// daily limit. The browser never sees a key.

import type {
  AgAiConversationItem,
  AgAiEvent,
  AgAiOutputItem,
  AgLlmAdapter,
  AgLlmRequest,
  AgLlmResponse,
  AgLlmResponseHandler,
} from "ag-studio";

import { apiFetch } from "@/lib/campaign";

type JsonSchema = Record<string, unknown>;
// Provider payloads are parsed JSON. Each read below checks the type field first.
// biome-ignore lint/suspicious/noExplicitAny: untyped provider JSON
type Raw = Record<string, any>;

// Studio emits JSON Schema 2020-12. OpenAI strict mode accepts a subset: every property listed in
// required, optional ones made nullable, no open additionalProperties, no const or "undefined".
const BANNED = ["allOf", "not", "oneOf", "if", "then", "else", "prefixItems", "patternProperties"];

const isSchema = (value: unknown): value is JsonSchema =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isUndefinedSentinel = (value: unknown) =>
  isSchema(value) &&
  Object.keys(value).length === 1 &&
  isSchema(value.not) &&
  Object.keys(value.not).length === 0;

function stripUndefined(schema: JsonSchema): JsonSchema {
  if (!Array.isArray(schema.anyOf)) return schema;
  const branches = schema.anyOf.filter((branch) => !isUndefinedSentinel(branch));
  if (branches.length === schema.anyOf.length) return schema;
  const { anyOf: _, ...rest } = schema;
  return branches.length === 1 && isSchema(branches[0])
    ? { ...branches[0], ...rest }
    : { ...rest, anyOf: branches };
}

function literalType(value: unknown): string | undefined {
  if (value === null) return "null";
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "number";
  if (typeof value === "string" || typeof value === "boolean") return typeof value;
  return undefined;
}

function nullable(schema: JsonSchema): JsonSchema {
  if (typeof schema.type === "string")
    return schema.type === "null" ? schema : { ...schema, type: [schema.type, "null"] };
  if (Array.isArray(schema.type))
    return schema.type.includes("null") ? schema : { ...schema, type: [...schema.type, "null"] };
  if (Array.isArray(schema.anyOf)) {
    const hasNull = schema.anyOf.some((branch) => isSchema(branch) && branch.type === "null");
    return hasNull ? schema : { ...schema, anyOf: [...schema.anyOf, { type: "null" }] };
  }
  return { anyOf: [schema, { type: "null" }] };
}

function toStrictSchema(input: JsonSchema): JsonSchema {
  const schema = stripUndefined(input);
  // Strict mode allows no keyword beside $ref.
  if ("$ref" in schema)
    return schema.$defs === undefined
      ? { $ref: schema.$ref }
      : { $ref: schema.$ref, $defs: schema.$defs };
  for (const keyword of BANNED) {
    if (keyword in schema) throw new Error(`OpenAI strict mode does not support '${keyword}'`);
  }
  if ("const" in schema) {
    const { const: value, ...rest } = schema;
    return toStrictSchema({ type: literalType(value), ...rest, enum: [value] });
  }
  const out: JsonSchema = { ...schema };
  if (Array.isArray(out.anyOf))
    out.anyOf = out.anyOf.map((branch) => (isSchema(branch) ? toStrictSchema(branch) : branch));
  if (isSchema(out.$defs))
    out.$defs = Object.fromEntries(
      Object.entries(out.$defs).map(([key, def]) => [
        key,
        isSchema(def) ? toStrictSchema(def) : def,
      ]),
    );
  if (out.type === "object" || isSchema(out.properties)) {
    if ("additionalProperties" in out && out.additionalProperties !== false)
      throw new Error("OpenAI strict mode does not support open additionalProperties");
    const required = new Set(Array.isArray(out.required) ? (out.required as string[]) : []);
    const properties = isSchema(out.properties) ? out.properties : {};
    out.properties = Object.fromEntries(
      Object.entries(properties).map(([key, value]) => {
        const strict = isSchema(value) ? toStrictSchema(value) : value;
        return [key, required.has(key) || !isSchema(strict) ? strict : nullable(strict)];
      }),
    );
    out.required = Object.keys(out.properties as JsonSchema);
    out.additionalProperties = false;
  }
  if (isSchema(out.items)) out.items = toStrictSchema(out.items);
  return out;
}

// Strict mode returns null for unset optional properties. Studio expects them left out.
function stripNulls(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripNulls);
  if (isSchema(value))
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== null)
        .map(([key, item]) => [key, stripNulls(item)]),
    );
  return value;
}

function cleanArguments(json: string): string {
  try {
    return JSON.stringify(stripNulls(JSON.parse(json)));
  } catch {
    return json;
  }
}

function encodeItem(item: AgAiConversationItem): Raw {
  if (item.kind === "input" && item.type === "message")
    return {
      type: "message",
      role: item.role,
      content: item.content.map((part) =>
        part.type === "text"
          ? { type: "input_text", text: part.text }
          : part.type === "image"
            ? { type: "input_image", detail: part.detail, image_url: part.imageUrl ?? null }
            : { type: "input_file", file_data: part.fileData, filename: part.filename },
      ),
    };
  if (item.type === "function_call_output")
    return { type: "function_call_output", call_id: item.callId, output: item.output };
  // Replayed history leaves out the provider ids, so OpenAI does not look for stored responses.
  if (item.type === "message")
    return {
      type: "message",
      role: "assistant",
      content: item.content.map((part) =>
        part.type === "text"
          ? { type: "output_text", text: part.text, annotations: [] }
          : { type: "refusal", refusal: part.refusal },
      ),
    };
  if (item.type === "function_call")
    return {
      type: "function_call",
      call_id: item.callId,
      name: item.name,
      arguments: item.arguments,
    };
  return {
    id: item.id,
    type: "reasoning",
    summary: item.summary.map((part) => ({ type: "summary_text", text: part.text })),
  };
}

function decodeItem(item: Raw): AgAiOutputItem {
  if (item.type === "message")
    return {
      id: item.id ?? "",
      kind: "output",
      type: "message",
      role: "assistant",
      status: item.status ?? "completed",
      content: (item.content as Raw[]).map((part) =>
        part.type === "output_text"
          ? { type: "text", text: part.text, annotations: [] }
          : { type: "refusal", refusal: part.refusal },
      ),
    };
  if (item.type === "function_call")
    return {
      id: item.id ?? "",
      kind: "output",
      type: "function_call",
      callId: item.call_id,
      name: item.name,
      arguments: cleanArguments(item.arguments ?? ""),
      status: item.status,
    };
  if (item.type === "reasoning")
    return {
      id: item.id ?? "",
      kind: "output",
      type: "reasoning",
      summary: ((item.summary ?? []) as Raw[]).map((part) => ({
        type: "summary",
        text: part.text,
      })),
    };
  throw new Error(`Unknown output item type: ${item.type}`);
}

function decodeResponse(response: Raw): AgLlmResponse {
  return {
    id: response.id,
    createdAt: response.created_at,
    model: response.model,
    status: response.status,
    output: ((response.output ?? []) as Raw[]).map(decodeItem),
    usage: response.usage && {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      totalTokens: response.usage.total_tokens,
      reasoningTokens: response.usage.output_tokens_details?.reasoning_tokens,
      cachedInputTokens: response.usage.input_tokens_details?.cached_tokens,
    },
  };
}

type Outcome = { response?: AgLlmResponse; error?: Error };

// The provider streams items by index. Studio reads messages and tool calls by id.
class StreamTranslator {
  private readonly calls = new Map<string, string>();
  private readonly kinds = new Map<string, string>();

  translate(event: Raw, outcome: Outcome): AgAiEvent[] {
    switch (event.type) {
      case "response.output_item.added":
        return this.open(event.item);
      case "response.output_item.done":
        return this.close(event.item);
      case "response.output_text.delta":
      case "response.refusal.delta":
        return [{ type: "TEXT_MESSAGE_CONTENT", messageId: event.item_id, delta: event.delta }];
      case "response.reasoning_summary_text.delta":
        return [
          { type: "REASONING_MESSAGE_CONTENT", messageId: event.item_id, delta: event.delta },
        ];
      case "response.function_call_arguments.delta": {
        const toolCallId = this.calls.get(event.item_id);
        return toolCallId ? [{ type: "TOOL_CALL_ARGS", toolCallId, delta: event.delta }] : [];
      }
      case "response.completed":
        outcome.response = decodeResponse(event.response);
        return [];
      case "response.failed":
      case "response.incomplete":
        outcome.error ??= new Error(
          event.response?.error?.message ?? "The assistant stopped before it finished.",
        );
        return [];
      case "error":
        outcome.error ??= new Error(event.message ?? "The assistant ran into an error.");
        return [];
      default:
        return [];
    }
  }

  private open(item: Raw): AgAiEvent[] {
    this.kinds.set(item?.id, item?.type);
    if (item?.type === "message")
      return [{ type: "TEXT_MESSAGE_START", messageId: item.id, role: "assistant" }];
    if (item?.type === "reasoning")
      return [{ type: "REASONING_MESSAGE_START", messageId: item.id, role: "reasoning" }];
    if (item?.type === "function_call") {
      this.calls.set(item.id, item.call_id);
      return [{ type: "TOOL_CALL_START", toolCallId: item.call_id, toolCallName: item.name }];
    }
    return [];
  }

  private close(item: Raw): AgAiEvent[] {
    const kind = this.kinds.get(item?.id);
    if (kind === "message") return [{ type: "TEXT_MESSAGE_END", messageId: item.id }];
    if (kind === "reasoning") return [{ type: "REASONING_MESSAGE_END", messageId: item.id }];
    const toolCallId = this.calls.get(item?.id);
    return kind === "function_call" && toolCallId ? [{ type: "TOOL_CALL_END", toolCallId }] : [];
  }
}

async function* streamTurn(
  body: Raw,
  outcome: Outcome,
  signal?: AbortSignal,
): AsyncGenerator<AgAiEvent> {
  const response = await apiFetch("/v1/studio/ai/responses", {
    method: "POST",
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok || !response.body) {
    const detail = (await response.json().catch(() => null))?.detail;
    throw new Error(typeof detail === "string" ? detail : "The assistant is unavailable.");
  }
  const translator = new StreamTranslator();
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    for (const line of frames.flatMap((frame) => frame.split("\n"))) {
      if (!line.startsWith("data: ") || line === "data: [DONE]") continue;
      try {
        yield* translator.translate(JSON.parse(line.slice(6)), outcome);
      } catch (error) {
        outcome.error ??= error instanceof Error ? error : new Error(String(error));
      }
    }
  }
}

function executeTurn(request: AgLlmRequest, signal?: AbortSignal): AgLlmResponseHandler {
  const { tools = [], toolChoice, responseFormat, input, instructions, model } = request;
  const body: Raw = {
    input: input.map(encodeItem),
    instructions,
    tools: tools.map((tool) => ({
      type: "function",
      name: tool.name,
      description: tool.description,
      parameters: toStrictSchema(tool.parameters as unknown as JsonSchema),
      strict: true,
    })),
    tool_choice:
      typeof toolChoice === "object" ? { type: "function", name: toolChoice.name } : toolChoice,
    // Studio's json format maps to OpenAI's json_schema format.
    text: {
      format:
        responseFormat?.type === "json"
          ? {
              type: "json_schema",
              name: responseFormat.name,
              description: responseFormat.description,
              schema: toStrictSchema(responseFormat.schema as unknown as JsonSchema),
              strict: true,
            }
          : { type: "text" },
    },
    // The API allows low or medium effort and picks the model itself.
    effort: model?.effort === "medium" ? "medium" : "low",
  };

  const outcome: Outcome = {};
  let resolve: (response: AgLlmResponse) => void = () => {};
  let reject: (error: Error) => void = () => {};
  const complete = new Promise<AgLlmResponse>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  // A failed turn is reported once, on `complete`. This keeps an unread rejection quiet.
  void complete.catch(() => {});

  async function* events(): AsyncGenerator<AgAiEvent> {
    try {
      yield* streamTurn(body, outcome, signal);
    } catch (error) {
      outcome.error ??= error instanceof Error ? error : new Error(String(error));
    }
    if (outcome.error) reject(outcome.error);
    else if (outcome.response) resolve(outcome.response);
    else reject(new Error("The assistant stopped before it finished."));
  }

  const stream = events();
  return { stream: { [Symbol.asyncIterator]: () => stream }, complete };
}

export const growthReceiptAdapter: AgLlmAdapter = {
  executeTurn: (request, options) => executeTurn(request, options?.signal),
};
