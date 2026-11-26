const mongoose = require('mongoose');

const rpsuserSchema = new mongoose.Schema({
    id: String,
    messageId: String,
    choice: String,
    round: Number,
    timestamp: { type: Date, default: Date.now }
});

module.exports = mongoose.model('rpsuser', rpsuserSchema);