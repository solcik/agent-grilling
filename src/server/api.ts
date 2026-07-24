import { Schema } from 'effect'
import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiError,
  HttpApiGroup,
  OpenApi,
} from 'effect/unstable/httpapi'

import { Answer, Inbox, Round } from '../domain/contract.js'

export const Health = Schema.Struct({ status: Schema.Literal('ok') })

export const RoundRequest = Schema.Struct({
  sessionId: Schema.String,
  round: Round,
})

export const SessionRequest = Schema.Struct({ sessionId: Schema.String })

export const ResetResult = Schema.Struct({ reset: Schema.Boolean })

export const GrillApi = HttpApi.make('grill')
  .add(
    HttpApiGroup.make('grill').add(
      HttpApiEndpoint.get('health', '/api/health', { success: Health }),
      HttpApiEndpoint.get('sessions', '/api/sessions', {
        success: Inbox,
        error: HttpApiError.BadRequestNoContent,
      }),
      HttpApiEndpoint.get('round', '/api/round', {
        query: { session: Schema.String },
        success: Round,
        error: [HttpApiError.BadRequestNoContent, HttpApiError.NotFoundNoContent],
      }),
      HttpApiEndpoint.post('postRound', '/api/round', {
        payload: RoundRequest,
        success: Round,
        error: HttpApiError.BadRequestNoContent,
      }),
      HttpApiEndpoint.get('answer', '/api/answer', {
        query: { session: Schema.String },
        success: Answer,
        error: [HttpApiError.BadRequestNoContent, HttpApiError.NotFoundNoContent],
      }),
      HttpApiEndpoint.post('postAnswer', '/api/answer', {
        payload: Answer,
        success: Answer,
        error: [HttpApiError.BadRequestNoContent, HttpApiError.NotFoundNoContent],
      }),
      HttpApiEndpoint.post('reset', '/api/reset', {
        payload: SessionRequest,
        success: ResetResult,
        error: HttpApiError.BadRequestNoContent,
      }),
    ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: 'grill',
      version: '0.1.0',
      description: 'A local inbox for agent questions.',
    }),
  )
