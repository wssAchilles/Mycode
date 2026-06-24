const mongoose = require('mongoose');

async function test() {
    await mongoose.connect('mongodb+srv://Telegram:758205@telegram.wtcymhw.mongodb.net/telegram_clone?retryWrites=true&w=majority&appName=Telegram');

    const PostMediaSchema = new mongoose.Schema(
        {
            type: {
                type: String,
                enum: ['image', 'video', 'gif'],
                required: true,
            },
            url: { type: String, required: true },
            thumbnailUrl: String,
            width: Number,
            height: Number,
            duration: Number,
        },
        { _id: false }
    );

    const PostSchema = new mongoose.Schema({
        isNews: Boolean,
        media: {
            type: [PostMediaSchema],
            default: [],
        },
        content: String,
    }, { strict: false });

    const Post = mongoose.models.Post || mongoose.model('Post', PostSchema);

    // Let's create a new post with media, mimicking NewsMaterializationService
    const doc = await Post.findOneAndUpdate(
        { isNews: true, content: 'TEST_MONGO_MEDIA' },
        { 
            $set: { 
                content: 'TEST_MONGO_MEDIA',
                media: [
                    {
                        type: 'image',
                        url: 'https://test.com/image.jpg',
                        thumbnailUrl: 'https://test.com/image.jpg',
                    }
                ]
            }
        },
        { upsert: true, new: true }
    ).lean();

    console.log("Document media after update:", doc.media);
    
    await Post.deleteOne({ _id: doc._id });
    await mongoose.disconnect();
}

test().catch(console.error);
