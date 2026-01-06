import bcrypt from "bcrypt";
import { generate } from "generate-password";

export const generatePassword = async () => {
  const password_generate = generate({
    length: 6,
    numbers: true,
  });
  const password_hash = await bcrypt.hash(password_generate, 10);

  return {
    password: password_generate,
    hashedPassword: password_hash,
  };
};



