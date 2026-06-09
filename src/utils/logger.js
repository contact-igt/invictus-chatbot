const isDev = process.env.NODE_ENV !== "production";

export const logger = {
  debug: (...args) => {
    if (isDev) {
      
    }
  },
  warn: (...args) => {
    console.warn(...args);
  },
  error: (...args) => {
    console.error(...args);
  },
  info: (...args) => {
    
  },
  warn: (...args) => {
    console.warn(...args);
  },
};

