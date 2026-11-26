const mongoose = require('mongoose');

const bombChipsSchema = new mongoose.Schema({
        msgID:         { type: String, required: true, unique: true },
            p1:            { type: String, required: true },   // ID اللاعب الأول (المُرسِل)
                p2:            { type: String, required: true },   // ID اللاعب الثاني (المُستقبِل)
                    coins:         { type: Number, default: 0 },
                        channelID:     { type: String, default: '' },

                            // القنابل (مصفوفة indices من 0-8)
                                p1Bombs:       { type: [Number], default: [] },   // قنابل اللاعب 1 (مخفية في شيبس الخصم)
                                    p2Bombs:       { type: [Number], default: [] },   // قنابل اللاعب 2 (مخفية في شيبس الخصم)

                                        // الرومات المؤقتة للي DM مقفل
                                            p1TempChannel: { type: String, default: null },
                                                p2TempChannel: { type: String, default: null },

                                                    // مرحلة اللعبة: 'placing' → 'guessing' → 'finished'
                                                        phase:         { type: String, default: 'placing' },

                                                            createdAt:     { type: Date, default: Date.now, expires: 3600 } // تُحذف تلقائياً بعد ساعة
});

module.exports = mongoose.models.BombChips || mongoose.model('BombChips', bombChipsSchema);

