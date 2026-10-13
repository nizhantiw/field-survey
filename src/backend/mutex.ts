export function createKeyMutex() {
  const tails = new Map<string, Promise<unknown>>();
  return function exclusive<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = tails.get(key) ?? Promise.resolve();
    const run = previous.then(task, task);
    tails.set(
      key,
      run.then(
        () => undefined,
        () => undefined,
      ),
    );
    return run;
  };
}
