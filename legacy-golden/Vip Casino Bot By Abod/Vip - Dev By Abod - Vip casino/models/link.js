const mongoose = require('mongoose');

const linkSchema = new mongoose.Schema({
    userId: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    partnerId: {
        type: String,
        required: true
    },
    linkedAt: {
        type: Date,
        default: Date.now
    },
    totalTransfers: {
        type: Number,
        default: 0
    },
    lastTransferAt: {
        type: Date,
        default: null
    }
}, {
    timestamps: true
});


linkSchema.index({ partnerId: 1 });
linkSchema.index({ linkedAt: -1 });

const Link = mongoose.model('Link', linkSchema);

module.exports = Link;
