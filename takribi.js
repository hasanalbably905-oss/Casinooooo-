const mongoose = require("mongoose");

const takribiSchema = new mongoose.Schema({
    msgID: String,
    idstusr: String,
    role: String,
    notrole: String,
    max_number: String,
    number_players_done: String,
    number_smaller1: String,
    number_smaller2: String,
    number_greater1: String,
    number_greater2: String,
    user1: String,
    user2: String,
    channelID: String,
    gameType: { type: String, default: "normal" },
    controllingPlayer: { type: String, default: null }  // Add this line within the schema object
});

module.exports = mongoose.model("takribi", takribiSchema);