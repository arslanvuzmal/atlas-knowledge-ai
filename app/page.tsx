import Link from 'next/link';
import { DemoBadge, Wordmark } from '@/components/ui/wordmark';
import { prisma } from '@/lib/database/client';
import { env } from '@/lib/env';
import { formatNumber } from '@/lib/ui';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const [documents, chunks, questions] = await Promise.all([
    prisma.document.count({ where: { status: 'INDEXED' } }),
    prisma.documentChunk.count(),
    prisma.message.count({ where: { role: 'USER' } }),
  ]);

  const demoMode = env().DEMO_MODE;

  return (
    <div className="min-h-screen bg-canvas text-ink font-sans">
      <header className="border-b border-edge bg-canvas/90 backdrop-blur-sm sticky top-0 z-50">
        <nav className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-3.5">
          <Wordmark showSubtitle />
          <div className="flex items-center gap-3">
            {demoMode ? <DemoBadge className="hidden sm:inline-flex" /> : null}
            <Link
              href="/demo"
              className="rounded px-3 py-1.5 font-mono text-xs font-semibold text-ink-muted transition hover:bg-canvas-raised hover:text-ink border border-transparent hover:border-edge"
            >
              Public Demo
            </Link>
            <Link
              href="/login"
              className="rounded bg-accent px-3.5 py-1.5 font-mono text-xs font-bold text-ink-inverse transition hover:bg-accent-soft shadow-sm"
            >
              Sign in
            </Link>
          </div>
        </nav>
      </header>

      <main id="main">
        {/* Editorial Hero */}
        <section className="border-b border-edge py-16 sm:py-24">
          <div className="mx-auto max-w-6xl px-6 grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
            <div className="lg:col-span-6 space-y-6">
              <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded bg-canvas-sunken border border-edge font-mono text-[11px] font-bold text-accent uppercase tracking-wider">
                <span className="h-1.5 w-1.5 rounded-full bg-accent animate-pulse" />
                Knowledge Intelligence Platform
              </div>
              <h1 className="text-4xl sm:text-5xl font-bold tracking-tight text-ink leading-[1.1]">
                Ask your business. <br />
                <span className="text-teal">See the evidence.</span>
              </h1>
              <p className="text-sm sm:text-base leading-relaxed text-ink-muted max-w-xl">
                Atlas turns approved documents, policies, manuals and websites into a searchable knowledge system where every answer can be traced directly back to its verified source.
              </p>

              <div className="flex flex-wrap gap-3 pt-2">
                <Link
                  href="/chat"
                  className="rounded bg-accent px-5 py-2.5 font-mono text-xs uppercase font-bold text-ink-inverse transition hover:bg-accent-soft shadow-md flex items-center gap-2"
                >
                  Try Atlas →
                </Link>
                <Link
                  href="/demo"
                  className="rounded border border-edge-strong bg-canvas-raised px-5 py-2.5 font-mono text-xs uppercase font-bold text-ink transition hover:border-accent hover:text-accent"
                >
                  Explore Knowledge Base
                </Link>
              </div>

              {/* Provenance Stat Line */}
              <div className="pt-6 border-t border-edge grid grid-cols-3 gap-4 font-mono text-[11px]">
                <div>
                  <div className="text-lg font-bold text-ink tabular-nums">{formatNumber(documents)}</div>
                  <div className="text-ink-faint text-[10px] uppercase tracking-wider">Indexed Documents</div>
                </div>
                <div>
                  <div className="text-lg font-bold text-ink tabular-nums">{formatNumber(chunks)}</div>
                  <div className="text-ink-faint text-[10px] uppercase tracking-wider">Retrievable Passages</div>
                </div>
                <div>
                  <div className="text-lg font-bold text-ink tabular-nums">{formatNumber(questions)}</div>
                  <div className="text-ink-faint text-[10px] uppercase tracking-wider">Answered Queries</div>
                </div>
              </div>
            </div>

            {/* Signature Evidence Interaction Diagram */}
            <div className="lg:col-span-6">
              <div className="panel p-5 font-mono text-xs space-y-4 border-edge-strong bg-canvas-raised">
                <div className="flex items-center justify-between border-b border-edge pb-3">
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-teal animate-pulse" />
                    <span className="text-[11px] font-bold text-ink uppercase tracking-wider">EVIDENCE_INTERACTION // LIVE_DEMO</span>
                  </div>
                  <span className="text-[10px] text-teal font-semibold border border-teal/30 bg-teal-wash px-2 py-0.5 rounded">
                    SUPPORTED (0.92)
                  </span>
                </div>

                {/* Question */}
                <div className="p-3 bg-canvas-sunken rounded border border-edge space-y-1">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">USER QUESTION</span>
                  <p className="text-xs text-ink font-sans">How long can an employee carry unused annual leave?</p>
                </div>

                {/* Answer with Citation */}
                <div className="p-3.5 bg-canvas-overlay rounded border border-edge space-y-2">
                  <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-accent">
                    <span>ATLAS GROUNDED ANSWER</span>
                    <span>CONFIDENCE: HIGH</span>
                  </div>
                  <p className="text-xs text-ink leading-relaxed font-sans">
                    Unused annual leave may be carried forward up to 5 consecutive working days into the next calendar year, subject to manager approval prior to December 15. <span className="font-mono text-teal font-bold hover:underline cursor-pointer">[1]</span>
                  </p>
                </div>

                {/* Reference Line Connection */}
                <div className="ref-line space-y-2">
                  <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-teal">
                    <span>MATCHED EVIDENCE SOURCE [1]</span>
                    <span>PAGE 42 // EMPLOYEE</span>
                  </div>
                  <div className="p-3 bg-canvas-sunken rounded border border-teal/40 space-y-1 font-sans text-xs text-ink-muted">
                    <div className="font-mono text-[10px] text-ink font-bold">Employee Handbook — Section 4.2 Leave Policy</div>
                    <p className="text-[11px] italic text-ink-muted">
                      &ldquo;Employees may carry forward a maximum of 5 days of accrued unused annual leave into the subsequent year with written approval...&rdquo;
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* The Problem Section */}
        <section className="border-b border-edge bg-canvas-sunken py-16">
          <div className="mx-auto max-w-6xl px-6 space-y-8">
            <div className="max-w-2xl">
              <span className="font-mono text-xs font-bold text-rust uppercase tracking-wider block mb-1">01 // THE KNOWLEDGE PARADOX</span>
              <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-ink">
                Your company already has the answers. <br />
                Finding the right one is the problem.
              </h2>
              <p className="mt-3 text-xs sm:text-sm text-ink-muted leading-relaxed">
                Policies live in PDFs, procedures in drive folders, rules in wikis, and answers in employees&apos; heads. Traditional search finds documents; generic AI invents answers. Atlas sits precisely between them.
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <div className="panel p-5 space-y-2 border-edge">
                <span className="font-mono text-xs font-bold text-ink-faint">TRADITIONAL SEARCH</span>
                <h3 className="text-sm font-semibold text-ink">Finds Documents</h3>
                <p className="text-xs text-ink-muted leading-relaxed">
                  Returns 40-page PDFs and forces team members to scan through dozens of pages to locate a single rule.
                </p>
              </div>

              <div className="panel p-5 space-y-2 border-edge">
                <span className="font-mono text-xs font-bold text-rust">GENERIC CHATBOTS</span>
                <h3 className="text-sm font-semibold text-ink">Invents Answers</h3>
                <p className="text-xs text-ink-muted leading-relaxed">
                  Hallucinates plausible-sounding policies when sources are missing, creating business risk and compliance failures.
                </p>
              </div>

              <div className="panel p-5 space-y-2 border-teal/40 bg-teal-wash/10">
                <span className="font-mono text-xs font-bold text-teal">ATLAS KNOWLEDGE AI</span>
                <h3 className="text-sm font-semibold text-ink">Grounded &amp; Traceable</h3>
                <p className="text-xs text-ink-muted leading-relaxed">
                  Extracts exact answers from authorized sources, attaches proof citations, and refuses to guess when evidence is missing.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* 4 Editorial Differentiators */}
        <section className="border-b border-edge py-16">
          <div className="mx-auto max-w-6xl px-6 space-y-12">
            <div className="border-b border-edge pb-4">
              <span className="font-mono text-xs font-bold text-accent uppercase tracking-wider block mb-1">02 // CORE DIFFERENTIATORS</span>
              <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-ink">Built for Trust and Verification</h2>
            </div>

            <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-3">
                <span className="font-mono text-xs font-bold text-accent">01 // EVIDENCE</span>
                <h3 className="text-sm font-semibold text-ink">Answers with Evidence</h3>
                <p className="text-xs text-ink-muted leading-relaxed">
                  Every claim links to its exact source, section, and page number with matched passage excerpts.
                </p>
              </div>

              <div className="space-y-3">
                <span className="font-mono text-xs font-bold text-indigo">02 // ACCESS LADDER</span>
                <h3 className="text-sm font-semibold text-ink">Role-Based Access</h3>
                <p className="text-xs text-ink-muted leading-relaxed">
                  Strict authorization ladder (Public &rarr; Customer &rarr; Employee &rarr; Manager &rarr; Admin) enforced in database queries.
                </p>
              </div>

              <div className="space-y-3">
                <span className="font-mono text-xs font-bold text-amber">03 // EPISTEMIC STATES</span>
                <h3 className="text-sm font-semibold text-ink">Knows When It Doesn&apos;t Know</h3>
                <p className="text-xs text-ink-muted leading-relaxed">
                  Classifies outputs cleanly into Supported, Partial, or Unsupported without anthropomorphic excuses.
                </p>
              </div>

              <div className="space-y-3">
                <span className="font-mono text-xs font-bold text-teal">04 // KNOWLEDGE GAPS</span>
                <h3 className="text-sm font-semibold text-ink">Knowledge Gaps Visible</h3>
                <p className="text-xs text-ink-muted leading-relaxed">
                  Identifies repeated unanswered questions and surfaces them to administrators for content creation.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Technical Pipeline Process */}
        <section className="border-b border-edge bg-canvas-sunken py-16">
          <div className="mx-auto max-w-6xl px-6 space-y-8">
            <div className="border-b border-edge pb-4">
              <span className="font-mono text-xs font-bold text-olive uppercase tracking-wider block mb-1">03 // SYSTEM TOPOLOGY</span>
              <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-ink">The Atlas Retrieval &amp; Grounding Pipeline</h2>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2 font-mono text-xs text-center">
              {[
                { step: '01', name: 'DOCUMENTS', detail: 'PDF, DOCX, WEB' },
                { step: '02', name: 'VALIDATE', detail: 'Injection Check' },
                { step: '03', name: 'INDEX', detail: 'Chunk & Embed' },
                { step: '04', name: 'RBAC', detail: 'SQL Pre-filter' },
                { step: '05', name: 'RETRIEVE', detail: 'Vector + Keyword' },
                { step: '06', name: 'RERANK', detail: 'Reciprocal Fusion' },
                { step: '07', name: 'EVIDENCE', detail: 'Passage Match' },
                { step: '08', name: 'ANSWER', detail: 'Cited Output' },
              ].map((item) => (
                <div key={item.step} className="p-3 bg-canvas-raised rounded border border-edge space-y-1">
                  <span className="text-[10px] text-accent font-bold block">{item.step}</span>
                  <div className="font-bold text-ink text-[11px] truncate">{item.name}</div>
                  <div className="text-[9px] text-ink-faint truncate">{item.detail}</div>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-edge py-8">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 font-mono text-xs text-ink-faint">
          <Wordmark size={22} />
          <p>Atlas Knowledge AI · Grounded Enterprise Intelligence</p>
        </div>
      </footer>
    </div>
  );
}
