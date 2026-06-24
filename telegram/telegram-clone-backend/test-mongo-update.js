const mongoose = require('mongoose');
mongoose.connect('mongodb+srv://Telegram:758205@telegram.wtcymhw.mongodb.net/telegram_clone?retryWrites=true&w=majority&appName=Telegram').then(async () => {
    const Post = mongoose.model('Post', new mongoose.Schema({
        isNews: Boolean,
        media: [{ type: String, url: String, thumbnailUrl: String }]
    }, { strict: false }));
    const result = await Post.findOneAndUpdate(
        { isNews: true },
        { $set: { media: [{ type: 'image', url: 'https://test.com/image.jpg', thumbnailUrl: 'https://test.com/image.jpg' }] } },
        { new: true }
    ).lean();
    console.log('Updated post media:', result.media);
    mongoose.disconnect();
});
