const mysql = require('mysql2/promise');

// Database configuration
const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'lost_and_found',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
};

// Create connection pool
const pool = mysql.createPool(dbConfig);

// Test database connection
const testConnection = async () => {
    try {
        const connection = await pool.getConnection();
        console.log('Connected to MySQL database:', dbConfig.database);
        connection.release();
    } catch (error) {
        console.error('Error connecting to MySQL database:', error.message);
    }
};

testConnection();

// Database helper functions
const dbHelpers = {
    // Get a single row
    get: async (sql, params = []) => {
        try {
            const [rows] = await pool.execute(sql, params);
            return rows[0] || null;
        } catch (error) {
            throw error;
        }
    },

    // Get all rows
    all: async (sql, params = []) => {
        try {
            const [rows] = await pool.execute(sql, params);
            return rows;
        } catch (error) {
            throw error;
        }
    },

    // Run a query (INSERT, UPDATE, DELETE)
    run: async (sql, params = []) => {
        try {
            const [result] = await pool.execute(sql, params);
            return { 
                id: result.insertId, 
                changes: result.affectedRows,
                insertId: result.insertId,
                affectedRows: result.affectedRows
            };
        } catch (error) {
            throw error;
        }
    },

    // Begin transaction
    beginTransaction: async () => {
        try {
            const connection = await pool.getConnection();
            await connection.beginTransaction();
            return connection;
        } catch (error) {
            throw error;
        }
    },

    // Commit transaction
    commit: async (connection) => {
        try {
            await connection.commit();
            connection.release();
        } catch (error) {
            throw error;
        }
    },

    // Rollback transaction
    rollback: async (connection) => {
        try {
            await connection.rollback();
            connection.release();
        } catch (error) {
            throw error;
        }
    },

    // Execute query with connection (for transactions)
    execute: async (connection, sql, params = []) => {
        try {
            const [result] = await connection.execute(sql, params);
            return result;
        } catch (error) {
            throw error;
        }
    }
};

module.exports = { pool, dbHelpers };
