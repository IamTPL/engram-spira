import { describe, test, expect } from 'bun:test';
import {
  AppError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  ValidationError,
  TooManyRequestsError,
  PayloadTooLargeError,
} from '../../src/shared/errors';

describe('AppError', () => {
  test('stores statusCode and message', () => {
    const err = new AppError(500, 'Server error');
    expect(err.statusCode).toBe(500);
    expect(err.message).toBe('Server error');
    expect(err.name).toBe('AppError');
    expect(err).toBeInstanceOf(Error);
  });
});

describe('UnauthorizedError', () => {
  test('defaults to 401 + "Unauthorized"', () => {
    const err = new UnauthorizedError();
    expect(err.statusCode).toBe(401);
    expect(err.message).toBe('Unauthorized');
    expect(err.name).toBe('UnauthorizedError');
  });

  test('accepts custom message', () => {
    const err = new UnauthorizedError('Token expired');
    expect(err.message).toBe('Token expired');
  });
});

describe('ForbiddenError', () => {
  test('defaults to 403', () => {
    const err = new ForbiddenError();
    expect(err.statusCode).toBe(403);
    expect(err.message).toBe('Forbidden');
    expect(err.name).toBe('ForbiddenError');
  });
});

describe('NotFoundError', () => {
  test('formats resource name into message', () => {
    const err = new NotFoundError('Deck');
    expect(err.statusCode).toBe(404);
    expect(err.message).toBe('Deck not found');
    expect(err.name).toBe('NotFoundError');
  });
});

describe('ConflictError', () => {
  test('returns 409', () => {
    const err = new ConflictError('Already exists');
    expect(err.statusCode).toBe(409);
    expect(err.message).toBe('Already exists');
    expect(err.name).toBe('ConflictError');
  });
});

describe('ValidationError', () => {
  test('returns 422', () => {
    const err = new ValidationError('Invalid input');
    expect(err.statusCode).toBe(422);
    expect(err.message).toBe('Invalid input');
    expect(err.name).toBe('ValidationError');
  });
});

describe('TooManyRequestsError', () => {
  test('defaults to 429', () => {
    const err = new TooManyRequestsError();
    expect(err.statusCode).toBe(429);
    expect(err.message).toBe('Too many requests');
    expect(err.name).toBe('TooManyRequestsError');
  });

  test('accepts custom message', () => {
    const err = new TooManyRequestsError('Slow down');
    expect(err.message).toBe('Slow down');
  });
});

describe('PayloadTooLargeError', () => {
  test('returns 413', () => {
    const err = new PayloadTooLargeError();
    expect(err.statusCode).toBe(413);
    expect(err.message).toBe('Payload too large');
    expect(err.name).toBe('PayloadTooLargeError');
  });
});
