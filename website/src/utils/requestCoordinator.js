export function createRequestCoordinator(createController = () => new AbortController()) {
  let requestVersion = 0;
  let currentController = null;

  return {
    begin() {
      if (currentController) currentController.abort();
      const controller = createController();
      currentController = controller;
      const version = ++requestVersion;

      return {
        signal: controller.signal,
        abort() {
          controller.abort();
        },
        isCurrent() {
          return version === requestVersion && !controller.signal.aborted;
        },
      };
    },
    cancel() {
      requestVersion += 1;
      if (currentController) currentController.abort();
      currentController = null;
    },
  };
}

export function isCanceledRequest(error) {
  return error?.name === 'AbortError'
    || error?.name === 'CanceledError'
    || error?.code === 'ERR_CANCELED';
}
