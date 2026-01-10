import { title } from "process";

import bcrypt from "bcrypt";
import { tableNames } from "../../database/tableName.js";
import db from "../../database/index.js";

export const registerManagementService = async (
  tenant_id,
  title,
  username,
  email,
  country_code,
  mobile,
  password,
  role
) => {
  const passwordhashed = await bcrypt.hash(password, 10);

  try {
    const Query = `INSERT INTO ${tableNames?.MANAGEMENT} (
    tenant_id, title, username, email, country_code, mobile, password, role) VALUES ( ? , ? , ? , ? , ? , ? , ? , ?) `;

    const values = [
      tenant_id,
      title,
      username,
      email,
      country_code,
      mobile,
      passwordhashed,
      role,
    ];

    const [result] = await db.sequelize.query(Query, { replacements: values });
    return result;
  } catch (err) {
    throw err;
  }
};

export const loginManagementService = async (email) => {
  try {
    const Query = `SELECT * FROM ${tableNames?.MANAGEMENT} WHERE email = ? `;

    const [result] = await db.sequelize.query(Query, {
      replacements: [email],
    });
    return result[0];
  } catch (err) {
    throw err;
  }
};

export const getManagementService = async () => {
  const protectedEmails = ["contact@invictusglobaltech.com"];
  const Query = `SELECT id , name , email ,  mobile , role , status ,  created_at  FROM ${tableNames?.MANAGEMENT} ORDER BY created_at DESC `;

  try {
    const [result] = await db.sequelize.query(Query);
    const filteredManagement = result
      .filter((management) => !protectedEmails.includes(management.email))
      .map((management) => ({
        ...management,
      }));
    return filteredManagement;
  } catch (err) {
    throw err;
  }
};

export const getManagementByIdService = async (user_id) => {
  const Query = `SELECT id , name , email ,  mobile , role , status ,  created_at FROM ${tableNames?.MANAGEMENT} WHERE id = ? `;

  try {
    const [result] = await db.sequelize.query(Query, {
      replacements: [user_id],
    });

    const finalManagementUser = result?.map((managementUser) => ({
      ...managementUser,
      title: `${managementUser.title}.`,
    }));

    return finalManagementUser[0];
  } catch (err) {
    throw err;
  }
};

// export const updateManagementByIdService = async (
//   user_id,
//   title,
//   username,
//   email,
//   country_code,
//   mobile,
//   profile_picture,
//   role
// ) => {
// const updateFields = [];
// const updateValues = [];

// if (title) {
//   updateFields.push("title = ?");
//   updateValues.push(title);
// }

// if (username) {
//   updateFields.push("username = ?");
//   updateValues.push(username);
// }
// if (mobile) {
//   updateFields.push("mobile = ?");
//   updateValues.push(mobile);
// }
// if (country_code) {
//   updateFields.push("country_code = ?");
//   updateValues.push(country_code);
// }
// if (email) {
//   updateFields.push("email = ?");
//   updateValues.push(email);
// }

// if (profile_picture) {
//   updateFields.push("profile_picture = ?");
//   updateValues.push(profile_picture);
// }
// if (role) {
//   updateFields.push("role = ?");
//   updateValues.push(role);
// }

// const Query = `
//   UPDATE ${tableNames?.MANAGEMENT}
//   SET ${updateFields.join(", ")}
//   WHERE id = ?
// `;
// updateValues.push(user_id);

//   try {
//     const [result] = await db.sequelize.query(Query, {
//       replacements: updateValues,
//     });
//     return result;
//   } catch (err) {
//     throw err;
//   }
// };

// export const deleteManagementByIdService = async (user_id) => {
//   const Query = `DELETE FROM ${tableNames?.MANAGEMENT} WHERE id = ? `;

//   try {
//     const [result] = await db.sequelize.query(Query, {
//       replacements: [user_id],
//     });

//     return result[0];
//   } catch (err) {
//     throw err;
//   }
// };

// export const findManagementByEmailService = async (email) => {
//   const Query = `SELECT * FROM ${tableNames?.MANAGEMENT} WHERE email = ?`;

//   try {
//     const [result] = await db.sequelize.query(Query, { replacements: [email] });
//     return result[0];
//   } catch (err) {
//     throw err;
//   }
// };
