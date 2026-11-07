const MAX_CONCURRENT_RENDERS = 2;

let activeRenders = 0;
const waiting: Array<() => void> = [];

function startNext() {
  const next = waiting.shift();
  if (next) {
    next();
  }
}

export function scheduleRender<T>(task: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const run = () => {
      activeRenders += 1;
      Promise.resolve()
        .then(task)
        .then(resolve, reject)
        .finally(() => {
          activeRenders -= 1;
          startNext();
        });
    };

    if (activeRenders < MAX_CONCURRENT_RENDERS) {
      run();
    } else {
      waiting.push(run);
    }
  });
}
