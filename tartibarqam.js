const mongoose = require('mongoose');

const tartibarqamSchema = new mongoose.Schema({
        msgID: { type: String, required: true, unique: true },
            channelID: { type: String, default: null },
                p1id: { type: String, required: true },
                    p2id: { type: String, required: true },
                        betAmount: { type: Number, required: true },
                            p1Score: { type: Number, default: 0 },
                                p2Score: { type: Number, default: 0 },
                                    currentRound: { type: Number, default: 1 },
                                        gameOver: { type: Boolean, default: false },
}, { timestamps: true });

module.exports = mongoose.model('tartibarqam', tartibarqamSchema);
