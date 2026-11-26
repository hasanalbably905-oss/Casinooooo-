const mongoose = require('mongoose');

const s7bSchema = new mongoose.Schema({
    user: { type: String, required: true }, 
    msgID: { type: String, required: true, default: "0" },
    channelID: { type: String, required: true, default: "0" },
    coins: { type: Number, default: 0 },
    status: { type: String, enum: ['pending', 'active'], default: 'pending' }
});

const S7b = mongoose.model('S7b', s7bSchema);

module.exports = S7b;