// The grill contract — the single source of truth shared by the server, the CLI,
// and the Foldkit UI. Everything is an Effect Schema so decode/encode is fail-loud
// at every boundary (an agent that posts an illegal round is rejected before the
// human ever sees it).
//
// NOTE FOR IMPLEMENTERS (Effect v4 beta — effect@4.0.0-beta.x): the FIELD SET and
// TYPES below are canonical (the design). The exact Schema constructor spellings
// may need small adjustments against the pinned source — verify optional / Record /
// Union / annotation forms in ~/dev/ref/github/effect and against finvestor-front
// (which imports `Schema` from 'effect' and HttpApi from 'effect/unstable/http').
// Do NOT change the shape; only the API surface if a constructor differs.

import { Schema } from 'effect'

// ---------------------------------------------------------------------------
// Rich context blocks — attached to a round, a question, or a single option, so
// a decision can carry robust information (a screenshot, a rendered diff, a
// markdown table) before it is made.
// ---------------------------------------------------------------------------

/** Markdown, rendered via @foldkit/markdown (headings, tables, code, links). */
export const MarkdownBlock = Schema.Struct({
  kind: Schema.Literal('markdown'),
  text: Schema.String,
})

/** An image: either an inline data: URI (small, self-contained) or an id/URL of
 *  an uploaded attachment (/attachments/<id>) for larger images. */
export const ImageBlock = Schema.Struct({
  kind: Schema.Literal('image'),
  src: Schema.String,
  alt: Schema.optional(Schema.String),
  caption: Schema.optional(Schema.String),
})

/** Arbitrary agent-generated HTML (a rendered diff, a chart). Rendered in a
 *  SANDBOXED iframe by the UI — it must never touch the panel's own DOM. */
export const HtmlBlock = Schema.Struct({
  kind: Schema.Literal('html'),
  html: Schema.String,
})

export const ContextBlock = Schema.Union([MarkdownBlock, ImageBlock, HtmlBlock])
export type ContextBlock = typeof ContextBlock.Type

// ---------------------------------------------------------------------------
// Question / option
// ---------------------------------------------------------------------------

/** One selectable answer option. `recommended` badges it and pre-selects it (and
 *  drives "Accept all recommended"). `preview` is an optional per-option context
 *  block — the comparison affordance (e.g. two mockups side by side). */
export const AnswerOption = Schema.Struct({
  label: Schema.String,
  description: Schema.optional(Schema.String),
  recommended: Schema.optional(Schema.Boolean),
  preview: Schema.optional(ContextBlock),
})
export type AnswerOption = typeof AnswerOption.Type

export const Question = Schema.Struct({
  id: Schema.String,
  header: Schema.optional(Schema.String),
  question: Schema.String,
  /** true → checkboxes, false/omitted → radios. */
  multiSelect: Schema.optional(Schema.Boolean),
  /** context shown inside the question card, above the options. */
  context: Schema.optional(Schema.Array(ContextBlock)),
  options: Schema.Array(AnswerOption),
  /** default true — set false to hide the free-text / notes field. */
  allowOther: Schema.optional(Schema.Boolean),
  allowNotes: Schema.optional(Schema.Boolean),
})
export type Question = typeof Question.Type

// ---------------------------------------------------------------------------
// Round — one batch of questions posted to a session.
// ---------------------------------------------------------------------------

export const Round = Schema.Struct({
  /** must change every round; the UI re-renders when it differs from what's shown. */
  roundId: Schema.String,
  title: Schema.optional(Schema.String),
  /** short intro (markdown-lite); richer context goes in `context`. */
  intro: Schema.optional(Schema.String),
  /** round-level context, shown once at the top. */
  context: Schema.optional(Schema.Array(ContextBlock)),
  questions: Schema.Array(Question),
})
export type Round = typeof Round.Type

// ---------------------------------------------------------------------------
// Answer — what the human submits back.
// ---------------------------------------------------------------------------

export const QuestionAnswer = Schema.Struct({
  /** chosen option label(s): one for radios, many for multiSelect. */
  selected: Schema.Array(Schema.String),
  /** free text from the Other box; when present, treat as overriding `selected`. */
  other: Schema.optional(Schema.NullOr(Schema.String)),
  notes: Schema.optional(Schema.NullOr(Schema.String)),
})
export type QuestionAnswer = typeof QuestionAnswer.Type

export const Answer = Schema.Struct({
  sessionId: Schema.String,
  roundId: Schema.String,
  submittedAt: Schema.optional(Schema.String),
  /** keyed by Question.id. */
  answers: Schema.Record(Schema.String, QuestionAnswer),
})
export type Answer = typeof Answer.Type

// ---------------------------------------------------------------------------
// Inbox — one row per session that has a round, for the sidebar.
// ---------------------------------------------------------------------------

export const SessionRow = Schema.Struct({
  /** <project>/<task> — project auto-derived from git remote/cwd by the CLI. */
  sessionId: Schema.String,
  roundId: Schema.String,
  title: Schema.String,
  count: Schema.Finite,
  answered: Schema.Boolean,
})
export type SessionRow = typeof SessionRow.Type

export const Inbox = Schema.Struct({
  sessions: Schema.Array(SessionRow),
})
export type Inbox = typeof Inbox.Type
