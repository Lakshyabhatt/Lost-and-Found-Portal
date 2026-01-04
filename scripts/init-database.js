const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Database configuration
const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || ''
};

// Read schema file
const schemaPath = path.join(__dirname, '..', 'database', 'schema.sql');
const schema = fs.readFileSync(schemaPath, 'utf8');

async function initializeDatabase() {
    let connection;
    
    try {
        // Connect to MySQL server (without database)
        connection = await mysql.createConnection(dbConfig);
        console.log('Connected to MySQL server.');

        // Create database if it doesn't exist
        const dbName = process.env.DB_NAME || 'lost_and_found';
        await connection.execute(`CREATE DATABASE IF NOT EXISTS \`${dbName}\``);
        console.log(`Database '${dbName}' created or already exists.`);

        // Use the database
        await connection.execute(`USE \`${dbName}\``);

        // Execute schema statements one by one
        const statements = schema.split(';').filter(stmt => stmt.trim().length > 0);
        
        for (const statement of statements) {
            if (statement.trim()) {
                await connection.execute(statement.trim());
            }
        }
        
        console.log('Database schema created successfully!');
        console.log('Tables created:');
        console.log('- students');
        console.log('- lost_items');
        console.log('- found_items');
        console.log('- categories');

    } catch (error) {
        console.error('Error initializing database:', error.message);
    } finally {
        if (connection) {
            await connection.end();
            console.log('Database connection closed.');
        }
    }
}

// Run the initialization
initializeDatabase();
