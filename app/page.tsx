import Link from 'next/link';
import { DemoBadge, Wordmark } from '@/components/ui/wordmark';
import { prisma } from '@/lib/database/client';
import { env } from '@/lib/env';
import { formatNumber } from '@/lib/ui';

export const dynamic = 'force-dynamic';

/**
 * Landing page.
 *
 * The figures shown are read from the database at request time. They describe
 * this deployment's own demo corpus, and are labelled as such: no invented
 * customer counts, no fabricated performance claims.
 */
export default async function HomePage() {
  const [documents, chunks, questions] = await Promise.all([
    prisma.document.count({ where: { status: 'INDEXED' } }),
    prisma.documentChunk.count(),
    prisma.message.count({ where: { role: 'USER' } }),
  ]);

  const demoMode = env().DEMO_MODE;

  return (
    <div className="min-h-screen">
      <header className="border-b border-edge">
        <nav className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-4">
          <Wordmark />
          <div className="flex items-center gap-2">
            {demoMode ? <DemoBadge className="hidden sm:inline-flex" /> : null}
            <Link
              href="/demo"
              className="rounded-md px-3 py-2 text-sm font-medium text-ink-muted transition hover:bg-canvas-raised hover:text-ink"
            >
              Try the demo
            </Link>
            <Link
              href="/login"
              className="rounded-md bg-accent px-3.5 py-2 text-sm font-semibold text-ink-inverse transition hover:bg-accent-soft"
            >
              Sign in
            </Link>
          </div>
        </nav>
      </header>

      <main id="main">
        {/* Hero */}
        <section className="border-b border-edge">
          <div className="mx-auto max-w-6xl px-6 py-16 sm:py-24">
            <p className="mb-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-accent">
              Retrieval-augmented knowledge platform
            </p>
            <h1 className="max-w-3xl text-4xl font-semibold leading-[1.1] tracking-tight text-ink sm:text-5xl">
              Business knowledge that answers,
              <span className="text-ink-muted"> with its sources attached.</span>
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-relaxed text-ink-muted">
              Atlas Knowledge AI turns approved documents, websites, policies, manuals and FAQs into
              a searchable conversational assistant — with document-level citations, role-based
              access control, feedback analytics and human escalation.
            </p>

            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href="/demo"
                className="rounded-md bg-accent px-5 py-2.5 text-sm font-semibold text-ink-inverse transition hover:bg-accent-soft"
              >
                Ask the public demo
              </Link>
              <Link
                href="/login"
                className="rounded-md border border-edge-strong px-5 py-2.5 text-sm font-semibold text-ink transition hover:border-accent hover:text-accent"
              >
                Sign in to the dashboard
              </Link>
            </div>

            <dl className="mt-14 grid max-w-2xl grid-cols-2 gap-x-8 gap-y-6 sm:grid-cols-3">
              {[
                { term: 'Documents indexed', value: formatNumber(documents) },
                { term: 'Retrievable passages', value: formatNumber(chunks) },
                { term: 'Questions answered', value: formatNumber(questions) },
              ].map((stat) => (
                <div key={stat.term}>
                  <dd className="text-2xl font-semibold tabular-nums text-ink">{stat.value}</dd>
                  <dt className="mt-1 text-xs text-ink-faint">{stat.term}</dt>
                </div>
              ))}
            </dl>
            <p className="mt-4 max-w-2xl text-xs text-ink-faint">
              Live counts from this deployment&rsquo;s fictional demonstration corpus.
            </p>
          </div>
        </section>

        {/* The problem */}
        <section className="border-b border-edge bg-canvas-sunken">
          <div className="mx-auto max-w-6xl px-6 py-16">
            <h2 className="text-2xl font-semibold tracking-tight text-ink">
              The knowledge exists. Finding it is the problem.
            </h2>
            <p className="mt-3 max-w-2xl text-ink-muted">
              Policies live in PDFs, procedures in a wiki, pricing in a spreadsheet, and the real
              answer in someone&rsquo;s head. A general-purpose chatbot will confidently make
              something up. Atlas will not.
            </p>

            <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {[
                {
                  title: 'Answers are grounded, or refused',
                  body: 'Every claim carries a citation to the document, section and page it came from. When the sources do not support an answer, Atlas says so and offers a human instead of guessing.',
                },
                {
                  title: 'Access control is enforced in SQL',
                  body: 'Each document and passage carries an access level. Filtering happens in the database query against the caller’s role, then again after reranking. Restricted content is never loaded, let alone quoted.',
                },
                {
                  title: 'Documents are data, never instructions',
                  body: 'Retrieved text is wrapped in an untrusted-data boundary and the generator has no tools, no network access and no secrets. An instruction hidden in a PDF has nothing to act on.',
                },
                {
                  title: 'Ingestion you can watch and retry',
                  body: 'Validation, extraction, chunking, embedding and indexing each report their own state. A failure tells you which stage broke and why, and can be retried from the library.',
                },
                {
                  title: 'Measured, not asserted',
                  body: 'Grounded-answer rate, unsupported rate, confidence, retrieval latency and content gaps are all computed from real usage recorded by the platform.',
                },
                {
                  title: 'Runs without paid credentials',
                  body: 'Deterministic demo providers make the entire platform runnable end to end with no API keys. Point it at a real embedding and language model when you are ready.',
                },
              ].map((feature) => (
                <div key={feature.title} className="panel p-5">
                  <h3 className="text-sm font-semibold text-ink">{feature.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-ink-muted">{feature.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Pipeline */}
        <section className="border-b border-edge">
          <div className="mx-auto max-w-6xl px-6 py-16">
            <h2 className="text-2xl font-semibold tracking-tight text-ink">
              How a question is answered
            </h2>
            <ol className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {[
                {
                  step: '01',
                  title: 'Scope',
                  body: 'The question is validated, scanned for injection patterns, and resolved against recent conversation context. The caller’s role fixes which access levels are reachable.',
                },
                {
                  step: '02',
                  title: 'Retrieve',
                  body: 'Vector similarity and keyword search run in parallel over permitted passages only, then fuse by reciprocal rank.',
                },
                {
                  step: '03',
                  title: 'Rerank',
                  body: 'Candidates are rescored on term coverage, proximity, rarity and heading match, and a confidence figure is computed from the evidence.',
                },
                {
                  step: '04',
                  title: 'Answer',
                  body: 'A grounded answer is generated inside a strict source boundary. Citations are validated against what was actually retrieved before anything is shown.',
                },
              ].map((item) => (
                <li key={item.step} className="border-l-2 border-accent/30 pl-4">
                  <p className="font-mono text-xs text-accent">{item.step}</p>
                  <h3 className="mt-2 text-sm font-semibold text-ink">{item.title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">{item.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Demo credentials */}
        {demoMode ? (
          <section className="border-b border-edge bg-canvas-sunken">
            <div className="mx-auto max-w-6xl px-6 py-16">
              <div className="flex flex-wrap items-center gap-3">
                <h2 className="text-2xl font-semibold tracking-tight text-ink">
                  Explore the roles
                </h2>
                <DemoBadge />
              </div>
              <p className="mt-3 max-w-2xl text-ink-muted">
                Each account sees a different slice of the same knowledge base. Ask all of them
                about the employee handbook to watch access control decide the answer.
              </p>

              <div className="mt-8 overflow-x-auto">
                <table className="w-full min-w-[520px] border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-edge text-left">
                      <th
                        scope="col"
                        className="py-2 pr-4 text-[11px] uppercase tracking-wider text-ink-faint"
                      >
                        Role
                      </th>
                      <th
                        scope="col"
                        className="py-2 pr-4 text-[11px] uppercase tracking-wider text-ink-faint"
                      >
                        Email
                      </th>
                      <th
                        scope="col"
                        className="py-2 text-[11px] uppercase tracking-wider text-ink-faint"
                      >
                        Reaches
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-edge-subtle">
                    {[
                      [
                        'Administrator',
                        'admin@atlasknowledge.demo',
                        'Everything, plus configuration and audit',
                      ],
                      [
                        'Manager',
                        'manager@atlasknowledge.demo',
                        'Internal procedures, escalations, analytics',
                      ],
                      ['Employee', 'employee@atlasknowledge.demo', 'Handbook and sales material'],
                      ['Customer', 'customer@atlasknowledge.demo', 'Customer-approved sources'],
                      ['Public viewer', 'viewer@atlasknowledge.demo', 'Public documentation only'],
                    ].map(([role, email, reach]) => (
                      <tr key={email}>
                        <td className="py-2.5 pr-4 font-medium text-ink">{role}</td>
                        <td className="py-2.5 pr-4 font-mono text-[13px] text-ink-muted">
                          {email}
                        </td>
                        <td className="py-2.5 text-ink-muted">{reach}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-4 text-sm text-ink-muted">
                Password for every demo account:{' '}
                <code className="rounded bg-canvas-overlay px-1.5 py-0.5 font-mono text-accent-soft">
                  AtlasDemo!2026
                </code>
              </p>
              <p className="mt-2 text-xs text-ink-faint">
                These accounts authenticate only while demo mode is enabled. All documents, people
                and figures in the corpus are fictional.
              </p>
            </div>
          </section>
        ) : null}
      </main>

      <footer className="border-t border-edge">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-8 text-sm text-ink-faint">
          <Wordmark size={22} />
          <p>Built by Arslan Vuzmal Lone · MIT licensed</p>
        </div>
      </footer>
    </div>
  );
}
