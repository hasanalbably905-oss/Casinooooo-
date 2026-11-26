const mongoose = require('mongoose');

const blackjackusrSchema = new mongoose.Schema({
    id: { type: String, required: true },
    hand: { type: Array, default: [] },
    stand: { type: Boolean, default: false },
    result: { type: Number, default: 0 }
});

module.exports = mongoose.model('blackjackusr', blackjackusrSchema); 