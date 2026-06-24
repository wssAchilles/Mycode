const mongoose = require('mongoose');

async function test() {
    await mongoose.connect('mongodb+srv://Telegram:758205@telegram.wtcymhw.mongodb.net/telegram_clone?retryWrites=true&w=majority&appName=Telegram');
    const Post = mongoose.model('Post', new mongoose.Schema({ isNews: Boolean, media: mongoose.Schema.Types.Mixed }, { strict: false }));
    const p = await Post.findOne({ isNews: true }).lean();
    console.log("Found post:", p.newsMetadata.title);
    console.log("Media array:", JSON.stringify(p.media, null, 2));
    await mongoose.disconnect();
}
test().catch(console.error);
