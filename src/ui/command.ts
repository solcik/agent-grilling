import { Effect, Schema as S, pipe } from 'effect'
import { HttpClient, HttpClientRequest, HttpClientResponse } from 'effect/unstable/http'
import { Command, Http } from 'foldkit'

import { Answer, Inbox, Round } from '../domain/contract.js'
import {
  PersistedTheme,
  SettledFetchInbox,
  SettledFetchRound,
  SettledSubmitAnswer,
} from './message.js'
import { AnswerDraft } from './model.js'

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
  {
    sessionId: S.String,
    round: Round,
    answers: S.Record(S.String, AnswerDraft),
  },
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
