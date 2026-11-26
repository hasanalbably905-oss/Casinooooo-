const mongoose = require('mongoose');

const questSchema = new mongoose.Schema({
    guildId: {
        type: String,
        required: true
    },
    userId: {
        type: String,
        required: true
    },
    questId: {
        type: String,
        required: true
    },
    questName: {
        type: String,
        required: true
    },
    progress: {
        type: Number, // التقدم الحالي في المهمة (مثلاً: عدد الرسائل أو الانتصارات)
        default: 0
    },
    target: {
        type: Number, // الهدف المطلوب للانتهاء من المهمة
        required: true,
        default: 10
    },
    status: {
        type: String, // حالة المهمة: 'active', 'completed', 'claimed'
        default: 'active'
    },
    reward: {
        type: Number, // الجائزة أو النقاط عند اكتمال المهمة
        default: 0
    },
    updatedAt: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('Quest', questSchema);