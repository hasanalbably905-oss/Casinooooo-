const mongoose = require('mongoose');

const botolaSchema = new mongoose.Schema({
      guildId: { type: String, required: true, unique: true },
        tournamentId: { type: String, default: null },
          status: { type: String, enum: ['open', 'running', 'ended'], default: 'open' },
            round: { type: Number, default: 0 },
              
                entryFee: { type: Number, required: true },
                  maxPlayers: { type: Number, required: true },
                    participants: [{
                            id: String,
                                username: String,
                                    active: { type: Boolean, default: true }
                    }],
                      
                        prize: { type: Number, required: true },
                          
                            currentPairs: [[String]],
                              
                                roundWinners: [String],
                                  prevRoundWinners: [String],
                                    
                                      channelId: String,
                                        announceMessageId: String,
                                          tournamentChannelId: String,
                                            /** bracket = جولات ثنائية | 1vall = سلسلة فائز ضد التالي */
                                              format: { type: String, default: 'bracket' },
                                            
                                              games: [{
                                                    matchNumber: Number,
                                                        round: Number,
                                                            player1Id: String,
                                                                player2Id: String,
                                                                    gameType: { 
                                                                              type: String, 
                                                                                    enum: ['takribich', 'nrd', 'rps', 'xo', 'minegame', 'baccarat', 'blackjack', 'roulette', 'matching'],
                                                                                          required: true
                                                                    },
                                                                        winner: String,
                                                                            loser: String,
                                                                                gameData: mongoose.Schema.Types.Mixed,
                                                                                    status: { type: String, enum: ['pending', 'playing', 'finished'], default: 'pending' },
                                                                                        createdAt: { type: Date, default: Date.now }
                                              }],
                                                
                                                  createdAt: { type: Date, default: Date.now },
                                                    startedAt: Date,
                                                      endedAt: Date,
                                                        
                                                          winners: [{
                                                                id: String,
                                                                    username: String,
                                                                        prize: Number,
                                                                            rank: Number,
                                                                                timestamp: Date
                                                          }]
}, { timestamps: true });

botolaSchema.index({ guildId: 1 });
botolaSchema.index({ status: 1 });
botolaSchema.index({ createdAt: 1 });

module.exports = mongoose.model('Botola', botolaSchema);