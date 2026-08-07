export const tracing = {
  enterSpan(_name, callback) {
    return callback({ isTraced: false, setAttribute() {} });
  },
};
