const mongoose = require('mongoose');

// Simple schema that only stores current game state
const rouletteSchema = new mongoose.Schema({
  gameState: { 
    type: String, 
    enum: ['waiting', 'active', 'ended'], 
    default: 'waiting' 
  },
  messageId: { 
    type: String, 
    default: null 
  },
  startTime: { 
    type: Number, 
    default: null 
  },
  endTime: { 
    type: Number, 
    default: null 
  },
  nextGameTime: { 
    type: Number, 
    default: null 
  },
  bets: [{
    userId: String,
    color: String,
    amount: Number,
    timestamp: Number
  }],
  lastResult: { 
    type: String, 
    default: null 
  },
  lastResultSlot: { 
    type: String, 
    default: null 
  }
}, { minimize: false });

// Static method to get or create a single game document
rouletteSchema.statics.getCurrentGame = async function() {
  let game = await this.findOne({});
  
  if (!game) {
    game = new this({
      gameState: 'waiting',
      startTime: Date.now() + 20000,
      bets: []
    });
    await game.save();
  }
  
  return game;
};

// Reset method to clear data between games
rouletteSchema.statics.resetGame = async function() {
  // Remove all documents and create a fresh one
  await this.deleteMany({});
  
  const game = new this({
    gameState: 'waiting',
    startTime: Date.now() + 20000,
    bets: []
  });
  
  await game.save();
  return game;
};

module.exports = mongoose.model('Roulette', rouletteSchema);