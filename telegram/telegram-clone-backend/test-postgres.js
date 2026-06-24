const { Client } = require('pg');
require('dotenv').config();

async function run() {
  const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  const res = await client.query('SELECT title, "coverImageUrl" FROM "news_articles" ORDER BY "createdAt" DESC LIMIT 5');
  console.log('Postgres NewsArticles:', res.rows);
  await client.end();
}
run().catch(console.error);
