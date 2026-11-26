const mongoose = require('mongoose');

const botolaWhitelistSchema = new mongoose.Schema({
      userId: { type: String, required: true, unique: true },
        username: String,
          guildId: String,
            addedBy: String,
              addedAt: { type: Date, default: Date.now },
                reason: String
}, { timestamps: true });

botolaWhitelistSchema.index({ userId: 1 });
botolaWhitelistSchema.index({ guildId: 1 });

module.exports = mongoose.model('BotolaWhitelist', botolaWhitelistSchema);