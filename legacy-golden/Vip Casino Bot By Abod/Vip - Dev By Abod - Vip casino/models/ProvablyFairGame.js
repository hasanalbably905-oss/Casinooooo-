const mongoose = require('mongoose');

const ProvablyFairGameSchema = new mongoose.Schema({
    gameId: { type: String, required: true, unique: true },
    userId: { type: String, required: true },
    serverSeed: { type: String, required: true },
    clientSeed: { type: String, default: () => require('crypto').randomBytes(16).toString('hex') },
    nonce: { type: Number, required: true },
    hash: { type: String, required: true },
    result: { type: mongoose.Schema.Types.Mixed },
    gameType: { type: String },
    revealed: { type: Boolean, default: false },
    revealedAt: Date,
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('ProvablyFairGame', ProvablyFairGameSchema);