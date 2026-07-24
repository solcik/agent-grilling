import { Effect, Match as M, Option, Schema as S } from 'effect'
import { Command, Runtime } from 'foldkit'
import { type Document, type Html, html } from 'foldkit/html'
import { m } from 'foldkit/message'
import { evo } from 'foldkit/struct'

import { Answer, type ContextBlock, Inbox, type Question, Round } from '../domain/contract.js'

const AnswerDraft = S.Struct({
  selected: S.Array(S.String),
  other: S.String,
  notes: S.String,
})

export const Model = S.Struct({
  inbox: Inbox,
  activeSessionId: S.Option(S.String),
  round: S.Option(Round),
  answers: S.Record(S.String, AnswerDraft),
  isLight: S.Boolean,
  status: S.String,
})
export type Model = typeof Model.Type

export const GotInbox = m('GotInbox', { inbox: Inbox })
export const GotRound = m('GotRound', { sessionId: S.String, round: Round })
export const FailedRequest = m('FailedRequest', { message: S.String })
export const ClickedSession = m('ClickedSession', { sessionId: S.String })
export const ClickedOption = m('ClickedOption', { questionId: S.String, label: S.String })
export const UpdatedOther = m('UpdatedOther', { questionId: S.String, value: S.String })
export const UpdatedNotes = m('UpdatedNotes', { questionId: S.String, value: S.String })
export const ClickedAcceptRecommended = m('ClickedAcceptRecommended')
export const ClickedSubmit = m('ClickedSubmit')
export const SubmittedAnswer = m('SubmittedAnswer', { sessionId: S.String })
export const ToggledTheme = m('ToggledTheme')
export const PersistedTheme = m('PersistedTheme')

export const Message = S.Union([
  GotInbox,
  GotRound,
  FailedRequest,
  ClickedSession,
  ClickedOption,
  UpdatedOther,
  UpdatedNotes,
  ClickedAcceptRecommended,
  ClickedSubmit,
  SubmittedAnswer,
  ToggledTheme,
  PersistedTheme,
])
export type Message = typeof Message.Type

export const init: Runtime.ApplicationInit<Model, Message> = () => [
  {
    inbox: { sessions: [] },
    activeSessionId: Option.none(),
    round: Option.none(),
    answers: {},
    isLight: readInitialTheme(),
    status: 'Connecting…',
  },
  [FetchInbox()],
]

export const update = (
  model: Model,
  message: Message,
): readonly [Model, ReadonlyArray<Command.Command<Message>>] =>
  M.value(message).pipe(
    M.withReturnType<readonly [Model, ReadonlyArray<Command.Command<Message>>]>(),
    M.tagsExhaustive({
      GotInbox: ({ inbox }) => {
        const maybeActive = Option.filter(model.activeSessionId, sessionId =>
          inbox.sessions.some(row => row.sessionId === sessionId),
        )
        const nextSessionId = Option.orElse(maybeActive, () =>
          Option.fromNullishOr(inbox.sessions.find(row => !row.answered)?.sessionId),
        )
        return Option.match(nextSessionId, {
          onNone: () => [
            evo(model, {
              inbox: () => inbox,
              activeSessionId: () => nextSessionId,
              round: () => Option.none(),
              status: () => 'No sessions yet.',
            }),
            [],
          ],
          onSome: sessionId => [
            evo(model, {
              inbox: () => inbox,
              activeSessionId: () => nextSessionId,
              status: () => 'Connected',
            }),
            [FetchRound({ sessionId })],
          ],
        })
      },
      GotRound: ({ sessionId, round }) => [
        evo(model, {
          activeSessionId: () => Option.some(sessionId),
          round: () => Option.some(round),
          answers: () => initialAnswers(round),
          status: () => 'Connected',
        }),
        [],
      ],
      FailedRequest: ({ message }) => [evo(model, { status: () => message }), []],
      ClickedSession: ({ sessionId }) => [
        evo(model, {
          activeSessionId: () => Option.some(sessionId),
          round: () => Option.none(),
          status: () => 'Loading round…',
        }),
        [FetchRound({ sessionId })],
      ],
      ClickedOption: ({ questionId, label }) => {
        const maybeQuestion = Option.flatMap(model.round, round =>
          Option.fromNullishOr(round.questions.find(question => question.id === questionId)),
        )
        return Option.match(maybeQuestion, {
          onNone: () => [model, []],
          onSome: question => {
            const current = model.answers[questionId] ?? { selected: [], other: '', notes: '' }
            const selected =
              question.multiSelect === true
                ? current.selected.includes(label)
                  ? current.selected.filter(selectedLabel => selectedLabel !== label)
                  : [...current.selected, label]
                : [label]
            return [
              evo(model, {
                answers: () => ({ ...model.answers, [questionId]: { ...current, selected } }),
              }),
              [],
            ]
          },
        })
      },
      UpdatedOther: ({ questionId, value }) => [
        evo(model, {
          answers: () =>
            updateDraft(model.answers, questionId, draft => ({ ...draft, other: value })),
        }),
        [],
      ],
      UpdatedNotes: ({ questionId, value }) => [
        evo(model, {
          answers: () =>
            updateDraft(model.answers, questionId, draft => ({ ...draft, notes: value })),
        }),
        [],
      ],
      ClickedAcceptRecommended: () =>
        Option.match(model.round, {
          onNone: () => [model, []],
          onSome: round => [
            evo(model, { answers: () => recommendedAnswers(round, model.answers) }),
            [],
          ],
        }),
      ClickedSubmit: () =>
        Option.match(model.activeSessionId, {
          onNone: () => [model, []],
          onSome: sessionId =>
            Option.match(model.round, {
              onNone: () => [model, []],
              onSome: round => [
                evo(model, { status: () => 'Submitting…' }),
                [SubmitAnswer({ sessionId, round, answers: model.answers })],
              ],
            }),
        }),
      SubmittedAnswer: ({ sessionId }) => [
        evo(model, { status: () => 'Answer submitted.' }),
        [FetchInbox(), FetchRound({ sessionId })],
      ],
      ToggledTheme: () => {
        const isLight = !model.isLight
        return [evo(model, { isLight: () => isLight }), [SaveTheme({ isLight })]]
      },
      PersistedTheme: () => [model, []],
    }),
  )

export const FetchInbox = Command.define(
  'FetchInbox',
  GotInbox,
  FailedRequest,
)(
  requestJson('/api/sessions', Inbox).pipe(
    Effect.map(inbox => GotInbox({ inbox })),
    Effect.orElseSucceed(() =>
      FailedRequest({ message: 'Could not reach the local grill server.' }),
    ),
  ),
)

export const FetchRound = Command.define(
  'FetchRound',
  { sessionId: S.String },
  GotRound,
  FailedRequest,
)(({ sessionId }) =>
  requestJson(`/api/round?session=${encodeURIComponent(sessionId)}`, Round).pipe(
    Effect.map(round => GotRound({ sessionId, round })),
    Effect.orElseSucceed(() => FailedRequest({ message: 'Could not load this round.' })),
  ),
)

export const SubmitAnswer = Command.define(
  'SubmitAnswer',
  { sessionId: S.String, round: Round, answers: S.Record(S.String, AnswerDraft) },
  SubmittedAnswer,
  FailedRequest,
)(({ sessionId, round, answers }) => {
  const answer = SchemaAnswer({ sessionId, roundId: round.roundId, answers })
  return requestJson('/api/answer', Answer, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(answer),
  }).pipe(
    Effect.map(() => SubmittedAnswer({ sessionId })),
    Effect.orElseSucceed(() =>
      FailedRequest({
        message: 'The server rejected the answer. Complete every question and try again.',
      }),
    ),
  )
})

export const SaveTheme = Command.define(
  'SaveTheme',
  { isLight: S.Boolean },
  PersistedTheme,
)(({ isLight }) =>
  Effect.sync(() => {
    localStorage.setItem('grill-theme', isLight ? 'light' : 'dark')
  }).pipe(Effect.as(PersistedTheme())),
)

export const view = (model: Model): Document => {
  const h = html<Message>()
  const palette = model.isLight ? 'theme-light' : 'theme-dark'
  return {
    title: 'Grilling panel',
    body: h.div(
      [h.Class(`app-shell ${palette}`)],
      [sidebarView(model), h.main([h.Class('main-panel')], [roundView(model)])],
    ),
  }
}

const sidebarView = (model: Model): Html => {
  const h = html<Message>()
  const pending = model.inbox.sessions.filter(session => !session.answered).length
  return h.aside(
    [h.Class('sidebar')],
    [
      h.div(
        [h.Class('sidebar-header')],
        [
          h.div([h.Class('brand')], ['Grilling']),
          h.span([h.Class('count')], [String(pending)]),
          h.button(
            [h.Class('theme-button'), h.OnClick(ToggledTheme())],
            [model.isLight ? '☾' : '☀'],
          ),
        ],
      ),
      h.nav(
        [h.Class('session-list'), h.AriaLabel('Sessions')],
        model.inbox.sessions.length === 0
          ? [h.p([h.Class('muted')], ['No sessions yet.'])]
          : model.inbox.sessions.map(session =>
              h.button(
                [
                  h.Key(session.sessionId),
                  h.Class(`session-row ${isActive(model, session.sessionId) ? 'active' : ''}`),
                  h.OnClick(ClickedSession({ sessionId: session.sessionId })),
                ],
                [
                  h.span([h.Class('session-title')], [session.title]),
                  h.span(
                    [h.Class('session-meta')],
                    [
                      session.answered
                        ? '✓ answered'
                        : `${session.count} question${session.count === 1 ? '' : 's'}`,
                    ],
                  ),
                ],
              ),
            ),
      ),
      h.div([h.Class('connection')], [h.span([h.Class('connection-dot')], []), model.status]),
    ],
  )
}

const roundView = (model: Model): Html => {
  const h = html<Message>()
  return Option.match(model.round, {
    onNone: () =>
      h.div([h.Class('empty-state')], [h.h1([], ['Waiting for a round']), h.p([], [model.status])]),
    onSome: round =>
      h.div(
        [h.Class('round-wrap')],
        [
          h.header(
            [h.Class('round-header')],
            [
              h.h1([], [round.title ?? 'Agent question']),
              Option.match(model.activeSessionId, {
                onNone: () => h.empty,
                onSome: sessionId => h.p([h.Class('session-tag')], [sessionId]),
              }),
              round.intro === undefined ? h.empty : h.p([h.Class('intro')], [round.intro]),
              contextView(round.context ?? []),
            ],
          ),
          ...round.questions.map(question => questionView(model, question)),
          h.footer(
            [h.Class('action-bar')],
            [
              h.p(
                [h.Class('muted')],
                ['Every required question must be answered before submission.'],
              ),
              h.button(
                [h.Class('secondary-action'), h.OnClick(ClickedAcceptRecommended())],
                ['✓ Accept all recommended'],
              ),
              h.button([h.Class('primary-action'), h.OnClick(ClickedSubmit())], ['Submit answers']),
            ],
          ),
        ],
      ),
  })
}

const questionView = (model: Model, question: Question): Html => {
  const h = html<Message>()
  const draft = model.answers[question.id] ?? { selected: [], other: '', notes: '' }
  return h.section(
    [h.Class('question-card'), h.Key(question.id)],
    [
      question.header === undefined
        ? h.empty
        : h.span([h.Class('question-header')], [question.header]),
      h.h2([], [question.question]),
      contextView(question.context ?? []),
      h.div(
        [h.Class('options')],
        question.options.map(option => {
          const selected = draft.selected.includes(option.label)
          return h.label(
            [h.Class(`option ${selected ? 'selected' : ''}`)],
            [
              h.input([
                h.Type(question.multiSelect === true ? 'checkbox' : 'radio'),
                h.Name(question.id),
                h.Checked(selected),
                h.OnClick(ClickedOption({ questionId: question.id, label: option.label })),
              ]),
              h.span(
                [h.Class('option-copy')],
                [
                  h.span(
                    [h.Class('option-label')],
                    [
                      option.label,
                      option.recommended === true
                        ? h.span([h.Class('recommended')], ['Recommended'])
                        : h.empty,
                    ],
                  ),
                  option.description === undefined
                    ? h.empty
                    : h.span([h.Class('option-description')], [option.description]),
                  option.preview === undefined ? h.empty : contextView([option.preview]),
                ],
              ),
            ],
          )
        }),
      ),
      question.allowOther === false
        ? h.empty
        : h.input([
            h.Class('text-input'),
            h.Placeholder('Other (optional)'),
            h.Value(draft.other),
            h.OnInput(value => UpdatedOther({ questionId: question.id, value })),
          ]),
      question.allowNotes === false
        ? h.empty
        : h.div(
            [h.Class('notes')],
            [
              h.label([], ['Notes']),
              h.textarea(
                [
                  h.Rows(2),
                  h.Value(draft.notes),
                  h.OnInput(value => UpdatedNotes({ questionId: question.id, value })),
                ],
                [],
              ),
            ],
          ),
    ],
  )
}

const contextView = (blocks: ReadonlyArray<ContextBlock>): Html => {
  const h = html<Message>()
  if (blocks.length === 0) return h.empty
  return h.div(
    [h.Class('context-blocks')],
    blocks.map((block, index) => {
      if (block.kind === 'image') {
        return h.figure(
          [h.Key(`image-${index}`), h.Class('context-image')],
          [
            h.img([h.Src(block.src), h.Alt(block.alt ?? '')]),
            block.caption === undefined ? h.empty : h.figcaption([], [block.caption]),
          ],
        )
      }
      if (block.kind === 'html') {
        return h.iframe(
          [
            h.Key(`html-${index}`),
            h.Class('context-frame'),
            h.Sandbox(''),
            h.Srcdoc(block.html),
            h.Title('Agent supplied preview'),
          ],
          [],
        )
      }
      return h.div([h.Key(`markdown-${index}`), h.Class('markdown')], [renderMarkdown(block.text)])
    }),
  )
}

const renderMarkdown = (source: string): Html => {
  const h = html<Message>()
  const lines = source.replace(/\r/g, '').split('\n')
  const blocks: Array<Html> = []
  let index = 0
  while (index < lines.length) {
    const line = lines[index] ?? ''
    if (line.trim() === '') {
      index += 1
    } else if (line.startsWith('```')) {
      const code: Array<string> = []
      index += 1
      while (index < lines.length && !(lines[index] ?? '').startsWith('```')) {
        code.push(lines[index] ?? '')
        index += 1
      }
      index += 1
      blocks.push(h.pre([], [h.code([], [code.join('\n')])]))
    } else if (/^#{1,6}\s/.test(line)) {
      const match = /^(#{1,6})\s+(.*)$/.exec(line)
      const level = match?.[1]?.length ?? 1
      const content = inlineMarkdown(match?.[2] ?? '')
      blocks.push(
        level === 1
          ? h.h1([], content)
          : level === 2
            ? h.h2([], content)
            : level === 3
              ? h.h3([], content)
              : h.h4([], content),
      )
      index += 1
    } else if (/^\s*[-*+]\s+/.test(line)) {
      const items: Array<Html> = []
      while (index < lines.length && /^\s*[-*+]\s+/.test(lines[index] ?? '')) {
        items.push(h.li([], inlineMarkdown((lines[index] ?? '').replace(/^\s*[-*+]\s+/, ''))))
        index += 1
      }
      blocks.push(h.ul([], items))
    } else if (/^\s*\d+\.\s+/.test(line)) {
      const items: Array<Html> = []
      while (index < lines.length && /^\s*\d+\.\s+/.test(lines[index] ?? '')) {
        items.push(h.li([], inlineMarkdown((lines[index] ?? '').replace(/^\s*\d+\.\s+/, ''))))
        index += 1
      }
      blocks.push(h.ol([], items))
    } else if (line.includes('|') && (lines[index + 1] ?? '').includes('|')) {
      const headers = tableCells(line)
      index += 2
      const rows: Array<Html> = []
      while (index < lines.length && (lines[index] ?? '').includes('|')) {
        rows.push(
          h.tr(
            [],
            tableCells(lines[index] ?? '').map(cell => h.td([], inlineMarkdown(cell))),
          ),
        )
        index += 1
      }
      blocks.push(
        h.table(
          [],
          [
            h.thead(
              [],
              [
                h.tr(
                  [],
                  headers.map(cell => h.th([], inlineMarkdown(cell))),
                ),
              ],
            ),
            h.tbody([], rows),
          ],
        ),
      )
    } else {
      const paragraph: Array<string> = [line]
      index += 1
      while (
        index < lines.length &&
        (lines[index] ?? '').trim() !== '' &&
        !/^#{1,6}\s|^\s*[-*+]\s+|^\s*\d+\.\s+|^```/.test(lines[index] ?? '')
      ) {
        paragraph.push(lines[index] ?? '')
        index += 1
      }
      blocks.push(h.p([], inlineMarkdown(paragraph.join(' '))))
    }
  }
  return h.div([], blocks)
}

const inlineMarkdown = (source: string): ReadonlyArray<Html | string> => {
  const h = html<Message>()
  const tokens = source.split(/(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/g)
  return tokens
    .filter(token => token !== '')
    .map(token => {
      if (token.startsWith('`') && token.endsWith('`')) return h.code([], [token.slice(1, -1)])
      if (token.startsWith('**') && token.endsWith('**')) return h.strong([], [token.slice(2, -2)])
      if (token.startsWith('*') && token.endsWith('*')) return h.em([], [token.slice(1, -1)])
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token)
      return link === null
        ? token
        : h.a([h.Href(link[2] ?? ''), h.Target('_blank'), h.Rel('noreferrer')], [link[1] ?? ''])
    })
}

const tableCells = (line: string): Array<string> =>
  line
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map(cell => cell.trim())

function requestJson<SchemaType extends S.ConstraintDecoder<unknown, never>>(
  url: string,
  schema: SchemaType,
  init?: RequestInit,
): Effect.Effect<SchemaType['Type'], unknown, never> {
  return Effect.tryPromise(async () => {
    const response = await fetch(url, init)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return response.json()
  }).pipe(Effect.flatMap(S.decodeUnknownEffect(schema)))
}

const SchemaAnswer = (input: unknown) => S.decodeUnknownSync(Answer)(input)

const initialAnswers = (round: Round) =>
  Object.fromEntries(
    round.questions.map(question => [
      question.id,
      { selected: recommendedLabels(question), other: '', notes: '' },
    ]),
  )

const recommendedAnswers = (round: Round, previous: Record<string, typeof AnswerDraft.Type>) =>
  Object.fromEntries(
    round.questions.map(question => [
      question.id,
      {
        ...(previous[question.id] ?? { selected: [], other: '', notes: '' }),
        selected: recommendedLabels(question),
      },
    ]),
  )

const recommendedLabels = (question: Question): Array<string> => {
  const labels = question.options
    .filter(option => option.recommended === true)
    .map(option => option.label)
  return question.multiSelect === true ? labels : labels.slice(0, 1)
}

const updateDraft = (
  answers: Record<string, typeof AnswerDraft.Type>,
  questionId: string,
  update: (draft: typeof AnswerDraft.Type) => typeof AnswerDraft.Type,
) => ({
  ...answers,
  [questionId]: update(answers[questionId] ?? { selected: [], other: '', notes: '' }),
})

const isActive = (model: Model, sessionId: string): boolean =>
  Option.contains(model.activeSessionId, sessionId)

const readInitialTheme = (): boolean => {
  try {
    return localStorage.getItem('grill-theme') === 'light'
  } catch {
    return false
  }
}
