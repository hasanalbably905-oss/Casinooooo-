const { Schema, model } = require("mongoose");

const twoVtwoTakribiSchema = new Schema({
    gameId: { type: String, required: true, unique: true },
    createdAt: { type: Date, default: Date.now },
    startTime: { type: Date },
    endTime: { type: Date },
    status: { type: String, enum: ['pending', 'active', 'finished', 'cancelled'], default: 'pending' },
    
    team1: {
        player1: { type: String, required: true },
        player2: { type: String, required: true },
        currentPlayer: { type: String },
        control: { type: Number, default: 0 },
        hasSwapped: { type: Boolean, default: false }
    },
    
    team2: {
        player1: { type: String, required: true },
        player2: { type: String, required: true },
        currentPlayer: { type: String },
        control: { type: Number, default: 0 },
        hasSwapped: { type: Boolean, default: false }
    },
    
    betAmount: { type: Number, required: true },
    
    targetNumber: { type: Number, required: true },
    currentNumber: { type: Number, default: 0 },
    
    acceptedPlayers: { type: [String], default: [] },
    
    moves: [{
        team: { type: String, enum: ['team1', 'team2'] },
        player: { type: String },
        number: { type: Number },
        newTotal: { type: Number },
        timestamp: { type: Date, default: Date.now }
    }],
    
    winner: { type: String, enum: ['team1', 'team2', 'none'], default: 'none' },
    
    team1Idle: {
        lastAction: { type: Date },
        idleWarning: { type: Boolean, default: false }
    },
    team2Idle: {
        lastAction: { type: Date },
        idleWarning: { type: Boolean, default: false }
    },
    
    messageId: { type: String }
});

module.exports = model("2v2takribi", twoVtwoTakribiSchema);