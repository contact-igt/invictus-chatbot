import db from "../../database/index.js";
import { tableNames } from "../../database/tableName.js";

export const createTenantService = async (
  name,
  email,
  country_code,
  mobile,
  type
) => {
  const Query = `INSERT INTO ${tableNames?.TENANTS} (name, email, country_code , mobile, type) VALUES (?,?,?,?,?)`;

  try {
    const values = [name, email, country_code, mobile, type];
    console.log("values", values);

    const [result] = await db.sequelize.query(Query, {
      replacements: values,
    });

    return result;
  } catch (err) {
    throw err;
  }
};

export const getAllTenantService = async () => {
  const Query = `SELECT * FROM ${tableNames?.TENANTS} ORDER BY id DESC `;

  try {
    const [result] = await db.sequelize.query(Query);
    return result;
  } catch (err) {
    throw err;
  }
};

export const getTenantByidService = async (id) => {
  const Query = `SELECT * FROM ${tableNames?.TENANTS} WHERE id = ?  `;
  try {
    const [result] = await db.sequelize.query(Query, {
      replacements: [id],
    });
    return result[0];
  } catch (err) {
    throw err;
  }
};

export const updateTenantService = async (
  name,
  email,
  country_code,
  mobile,
  type,
  id
) => {
  const updateFields = [];
  const updateValues = [];

  if (name) {
    updateFields.push("name = ?");
    updateValues.push(name);
  }

  if (country_code) {
    updateFields.push("country_code = ?");
    updateValues.push(country_code);
  }

  if (mobile) {
    updateFields.push("mobile = ?");
    updateValues.push(mobile);
  }

  if (email) {
    updateFields.push("email = ?");
    updateValues.push(email);
  }

  if (type) {
    updateFields.push("type = ?");
    updateValues.push(type);
  }

  const Query = `
    UPDATE ${tableNames?.TENANTS}
    SET ${updateFields.join(", ")}
    WHERE id = ?
  `;
  updateValues.push(id);

  try {
    const [result] = await db.sequelize.query(Query, {
      replacements: updateValues,
    });
    return result;
  } catch (err) {
    throw err;
  }
};

export const updateTenantStatusService = async (status, id) => {
  const Query = `UPDATE ${tableNames?.TENANTS} SET status = ? WHERE id = ? `;

  try {
    const [result] = await db.sequelize.query(Query, {
      replacements: [status, id],
    });

    return result;
  } catch (err) {
    throw err;
  }
};

export const deleteTenantService = async (id) => {
  const Query = `DELETE FROM ${tableNames?.TENANTS} WHERE id = ?`;

  try {
    const [result] = await db.sequelize.query(Query, { replacements: [id] });

    return result;
  } catch (err) {
    throw err;
  }
};

export const findTenantByIdService = async (id) => {
  const Query = `SELECT * FROM ${tableNames?.TENANTS} WHERE id = ? LIMIT 1`;

  try {
    const [result] = await db.sequelize.query(Query, { replacements: [id] });
    return result[0];
  } catch (err) {
    throw err;
  }
};


