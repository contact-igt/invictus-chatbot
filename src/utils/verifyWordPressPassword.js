import { CheckPassword } from "wordpress-hash-node";

export const verifyWordPressPassword = (inputPassword, wpHashedPassword) => {
  console.log(inputPassword, wpHashedPassword);

  return CheckPassword(inputPassword, wpHashedPassword);
};
