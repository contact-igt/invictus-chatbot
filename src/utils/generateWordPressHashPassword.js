import { HashPassword } from "wordpress-hash-node";

export const generateWordPressHashedPassword = (plainPassword) => {
  return HashPassword(plainPassword);
};
