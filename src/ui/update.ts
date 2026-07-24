import { Match as M, Option, Result } from 'effect'
import { AsyncData, Command, Runtime } from 'foldkit'
import { evo } from 'foldkit/struct'

import { type Round } from '../domain/contract.js'
import { FetchInbox, FetchRound, SaveTheme, SubmitAnswer } from './command.js'
import { type Message } from './message.js'
import {
  type Flags,
  type Model,
  InboxData,
  RoundData,
  initialAnswers,
  recommendedAnswers,
  updateDraft,
} from './model.js'

export const init: Runtime.ApplicationInit<Model, Message, Flags> = flags => [
  {
    inbox: InboxData.Loading(),
    activeSessionId: Option.none(),
    round: RoundData.Idle(),
    answers: {},
    isLight: flags.isLight,
  },
  [FetchInbox()],
]

type UpdateReturn = readonly [Model, ReadonlyArray<Command.Command<Message>>]
const withUpdateReturn = M.withReturnType<UpdateReturn>()

export const update = (model: Model, message: Message): UpdateReturn =>
  M.value(message).pipe(
    withUpdateReturn,
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
            const current = model.answers[questionId] ?? {
              selected: [],
              other: '',
              notes: '',
            }
            const selected =
              question.multiSelect === true
                ? current.selected.includes(label)
                  ? current.selected.filter(selectedLabel => selectedLabel !== label)
                  : [...current.selected, label]
                : [label]
            return [
              evo(model, {
                answers: () => ({
                  ...model.answers,
                  [questionId]: { ...current, selected },
                }),
              }),
              [],
            ]
          },
        })
      },
      UpdatedOther: ({ questionId, value }) => [
        evo(model, {
          answers: () =>
            updateDraft(model.answers, questionId, draft => ({
              ...draft,
              other: value,
            })),
        }),
        [],
      ],
      UpdatedNotes: ({ questionId, value }) => [
        evo(model, {
          answers: () =>
            updateDraft(model.answers, questionId, draft => ({
              ...draft,
              notes: value,
            })),
        }),
        [],
      ],
      ClickedAcceptRecommended: () =>
        Option.match(AsyncData.getData(model.round), {
          onNone: () => [model, []],
          onSome: round => [
            evo(model, {
              answers: () => recommendedAnswers(round, model.answers),
            }),
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
