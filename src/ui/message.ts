import { Schema as S } from 'effect'
import { m } from 'foldkit/message'

import { Answer, Inbox, Round } from '../domain/contract.js'

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
export const ClickedOption = m('ClickedOption', {
  questionId: S.String,
  label: S.String,
})
export const UpdatedOther = m('UpdatedOther', {
  questionId: S.String,
  value: S.String,
})
export const UpdatedNotes = m('UpdatedNotes', {
  questionId: S.String,
  value: S.String,
})
export const ClickedAcceptRecommended = m('ClickedAcceptRecommended')
export const ClickedSubmit = m('ClickedSubmit')
export const ToggledTheme = m('ToggledTheme')
export const PersistedTheme = m('PersistedTheme')

export const AnswerFormMessage = S.Union([
  ClickedOption,
  UpdatedOther,
  UpdatedNotes,
  ClickedAcceptRecommended,
  ClickedSubmit,
])
export type AnswerFormMessage = typeof AnswerFormMessage.Type

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
