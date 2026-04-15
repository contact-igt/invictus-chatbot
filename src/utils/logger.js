const isDev = process.env.NODE_ENV !== "production";

export const logger = {
  debug: (...args) => {
    if (isDev) {
      console.log(...args);
    }
  },
  error: (...args) => {
    console.error(...args);
  },
  info: (...args) => {
    console.log(...args);
  },
  warn: (...args) => {
    console.warn(...args);
  },
};

