import { sequelize } from './src/config/sequelize';
import { NewsArticle } from './src/models/NewsArticle';
async function run() {
  const articles = await NewsArticle.findAll({ limit: 5 });
  console.log(JSON.stringify(articles.map((a: any) => ({ id: a.id, title: a.title, coverImageUrl: a.coverImageUrl })), null, 2));
  process.exit(0);
}
run();
