const mongoose = require('mongoose');

const JackpotGameSchema = new mongoose.Schema({
    channelId: String,
    messageId: String,
    isActive: Boolean,
    startTime: Date,
    endTime: Date,
    totalPot: { type: Number, default: 0 },
    deposits: [{
        userId: String,
        color: String,
        amount: Number,
        timestamp: Date
    }],
    colorTotals: {
        "🟡": { type: Number, default: 0 },
        "🟢": { type: Number, default: 0 },
        "⚫": { type: Number, default: 0 },
        "🔴": { type: Number, default: 0 },
        "🔵": { type: Number, default: 0 },
        "🟣": { type: Number, default: 0 },
        "🟠": { type: Number, default: 0 },
        "🟤": { type: Number, default: 0 },
        "⚪": { type: Number, default: 0 },
        "🟨": { type: Number, default: 0 },
        "🟩": { type: Number, default: 0 },
        "🟦": { type: Number, default: 0 }
    }
});

const JackpotGame = mongoose.model('JackpotGame', JackpotGameSchema);

module.exports = JackpotGame;