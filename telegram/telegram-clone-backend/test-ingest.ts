import dotenv from 'dotenv';
dotenv.config();
import { newsService } from './src/services/newsService';
import mongoose from 'mongoose';
import { NewsMaterializationService } from './src/services/recommendation/newsMaterialization/NewsMaterializationService';
import Post from './src/models/Post';

async function test() {
  await mongoose.connect(process.env.MONGODB_URI || '');
  console.log('MongoDB connected');
  
  const dummyItem = {
    url: 'https://www.bbc.com/news/articles/dummy-test-' + Date.now(),
    title: 'Dummy Test Article',
    summary: 'This is a test article.',
    source: 'bbc_world',
    published: new Date().toISOString(),
    top_image: 'https://ichef.bbci.co.uk/news/1024/branded_news/c3ee/live/74d107a0-5457-11f1-8b8c-6d33e1d5abb6.jpg'
  };

  const count = await newsService.ingestArticles([dummyItem as any]);
  console.log('Ingested count:', count);

  const matService = new NewsMaterializationService();
  const res = await matService.materialize({ limit: 10 });
  console.log('Materialized:', res);

  const posts = await Post.find({ 'newsMetadata.title': 'Dummy Test Article' }).lean();
  console.log('Dummy Post media:', JSON.stringify(posts[0]?.media));
  
  process.exit(0);
}
test();
