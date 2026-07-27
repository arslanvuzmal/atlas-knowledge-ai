# Design system

The interface commits to a single dark appearance. Colour is not chosen by eye: the chart-facing tokens were generated in OKLCH and checked with a colour-vision validator against the actual chart surface.

---

## Why measured rather than picked

Roughly one man in twelve has a colour vision deficiency. A categorical palette that fails deutan separation is unreadable for them, and no amount of looking at it reveals the problem — the designer sees two distinct colours and the reader sees one.

So the palette was computed. Four candidate sets were rejected before one passed:

| Attempt                                       | Failure                                                                                   |
| --------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `#3fbfd4, #9a7ce0, #5bc98f, #e0b054, #e0687f` | Three colours outside the dark lightness band; amber↔green worst adjacent ΔE 6.9 (protan) |
| Darker restep, reordered                      | Red↔green ΔE 4.1 (deutan)                                                                 |
| Cyan/violet at equal lightness                | ΔE 5.0 (deutan) — visually appealing, unreadable for deuteranopia                         |
| OKLCH-generated at L 0.62                     | Gamut clipping pushed measured lightness back out of band                                 |

The set that passed separates cyan and violet by **lightness as well as hue**, which is what makes them distinguishable without colour perception.

## Validated palette

Checked against the chart surface `#171923`, dark mode band OKLCH L ∈ [0.48, 0.67]:

```
[PASS] Lightness band       all 3 inside L 0.48–0.67
[PASS] Chroma floor         all 3 >= 0.1
[PASS] CVD separation       worst adjacent #5a58c2 ↔ #00a3c3  ΔE 17.4 (deutan)
[PASS] Normal-vision floor  worst adjacent #5a58c2 ↔ #00a3c3  ΔE 20.5
[PASS] Contrast vs surface  all 3 >= 3:1
```

ΔE 17.4 against a floor of 8.0 — comfortable margin rather than a bare pass.

### Categorical — assign in this order, never cycle

| Slot | Hex       | Use                                  |
| ---- | --------- | ------------------------------------ |
| 1    | `#00a3c3` | First series. Also the brand accent. |
| 2    | `#5a58c2` | Second series.                       |
| 3    | `#429c5a` | Third series.                        |

There is no slot 4. A fourth category folds into "Other", or becomes small multiples. A generated hue would not have been validated, so it does not exist.

### Status — reserved, never a series colour

| Token             | Hex       | Contrast |
| ----------------- | --------- | -------- |
| `status.good`     | `#4fa866` | 5.94:1   |
| `status.warning`  | `#bd871c` | 5.54:1   |
| `status.critical` | `#cd5f5f` | 4.50:1   |
| `status.info`     | `#00a3c3` | 5.86:1   |
| `status.neutral`  | `#7d879f` | —        |

Status colours always ship with a text label. A badge reading "Failed" in red carries its meaning in the word; the colour is reinforcement. Nothing in this interface communicates state by colour alone.

### Sequential — one hue, light to dark

`#57c8e6` → `#38afcc` → `#0995b2` → `#007d99` → `#006580`

One hue for magnitude. Never a rainbow.

### Surfaces and ink

| Token           | Hex       | Use                                                          |
| --------------- | --------- | ------------------------------------------------------------ |
| `canvas`        | `#12141c` | Page background                                              |
| `canvas.raised` | `#171923` | Panels — the chart surface the palette was validated against |
| `canvas.sunken` | `#0d0f16` | Inset areas, code, input fields                              |
| `edge`          | `#242836` | Default border                                               |
| `ink`           | `#e6e9f2` | Primary text — 14.42:1                                       |
| `ink.muted`     | `#a8b0c8` | Secondary text — 8.09:1                                      |
| `ink.faint`     | `#7d879f` | Labels and metadata                                          |

## Why no light theme

A light theme is not an inversion. Every colour needs re-stepping and re-validating against a white surface, and the first attempt at a light categorical set failed the chroma floor — `#00868e` measured 0.096 against a 0.1 minimum, meaning it would read as grey rather than as a colour.

Shipping it anyway would mean shipping colours that had not passed the checks the dark set had to pass. One validated appearance is more honest than two where one is unverified.

## Chart rules

- **Marks are thin.** 2px line strokes, 4px rounded data ends anchored to the baseline.
- **Fills are separated.** A 2px surface-coloured gap between adjacent segments, so touching bars read as separate marks.
- **Grid and axes recede.** Grid lines at `edge.subtle`, axis labels at `ink.faint`, 11px monospace. The data carries the contrast.
- **Labels wear text tokens.** A value beside a chart is `ink` or `ink.muted`, never the series colour. A coloured swatch next to it carries the identity.
- **Direct labels are selective.** Every bar in a `BarList` shows its value because there are at most eight. No line chart labels every point.
- **Never a dual axis.** Two measures of different scale become two charts.
- **Every chart is interactive and every chart has a table.** Hover gives a crosshair and tooltip; a screen-reader-only `<table>` carries the same data. Hit targets are wider than the marks.

## Layout

- **`min-w-0` on every panel.** Grid and flex items default to `min-width: auto` and refuse to shrink below their content. A panel holding a 520px chart will otherwise stretch its column past a phone viewport and make the whole page scroll sideways. This was a real bug, caught by a mobile test asserting `scrollWidth <= clientWidth`.
- **Wide content scrolls inside its own container.** Tables get `overflow-x-auto` and a `min-width`. The page body never scrolls horizontally.
- **Responsive sidebar.** Fixed at `lg`, an overlay below it, with focus management and an Escape handler.

## Motion

Two animations: a 180ms fade-up for arriving content, and a soft pulse for loading. Both respect `prefers-reduced-motion`, which reduces every duration to 0.01ms rather than merely shortening it.

No decorative motion. Nothing animates that does not communicate a state change.

## Accessibility

- Focus is never removed, only replaced — a 2px accent outline with 2px offset on every interactive element
- Text meets 4.5:1; large text and UI elements meet 3:1
- A skip link precedes the navigation
- Icons are `aria-hidden`; adjacent text carries the meaning
- Dialogs trap focus, close on Escape, and restore focus to the trigger
- Live regions announce chat responses and form outcomes
- Tables carry captions and scoped headers

## Re-validating

The validator lives in the `dataviz` skill:

```bash
node scripts/validate_palette.js "#00a3c3,#5a58c2,#429c5a" --mode dark --surface "#171923"
```

Any new categorical colour must pass all five checks before it enters `tailwind.config.ts`. Eyeballing is not sufficient and was demonstrably wrong four times.
