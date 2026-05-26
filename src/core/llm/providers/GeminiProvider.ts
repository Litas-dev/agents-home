import { LLMMessage, LLMProvider, LLMResponse, LLMToolCall, LLMToolDefinition } from '../types';
import { DEFAULT_MODELS } from '../constants';

type DeepSeekChatMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content?: string | null };

interface DeepSeekChatCompletionResponse {
  id?: string;
  choices?: Array<{
    index: number;
    finish_reason?: string;
    message?: {
      role: 'assistant';
      content?: string | null;
      tool_calls?: Array<{
        id: string;
        type: 'function';
        function: {
          name: string;
          arguments: string;
        };
      }>;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  error?: {
    message?: string;
    type?: string;
    code?: string | number;
  };
}

export class DeepSeekProvider implements LLMProvider {
  private static nextAllowedAtByKey = new Map<string, number>();
  private static backoffMsByKey = new Map<string, number>();

  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string = 'https://api.deepseek.com'
  ) { }

  private static async waitForRateLimit(key: string) {
    const now = Date.now();
    const next = DeepSeekProvider.nextAllowedAtByKey.get(key) || 0;
    if (now >= next) return;
    await new Promise((r) => setTimeout(r, next - now));
  }

  private static updateRateLimitFromMessage(key: string, message: string) {
    const m = message.match(/limited to\s+(\d+)\s+requests per minute/i);
    const rpm = m ? Number(m[1]) : NaN;
    const minIntervalMs = Number.isFinite(rpm) && rpm > 0 ? Math.ceil(60000 / rpm) + 500 : 8000;
    DeepSeekProvider.nextAllowedAtByKey.set(key, Date.now() + minIntervalMs);
    DeepSeekProvider.backoffMsByKey.set(key, minIntervalMs);
  }

  private static updateRateLimitFromHeaders(key: string, headers: Headers, status: number) {
    if (status !== 429) return;
    const retryAfterRaw = headers.get('retry-after');
    const retryAfterSeconds = retryAfterRaw ? Number(retryAfterRaw) : NaN;

    const resetRaw =
      headers.get('x-ratelimit-reset') ||
      headers.get('ratelimit-reset') ||
      headers.get('x-ratelimit-reset-requests');
    const resetSeconds = resetRaw ? Number(resetRaw) : NaN;

    let waitMs: number | null = null;
    if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
      waitMs = Math.ceil(retryAfterSeconds * 1000);
    } else if (Number.isFinite(resetSeconds) && resetSeconds > 0) {
      waitMs = Math.ceil(resetSeconds * 1000);
    }

    const prev = DeepSeekProvider.backoffMsByKey.get(key) || 8000;
    const next = waitMs ?? Math.min(prev * 2, 60000);

    DeepSeekProvider.nextAllowedAtByKey.set(key, Date.now() + next);
    DeepSeekProvider.backoffMsByKey.set(key, next);
  }

  async generateCompletion(
    messages: LLMMessage[],
    tools?: LLMToolDefinition[],
    systemInstruction?: string,
    modelName: string = DEFAULT_MODELS.text
  ): Promise<LLMResponse> {
    const payloadMessages: DeepSeekChatMessage[] = [];

    if (systemInstruction?.trim()) {
      payloadMessages.push({ role: 'system', content: systemInstruction.trim() });
    }

    for (const m of messages) {
      if (m.role === 'system') continue;
      if (m.role === 'user') {
        payloadMessages.push({ role: 'user', content: m.content || '' });
        continue;
      }
      if (m.role === 'assistant') {
        payloadMessages.push({
          role: 'assistant',
          content: m.content || '',
        });
        continue;
      }
    }

    const requestBody: any = {
      model: modelName,
      messages: payloadMessages,
    };

    const normalizedBaseUrl = this.baseUrl.replace(/\/$/, '');
    if (tools && tools.length > 0) {
      requestBody.tools = tools;
      if (!normalizedBaseUrl.includes('openrouter.ai')) {
        requestBody.tool_choice = 'auto';
      }
    }
    const url = `${normalizedBaseUrl}/chat/completions`;
    const rateKey = `${normalizedBaseUrl}|${modelName}`;
    const baseRateKey = normalizedBaseUrl;

    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      await DeepSeekProvider.waitForRateLimit(baseRateKey);
      await DeepSeekProvider.waitForRateLimit(rateKey);

      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
          ...(normalizedBaseUrl.includes('openrouter.ai')
            ? {
              'HTTP-Referer': 'http://localhost',
              'X-OpenRouter-Title': 'the-delegation',
            }
            : {}),
        },
        body: JSON.stringify(requestBody),
      });

      let json: DeepSeekChatCompletionResponse | undefined;
      try {
        json = (await resp.json()) as DeepSeekChatCompletionResponse;
      } catch {
        json = undefined;
      }

      if (resp.ok) {
        const choice = json?.choices?.[0];
        const message = choice?.message;

        const toolCalls: LLMToolCall[] | undefined = message?.tool_calls?.length
          ? message.tool_calls.map((tc) => ({
            id: tc.id,
            type: 'function',
            function: {
              name: tc.function.name,
              arguments: tc.function.arguments,
            },
          }))
          : undefined;

        return {
          content: message?.content ?? null,
          tool_calls: toolCalls,
          usage: json?.usage
            ? {
              promptTokens: json.usage.prompt_tokens || 0,
              completionTokens: json.usage.completion_tokens || 0,
              totalTokens: json.usage.total_tokens || 0,
            }
            : undefined,
          finishReason: choice?.finish_reason,
          raw: { ...(json || {}), model: modelName },
          request: {
            contents: payloadMessages as any[],
            systemInstruction,
            tools,
          },
        };
      }

      DeepSeekProvider.updateRateLimitFromHeaders(baseRateKey, resp.headers, resp.status);
      DeepSeekProvider.updateRateLimitFromHeaders(rateKey, resp.headers, resp.status);

      const retryAfter = resp.headers.get('retry-after');
      const msg = json?.error?.message
        ? `${json.error.message} (HTTP ${resp.status}${retryAfter ? `, retry-after=${retryAfter}s` : ''})`
        : `Provider returned error (HTTP ${resp.status}${retryAfter ? `, retry-after=${retryAfter}s` : ''})`;
      lastError = new Error(msg);

      if (resp.status === 429 || /rate limit/i.test(msg)) {
        DeepSeekProvider.updateRateLimitFromMessage(rateKey, msg);
        continue;
      }

      throw new Error(msg);
    }

    throw lastError instanceof Error
      ? lastError
      : new Error(`Provider returned error (HTTP unknown).`);

  }
}
