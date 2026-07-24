import { Schema as S } from 'effect'
import { AsyncData } from 'foldkit'

import { Inbox, type Question, Round } from '../domain/contract.js'

export const AnswerDraft = S.Struct({
  selected: S.Array(S.String),
  other: S.String,
  notes: S.String,
})
export type AnswerDraft = typeof AnswerDraft.Type

export const AnswerFormModel = S.Record(S.String, AnswerDraft)
export type AnswerFormModel = typeof AnswerFormModel.Type

export const InboxData = AsyncData.Schema(Inbox, S.String)
export const RoundData = AsyncData.Schema(Round, S.String)

type InboxData = typeof InboxData.schema.Type
type RoundData = typeof RoundData.schema.Type

export const Model = S.Struct({
  inbox: InboxData.schema,
  activeSessionId: S.Option(S.String),
  round: RoundData.schema,
  answers: AnswerFormModel,
  isLight: S.Boolean,
})
export type Model = typeof Model.Type

export const Flags = S.Struct({
  isLight: S.Boolean,
})
export type Flags = typeof Flags.Type

export const initialAnswers = (round: Round): AnswerFormModel =>
  Object.fromEntries(
    round.questions.map(question => [
      question.id,
      { selected: recommendedLabels(question), other: '', notes: '' },
    ]),
  )

export const recommendedAnswers = (round: Round, previous: AnswerFormModel): AnswerFormModel =>
  Object.fromEntries(
    round.questions.map(question => [
      question.id,
      {
        ...(previous[question.id] ?? { selected: [], other: '', notes: '' }),
        selected: recommendedLabels(question),
      },
    ]),
  )

export const updateDraft = (
  answers: AnswerFormModel,
  questionId: string,
  transform: (draft: AnswerDraft) => AnswerDraft,
): AnswerFormModel => ({
  ...answers,
  [questionId]: transform(answers[questionId] ?? { selected: [], other: '', notes: '' }),
})

const recommendedLabels = (question: Question): Array<string> => {
  const labels = question.options
    .filter(option => option.recommended === true)
    .map(option => option.label)
  return question.multiSelect === true ? labels : labels.slice(0, 1)
}
