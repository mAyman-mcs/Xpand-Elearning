import type { AppDeps, RouteContext } from "../../core/context.js";
import { authOf } from "../../core/context.js";
import { access, ApiRouter, created } from "../../core/route.js";
import { idParams } from "../../core/schemas.js";
import {
  answerBody,
  answerParams,
  attemptOutcome,
  eventBody,
  getAttempt,
  heartbeat,
  moveTo,
  positionBody,
  reportEvent,
  saveAnswer,
  startAttempt,
  startBody,
  submitAttempt,
} from "./service.js";

/** The login session: an attempt belongs to the session that started it (one device). */
const sessionOf = (ctx: RouteContext) => authOf(ctx).session.id;

/** Mounted at /api/attempts: the exam session. Students only, and only their own attempts. */
export function attemptsRoutes(deps: AppDeps): ApiRouter {
  const api = new ApiRouter(deps);
  const student = access.roles("STUDENT");

  api.post("/", {
    access: student,
    body: startBody,
    handler: async (ctx, { body }) => {
      const r = await startAttempt(ctx, body.examId, sessionOf(ctx));
      return r.created ? created(r.view) : r.view;
    },
  });
  api.get("/:id", {
    access: student,
    params: idParams,
    handler: (ctx, { params }) => getAttempt(ctx, params.id, sessionOf(ctx)),
  });
  api.get("/:id/outcome", {
    access: student,
    params: idParams,
    handler: (ctx, { params }) => attemptOutcome(ctx, params.id),
  });
  api.put("/:id/answers/:questionId", {
    access: student,
    params: answerParams,
    body: answerBody,
    handler: (ctx, { params, body }) =>
      saveAnswer(ctx, params.id, params.questionId, sessionOf(ctx), body.selectedOptionIds),
  });
  api.post("/:id/position", {
    access: student,
    params: idParams,
    body: positionBody,
    handler: (ctx, { params, body }) => moveTo(ctx, params.id, sessionOf(ctx), body.index),
  });
  api.post("/:id/events", {
    access: student,
    params: idParams,
    body: eventBody,
    handler: (ctx, { params, body }) => reportEvent(ctx, params.id, sessionOf(ctx), body),
  });
  api.post("/:id/heartbeat", {
    access: student,
    params: idParams,
    handler: (ctx, { params }) => heartbeat(ctx, params.id, sessionOf(ctx)),
  });
  api.post("/:id/submit", {
    access: student,
    params: idParams,
    handler: (ctx, { params }) => submitAttempt(ctx, params.id, sessionOf(ctx)),
  });
  return api;
}
