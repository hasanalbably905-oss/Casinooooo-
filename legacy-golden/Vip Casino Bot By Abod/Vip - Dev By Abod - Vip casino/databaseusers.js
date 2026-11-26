const { Schema, model } = require("mongoose");

module.exports = model("Database Users", Schema({
  id: { type: String, required: true },
  user: { type: String },

  coins: { type: Number, default: 0 },
  reps: { type: Number, default: 0 },

  status_playing: { type: String, default: "no" },
  playing: { type: Boolean, default: false },

  withdrawing: { type: Boolean, default: false },
  withdrawalStartTime: { type: Date, default: null },
  withdrawalsToday: { type: Number, default: 0 },
  bonusAmount: { type: Number, default: 0 },

  dailytime: { type: Date, default: () => new Date('2000-08-02T01:33:12.000Z') },
  premiumExpires: { type: Date, default: () => new Date('2000-08-02T01:33:12.000Z') },

  withdraw_amount: { type: Number, default: 0 },
  withdrawmessages: { type: [String], default: [] },

  prembank: { type: Number, default: 0 },

  friends: { type: [String], default: [] },
  challenge: { type: String, default: "general" },
  blocked: { type: [String], default: [] },

  challengesnumber: { type: Number, default: 0 },
  winnumber: { type: Number, default: 0 },
  losenumber: { type: Number, default: 0 },
  tienumber: { type: Number, default: 0 },

  totalwinnings: { type: Number, default: 0 },
  totallost: { type: Number, default: 0 },

  incomingtransactions: { type: Number, default: 0 },
  outcomingtransactions: { type: Number, default: 0 },

  isontransfersure: { type: String, default: 'no' },
  isOnWithdrawal: { type: String, default: "no" },

  takribimessages: { type: [String], default: [] },
  privchannels: { type: [String], default: [] },

  cashback: { type: Number, default: 0 },

  createdAt: { type: Date, default: Date.now },

  bj_wins: { type: Number, default: 0 },
  bj_losses: { type: Number, default: 0 },
  bj_draws: { type: Number, default: 0 },
  bj_coins_won: { type: Number, default: 0 },
  bj_coins_lost: { type: Number, default: 0 },

  xp: { type: Number, default: 0 },
  level: { type: Number, default: 1 },

  bankBalance: { type: Number, default: 0 },

  // Bonus system tracking
  activeBonusId: { type: String, default: null },
  bonusRechargedAmount: { type: Number, default: 0 },
  bonusBonusAmount: { type: Number, default: 0 },
  bonusPlayedAmount: { type: Number, default: 0 },
  bonusEndTime: { type: Date, default: null },
  bonusCondition: { type: String, enum: ["half", "bonus_only", "full"], default: null },
  bonusWithdrawalAllowed: { type: Boolean, default: false }
}));