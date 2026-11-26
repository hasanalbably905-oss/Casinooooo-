const mongoose = require('mongoose');

const staffQuestProgressSchema = new mongoose.Schema({
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
    actionsCount: {
        type: Number, // عدد الإجراءات الإدارية التي قام بها الإداري (مثل بان، ميوت، إلخ)
        default: 0
    },
    targetActions: {
        type: Number, // الهدف المطلوب منه للانتهاء من المهمة الإدارية
        required: true,
        default: 50
    },
    isCompleted: {
        type: Boolean,
        default: false
    },
    rewardClaimed: {
        type: Boolean,
        default: false
    },
    lastUpdated: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('StaffQuestProgress', staffQuestProgressSchema);