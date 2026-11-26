const mongoose = require('mongoose');

const competitionSchema = new mongoose.Schema({
    startTime: {
        type: Date,
        required: true,
    },
    endTime: {
        type: Date,
        required: true,
    },
    participants: [{
        userId: String,
        wageredAmount: {
            type: Number,
            default: 0
        }
    }],
    top10Prize: {
        type: Number,
        required: true,
    },
    top3Prize: {
        type: Array,
        required: true,
    },
    entryFee: {
        type: Number,
        default: 0,
    },
    status: {
        type: String,
        enum: ['active', 'ended', 'cancelled'],
        default: 'active',
    },
    messageId: {
        type: String,
        default: null
    }
});

module.exports = mongoose.model('Competition', competitionSchema);