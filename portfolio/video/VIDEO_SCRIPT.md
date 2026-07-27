# Video script — 60 seconds

Screen recording of the running application. No stock footage, no voiceover actor required (captions work alone), no invented statistics.

**Recording setup:** 1440×900 browser, demo mode on, freshly seeded (`npm run demo:reset --full && npm run db:seed`). Sign in as `admin@atlasknowledge.demo`.

---

### 0:00 – 0:06 · The problem

> Important business knowledge is buried across PDFs, policies, websites and internal documents.

**On screen:** the document library at `/dashboard/documents`, scrolling slowly. Eight documents, different types, different access levels.

**Note:** no stock imagery of frustrated office workers. The real library makes the point.

---

### 0:06 – 0:14 · The product

> Atlas Knowledge AI turns approved information into a secure conversational knowledge base.

**On screen:** cut to `/dashboard`. The overview loads with real figures — indexed documents, questions answered, grounded rate, open escalations. Hold on the question-volume chart.

---

### 0:14 – 0:25 · Ingestion

> Documents are validated, processed, divided into searchable sections, and indexed for retrieval.

**On screen:** `/dashboard/upload`, the "Write an entry" tab. Paste a short policy, press **Save and index**. Show the success message with the passage count. Cut to the new document's detail page showing indexed passages with their section titles.

**Note:** this is a real ingestion, in real time. Do not cut around a delay — the speed is the point.

---

### 0:25 – 0:38 · Grounded answers

> Users get source-grounded answers with document, page and section citations.

**On screen:** `/chat`. Type _"What is the refund window for an annual subscription?"_ Show the answer arriving with the **Supported** badge and confidence meter. Pause on the citation cards. Click one — the source drawer opens showing the actual retrieved passage.

**Note:** hold on the drawer for at least two seconds. This is the shot that answers "how do I know it isn't making things up".

---

### 0:38 – 0:48 · Access control

> Role-based access prevents unauthorised users from retrieving restricted information.

**On screen:** open `/demo` in a fresh window (anonymous). Ask _"How many days of annual leave do employees receive?"_ Show the refusal — **Not supported**, no citations.

Then cut back to the signed-in employee session and ask the identical question. It answers, with citations to the Employee Handbook.

**Note:** the same question, two outcomes, side by side. This single comparison sells the whole access-control story.

---

### 0:48 – 0:57 · Escalation

> When reliable information is unavailable, the assistant creates a human escalation with the full conversation attached.

**On screen:** ask something the corpus does not cover — _"Do you provide a native mobile app for iOS?"_ Show the honest refusal. Cut to `/dashboard/escalations` where the item now sits in the queue. Expand it to show the conversation summary and suggested reply.

---

### 0:57 – 1:00 · Close

> Atlas Knowledge AI — secure business knowledge, available when your users need it.

**On screen:** back to `/dashboard/analytics`, then fade on the wordmark.

---

## Captions

Burn them in. Most viewers watch muted. Sentence case, bottom third, generous contrast against the dark interface. One line at a time, never two.

## What not to do

- No claimed accuracy figure, time saving, or client count
- No fake cursor movements or sped-up footage presented as real-time
- No "AI" stock visuals
- Do not hide the refusals — they are the most persuasive part
- Do not show a real company's documents
