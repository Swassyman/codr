import { z } from 'zod';

/** An error with a stable machine-readable code that is safe to show to the client. */
export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (code: string, message: string, details?: unknown) =>
  new HttpError(400, code, message, details);
export const unauthorized = (message = 'Sign in to continue.') => new HttpError(401, 'unauthorized', message);
export const forbidden = (code = 'forbidden', message = 'You do not have access to this.') =>
  new HttpError(403, code, message);
export const notFound = (message = 'Not found.') => new HttpError(404, 'not_found', message);
export const conflict = (code: string, message: string, details?: unknown) => new HttpError(409, code, message, details);
export const tooMany = (code: string, message: string, details?: unknown) => new HttpError(429, code, message, details);

/** Parse untrusted input with a Zod schema, turning failures into a 400. */
export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw badRequest(
      'validation_failed',
      'Some fields are invalid.',
      result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }
  return result.data;
}

export const idParam = z.object({ id: z.coerce.number().int().positive() });
