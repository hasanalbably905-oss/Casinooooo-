const mongoose = require('mongoose');

const eventFounderBudgetSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true },
  username: { type: String, required: true },
  totalBudget: { type: Number, default: 0 },
  remainingBudget: { type: Number, default: 0 },
  lastUpdated: { type: Date, default: Date.now }
});

module.exports = mongoose.model('EventFounderBudget', eventFounderBudgetSchema);