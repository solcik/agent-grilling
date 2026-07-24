import { Option } from 'effect'
import { AsyncData, Submodel } from 'foldkit'
import { type Document, type Html, html } from 'foldkit/html'

import { type ContextBlock, type Inbox, type Question, type Round } from '../domain/contract.js'
import {
  type AnswerFormMessage,
  ClickedAcceptRecommended,
  ClickedOption,
  ClickedRetryRound,
  ClickedSession,
  ClickedSubmit,
  type Message,
  ToggledTheme,
  UpdatedNotes,
  UpdatedOther,
} from './message.js'
import { type AnswerFormModel, type Model } from './model.js'

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
  const h = html<Message>()

  return AsyncData.matchDataSplitEmpty(model.round, {
    onIdle: () => roundLoadingView('Waiting for a round'),
    onLoading: () => roundLoadingView('Loading round…'),
    onFailure: error => roundFailureView(error),
    onData: round =>
      h.submodel({
        slotId: 'answer-form',
        model: model.answers,
        view: roundFormView,
        viewInputs: {
          activeSessionId: model.activeSessionId,
          round,
        },
        toParentMessage: message => message,
      }),
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

type AnswerFormViewInputs = Readonly<{
  activeSessionId: Model['activeSessionId']
  round: Round
}>

const roundFormView = Submodel.defineView<AnswerFormModel, AnswerFormMessage, AnswerFormViewInputs>(
  (answers, { activeSessionId, round }): Html => {
    const h = html<AnswerFormMessage>()

    return h.div(
      [h.Class('round-wrap')],
      [
        h.header(
          [h.Class('round-header')],
          [
            h.h1([], [round.title ?? 'Agent question']),
            Option.match(activeSessionId, {
              onNone: () => h.empty,
              onSome: sessionId => h.p([h.Class('session-tag')], [sessionId]),
            }),
            round.intro === undefined ? h.empty : h.p([h.Class('intro')], [round.intro]),
            contextView(round.context ?? []),
          ],
        ),
        ...round.questions.map(question => questionView(answers, question)),
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
    )
  },
)

const questionView = (answers: AnswerFormModel, question: Question): Html => {
  const h = html<AnswerFormMessage>()
  const draft = answers[question.id] ?? {
    selected: [],
    other: '',
    notes: '',
  }
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
                h.OnChange(value =>
                  ClickedOption({
                    questionId: question.id,
                    label: value,
                  }),
                ),
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
