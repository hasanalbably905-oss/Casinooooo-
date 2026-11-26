const mongoose = require('mongoose');

const matchBetSchema = new mongoose.Schema({
    guildId: {
        type: String,
        required: true
    },
    userId: {
        type: String,
        required: true
    },
    matchId: {
        type: String,
        required: true
    },
    teamBet: {
        type: String, // اسم الفريق الذي تم الرهان عليه
        required: true
    },
    amount: {
        type: Number, // كمية النقاط أو العملات المراهن بها
        required: true,
        default: 0
    },
    status: {
        type: String, // حالة الرهان: 'pending', 'won', 'lost'
        default: 'pending'
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('MatchBet', matchBetSchema);