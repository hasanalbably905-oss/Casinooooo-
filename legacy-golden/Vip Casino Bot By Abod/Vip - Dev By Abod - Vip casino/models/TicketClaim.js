const mongoose = require('mongoose');

const ticketClaimSchema = new mongoose.Schema({
    guildId: {
        type: String,
        required: true
    },
    ticketId: {
        type: String, // معرف روم التذكرة (Channel ID)
        required: true
    },
    userId: {
        type: String, // معرف العضو صاحب التذكرة
        required: true
    },
    staffId: {
        type: String, // معرف الإداري الذي استلم التذكرة
        required: true
    },
    status: {
        type: String, // حالة التذكرة: 'claimed', 'closed'
        default: 'claimed'
    },
    claimedAt: {
        type: Date,
        default: Date.now
    },
    closedAt: {
        type: Date
    }
});

module.exports = mongoose.model('TicketClaim', ticketClaimSchema);