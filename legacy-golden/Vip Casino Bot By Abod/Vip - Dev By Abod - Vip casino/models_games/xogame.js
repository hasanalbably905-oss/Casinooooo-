const mongoose = require('mongoose');

const xogameSchema = new mongoose.Schema({
    messageId: String,
    playerX: String,
    playerO: String,
    currentPlayer: String,
    board: [[String]],
    bet: Number,
    lastMoveTime: {
        type: Date,
        default: Date.now
    },
    playerMoves: {
        type: Map,
        of: [[Number]], 
        default: {} 
    }
});

module.exports = mongoose.model('Xogame', xogameSchema);
