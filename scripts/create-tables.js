const mysql = require('mysql2/promise');
require('dotenv').config();

async function createTables() {
    let connection;
    
    try {
        // Connect to MySQL server
        connection = await mysql.createConnection({
            host: process.env.DB_HOST || 'localhost',
            port: process.env.DB_PORT || 3306,
            user: process.env.DB_USER || 'root',
            password: process.env.DB_PASSWORD || ''
        });

        console.log('Connected to MySQL server.');

        // Create database
        const dbName = process.env.DB_NAME || 'lost_and_found';
        await connection.query(`CREATE DATABASE IF NOT EXISTS ${dbName}`);
        console.log(`Database '${dbName}' created or already exists.`);

        // Use the database
        await connection.query(`USE ${dbName}`);

        console.log('Creating tables...');

        // Drop tables if they exist (to start fresh)
        try {
            await connection.query('DROP TABLE IF EXISTS claims');
            await connection.query('DROP TABLE IF EXISTS lost_items');
            await connection.query('DROP TABLE IF EXISTS found_items');
            await connection.query('DROP TABLE IF EXISTS categories');
            await connection.query('DROP TABLE IF EXISTS students');
            console.log('Old tables dropped.');
        } catch (e) {
            console.log('No old tables to drop.');
        }

        // Create students table
        await connection.query(`
            CREATE TABLE students (
                id INT AUTO_INCREMENT PRIMARY KEY,
                student_id VARCHAR(20) UNIQUE NOT NULL,
                name VARCHAR(100) NOT NULL,
                email VARCHAR(100) UNIQUE NOT NULL,
                phone VARCHAR(15),
                password_hash VARCHAR(255) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            )
        `);
        console.log('✓ students table created');

        // Create lost_items table
        await connection.query(`
            CREATE TABLE lost_items (
                id INT AUTO_INCREMENT PRIMARY KEY,
                student_id INT NOT NULL,
                item_name VARCHAR(100) NOT NULL,
                description TEXT NOT NULL,
                location VARCHAR(200) NOT NULL,
                date_lost DATE NOT NULL,
                time_lost TIME,
                category VARCHAR(50),
                status VARCHAR(20) DEFAULT 'active',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
            )
        `);
        console.log('✓ lost_items table created');

        // Create found_items table
        await connection.query(`
            CREATE TABLE found_items (
                id INT AUTO_INCREMENT PRIMARY KEY,
                finder_id INT NOT NULL,
                item_name VARCHAR(100) NOT NULL,
                description TEXT NOT NULL,
                location VARCHAR(200) NOT NULL,
                date_found DATE NOT NULL,
                time_found TIME,
                category VARCHAR(50),
                status VARCHAR(20) DEFAULT 'active',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                FOREIGN KEY (finder_id) REFERENCES students(id) ON DELETE CASCADE
            )
        `);
        console.log('✓ found_items table created');

        // Create claims table
        await connection.query(`
            CREATE TABLE claims (
                id INT AUTO_INCREMENT PRIMARY KEY,
                lost_item_id INT NULL,
                found_item_id INT NOT NULL,
                claimer_id INT NOT NULL,
                status VARCHAR(20) DEFAULT 'requested',
                contact_date DATE NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                FOREIGN KEY (lost_item_id) REFERENCES lost_items(id) ON DELETE SET NULL,
                FOREIGN KEY (found_item_id) REFERENCES found_items(id) ON DELETE CASCADE,
                FOREIGN KEY (claimer_id) REFERENCES students(id) ON DELETE CASCADE
            )
        `);
        console.log('✓ claims table created');

        // Indexes for claims
        await connection.query('CREATE INDEX idx_claims_found_item_id ON claims(found_item_id)');
        await connection.query('CREATE INDEX idx_claims_claimer_id ON claims(claimer_id)');
        await connection.query('CREATE INDEX idx_claims_status ON claims(status)');
        console.log('✓ claim indexes created');

        // Create categories table
        await connection.query(`
            CREATE TABLE categories (
                id INT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(50) UNIQUE NOT NULL,
                description TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('✓ categories table created');

        // Insert categories one by one
        const categories = [
            ['Electronics', 'Phones, laptops, tablets, chargers, etc.'],
            ['Clothing', 'Jackets, bags, shoes, accessories, etc.'],
            ['Books', 'Textbooks, notebooks, stationery, etc.'],
            ['Personal Items', 'Keys, wallets, jewelry, etc.'],
            ['Sports Equipment', 'Sports gear, equipment, etc.'],
            ['Other', 'Miscellaneous items']
        ];

        for (const [name, description] of categories) {
            await connection.execute(
                'INSERT INTO categories (name, description) VALUES (?, ?)',
                [name, description]
            );
            console.log(`✓ Category '${name}' inserted`);
        }

        console.log('\n🎉 All tables created successfully!');
        console.log('You can now start the server with: npm run dev');

    } catch (error) {
        console.error('❌ Error:', error.message);
    } finally {
        if (connection) {
            await connection.end();
            console.log('Database connection closed.');
        }
    }
}

createTables();
