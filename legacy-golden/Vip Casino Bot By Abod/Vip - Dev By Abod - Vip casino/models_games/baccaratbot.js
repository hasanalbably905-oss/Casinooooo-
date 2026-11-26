const mongoose = require('mongoose');

const baccaratbotSchema = new mongoose.Schema({
    messageId: {
        type: String,
        required: true
    },
    userId: {
        type: String,
        required: true
    },
    betAmount: {
        type: Number,
        required: true
    },
    betType: {
        type: String,
        enum: ['player', 'banker', 'tie'],
        default: null
    },
    gameActive: {
        type: Boolean,
        default: true
    },
    deckId: {
        type: Number,
        required: true
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('baccaratbot', baccaratbotSchema);