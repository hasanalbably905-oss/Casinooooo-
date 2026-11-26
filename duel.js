const mongoose = require('mongoose');

const duelSchema = new mongoose.Schema({
    // معرف اللاعب الأول
    player1Id: {
        type: String,
        required: true
    },
    // معرف اللاعب الثاني
    player2Id: {
        type: String,
        required: true
    },
    // حالة المبارزة (مثلاً: pending, active, finished)
    status: {
        type: String,
        default: 'pending'
    },
    // الرهان أو الجائزة (اختياري)
    bet: {
        type: Number,
        default: 0
    },
    // الفائز بالمبارزة
    winnerId: {
        type: String,
        default: null
    },
    // وقت بدء التحدي
    createdAt: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('Duel', duelSchema);