import type { ILLMProvider } from '../../domain/ports/index.js'
import type { AlertCluster } from '../../domain/entities/cluster.js'
import type { LLMAnalysis } from '../../domain/entities/incident.js'
import { LLMAnalysisSchema } from '../../domain/entities/incident.js'

// ─────────────────────────────────────────────────────────────────────────────
// LLM Adapters — each implements ILLMProvider.
// Swap providers via LLM_PROVIDER env var. Domain never changes.
// ─────────────────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a senior Site Reliability Engineer performing incident triage.
Analyze the following alert cluster and trace excerpts.
Respond ONLY with a valid JSON object matching this exact schema — no markdown, no explanation:
{
  "probable_cause": "string",
  "impacted_services": ["string"],
  "recommended_steps": ["string (max 5 items)"],
  "urgency_level": "low" | "medium" | "high" | "critical",
  "requires_rollback": boolean
}`

function buildUserPrompt(cluster: AlertCluster, traces: Record<string, unknown>[]): string {
  return [
    `## Alert Cluster`,
    `Service: ${cluster.serviceName}`,
    `Error type: ${cluster.errorType}`,
    `Endpoint: ${cluster.endpointPath}`,
    `Alert count: ${cluster.alertCount}`,
    `First seen: ${cluster.firstSeenAt}`,
    cluster.latencyP99Ms ? `P99 latency: ${cluster.latencyP99Ms}ms` : '',
    ``,
    `## Representative Traces (${traces.length} spans)`,
    JSON.stringify(traces.slice(0, 30), null, 2), // hard cap — never exceed token budget
  ].filter(Boolean).join('\n')
}

function parseAnalysis(raw: string): LLMAnalysis {
  const cleaned = raw.replace(/```json|```/g, '').trim()
  return LLMAnalysisSchema.parse(JSON.parse(cleaned))
}

// ─────────────────────────────────────────────────────────────────────────────
// GeminiProvider
// ─────────────────────────────────────────────────────────────────────────────

export class GeminiProvider implements ILLMProvider {
  constructor(
    private readonly apiKey: string,
    private readonly model = 'gemini-1.5-flash',
  ) {}

  async analyze(cluster: AlertCluster, traces: Record<string, unknown>[]): Promise<LLMAnalysis> {
    const { GoogleGenerativeAI } = await import('@google/generative-ai')
    const genAI = new GoogleGenerativeAI(this.apiKey)
    const gemini = genAI.getGenerativeModel({ model: this.model, systemInstruction: SYSTEM_PROMPT })

    const result = await gemini.generateContent(buildUserPrompt(cluster, traces))
    return parseAnalysis(result.response.text())
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ClaudeProvider
// ─────────────────────────────────────────────────────────────────────────────

export class ClaudeProvider implements ILLMProvider {
  constructor(
    private readonly apiKey: string,
    private readonly model = 'claude-haiku-4-5',
  ) {}

  async analyze(cluster: AlertCluster, traces: Record<string, unknown>[]): Promise<LLMAnalysis> {
    const Anthropic = (await import('@anthropic-ai/sdk')).default
    const client = new Anthropic({ apiKey: this.apiKey })

    const message = await client.messages.create({
      model: this.model,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildUserPrompt(cluster, traces) }],
    })

    const text = message.content.find((b) => b.type === 'text')?.text ?? ''
    return parseAnalysis(text)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MockLLMProvider — Test adapter. Returns deterministic analysis.
// ─────────────────────────────────────────────────────────────────────────────

export class MockLLMProvider implements ILLMProvider {
  readonly callLog: Array<{ cluster: AlertCluster }> = []

  async analyze(cluster: AlertCluster, _traces: Record<string, unknown>[]): Promise<LLMAnalysis> {
    this.callLog.push({ cluster })
    return {
      probable_cause:    `Mock: ${cluster.errorType} on ${cluster.serviceName}`,
      impacted_services: [cluster.serviceName],
      recommended_steps: ['Check the logs', 'Verify the deployment'],
      urgency_level:     'high',
      requires_rollback: false,
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// createLLMProvider() — factory, reads LLM_PROVIDER env var
// ─────────────────────────────────────────────────────────────────────────────

export function createLLMProvider(provider: string, apiKey: string, model?: string): ILLMProvider {
  switch (provider) {
    case 'gemini': return new GeminiProvider(apiKey, model)
    case 'claude': return new ClaudeProvider(apiKey, model)
    default: throw new Error(`Unknown LLM_PROVIDER: "${provider}". Supported: gemini, claude`)
  }
}
