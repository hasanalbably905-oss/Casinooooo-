const mongoose = require('mongoose');

// MongoDB Schema for Matching Game
const matchingGameSchema = new mongoose.Schema({
    msgID: { type: String, required: true },           // Message ID for the game
    idstusr: { type: String, required: true },         // ID of the challenge initiator
    idwhusr: { type: String, required: true },         // ID of the opponent
    items: { type: [String], required: true },         // Array of emojis for the game
    role: { type: String, required: true },            // Current player's turn
    notrole: { type: String, required: true },         // Other player's ID
    channelID: { type: String, required: true },       // Channel where the game is played
    revealed: { type: [Boolean], default: [] },        // Tiles that are currently revealed
    matched: { type: [Boolean], default: [] },         // Tiles that have been matched
    coins: { type: Number, default: 0 },               // Bet amount for the game
    gameOver: { type: Boolean, default: false },       // Whether the game has ended
    createdAt: { type: Date, default: Date.now }       // When the game was created
}, { versionKey: false }); // Disable versioning to prevent concurrency issues

// Create and export the model
const matchingGame = mongoose.model('MatchingGame', matchingGameSchema);
module.exports = matchingGame;