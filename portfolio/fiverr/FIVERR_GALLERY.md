# Fiverr gallery

Three images. Dark enterprise theme, real product screenshots, minimal text. No robots, no glowing brains, no invented results.

**Palette** — background `#12141c`, panel `#171923`, primary text `#e6e9f2`, secondary text `#a8b0c8`, accent `#00a3c3`, secondary accent `#5a58c2`. These are the application's own validated tokens.

**Type** — one sans-serif family throughout. Headline in semibold, everything else regular. Never more than three type sizes in one image.

---

## Image 1 — cover

**Headline**

```
PRIVATE AI KNOWLEDGE ASSISTANT
```

**Subheadline**

```
Chat with Documents, Websites and Business Data
```

**Support line**

```
RAG · Citations · Secure Access
```

**Visual** — `docs/assets/screenshots/06-chat-citations.png`, angled slightly and cropped so the citation cards are unmistakable at thumbnail size. Headline top-left, screenshot filling the lower two thirds.

**Why this shot** — the citation cards are the differentiator. A buyer scanning a category sees dozens of chatbot gigs; the visible source cards say immediately that this one shows its working.

---

## Image 2 — how it works

**Headline**

```
ANSWERS WITH VERIFIED SOURCES
```

**Process strip** — four steps, evenly spaced, connected by a thin `#00a3c3` line:

```
RETRIEVE  →  UNDERSTAND  →  ANSWER  →  CITE
```

**Support line**

```
PDFs · Policies · Manuals · FAQs
```

**Visual** — `docs/assets/screenshots/07-source-drawer.png` beneath the process strip, showing the open drawer with the retrieved passage and relevance score.

**Why this shot** — it answers the buyer's real question: _how do I know it isn't making things up?_ The drawer shows the actual retrieved text.

---

## Image 3 — the enterprise case

**Headline**

```
SECURE RAG FOR BUSINESS
```

**Support line**

```
Access Control · Feedback · Human Escalation
```

**Visual** — split composition. Left: `docs/assets/screenshots/08-access-refusal.png`, showing the assistant refusing a restricted question. Right: `docs/assets/screenshots/02-analytics.png`, cropped to the metric tiles and the grounding chart.

**Why this pairing** — the refusal is counter-intuitive and memorable: a demo where the AI _declines_ signals control rather than weakness. The analytics beside it shows the operational layer.

---

## Rules for all three

**Do**

- Use real screenshots from `docs/assets/screenshots/`
- Keep the headline under six words
- Leave generous margins; crowding reads as cheap
- Keep the same accent colour across all three so the set reads as one gig

**Do not**

- Add robots, glowing brains, circuit-board motifs or neon gradients
- Claim accuracy percentages, client counts, or time savings — none have been measured
- Use stock photography of people at laptops
- Put more than three lines of text on any image
- Show a real company's name or logo

---

## Gig description

**Title**

> I will build a secure RAG AI knowledge assistant for your documents

**Opening**

> Your team's answers are buried in PDFs, policies and wiki pages. A general-purpose chatbot will confidently invent an answer, which is worse than no answer at all.
>
> I build private knowledge assistants that answer only from your approved documents, cite the exact source and page behind every claim, and say "I don't know" instead of guessing.

**What is included**

- Document ingestion: PDF, Word, Markdown, CSV, text and approved web pages
- Retrieval pipeline with vector and keyword search, fused and reranked
- Source-grounded answers with document, section and page citations
- Role-based access control so restricted material stays restricted
- Feedback capture and human escalation for anything the assistant cannot answer
- Analytics dashboard: answer quality, confidence, and content gaps
- Full source code, documentation and a test suite

**Honest notes to include**

> The demonstration uses fictional documents for a company called Northstar Cloud. Every figure shown in the dashboard is computed from that demonstration data, not from client results.
>
> Retrieval quality depends on your documents. I will tell you before starting if your corpus is a poor fit — for example, scanned PDFs with no text layer need OCR first.

**Do not write**

- "100% accurate" or "zero hallucinations" — neither is achievable and both are checkable
- "Trusted by N companies" without N real companies
- "Saves X hours per week" without a measurement
- Any named client who has not agreed to be named
