import { tableNames } from "../../tableName.js";

export const SequencesTable = (sequelize, Sequelize) => {
    return sequelize.define(
        tableNames.SEQUENCES,
        {
            name: {
                type: Sequelize.STRING,
                primaryKey: true,
                allowNull: false,
            },
            value: {
                type: Sequelize.INTEGER,
                defaultValue: 0,
                allowNull: false,
            },
            prefix: {
                type: Sequelize.STRING,
                allowNull: true,
            },
        },
        {
            tableName: tableNames.SEQUENCES,
            timestamps: false,
            underscored: true,
        }
    );
};
