import { createRequestCoordinator, isCanceledRequest } from './requestCoordinator';

describe('request coordinator', () => {
  test('aborts the previous request and rejects a late response as stale', () => {
    const coordinator = createRequestCoordinator();
    const first = coordinator.begin();
    const second = coordinator.begin();

    expect(first.signal.aborted).toBe(true);
    expect(first.isCurrent()).toBe(false);
    expect(second.signal.aborted).toBe(false);
    expect(second.isCurrent()).toBe(true);
  });

  test('cancel invalidates the active request', () => {
    const coordinator = createRequestCoordinator();
    const request = coordinator.begin();

    coordinator.cancel();

    expect(request.signal.aborted).toBe(true);
    expect(request.isCurrent()).toBe(false);
  });

  test('recognizes browser and axios cancellation shapes', () => {
    expect(isCanceledRequest({ name: 'AbortError' })).toBe(true);
    expect(isCanceledRequest({ name: 'CanceledError' })).toBe(true);
    expect(isCanceledRequest({ code: 'ERR_CANCELED' })).toBe(true);
    expect(isCanceledRequest(new Error('network failed'))).toBe(false);
  });
});
