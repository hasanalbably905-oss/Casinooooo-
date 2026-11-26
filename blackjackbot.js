const mongoose = require('mongoose');

const blackjackbotSchema = new mongoose.Schema({
    messageId: String,
    userId: String,
    playerHand: Array, // Keep for backward compatibility
    playerHands: Array, // New: Array of hands for split functionality
    botHand: Array,
    deckId: { type: Number },
    betAmount: Number,
    splitBets: Array, // New: Array of bet amounts for each hand
    currentHandIndex: { type: Number, default: 0 }, // New: Which hand is currently being played
    canSplit: { type: Boolean, default: false }, // New: Whether splitting is allowed
    canDouble: Boolean,
    aceSplit: { type: Boolean, default: false }, // New: Whether this is an ace split
    gameActive: Boolean,
    withdrawRefund: Number,
    withdrawRequested: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now },
    bj_wins: { type: Number, default: 0 },
    bj_losses: { type: Number, default: 0 },
    bj_draws: { type: Number, default: 0 },
    bj_withdraws: { type: Number, default: 0 },
    bj_coins_won: { type: Number, default: 0 },
    bj_coins_lost: { type: Number, default: 0 },
    bj_coins_refunded: { type: Number, default: 0 }
});
module.exports = mongoose.model('blackjackbot', blackjackbotSchema);