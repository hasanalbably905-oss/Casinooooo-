const mongoose = require('mongoose');

const rpsSchema = new mongoose.Schema({
    messageId: String,
    player1: String,
    player2: String,
    betAmount: Number,
    player1Wins: { type: Number, default: 0 },
    player2Wins: { type: Number, default: 0 },
    gameStatus: { type: String, default: 'active' },
    currentTurn: String,
    player1Choice: String,
    player2Choice: String,
    roundPhase: { type: String, default: 'player1_turn' },
    // Store all rounds history
    roundHistory: [{
        player1Choice: String,
        player2Choice: String,
        result: String // 'player1', 'player2', 'tie'
    }],
    // Random order for display
    displayOrder: [String],
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('rps', rpsSchema);