const mongoose = require('mongoose');

const blackjackSchema = new mongoose.Schema({
    msgID: { type: String, required: true },
    idstusr: { type: String, required: true },
    idwhusr: { type: String, required: true },
    deck: { type: Array, default: [] },
    role: { type: String, default: null },
    notrole: { type: String, default: null },
    coins: { type: Number, required: true }
});

module.exports = mongoose.model('blackjack', blackjackSchema);