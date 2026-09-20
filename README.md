# SRS - Short-Term Spaced Repetition

A spaced repetition system built for cramming before an exam — short review cycles
designed to maximize retention in the days leading up to a test, not long-term
(months/years) memory retention.

Live at: https://sundopoz.github.io/SRS_lt/

## Why

Traditional spaced repetition schedules space reviews out over weeks or months.
This project instead compresses that schedule down to hours/days, tuned for
last-minute exam prep where you need to lock in material fast and hold onto it
just long enough to perform well on exam day.

## Files

- `index.html` — page markup
- `style.css` — all styling
- `script.js` — scheduling logic, deck/card management, import/export

No build step — open `index.html` directly, or serve the folder as-is (this
is what GitHub Pages does).

## Features

- Any subject, not just language pairs — front/back cards with optional
  category, tag/badge, and monospace-answer display for code, formulas, etc.
- SM-2-style scheduling (again / hard / good / easy) with short learning
  steps suited for cram sessions
- Anki-style queue priority: due learning cards first, then reviews, with new
  cards trickled in via an interleave ratio instead of flooding the session
- Leech handling — a card failed 8+ times gets flagged and cooled down
  instead of looping every few seconds
- Bulk TSV/CSV paste import, JSON import/export (deck-only or full backup
  with progress), category management, local-storage persistence

## Status

Early stage — work in progress.
