// The same capnweb wire crosses a runtime port and an offscreen dedicated-worker channel.
export function messageTransport(send, abort) {
  const queue = [];
  let waiting;
  let ended;
  const close = (error) => {
    if (ended) return;
    ended = error;
    queue.length = 0;
    waiting?.reject(error);
    waiting = null;
  };
  return {
    send(message) {
      if (ended) throw ended;
      send({ type: "rpc", message });
    },
    receive() {
      if (ended) return Promise.reject(ended);
      if (queue.length) return Promise.resolve(queue.shift());
      return new Promise((resolve, reject) => {
        waiting = { resolve, reject };
      });
    },
    accept(message) {
      if (ended) return;
      if (message?.type !== "rpc" || typeof message.message !== "string") {
        const error = new Error("Invalid extension transport frame.");
        close(error);
        abort(error);
        return;
      }
      if (waiting) {
        waiting.resolve(message.message);
        waiting = null;
      } else queue.push(message.message);
    },
    close,
    abort(error) {
      close(error);
      abort(error);
    },
  };
}
