const mongoose = require('mongoose');

const takribiHistorySchema = new mongoose.Schema({
        id: String,
            msgID: String,
                with: String,
                    numbers: [{
                                value: Number,
                                        time: Number
                    }],
                        result: Number,
                            // بيانات المباراة الكاملة (نحفظها مرة واحدة من اللاعب الأول فقط)
                                max_number: String,
                                    number_smaller1: String,
                                        number_smaller2: String,
                                            number_greater1: String,
                                                number_greater2: String,
                                                    user1: String,
                                                        user2: String,
                                                            gameType: { type: String, default: "normal" }
});

module.exports = mongoose.model('takribiHistory', takribiHistorySchema);

        