import { Effect, Match as M, Option, Result, Schema as S, pipe } from 'effect'
import { HttpClient, HttpClientRequest, HttpClientResponse } from 'effect/unstable/http'
import { AsyncData, Command, Http, Runtime } from 'foldkit'
import { type Document, type Html, html } from 'foldkit/html'
import { m } from 'foldkit/message'
import { evo } from 'foldkit/struct'

import { Answer, type ContextBlock, Inbox, type Question, Round } from '../domain/contract.js'

const AnswerDraft = S.Struct({
  selected: S.Array(S.String),
  other: S.String,
  notes: S.String,
})

export const InboxData = AsyncData.Schema(Inbox, S.String)
export const RoundData = AsyncData.Schema(Round, S.String)

type InboxData = typeof InboxData.schema.Type
type RoundData = typeof RoundData.schema.Type

export const Model = S.Struct({
  inbox: InboxData.schema,
  activeSessionId: S.Option(S.String),
  round: RoundData.schema,
  answers: S.Record(S.String, AnswerDraft),
  isLight: S.Boolean,
})
export type Model = typeof Model.Type

export const SettledFetchInbox = m('SettledFetchInbox', {
  result: S.Result(Inbox, S.String),
})
export const SettledFetchRound = m('SettledFetchRound', {
  sessionId: S.String,
  result: S.Result(Round, S.String),
})
export const SettledSubmitAnswer = m('SettledSubmitAnswer', {
  sessionId: S.String,
  result: S.Result(Answer, S.String),
})
export const ClickedSession = m('ClickedSession', { sessionId: S.String })
export const ClickedRetryRound = m('ClickedRetryRound')
export const ClickedOption = m('ClickedOption', { questionId: S.String, label: S.String })
export const UpdatedOther = m('UpdatedOther', { questionId: S.String, value: S.String })
export const UpdatedNotes = m('UpdatedNotes', { questionId: S.String, value: S.String })
export const ClickedAcceptRecommended = m('ClickedAcceptRecommended')
export const ClickedSubmit = m('ClickedSubmit')
export const ToggledTheme = m('ToggledTheme')
export const PersistedTheme = m('PersistedTheme')

export const Message = S.Union([
  SettledFetchInbox,
  SettledFetchRound,
  SettledSubmitAnswer,
  ClickedSession,
  ClickedRetryRound,
  ClickedOption,
  UpdatedOther,
  UpdatedNotes,
  ClickedAcceptRecommended,
  ClickedSubmit,
  ToggledTheme,
  PersistedTheme,
])
export type Message = typeof Message.Type

export const init: Runtime.ApplicationInit<Model, Message> = () => [
  {
    inbox: InboxData.Loading(),
    activeSessionId: Option.none(),
    round: RoundData.Idle(),
    answers: {},
    isLight: readInitialTheme(),
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
      SettledFetchInbox: ({ result }) =>
        Result.match(result, {
          onFailure: () => [evo(model, { inbox: AsyncData.settle(result) }), []],
          onSuccess: inbox => {
            const nextInbox = AsyncData.settle(model.inbox, result)
            const maybeActive = Option.filter(model.activeSessionId, sessionId =>
              inbox.sessions.some(row => row.sessionId === sessionId),
            )

            return Option.match(maybeActive, {
              onSome: activeSessionId => [
                evo(model, {
                  inbox: () => nextInbox,
                  activeSessionId: () => Option.some(activeSessionId),
                }),
                [],
              ],
              onNone: () => {
                const nextSessionId = Option.fromNullishOr(
                  inbox.sessions.find(row => !row.answered)?.sessionId,
                )

                return Option.match(nextSessionId, {
                  onNone: () => [
                    evo(model, {
                      inbox: () => nextInbox,
                      activeSessionId: () => Option.none(),
                      round: () => RoundData.Idle(),
                    }),
                    [],
                  ],
                  onSome: sessionId => [
                    evo(model, {
                      inbox: () => nextInbox,
                      activeSessionId: () => Option.some(sessionId),
                      round: () => RoundData.Loading(),
                    }),
                    [FetchRound({ sessionId })],
                  ],
                })
              },
            })
          },
        }),
      SettledFetchRound: ({ sessionId, result }) =>
        Result.match(result, {
          onFailure: () => [
            evo(model, {
              activeSessionId: () => Option.some(sessionId),
              round: AsyncData.settle(result),
            }),
            [],
          ],
          onSuccess: round => [
            evo(model, {
              activeSessionId: () => Option.some(sessionId),
              round: AsyncData.settle(result),
              answers: () => initialAnswers(round),
            }),
            [],
          ],
        }),
      ClickedSession: ({ sessionId }) => [
        evo(model, {
          activeSessionId: () => Option.some(sessionId),
          round: () => RoundData.Loading(),
        }),
        [FetchRound({ sessionId })],
      ],
      ClickedRetryRound: () =>
        Option.match(model.activeSessionId, {
          onNone: () => [model, []],
          onSome: sessionId => [
            evo(model, { round: () => RoundData.Loading() }),
            [FetchRound({ sessionId })],
          ],
        }),
      ClickedOption: ({ questionId, label }) => {
        const maybeQuestion = Option.flatMap(AsyncData.getData(model.round), round =>
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
        Option.match(AsyncData.getData(model.round), {
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
            Option.match(AsyncData.getData(model.round), {
              onNone: () => [model, []],
              onSome: round => [
                evo(model, {
                  round: () => RoundData.Refreshing({ data: round }),
                }),
                [SubmitAnswer({ sessionId, round, answers: model.answers })],
              ],
            }),
        }),
      SettledSubmitAnswer: ({ sessionId, result }) =>
        Result.match(result, {
          onFailure: error => [
            evo(model, {
              round: AsyncData.settle<Round, string>(Result.fail(error)),
            }),
            [],
          ],
          onSuccess: () => [
            evo(model, { round: () => RoundData.Loading() }),
            [FetchInbox(), FetchRound({ sessionId })],
          ],
        }),
      ToggledTheme: () => {
        const isLight = !model.isLight
        return [evo(model, { isLight: () => isLight }), [SaveTheme({ isLight })]]
      },
      PersistedTheme: () => [model, []],
    }),
  )

export const FetchInbox = Command.define(
  'FetchInbox',
  SettledFetchInbox,
)(
  pipe(
    requestJson(HttpClientRequest.get('/api/sessions'), Inbox),
    Effect.mapError(() => 'Could not reach the local grill server.'),
    Effect.provide(Http.layer),
    Effect.result,
    Effect.map(result => SettledFetchInbox({ result })),
  ),
)

export const FetchRound = Command.define(
  'FetchRound',
  { sessionId: S.String },
  SettledFetchRound,
)(({ sessionId }) =>
  pipe(
    requestJson(
      HttpClientRequest.get('/api/round').pipe(HttpClientRequest.setUrlParam('session', sessionId)),
      Round,
    ),
    Effect.mapError(() => 'Could not load this round.'),
    Effect.provide(Http.layer),
    Effect.result,
    Effect.map(result => SettledFetchRound({ sessionId, result })),
  ),
)

export const SubmitAnswer = Command.define(
  'SubmitAnswer',
  { sessionId: S.String, round: Round, answers: S.Record(S.String, AnswerDraft) },
  SettledSubmitAnswer,
)(({ sessionId, round, answers }) =>
  pipe(
    Effect.gen(function* () {
      const answer = yield* S.decodeUnknownEffect(Answer)({
        sessionId,
        roundId: round.roundId,
        answers,
      })
      const request = yield* HttpClientRequest.post('/api/answer').pipe(
        HttpClientRequest.schemaBodyJson(Answer)(answer),
      )
      return yield* requestJson(request, Answer)
    }),
    Effect.mapError(() => 'The server rejected the answer. Complete every question and try again.'),
    Effect.provide(Http.layer),
    Effect.result,
    Effect.map(result => SettledSubmitAnswer({ sessionId, result })),
  ),
)

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
  const pending = Option.match(AsyncData.getData(model.inbox), {
    onNone: () => 0,
    onSome: inbox => inbox.sessions.filter(session => !session.answered).length,
  })

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
        AsyncData.matchData(model.inbox, {
          onEmpty: () => [
            h.p(
              [h.Class('muted')],
              [AsyncData.isLoading(model.inbox) ? 'Loading sessions…' : 'No sessions yet.'],
            ),
          ],
          onFailure: error => [h.p([h.Class('muted')], [error])],
          onData: inbox =>
            inbox.sessions.length === 0
              ? [h.p([h.Class('muted')], ['No sessions yet.'])]
              : inbox.sessions.map(session =>
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
        }),
      ),
      h.div(
        [h.Class('connection')],
        [h.span([h.Class('connection-dot')], []), connectionStatus(model)],
      ),
    ],
  )
}

const roundView = (model: Model): Html => {
  return AsyncData.matchDataSplitEmpty(model.round, {
    onIdle: () => roundLoadingView('Waiting for a round'),
    onLoading: () => roundLoadingView('Loading round…'),
    onFailure: error => roundFailureView(error),
    onData: round => roundFormView(model, round),
  })
}

const roundLoadingView = (message: string): Html => {
  const h = html<Message>()

  return h.div([h.Class('empty-state')], [h.h1([], [message])])
}

const roundFailureView = (error: string): Html => {
  const h = html<Message>()

  return h.div(
    [h.Class('empty-state')],
    [
      h.h1([], ['Could not load this round']),
      h.p([], [error]),
      h.button([h.Class('primary-action'), h.OnClick(ClickedRetryRound())], ['Retry']),
    ],
  )
}

const roundFormView = (model: Model, round: Round): Html => {
  const h = html<Message>()

  return h.div(
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
          h.p([h.Class('muted')], ['Every required question must be answered before submission.']),
          h.button(
            [h.Class('secondary-action'), h.OnClick(ClickedAcceptRecommended())],
            ['✓ Accept all recommended'],
          ),
          h.button([h.Class('primary-action'), h.OnClick(ClickedSubmit())], ['Submit answers']),
        ],
      ),
    ],
  )
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
                h.Value(option.label),
                h.Checked(selected),
                h.OnChange(value => ClickedOption({ questionId: question.id, label: value })),
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
        : h.a(
            [h.Href(link[2] ?? ''), h.Target('_blank'), h.Rel('noopener noreferrer')],
            [link[1] ?? ''],
          )
    })
}

const tableCells = (line: string): Array<string> =>
  line
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map(cell => cell.trim())

function requestJson<SchemaType extends S.Constraint>(
  request: HttpClientRequest.HttpClientRequest,
  schema: SchemaType,
): Effect.Effect<
  SchemaType['Type'],
  unknown,
  HttpClient.HttpClient | SchemaType['DecodingServices']
> {
  return Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient
    const response = yield* client.execute(request)
    const successfulResponse = yield* HttpClientResponse.filterStatusOk(response)

    return yield* HttpClientResponse.schemaBodyJson(schema)(successfulResponse)
  })
}

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
  transform: (draft: typeof AnswerDraft.Type) => typeof AnswerDraft.Type,
) => ({
  ...answers,
  [questionId]: transform(answers[questionId] ?? { selected: [], other: '', notes: '' }),
})

const isActive = (model: Model, sessionId: string): boolean =>
  Option.contains(model.activeSessionId, sessionId)

const connectionStatus = (model: Model): string =>
  AsyncData.match(model.inbox, {
    onIdle: () => 'Connecting…',
    onLoading: () => 'Connecting…',
    onRefreshing: inbox => roundConnectionStatus(model, inbox),
    onFailure: error => error,
    onStale: ({ error }) => error,
    onSuccess: inbox => roundConnectionStatus(model, inbox),
  })

const roundConnectionStatus = (model: Model, inbox: Inbox): string => {
  if (inbox.sessions.length === 0) return 'No sessions yet.'

  return AsyncData.match(model.round, {
    onIdle: () => 'Waiting for a round.',
    onLoading: () => 'Loading round…',
    onRefreshing: () => 'Submitting…',
    onFailure: error => error,
    onStale: ({ error }) => error,
    onSuccess: () => 'Connected',
  })
}

const readInitialTheme = (): boolean => {
  try {
    return localStorage.getItem('grill-theme') === 'light'
  } catch {
    return false
  }
}
