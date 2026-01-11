// backend/db.js
const { Pool } = require("pg");
require("dotenv").config();

const pool = new Pool({
  host: process.env.PGHOST,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE,
  port: process.env.PGPORT,
  ssl: { rejectUnauthorized: false },
});

// Function to initialize database tables
const initDB = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name VARCHAR(50) NOT NULL UNIQUE,
        password VARCHAR(50) NOT NULL,
        balance INTEGER DEFAULT 500,
        recharge_due DATE
      );

      CREATE TABLE IF NOT EXISTS channels (
        id SERIAL PRIMARY KEY,
        name VARCHAR(50) NOT NULL,
        price INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS user_channels (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        channel_id INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
        PRIMARY KEY (user_id, channel_id)
      );
    `);
    console.log("✅ Database tables are ready");
  } catch (err) {
    console.error("❌ Error creating tables:", err);
  }
};

// Run the initialization when this module is loaded
initDB();

module.exports = pool;
