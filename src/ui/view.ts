import * as Markdown from '@foldkit/markdown'
import { Checkbox, RadioGroup } from '@foldkit/ui'
import { Option } from 'effect'
import { AsyncData, Submodel } from 'foldkit'
import { type Attribute, type Document, type Html, html } from 'foldkit/html'

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
import { parseMarkdown } from './markdown.js'
import { type AnswerFormModel, type Model } from './model.js'

const markdownHtml = html<Message>()
const markdownViews: Markdown.Views = {
  ...Markdown.defaultViews,
  Link: (link, content) =>
    markdownHtml.a(
      [
        markdownHtml.Href(link.url),
        markdownHtml.Target('_blank'),
        markdownHtml.Rel('noopener noreferrer'),
      ],
      content,
    ),
}

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
      answerOptionsView(question, draft.selected),
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

const answerOptionsView = (question: Question, selectedLabels: ReadonlyArray<string>): Html =>
  question.multiSelect === true
    ? checkboxOptionsView(question, selectedLabels)
    : radioOptionsView(question, selectedLabels)

const radioOptionsView = (question: Question, selectedLabels: ReadonlyArray<string>): Html => {
  const h = html<AnswerFormMessage>()
  const optionByLabel = new Map(question.options.map(option => [option.label, option]))

  return RadioGroup.view<string, AnswerFormMessage>({
    id: `radio-${question.id}`,
    selectedValue: Option.fromNullishOr(selectedLabels[0]),
    options: question.options.map(option => option.label),
    ariaLabel: question.question,
    onSelect: label => ClickedOption({ questionId: question.id, label }),
    toView: ({ group, options }) =>
      h.div(
        [...group, h.Class('options')],
        options.map(option => {
          const answerOption = optionByLabel.get(option.value)

          return answerOption === undefined
            ? h.empty
            : h.div(
                [
                  ...option.option,
                  h.Key(option.value),
                  h.Class(`option ${option.isSelected ? 'selected' : ''}`),
                ],
                [
                  h.span([], [option.isSelected ? '◉' : '○']),
                  optionCopyView(answerOption, option.label, option.description),
                ],
              )
        }),
      ),
  })
}

const checkboxOptionsView = (question: Question, selectedLabels: ReadonlyArray<string>): Html => {
  const h = html<AnswerFormMessage>()

  return h.div(
    [h.Class('options')],
    question.options.map((option, index) => {
      const selected = selectedLabels.includes(option.label)

      return Checkbox.view<AnswerFormMessage>({
        id: `checkbox-${question.id}-${index}`,
        isChecked: selected,
        onToggle: () =>
          ClickedOption({
            questionId: question.id,
            label: option.label,
          }),
        toView: attributes =>
          h.div(
            [h.Key(option.label), h.Class(`option ${selected ? 'selected' : ''}`)],
            [
              h.span([...attributes.checkbox], [selected ? '☑' : '☐']),
              optionCopyView(option, attributes.label, attributes.description),
            ],
          ),
      })
    }),
  )
}

const optionCopyView = (
  option: Question['options'][number],
  labelAttributes: ReadonlyArray<Attribute<AnswerFormMessage>>,
  descriptionAttributes: ReadonlyArray<Attribute<AnswerFormMessage>>,
): Html => {
  const h = html<AnswerFormMessage>()

  return h.span(
    [h.Class('option-copy')],
    [
      h.span(
        [...labelAttributes, h.Class('option-label')],
        [
          option.label,
          option.recommended === true ? h.span([h.Class('recommended')], ['Recommended']) : h.empty,
        ],
      ),
      option.description === undefined
        ? h.span([...descriptionAttributes], [])
        : h.span([...descriptionAttributes, h.Class('option-description')], [option.description]),
      option.preview === undefined ? h.empty : contextView([option.preview]),
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
      return h.div(
        [h.Key(`markdown-${index}`), h.Class('markdown')],
        Markdown.viewBlocks(parseMarkdown(block.text), {
          views: markdownViews,
        }),
      )
    }),
  )
}

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
