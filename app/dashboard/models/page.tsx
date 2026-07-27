import type { Metadata } from 'next';
import { AccessDenied } from '@/components/dashboard/access-denied';
import { ModelSettingsForm } from '@/components/dashboard/controls';
import { HealthBadge } from '@/components/dashboard/status-badges';
import {
  DefinitionList,
  InlineNote,
  PageHeader,
  Panel,
  PanelHeader,
} from '@/components/ui/primitives';
import { getSession } from '@/lib/auth/session';
import { hasPermission } from '@/lib/auth/rbac';
import { getModelSettings } from '@/lib/retrieval/settings';
import { getEmbeddingProvider } from '@/lib/embeddings';
import { getLlmProvider } from '@/lib/ai';
import { env } from '@/lib/env';

export const metadata: Metadata = { title: 'AI providers' };
export const dynamic = 'force-dynamic';

export default async function ModelsPage() {
  const session = await getSession();
  if (!hasPermission(session.role, 'settings:models:read')) {
    return <AccessDenied area="AI provider configuration" />;
  }

  const config = env();
  const settings = await getModelSettings();
  const embedding = getEmbeddingProvider();
  const llm = getLlmProvider();

  const [embeddingHealth, llmHealth] = await Promise.all([
    embedding.healthCheck(),
    llm.healthCheck(),
  ]);

  // "Configured" means the credential is present, checked without ever
  // exposing the value itself.
  const providers = [
    { value: 'demo', label: 'Deterministic demo generator', configured: true },
    { value: 'openai', label: 'OpenAI', configured: Boolean(config.OPENAI_API_KEY) },
    { value: 'anthropic', label: 'Anthropic', configured: Boolean(config.ANTHROPIC_API_KEY) },
    { value: 'gemini', label: 'Google Gemini', configured: Boolean(config.GEMINI_API_KEY) },
    { value: 'openrouter', label: 'OpenRouter', configured: Boolean(config.OPENROUTER_API_KEY) },
    { value: 'ollama', label: 'Ollama (local)', configured: Boolean(config.OLLAMA_BASE_URL) },
  ];

  const readOnly = !hasPermission(session.role, 'settings:models:manage');

  return (
    <>
      <PageHeader
        title="AI providers"
        description="Embedding and language model selection. Credentials live in environment variables and are never displayed, logged, or returned by the API."
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel>
          <PanelHeader
            title="Embedding provider"
            action={<HealthBadge state={embeddingHealth.status.toUpperCase()} />}
          />
          <div className="px-5 py-4">
            <DefinitionList
              items={[
                { term: 'Provider', value: embedding.name },
                { term: 'Model', value: embedding.model },
                { term: 'Index width', value: `${config.EMBEDDING_DIMENSIONS} dimensions` },
                { term: 'Native width', value: `${embedding.nativeDimensions} dimensions` },
              ]}
            />
            <p className="mt-4 text-[13px] leading-relaxed text-ink-muted">
              {embeddingHealth.detail}
            </p>
          </div>
        </Panel>

        <Panel>
          <PanelHeader
            title="Language model provider"
            action={<HealthBadge state={llmHealth.status.toUpperCase()} />}
          />
          <div className="px-5 py-4">
            <DefinitionList
              items={[
                { term: 'Provider', value: llm.name },
                { term: 'Model', value: llm.model },
                { term: 'Mode', value: llm.isDemo ? 'Deterministic demo' : 'Live provider' },
              ]}
            />
            <p className="mt-4 text-[13px] leading-relaxed text-ink-muted">{llmHealth.detail}</p>
          </div>
        </Panel>
      </div>

      <Panel className="mt-6">
        <PanelHeader
          title="Runtime selection"
          description="Overrides the environment configuration."
        />
        <ModelSettingsForm
          initial={{
            llmProviderOverride: settings.llmProviderOverride,
            maxAnswerTokens: settings.maxAnswerTokens,
            temperature: settings.temperature,
          }}
          availableProviders={providers}
          readOnly={readOnly}
        />
      </Panel>

      <div className="mt-6 space-y-4">
        <InlineNote tone="iris">
          <strong className="text-ink">Changing the embedding provider requires a re-index.</strong>{' '}
          Vectors from different models are not comparable, so a switch must be followed by
          reprocessing every document. The provider, model and dimensions used are recorded on each
          passage so drift is detectable rather than silent.
        </InlineNote>

        <InlineNote>
          The language model is never given tools, network access, or credentials. Instructions
          embedded in an uploaded document therefore have nothing to act on, which is what makes the
          untrusted-source boundary meaningful rather than decorative.
        </InlineNote>
      </div>
    </>
  );
}
