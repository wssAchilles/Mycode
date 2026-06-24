import dotenv from 'dotenv';
dotenv.config();
import { newsStorageService } from './src/services/newsStorageService';

async function test() {
  const url = 'https://ichef.bbci.co.uk/news/1024/branded_news/c3ee/live/74d107a0-5457-11f1-8b8c-6d33e1d5abb6.jpg';
  console.log('Testing image upload for:', url);
  try {
    const result = await newsStorageService.saveImageFromUrl('test-123', url);
    console.log('Result:', result);
  } catch (err) {
    console.error('Error:', err);
  }
}

test();
