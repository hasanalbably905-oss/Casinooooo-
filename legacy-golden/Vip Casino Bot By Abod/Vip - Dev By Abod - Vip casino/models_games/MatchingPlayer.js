const mongoose = require('mongoose');

// MongoDB Schema for Matching Game Player Data
const matchingPlayerSchema = new mongoose.Schema({
    id: { type: String, required: true },              // Player ID
    with: { type: String, required: true },            // Opponent ID
    msgID: { type: String, required: true },           // Game message ID
    score: { type: Number, default: 0 },               // Player's score
    selections: { type: [Number], default: [] },       // Current selections
    createdAt: { type: Date, default: Date.now }       // When the data was created
}, { versionKey: false }); // Disable versioning to prevent concurrency issues

// Create and export the model
const matchingPlayer = mongoose.model('MatchingPlayer', matchingPlayerSchema);
module.exports = matchingPlayer;