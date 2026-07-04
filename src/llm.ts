import { config } from './config.js';

interface LlmOptions {
  temperature?: number;
  maxTokens?: number;
}

/**
 * Calls the AI brain (an OpenAI-compatible chat endpoint; local Ollama by default).
 *
 * If the endpoint is unreachable and no API key is configured we fall back to a
 * deterministic offline "demo brain" so the whole system still runs end-to-end
 * with zero setup. The demo brain uses simple heuristics that are clearly labelled.
 */
export async function llm(system: string, user: string, opts: LlmOptions = {}): Promise<string> {
  try {
    const res = await fetch(`${config.llm.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(config.llm.apiKey ? { Authorization: `Bearer ${config.llm.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: config.llm.model,
        temperature: opts.temperature ?? 0.2,
        max_tokens: opts.maxTokens ?? 900,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    });
    if (!res.ok) throw new Error(`LLM request failed (${res.status})`);
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = data.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error('LLM returned empty content');
    return text;
  } catch {
    return demoBrain(system, user);
  }
}

/**
 * A tiny offline stand-in so the app works without any model at all.
 * Underwriting and adjudication both have deterministic fallbacks — the
 * numeric heuristics live in their own modules; this only produces prose.
 */
function demoBrain(system: string, user: string): string {
  const s = system.toLowerCase();
  const tag = '[demo brain — point LLM_BASE_URL at any OpenAI-compatible model for real analysis]';

  if (s.includes('underwrit')) {
    return [
      `${tag}`,
      'Assessment: the target service shows typical marketplace signals (price, traction, description quality).',
      'No strong negative indicators were found in the provided data; moderate uncertainty remains.',
    ].join('\n');
  }
  if (s.includes('adjudicat') || s.includes('claim')) {
    // The numeric verdict comes from the heuristic in claims.ts; this is prose only.
    return [
      `${tag}`,
      'Adjudication note: verdict determined by keyword-overlap heuristic between the job requirements and the delivered output.',
    ].join('\n');
  }
  return `${tag}\n\nResponse to: ${user.slice(0, 160)}`;
}
