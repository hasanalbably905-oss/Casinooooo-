const mongoose = require("mongoose");

const withdrawSchema = new mongoose.Schema({
    userId: String,
    amount: Number,
    messageId: String,
    status: { type: String, default: "pending" } 
});

module.exports = mongoose.model("Withdraw", withdrawSchema);
