# Shot list

**Before recording**

```bash
npm run demo:reset -- --full
npm run db:seed
npm run build && npm run start
```

Browser at 1440×900, zoom 100%, no extensions visible, no bookmarks bar. Two windows: one signed in as admin, one incognito for the anonymous demo.

---

| #   | Time      | Route                       | Action                                                 | Hold | Watch for                                                 |
| --- | --------- | --------------------------- | ------------------------------------------------------ | ---- | --------------------------------------------------------- |
| 1   | 0:00–0:06 | `/dashboard/documents`      | Slow scroll through the library                        | 6s   | Access-level badges visible; the FAILED document included |
| 2   | 0:06–0:14 | `/dashboard`                | Load; settle on the question-volume chart              | 8s   | Real figures, not placeholders                            |
| 3   | 0:14–0:20 | `/dashboard/upload`         | "Write an entry" tab, paste text, press Save and index | 6s   | Success message with passage count                        |
| 4   | 0:20–0:25 | `/dashboard/documents/[id]` | The new document's detail page                         | 5s   | Section titles on indexed passages                        |
| 5   | 0:25–0:32 | `/chat`                     | Ask the annual refund question                         | 7s   | **Supported** badge, confidence meter                     |
| 6   | 0:32–0:38 | `/chat`                     | Click a citation card                                  | 6s   | Drawer open, retrieved passage legible                    |
| 7   | 0:38–0:43 | `/demo` (incognito)         | Ask the annual-leave question                          | 5s   | Refusal, zero citations                                   |
| 8   | 0:43–0:48 | `/chat` (employee)          | Ask the identical question                             | 5s   | Answers, cites Employee Handbook                          |
| 9   | 0:48–0:53 | `/demo`                     | Ask about a native mobile app                          | 5s   | **Not supported** state                                   |
| 10  | 0:53–0:57 | `/dashboard/escalations`    | Expand the new escalation                              | 4s   | Summary and suggested reply                               |
| 11  | 0:57–1:00 | `/dashboard/analytics`      | Load, then fade to wordmark                            | 3s   | Grounding chart visible                                   |

---

## Technical

- **Resolution:** record at 2560×1600, deliver at 1920×1080
- **Frame rate:** 30 fps, constant
- **Cursor:** visible, no click highlights or ripples
- **Transitions:** hard cuts only, except the final fade
- **Audio:** none, or a quiet ambient bed under −20 dB. No stock corporate music.
- **Total:** 60 seconds, hard limit

## Editing

Type at natural speed — do not paste questions into the chat, and do not speed up the footage. The system answers in milliseconds; that speed is genuine and worth showing honestly rather than manufacturing.

If a take produces an unexpected result, keep it. An assistant that occasionally returns "partially supported" is more credible than one that is perfect in every shot.

## Deliverables

| File                    | Purpose                                               |
| ----------------------- | ----------------------------------------------------- |
| `atlas-demo-60s.mp4`    | Fiverr gig video, 1920×1080                           |
| `atlas-demo-square.mp4` | Social, 1080×1080, centre-cropped                     |
| `atlas-demo-poster.png` | Thumbnail — frame from shot 6, the open source drawer |
